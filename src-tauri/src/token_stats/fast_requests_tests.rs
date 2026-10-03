//! Synthetic diagnostics only; never open the real Codex home in tests.
use super::*;
use rusqlite::{params, Connection};

const THREAD: &str = "11111111-1111-4111-8111-111111111111";
const TURN: &str = "22222222-2222-4222-8222-222222222222";
const OTHER: &str = "33333333-3333-4333-8333-333333333333";

fn diagnostic(thread: &str, turn: &str, tags: Value) -> String {
    format!("session_loop{{thread_id={thread}}}:submission_dispatch{{otel.name=\"submission_dispatch\" submission.id=\"synthetic\" codex.op=\"user_input\"}}:turn{{otel.name=\"turn\" thread.id={thread} turn.id={turn} model=synthetic codex.turn.reasoning_effort=max}}:session_task.run:run_turn:run_sampling_request{{turn_id={turn} model=synthetic cwd=/synthetic workspace}}:try_run_sampling_request{{turn_id={turn} model=synthetic}}: model=\"synthetic\" tags_json={tags}")
}

fn diagnostics(h: &Harness) -> Connection {
    let db = Connection::open(h.home.join("logs_2.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE logs(id INTEGER PRIMARY KEY, thread_id TEXT, target TEXT, feedback_log_body TEXT); PRAGMA journal_mode=WAL;").unwrap();
    db
}

fn add(db: &Connection, thread: &str, body: &str) {
    db.execute(
        "INSERT INTO logs(thread_id,target,feedback_log_body) VALUES(?1,'feedback_tags',?2)",
        params![thread, body],
    )
    .unwrap();
}

fn rollout(h: &Harness, selection: Option<&str>) {
    let mut values = vec![meta(THREAD)];
    if let Some(tier) = selection {
        values.push(fast_settings(THREAD, Some(tier)));
    }
    values.extend([
        fast_turn(TURN),
        fast_fact(THREAD, TURN, 10),
        completed_turn(TURN, AT),
    ]);
    write(&h.log(), &values);
}

#[test]
fn fast_request_metadata_fills_a_turn_without_initial_settings() {
    let mut h = Harness::new();
    rollout(&h, None);
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    let accounting = accounting_dump(&h.db);
    let snapshots = metadata_table_dump(&h.db, "quota_snapshots");
    let checkpoints = metadata_table_dump(&h.db, "source_files");
    let db = diagnostics(&h);
    let body = diagnostic(
        THREAD,
        TURN,
        json!({"service_tier":"priority", "feature.fast_mode":"true"}),
    );
    add(&db, THREAD, &body);
    // The active producer has not checkpointed its WAL.
    let source_before = metadata_table_dump(&db, "logs");
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
    assert_eq!(accounting_dump(&h.db), accounting);
    assert_eq!(metadata_table_dump(&h.db, "quota_snapshots"), snapshots);
    assert_eq!(metadata_table_dump(&h.db, "source_files"), checkpoints);
    assert_eq!(metadata_table_dump(&db, "logs"), source_before);
    let saved: String =
        h.db.query_row(
            "SELECT root || thread || turn || flags FROM fast_request_evidence",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!saved.contains(THREAD));
    assert!(!saved.contains(TURN));
    assert!(!saved.contains("/synthetic workspace"));
}

#[test]
fn fast_request_metadata_exact_tiers_and_feature_flags_are_distinct() {
    for (tags, expected) in [
        (json!({"service_tier":"priority"}), json!(true)),
        (json!({"service_tier":"fast"}), json!(true)),
        (
            json!({"service_tier":"default","feature.fast_mode":"true"}),
            json!(false),
        ),
        (json!({"feature.fast_mode":"true"}), Value::Null),
        (json!({"service_tier":"flex"}), Value::Null),
        (json!({"service_tier":"Priority"}), Value::Null),
        (json!({"service_tier":true}), Value::Null),
        (json!({"service_tier":null}), Value::Null),
    ] {
        let mut h = Harness::new();
        rollout(&h, None);
        add(
            &diagnostics(&h),
            THREAD,
            &diagnostic(THREAD, TURN, tags.clone()),
        );
        h.scan();
        assert_eq!(fast_rows(&mut h), vec![expected], "{tags}");
    }
}

#[test]
fn fast_request_metadata_requires_matching_structured_thread_and_turn_spans() {
    let valid = diagnostic(THREAD, TURN, json!({"service_tier":"priority"}));
    let invalid = [
        (OTHER, valid.clone()),
        (
            THREAD,
            diagnostic(OTHER, TURN, json!({"service_tier":"priority"})),
        ),
        (
            THREAD,
            valid.replace(
                &format!("thread.id={THREAD}"),
                &format!("thread.id={OTHER}"),
            ),
        ),
        (
            THREAD,
            valid.replacen(&format!("turn_id={TURN}"), &format!("turn_id={OTHER}"), 1),
        ),
        (
            THREAD,
            valid.replace(
                &format!("try_run_sampling_request{{turn_id={TURN}"),
                &format!("try_run_sampling_request{{turn_id={OTHER}"),
            ),
        ),
        (
            THREAD,
            valid.replace("try_run_sampling_request", "other_request"),
        ),
        (THREAD, format!("ToolCall: {valid}")),
        (THREAD, format!("{valid} trailing-text")),
        (
            THREAD,
            valid.replace(
                &format!("turn.id={TURN}"),
                &format!("turn.id={TURN} turn.id={OTHER}"),
            ),
        ),
        (
            THREAD,
            valid
                .replace(
                    "otel.name=\"turn\"",
                    &format!("otel.name=\"quoted thread.id={OTHER} turn.id={OTHER}\""),
                )
                .replace(&format!(" thread.id={THREAD} turn.id={TURN}"), ""),
        ),
    ];
    for (thread, body) in invalid {
        let mut h = Harness::new();
        rollout(&h, None);
        add(&diagnostics(&h), thread, &body);
        h.scan();
        assert_eq!(fast_rows(&mut h), vec![Value::Null], "{body}");
    }
}

#[test]
fn fast_request_metadata_does_not_carry_to_other_turns_or_threads() {
    let mut h = Harness::new();
    rollout(&h, None);
    append(
        &h.log(),
        &[
            fast_turn(OTHER),
            fast_fact(THREAD, OTHER, 20),
            completed_turn(OTHER, "2026-09-05T01:01:00Z"),
        ],
    );
    let db = diagnostics(&h);
    add(
        &db,
        OTHER,
        &diagnostic(OTHER, TURN, json!({"service_tier":"priority"})),
    );
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, OTHER, json!({"service_tier":"priority"})),
    );
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true), Value::Null]);
}

