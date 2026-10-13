//! Compatibility fixtures are constructed from the unchanged pre-patch schemas.
//! No real Monitor database or Codex diagnostic source is opened by these tests.
use super::*;
use rusqlite::{params, Connection};

const ORIGINAL_REPAIR_SCHEMA: &str = "CREATE TABLE model_repairs (
    root TEXT PRIMARY KEY REFERENCES source_roots(root), revision INTEGER NOT NULL);
    CREATE INDEX model_source_lookup ON fact_sources(file,start,end)";

fn original_schema(path: &Path, version: i64) -> Connection {
    let db = Connection::open(path).unwrap();
    db.execute_batch(include_str!("schema.sql")).unwrap();
    if version >= 2 {
        db.execute_batch(include_str!("model_schema.sql")).unwrap();
    }
    if version >= 3 {
        db.execute_batch(ORIGINAL_REPAIR_SCHEMA).unwrap();
        db.execute_batch(include_str!("turn_schema.sql")).unwrap();
    }
    if version >= 4 {
        db.execute_batch(include_str!("fast_schema.sql")).unwrap();
    }
    db
}

fn original_v130_fixture() -> Harness {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("synthetic-codex");
    fs::create_dir_all(home.join("sessions")).unwrap();
    let path = temp.path().join("original-v130.sqlite3");
    let db = original_schema(&path, 4);
    let source = Source::configured(Some(home.clone().into_os_string()), None).unwrap();
    let root = source.resolve().unwrap().1;
    store::source(&db, &source.locator, Some(&root)).unwrap();
    db.execute(
        "INSERT INTO threads(root,thread,mode) VALUES(?1,'synthetic-thread','modern')",
        [&root],
    )
    .unwrap();
    db.execute("INSERT INTO token_facts(id,root,thread,input,output,cached,reasoning,cache_write,at,time_status,format,active,rule_version) VALUES('synthetic-fact',?1,'synthetic-thread',11,6,3,2,0,?2,'dated','response',1,1)", params![root, AT]).unwrap();
    db.execute("INSERT INTO fact_identities(root,kind,identity,fact) VALUES(?1,'response','synthetic-response','synthetic-fact')", [&root]).unwrap();
    db.execute("INSERT INTO model_turns(root,thread,turn,model,effort,completed_at,completion_status,fast_mode) VALUES(?1,'synthetic-thread','synthetic-turn','synthetic','high',?2,'completed',0)", params![root, AT]).unwrap();
    db.execute("INSERT INTO model_identities(root,kind,identity,thread,turn) VALUES(?1,'response','synthetic-response','synthetic-thread','synthetic-turn')", [&root]).unwrap();
    db.execute(
        "INSERT INTO model_repairs(root,revision) VALUES(?1,2)",
        [&root],
    )
    .unwrap();
    db.execute("INSERT INTO quota_snapshots(root,weekly_reset_at,observed_at,remaining_percent) VALUES(?1,'2026-09-10T00:00:00.000000000Z',?2,78.5)", params![root, "2026-09-05T01:01:00.000000000Z"]).unwrap();
    Harness {
        temp,
        home,
        path,
        db,
        scanner: Scanner::new(),
        source,
    }
}

