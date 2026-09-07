use super::{model::*, Result, PARSER_VERSION, SCHEMA_VERSION};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use std::{fs, path::Path, time::Duration};

pub const BUSY_TIMEOUT: Duration = Duration::from_millis(250);
const APPLICATION_ID: i64 = 1129598795;

pub fn validate(connection: &Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let app: i64 = connection.query_row("PRAGMA application_id", [], |r| r.get(0))?;
    if version != SCHEMA_VERSION || app != APPLICATION_ID {
        return Err("databaseIncompatible".into());
    }
    let parser: i64 = connection.query_row(
        "SELECT parser_version FROM statistics_meta WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    // Accounting parser/rule version remains V1; model metadata is independent.
    if parser != PARSER_VERSION {
        return Err("parserIncompatible".into());
    }
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection> {
    let fresh = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() => {
            return Err("databaseUnsafePath".into())
        }
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => return Err("databaseUnavailable".into()),
    };
    if fresh {
        let parent = path.parent().ok_or("databasePathUnavailable")?;
        if !parent.exists() {
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder
                .create(parent)
                .map_err(|_| super::Error("persistenceDegraded"))?;
        }
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(path)
            .map_err(|_| super::Error("persistenceDegraded"))?;
    }
    let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    if fresh {
        let tx = connection.transaction()?;
        tx.execute_batch(include_str!("schema.sql"))?;
        tx.execute_batch(include_str!("model_schema.sql"))?;
        tx.commit()?;
    }
    // Refuse foreign/newer databases before any migration or journal mutation.
    let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let app: i64 = connection.query_row("PRAGMA application_id", [], |r| r.get(0))?;
    if app != APPLICATION_ID || !matches!(version, 1 | SCHEMA_VERSION) {
        return Err("databaseIncompatible".into());
    }
    let parser: i64 = connection.query_row(
        "SELECT parser_version FROM statistics_meta WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    if parser != PARSER_VERSION {
        return Err("parserIncompatible".into());
    }
    let check: String = connection.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err("databaseCorrupt".into());
    }
    let violations: i64 =
        connection.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })?;
    if violations != 0 {
        return Err("databaseCorrupt".into());
    }
    if version == 1 {
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute_batch(include_str!("model_schema.sql"))?;
        tx.commit()?;
    }
    validate(&connection)?;
    connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1000; PRAGMA trusted_schema=OFF;")?;
    Ok(connection)
}

pub fn open_reader(path: &Path) -> Result<Connection> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    validate(&connection)?;
    connection.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")?;
    Ok(connection)
}

pub fn generation(connection: &Connection) -> Result<i64> {
    Ok(connection.query_row(
        "SELECT generation FROM statistics_meta WHERE singleton=1",
        [],
        |r| r.get(0),
    )?)
}

pub fn bump(tx: &Transaction<'_>) -> Result<i64> {
    let next = generation(tx)?.checked_add(1).ok_or("generationOverflow")?;
    tx.execute(
        "UPDATE statistics_meta SET generation=?1 WHERE singleton=1",
        [next],
    )?;
    Ok(next)
}

pub fn root_state(connection: &Connection, root: &str) -> Result<RootState> {
    let raw: Option<String> = connection
        .query_row(
            "SELECT state FROM source_roots WHERE root=?1",
            [root],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|s| from_json(&s))
        .unwrap_or_else(|| Ok(RootState::default()))
}

pub fn source(
    connection: &Connection,
    locator: &str,
    root: Option<&str>,
) -> Result<Option<String>> {
    if let Some(root) = root {
        connection.execute(
            "INSERT OR IGNORE INTO source_roots VALUES(?1,?2)",
            params![root, json(&RootState::default())?],
        )?;
        connection.execute("INSERT INTO root_locators VALUES(?1,?2) ON CONFLICT(locator) DO UPDATE SET root=excluded.root", params![locator,root])?;
        return Ok(Some(root.into()));
    }
    Ok(connection
        .query_row(
            "SELECT root FROM root_locators WHERE locator=?1",
            [locator],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn issue(
    connection: &Connection,
    root: &str,
    file: &str,
    position: u64,
    code: &str,
) -> Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO quality_issues VALUES(?1,?2,?3,?4)",
        params![root, file, position, code],
    )?;
    Ok(())
}

pub fn add_fact(connection: &Connection, root: &str, fact: &Fact) -> Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO token_facts VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,1,?13)",
        params![
            fact.id,
            root,
            fact.thread,
            fact.usage.input,
            fact.usage.output,
            fact.usage.cached,
            fact.usage.reasoning,
            fact.usage.cache_write,
            fact.at,
            fact.end,
            fact.time_status,
            fact.format,
            PARSER_VERSION
        ],
    )?;
    Ok(())
}

pub fn get_fact(connection: &Connection, id: &str) -> Result<Option<Fact>> {
    Ok(connection.query_row("SELECT id,thread,input,output,cached,reasoning,cache_write,at,end_at,time_status,format FROM token_facts WHERE id=?1", [id], read_fact).optional()?)
}

pub fn read_fact(row: &rusqlite::Row<'_>) -> rusqlite::Result<Fact> {
    Ok(Fact {
        id: row.get(0)?,
        thread: row.get(1)?,
        usage: Usage {
            input: row.get(2)?,
            output: row.get(3)?,
            cached: row.get(4)?,
            reasoning: row.get(5)?,
            cache_write: row.get(6)?,
        },
        at: row.get(7)?,
        end: row.get(8)?,
        time_status: row.get(9)?,
        format: row.get(10)?,
    })
}

pub fn identity(
    connection: &Connection,
    root: &str,
    kind: &str,
    id: &str,
) -> Result<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT fact FROM fact_identities WHERE root=?1 AND kind=?2 AND identity=?3",
            params![root, kind, id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn bind(connection: &Connection, root: &str, kind: &str, id: &str, fact: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO fact_identities VALUES(?1,?2,?3,?4)",
        params![root, kind, id, fact],
    )?;
    Ok(())
}

pub fn reference(
    connection: &Connection,
    fact: &str,
    file: &str,
    start: u64,
    end: u64,
    ordinal: Option<u64>,
) -> Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO fact_sources VALUES(?1,?2,?3,?4,?5)",
        params![fact, file, start, end, ordinal.map(|n| n.to_string())],
    )?;
    Ok(())
}

/// Online backup includes committed WAL pages. Not an automatic repair or a migration.
#[cfg(test)]
pub fn backup(connection: &Connection, destination: &Path) -> Result<()> {
    if destination.exists() {
        return Err("backupAlreadyExists".into());
    }
    connection.backup(rusqlite::MAIN_DB, destination, None)?;
    Ok(())
}