#[test]
fn fast_request_metadata_conflicts_with_settings_or_other_requests_stay_unknown() {
    for selection in [None, Some("priority"), Some("default")] {
        let mut h = Harness::new();
        rollout(&h, selection);
        let db = diagnostics(&h);
        add(
            &db,
            THREAD,
            &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
        );
        h.scan();
        add(
            &db,
            THREAD,
            &diagnostic(THREAD, TURN, json!({"service_tier":"default"})),
        );
        h.scan();
        assert_eq!(fast_rows(&mut h), vec![Value::Null]);
        db.execute("DELETE FROM logs", []).unwrap();
        h.restart();
        h.scan();
        assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    }
}

#[test]
fn fast_request_metadata_survives_log_rotation_and_legacy_repair_restarts() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    h.scan();
    let accounting = accounting_dump(&h.db);
    drop(db);
    fs::remove_file(h.home.join("logs_2.sqlite")).unwrap();
    // Simulate an incomplete revision-2 repair that runs again at startup.
    h.db.execute("UPDATE model_repairs SET revision=1", [])
        .unwrap();
    h.restart();
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
    assert_eq!(accounting_dump(&h.db), accounting);
    assert_eq!(
        h.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
}

#[test]
fn fast_request_metadata_optional_failures_do_not_block_statistics() {
    for kind in ["missing", "corrupt", "schema", "locked", "directory"] {
        let mut h = Harness::new();
        rollout(&h, None);
        let path = h.home.join("logs_2.sqlite");
        let mut guard = None;
        match kind {
            "corrupt" => fs::write(&path, b"not a database").unwrap(),
            "schema" => {
                Connection::open(&path)
                    .unwrap()
                    .execute_batch("CREATE TABLE unrelated(value TEXT)")
                    .unwrap();
            }
            "locked" => {
                let db = diagnostics(&h);
                db.execute_batch("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE")
                    .unwrap();
                guard = Some(db);
            }
            "directory" => fs::create_dir(&path).unwrap(),
            _ => {}
        }
        h.scan();
        assert_eq!(h.total(), "10", "{kind}");
        assert_eq!(fast_rows(&mut h), vec![Value::Null], "{kind}");
        if kind == "missing" {
            assert!(!path.exists());
        }
        drop(guard);
    }
}