fn schema_dump(db: &Connection, exclude_request_table: bool) -> Vec<String> {
    let mut statement = db
        .prepare("SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master WHERE (?1=0 OR name!='fast_request_evidence') ORDER BY type,name")
        .unwrap();
    statement
        .query_map([exclude_request_table], |row| {
            Ok(format!(
                "{}|{}|{}|{}",
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn original_metadata_dump(db: &Connection) -> Vec<Vec<String>> {
    [
        "statistics_meta",
        "source_roots",
        "root_locators",
        "threads",
        "model_turns",
        "model_identities",
        "model_checkpoints",
        "model_repairs",
        "quota_snapshots",
    ]
    .map(|table| metadata_table_dump(db, table))
    .to_vec()
}

fn request_table_count(db: &Connection) -> i64 {
    db.query_row(
        "SELECT count(*) FROM sqlite_master WHERE name='fast_request_evidence'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn request_evidence_dump(db: &Connection) -> Vec<(String, String, String, i64)> {
    let mut statement = db
        .prepare(
            "SELECT root,thread,turn,flags FROM fast_request_evidence ORDER BY root,thread,turn",
        )
        .unwrap();
    statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn assert_no_sqlite_sidecars(path: &Path) {
    for suffix in ["-wal", "-shm", "-journal"] {
        assert!(!PathBuf::from(format!("{}{suffix}", path.display())).exists());
    }
}

#[test]
fn fast_request_schema4_upgrade_and_reopen_preserve_legacy_statistics() {
    let mut h = original_v130_fixture();
    assert_eq!(request_table_count(&h.db), 0);
    let schema = schema_dump(&h.db, true);
    let accounting = accounting_dump(&h.db);
    let metadata = original_metadata_dump(&h.db);
    let snapshot = serde_json::to_value(h.snapshot()).unwrap();
    let turns = by_turn(&mut h);
    assert_eq!(snapshot["total"]["totalTokens"], "17");
    assert_eq!(turns["turns"][0]["fastMode"], false);
    assert_eq!(turns["turns"][0]["weeklyRemaining"], 78.5);

    h.restart();
    assert_eq!(request_table_count(&h.db), 1);
    let mut columns = h
        .db
        .prepare("SELECT name,type,\"notnull\",pk FROM pragma_table_info('fast_request_evidence') ORDER BY cid")
        .unwrap();
    let actual: Vec<(String, String, i64, i64)> = columns
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        actual,
        vec![
            ("root".into(), "TEXT".into(), 1, 1),
            ("thread".into(), "TEXT".into(), 1, 2),
            ("turn".into(), "TEXT".into(), 1, 3),
            ("flags".into(), "INTEGER".into(), 1, 0),
        ]
    );
    drop(columns);
    let root = h.source.resolve().unwrap().1;
    for invalid in [0, 4] {
        assert!(h
            .db
            .execute(
                "INSERT INTO fast_request_evidence VALUES(?1,'synthetic-thread','synthetic-turn',?2)",
                params![root, invalid],
            )
            .is_err());
    }
    h.db.execute(
        "INSERT INTO fast_request_evidence VALUES(?1,'synthetic-thread','synthetic-turn',1)",
        [&root],
    )
    .unwrap();
    let evidence = request_evidence_dump(&h.db);
    assert_eq!(evidence.len(), 1);

    for _ in 0..2 {
        h.restart();
        assert_eq!(
            h.db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(schema_dump(&h.db, true), schema);
        assert_eq!(accounting_dump(&h.db), accounting);
        assert_eq!(original_metadata_dump(&h.db), metadata);
        assert_eq!(request_evidence_dump(&h.db), evidence);
        assert_eq!(serde_json::to_value(h.snapshot()).unwrap(), snapshot);
        assert_eq!(by_turn(&mut h), turns);

        // This existing reader and aggregate path needs no supplementary-table query.
        let mut reader = store::open_reader(&h.path).unwrap();
        let read = aggregate::query(
            &mut reader,
            &root,
            DateTime::parse_from_rfc3339("2026-09-05T02:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            chrono_tz::Asia::Shanghai,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(read).unwrap(), snapshot);
    }
}

#[test]
fn fast_request_incompatible_databases_are_unchanged_before_supplemental_ddl() {
    for (mutation, expected) in [
        ("PRAGMA application_id=42", "databaseIncompatible"),
        ("PRAGMA user_version=5", "databaseIncompatible"),
        (
            "UPDATE statistics_meta SET parser_version=2 WHERE singleton=1",
            "parserIncompatible",
        ),
    ] {
        let h = original_v130_fixture();
        h.db.execute_batch(mutation).unwrap();
        let schema = schema_dump(&h.db, false);
        let accounting = accounting_dump(&h.db);
        let metadata = original_metadata_dump(&h.db);
        let bytes = fs::read(&h.path).unwrap();
        assert_no_sqlite_sidecars(&h.path);
        assert_eq!(store::open(&h.path).unwrap_err().to_string(), expected);
        assert_eq!(request_table_count(&h.db), 0);
        assert_eq!(schema_dump(&h.db, false), schema);
        assert_eq!(accounting_dump(&h.db), accounting);
        assert_eq!(original_metadata_dump(&h.db), metadata);
        assert_eq!(fs::read(&h.path).unwrap(), bytes);
        assert_no_sqlite_sidecars(&h.path);
    }
}

#[test]
fn fast_request_late_migration_failure_rolls_back_supplemental_and_prior_ddl() {
    for version in [1, 2] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("synthetic-late-ddl.sqlite3");
        let db = original_schema(&path, version);
        db.execute_batch("CREATE TABLE turn_completion_lookup(payload TEXT); INSERT INTO turn_completion_lookup VALUES('preserved synthetic user data')").unwrap();
        let schema = schema_dump(&db, false);
        let accounting = accounting_dump(&db);
        let blocker = metadata_table_dump(&db, "turn_completion_lookup");
        let bytes = fs::read(&path).unwrap();
        assert!(store::open(&path).is_err());
        assert_eq!(request_table_count(&db), 0);
        assert_eq!(schema_dump(&db, false), schema);
        assert_eq!(accounting_dump(&db), accounting);
        assert_eq!(metadata_table_dump(&db, "turn_completion_lookup"), blocker);
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            version
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_no_sqlite_sidecars(&path);
    }
}

#[test]
fn fast_request_same_name_table_view_or_index_is_rejected_without_data_loss() {
    for object in [
        "CREATE TABLE fast_request_evidence(payload TEXT); INSERT INTO fast_request_evidence VALUES('preserved synthetic user data')",
        "CREATE TABLE FAST_REQUEST_EVIDENCE(blocker TEXT); INSERT INTO FAST_REQUEST_EVIDENCE VALUES('preserved synthetic user data')",
        "CREATE TABLE fast_request_evidence(root TEXT NOT NULL,thread TEXT NOT NULL,turn TEXT NOT NULL,flags INTEGER NOT NULL,PRIMARY KEY(root,thread,turn)) WITHOUT ROWID",
        "CREATE VIEW fast_request_evidence AS SELECT payload FROM unrelated_user_data",
        "CREATE INDEX fast_request_evidence ON unrelated_user_data(payload)",
    ] {
        let h = original_v130_fixture();
        h.db.execute_batch("CREATE TABLE unrelated_user_data(payload TEXT); INSERT INTO unrelated_user_data VALUES('preserved synthetic user data')").unwrap();
        h.db.execute_batch(object).unwrap();
        let schema = schema_dump(&h.db, false);
        let accounting = accounting_dump(&h.db);
        let metadata = original_metadata_dump(&h.db);
        let unrelated = metadata_table_dump(&h.db, "unrelated_user_data");
        let bytes = fs::read(&h.path).unwrap();
        assert_eq!(
            store::open(&h.path).unwrap_err().to_string(),
            "databaseIncompatible",
            "{object}"
        );
        assert_eq!(schema_dump(&h.db, false), schema);
        assert_eq!(accounting_dump(&h.db), accounting);
        assert_eq!(original_metadata_dump(&h.db), metadata);
        assert_eq!(metadata_table_dump(&h.db, "unrelated_user_data"), unrelated);
        assert_eq!(fs::read(&h.path).unwrap(), bytes);
        assert_no_sqlite_sidecars(&h.path);
    }
}