#[test]
fn fast_request_metadata_ignores_wrong_target_oversized_and_malformed_tags() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    let valid = diagnostic(THREAD, TURN, json!({"service_tier":"priority"}));
    add(&db, THREAD, &valid);
    db.execute("UPDATE logs SET target='message_body'", [])
        .unwrap();
    add(
        &db,
        THREAD,
        &diagnostic(
            THREAD,
            TURN,
            json!({"service_tier":"priority","padding":"x".repeat(65536)}),
        ),
    );
    add(
        &db,
        THREAD,
        &valid.replace(
            "{\"service_tier\":\"priority\"}",
            "{\"service_tier\":\"priority\",\"service_tier\":\"default\"}",
        ),
    );
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    add(&db, THREAD, &valid);
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
}

#[test]
fn fast_request_metadata_replacement_and_id_reset_are_replayed() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    for _ in 0..3 {
        add(
            &db,
            THREAD,
            &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
        );
    }
    h.scan();
    db.execute("DELETE FROM logs", []).unwrap();
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"default"})),
    );
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    drop(db);
    fs::rename(h.home.join("logs_2.sqlite"), h.home.join("old-log.sqlite")).unwrap();
    let db = diagnostics(&h);
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
}

#[test]
fn fast_request_metadata_batches_do_not_skip_rows() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    db.execute_batch("BEGIN").unwrap();
    for _ in 0..1024 {
        add(
            &db,
            THREAD,
            &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
        );
    }
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"default"})),
    );
    db.execute_batch("COMMIT").unwrap();
    h.scan();
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
}

#[test]
fn fast_request_metadata_failed_commit_does_not_advance_source_cursor() {
    let mut h = Harness::new();
    rollout(&h, None);
    h.scan();
    add(
        &diagnostics(&h),
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    h.db.execute_batch("CREATE TRIGGER fail_request_commit BEFORE UPDATE ON source_roots BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(h
        .scanner
        .scan(&mut h.db, &h.source, &AtomicBool::new(false), |_| {})
        .is_err());
    assert_eq!(
        h.db.query_row("SELECT COUNT(*) FROM fast_request_evidence", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    h.db.execute_batch("DROP TRIGGER fail_request_commit")
        .unwrap();
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
}

#[test]
fn fast_request_metadata_reads_recent_and_live_rows_during_historical_replay() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    db.execute_batch("BEGIN").unwrap();
    for _ in 0..1100 {
        add(
            &db,
            OTHER,
            &diagnostic(OTHER, TURN, json!({"service_tier":"default"})),
        );
    }
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    db.execute_batch("COMMIT").unwrap();
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"default"})),
    );
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
}

#[cfg(unix)]
#[test]
fn fast_request_metadata_rejects_symlink_sources() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    drop(db);
    let path = h.home.join("logs_2.sqlite");
    let moved = h.temp.path().join("elsewhere.sqlite");
    fs::rename(&path, &moved).unwrap();
    std::os::unix::fs::symlink(&moved, &path).unwrap();
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
}

#[test]
fn fast_request_metadata_history_progresses_under_continuous_unrelated_live_logs() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    db.execute_batch("BEGIN; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2200) INSERT INTO logs(target) SELECT 'unrelated' FROM n; COMMIT").unwrap();
    h.scan();
    // The oldest record must wait: LIMIT bounds all source rows, not matches.
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    for round in 0..3 {
        db.execute_batch("BEGIN; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<600) INSERT INTO logs(target) SELECT 'unrelated' FROM n; COMMIT").unwrap();
        h.scan();
        assert_eq!(
            fast_rows(&mut h),
            vec![if round == 2 { json!(true) } else { Value::Null }]
        );
    }
    assert_eq!(h.total(), "10");
}

#[test]
fn fast_request_metadata_rejects_unsupported_source_layouts() {
    for ddl in [
        "CREATE TABLE logs(id TEXT PRIMARY KEY,thread_id TEXT,target TEXT,feedback_log_body TEXT)",
        "CREATE TABLE logs(id INTEGER,thread_id TEXT,target TEXT,feedback_log_body TEXT)",
        "CREATE TABLE logs(id INTEGER PRIMARY KEY DESC,thread_id TEXT,target TEXT,feedback_log_body TEXT)",
        "CREATE TABLE logs(id INTEGER,thread_id TEXT,target TEXT,feedback_log_body TEXT,PRIMARY KEY(id,thread_id))",
        "CREATE TABLE logs(id INTEGER PRIMARY KEY,thread_id TEXT,target TEXT,feedback_log_body TEXT) WITHOUT ROWID",
        "CREATE VIEW logs AS SELECT 1 AS id, '' AS thread_id, '' AS target, '' AS feedback_log_body",
    ] {
        let mut h = Harness::new();
        rollout(&h, None);
        let db = Connection::open(h.home.join("logs_2.sqlite")).unwrap();
        db.execute_batch(ddl).unwrap();
        h.scan();
        assert_eq!(h.total(), "10", "{ddl}");
        assert_eq!(fast_rows(&mut h), vec![Value::Null], "{ddl}");
    }
}

#[test]
fn fast_request_metadata_bounds_invalid_values_and_requires_exact_target() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = Connection::open(h.home.join("logs_2.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE logs(id INTEGER PRIMARY KEY,thread_id TEXT,target TEXT COLLATE NOCASE,feedback_log_body TEXT)").unwrap();
    let valid = diagnostic(THREAD, TURN, json!({"service_tier":"priority"}));
    add(&db, THREAD, &valid);
    db.execute("UPDATE logs SET target='FEEDBACK_TAGS'", [])
        .unwrap();
    add(&db, &"x".repeat(1_000_000), &valid);
    db.execute(
        "INSERT INTO logs(thread_id,target,feedback_log_body) VALUES(?1,'feedback_tags',?2)",
        params![THREAD, valid.as_bytes()],
    )
    .unwrap();
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    add(&db, THREAD, &valid);
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
    assert_eq!(h.total(), "10");
}

#[test]
fn fast_request_metadata_root_switch_does_not_reuse_even_a_hardlinked_cursor() {
    let mut h = Harness::new();
    rollout(&h, None);
    let db = diagnostics(&h);
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    drop(db);
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
    let original = h.source.clone();
    let original_log = fs::read(h.log()).unwrap();
    for (name, linked) in [("second-root", true), ("third-root", false)] {
        let root = h.temp.path().join(name);
        fs::create_dir_all(root.join("sessions")).unwrap();
        fs::write(root.join("sessions/rollout-synthetic.jsonl"), &original_log).unwrap();
        if linked {
            fs::hard_link(h.home.join("logs_2.sqlite"), root.join("logs_2.sqlite")).unwrap();
        }
        h.source = Source::configured(Some(root.into_os_string()), None).unwrap();
        h.scan();
        assert_eq!(
            fast_rows(&mut h),
            vec![if linked { json!(true) } else { Value::Null }]
        );
        assert_eq!(h.total(), "10");
    }
    h.source = original;
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
}

#[test]
fn fast_request_metadata_cancelled_read_leaves_cursor_replayable() {
    let mut h = Harness::new();
    rollout(&h, None);
    h.scan();
    let db = diagnostics(&h);
    add(
        &db,
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    let generation = store::generation(&h.db).unwrap();
    assert!(h
        .scanner
        .scan(&mut h.db, &h.source, &AtomicBool::new(true), |_| panic!(
            "cancelled scan committed"
        ))
        .is_err());
    assert_eq!(store::generation(&h.db).unwrap(), generation);
    assert_eq!(fast_rows(&mut h), vec![Value::Null]);
    h.scan();
    assert_eq!(fast_rows(&mut h), vec![json!(true)]);
}

#[test]
fn fast_request_metadata_service_refresh_emits_committed_quota_snapshot() {
    use super::super::service::TokenStatisticsService;
    use std::{sync::mpsc, time::Duration};
    let mut h = Harness::new();
    rollout(&h, None);
    append(
        &h.log(),
        &[
            fast_settings(THREAD, Some("default")),
            fast_turn(OTHER),
            fast_fact(THREAD, OTHER, 20),
            completed_turn(OTHER, "2026-09-05T01:02:00Z"),
        ],
    );
    h.scan();
    observation(&mut h, "2026-09-05T01:03:00Z", 72.5, "2026-09-10T00:00:00Z").unwrap();
    let (send, receive) = mpsc::channel();
    let service = TokenStatisticsService::start_source(
        Some(h.path.clone()),
        Ok(h.source.clone()),
        move |n| {
            let _ = send.send(serde_json::to_value(n).unwrap());
        },
    );
    let completed = || loop {
        let event = receive
            .recv_timeout(Duration::from_secs(5))
            .expect("service refresh timed out");
        if event["scanning"] == false {
            break event;
        }
    };
    let initial_event = completed();
    let root = h.source.resolve().unwrap().1;
    let snapshot = |db: &mut Connection| {
        serde_json::to_value(
            aggregate::query_with_quota(
                db,
                &root,
                DateTime::parse_from_rfc3339("2026-09-05T10:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
                chrono_tz::UTC,
                Some(&quota_window()),
            )
            .unwrap(),
        )
        .unwrap()
    };
    let before = snapshot(&mut h.db);
    assert_eq!(before["turnStatistics"]["turns"][0]["fastMode"], false);
    assert!(before["turnStatistics"]["turns"][1]["fastMode"].is_null());
    let accounting = accounting_dump(&h.db);
    let checkpoints = metadata_table_dump(&h.db, "source_files");
    let quotas = metadata_table_dump(&h.db, "quota_snapshots");
    let jsonl = fs::read(h.log()).unwrap();
    add(
        &diagnostics(&h),
        THREAD,
        &diagnostic(THREAD, TURN, json!({"service_tier":"priority"})),
    );
    assert!(service.refresh().queued);
    let event = completed();
    let after = snapshot(&mut h.db);
    service.stop();
    assert!(
        event["generation"]
            .as_str()
            .unwrap()
            .parse::<i64>()
            .unwrap()
            > initial_event["generation"]
                .as_str()
                .unwrap()
                .parse::<i64>()
                .unwrap()
    );
    assert_eq!(event["generation"], after["generation"]);
    assert_eq!(event["sourceId"], after["sourceId"]);
    let mut expected_turns = before["turnStatistics"].clone();
    expected_turns["turns"][1]["fastMode"] = json!(true);
    assert_eq!(after["turnStatistics"], expected_turns);
    for field in ["total", "today", "thisWeek", "thisMonth", "modelStatistics"] {
        assert_eq!(before[field], after[field], "{field}");
    }
    assert_eq!(accounting_dump(&h.db), accounting);
    assert_eq!(metadata_table_dump(&h.db, "source_files"), checkpoints);
    assert_eq!(metadata_table_dump(&h.db, "quota_snapshots"), quotas);
    assert_eq!(fs::read(h.log()).unwrap(), jsonl);
    // Optional synthetic handoff for the controller+DOM integration test. No
    // production data or app behavior depends on this test-only environment.
    if let Some(path) = std::env::var_os("FAST_REQUEST_REFRESH_FIXTURE") {
        fs::write(
            path,
            serde_json::to_vec_pretty(&json!({"before":before,"after":after,"notification":event}))
                .unwrap(),
        )
        .unwrap();
    }
}
