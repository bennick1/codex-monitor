//! Optional local request metadata, never proof of the backend execution tier.
//! Initial thread settings are not always persisted in rollouts. Codex's
//! feedback_tags diagnostics independently bind the requested tier to a Turn.
use super::{model::key, Result};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS fast_request_evidence (
    root TEXT NOT NULL REFERENCES source_roots(root),
    thread TEXT NOT NULL, turn TEXT NOT NULL,
    flags INTEGER NOT NULL CHECK(flags IN (1,2,3)),
    PRIMARY KEY(root,thread,turn)) WITHOUT ROWID";

// This optional table does not change the application's compatibility version.
// Refuse unexpected same-name objects; never replace or repair user data here.
pub fn ensure_schema(db: &Connection) -> Result<()> {
    let existing: Option<(String, String)> = db
        .query_row(
            "SELECT type,sql FROM sqlite_master WHERE name='fast_request_evidence' COLLATE NOCASE",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((kind, sql)) = existing {
        let normalize = |value: &str| {
            value
                .split_whitespace()
                .collect::<String>()
                .to_ascii_lowercase()
        };
        if kind != "table" || normalize(&sql) != normalize(&SCHEMA.replace(" IF NOT EXISTS", "")) {
            return Err("databaseIncompatible".into());
        }
    } else {
        db.execute_batch(SCHEMA)?;
    }
    Ok(())
}

// Bound allocations and work per refresh; remaining rows resume next refresh.
const BATCH_ROWS: usize = 1024;
const BODY_LIMIT: usize = 64 * 1024;

#[derive(Default)]
pub struct Cursor {
    root: Option<PathBuf>,
    file: Option<same_file::Handle>,
    id: i64,
    before: Option<i64>,
}

pub struct Batch {
    root: PathBuf,
    file: same_file::Handle,
    id: i64,
    before: Option<i64>,
    evidence: Vec<Evidence>,
}

#[derive(Debug, PartialEq)]
struct Evidence {
    thread: String,
    turn: String,
    flags: i64,
}

#[derive(Deserialize)]
struct Tags<'a> {
    #[serde(borrow)]
    service_tier: Option<&'a str>,
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}

// Extract one tracing span, respecting quoted values and nested braces. Never
// search arbitrary message text for an ID or a service-tier-looking fragment.
fn span(input: &str) -> Option<(&str, &str, &str)> {
    let end = input.find(['{', ':'])?;
    let name = &input[..end];
    if name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.')
    {
        return None;
    }
    if input.as_bytes()[end] == b':' {
        return Some((name, "", &input[end + 1..]));
    }
    let mut depth = 1;
    let mut quoted = false;
    let mut escaped = false;
    for (i, b) in input.bytes().enumerate().skip(end + 1) {
        if escaped {
            escaped = false;
        } else if quoted && b == b'\\' {
            escaped = true;
        } else if b == b'"' {
            quoted = !quoted;
        } else if !quoted && b == b'{' {
            depth += 1;
        } else if !quoted && b == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some((name, &input[end + 1..i], input[i + 1..].strip_prefix(':')?));
            }
        }
    }
    None
}

fn field<'a>(input: &'a str, key: &str) -> Option<&'a str> {
    let mut remaining = input;
    let mut found = None;
    while !remaining.is_empty() {
        remaining = remaining.trim_start();
        let end = remaining
            .find(char::is_whitespace)
            .unwrap_or(remaining.len());
        let token = &remaining[..end];
        // Quoted tracing values can contain spaces and misleading field names.
        if let Some(start) = token.find("=\"") {
            let value_start = start + 1;
            let mut stream = serde_json::Deserializer::from_str(&remaining[value_start..])
                .into_iter::<serde_json::Value>();
            stream.next()?.ok()?;
            let consumed = value_start + stream.byte_offset();
            if &token[..start] == key {
                return None; // Supported IDs use the observed bare UUID form.
            }
            remaining = &remaining[consumed..];
            continue;
        }
        if let Some(value) = token.strip_prefix(key).and_then(|s| s.strip_prefix('=')) {
            if found.is_some() || !uuid(value) {
                return None;
            }
            found = Some(value);
        }
        remaining = &remaining[end..];
    }
    found
}

fn parse(thread: &str, body: &str) -> Option<Evidence> {
    if !uuid(thread) || body.len() > BODY_LIMIT {
        return None;
    }
    let (name, fields, mut rest) = span(body)?;
    if name != "session_loop" || field(fields, "thread_id")? != thread {
        return None;
    }
    let mut turn = None;
    let mut sampling = false;
    let mut trying = false;
    // A finite, structured tracing prefix precedes the diagnostic message.
    for _ in 0..16 {
        let Some((name, fields, next)) = span(rest) else {
            break;
        };
        match name {
            "turn" if turn.is_none() => {
                if field(fields, "thread.id")? != thread {
                    return None;
                }
                turn = Some(field(fields, "turn.id")?);
            }
            "run_sampling_request" if !sampling => {
                if Some(field(fields, "turn_id")?) != turn {
                    return None;
                }
                sampling = true;
            }
            "try_run_sampling_request" if sampling && !trying => {
                if Some(field(fields, "turn_id")?) != turn {
                    return None;
                }
                trying = true;
            }
            "session_loop" | "turn" | "run_sampling_request" | "try_run_sampling_request" => {
                return None;
            }
            _ => {}
        }
        rest = next;
    }
    if !sampling || !trying || !rest.starts_with(' ') {
        return None;
    }
    let (_, raw) = rest.rsplit_once(" tags_json=")?;
    let tags: Tags<'_> = serde_json::from_str(raw).ok()?;
    let flags = match tags.service_tier? {
        "default" => 1,
        "priority" | "fast" => 2,
        _ => return None,
    };
    Some(Evidence {
        thread: key(&["codex", thread]),
        turn: key(&["codex", turn?]),
        flags,
    })
}

impl Cursor {
    pub fn read(&self, root: &Path, cancel: &AtomicBool) -> Result<Option<Batch>> {
        if cancel.load(Ordering::Relaxed) {
            return Err("scanCancelled".into());
        }
        // Missing/locked/unknown diagnostic stores are optional. They must not
        // break accounting or clear previously proven request evidence.
        let result = self.read_source(root, cancel);
        if cancel.load(Ordering::Relaxed) {
            return Err("scanCancelled".into());
        }
        Ok(result.ok())
    }

    fn read_source(&self, root: &Path, cancel: &AtomicBool) -> Result<Batch> {
        let path = root.join("logs_2.sqlite");
        let meta = fs::symlink_metadata(&path)?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("unsafeSourcePath".into());
        }
        let file = same_file::Handle::from_path(&path)?;
        let source = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        source.busy_timeout(Duration::from_millis(25))?;
        source.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;")?;
        // Only the observed ordinary rowid table shape is supported. In
        // particular, reject views/virtual tables and non-indexed or composite
        // IDs before MAX/ORDER BY so even incompatible sources remain bounded.
        let supported: bool = source.query_row(
            "SELECT
                EXISTS(SELECT 1 FROM pragma_table_list WHERE schema='main' AND name='logs' AND type='table' AND wr=0)
                AND (SELECT COUNT(*) FROM pragma_table_xinfo('logs') WHERE pk>0)=1
                AND (SELECT COUNT(*) FROM pragma_table_xinfo('logs') WHERE hidden=0 AND
                    ((name='id' AND upper(type)='INTEGER' AND pk=1) OR
                     (name IN ('thread_id','target','feedback_log_body') AND upper(type)='TEXT' AND pk=0)))=4
                AND NOT EXISTS(SELECT 1 FROM pragma_index_list('logs') WHERE origin='pk')",
            [], |row| row.get(0),
        )?;
        if !supported {
            return Err("sourceIncompatible".into());
        }
        let highest: i64 =
            source.query_row("SELECT COALESCE(MAX(id),0) FROM logs", [], |r| r.get(0))?;
        let mut evidence = Vec::new();
        let mut page = |low, high, limit, ascending| -> Result<(usize, i64)> {
            let order = if ascending { "ASC" } else { "DESC" };
            let mut statement = source.prepare(&format!("SELECT id,CASE WHEN target COLLATE BINARY='feedback_tags' AND typeof(thread_id)='text' AND length(CAST(thread_id AS BLOB))=36 THEN thread_id END,CASE WHEN target COLLATE BINARY='feedback_tags' AND typeof(feedback_log_body)='text' AND length(CAST(feedback_log_body AS BLOB))<=?3 THEN feedback_log_body END FROM logs WHERE id>?1 AND id<=?2 ORDER BY id {order} LIMIT ?4"))?;
            let mut rows = statement.query(params![low, high, BODY_LIMIT, limit])?;
            let mut count = 0;
            let mut last = low;
            while let Some(row) = rows.next()? {
                if cancel.load(Ordering::Relaxed) {
                    return Err("scanCancelled".into());
                }
                last = row.get(0)?;
                count += 1;
                let thread: Option<String> = row.get(1).unwrap_or(None);
                let body: Option<String> = row.get(2).unwrap_or(None);
                if let Some(e) = thread
                    .as_deref()
                    .zip(body.as_deref())
                    .and_then(|(t, b)| parse(t, b))
                {
                    evidence.push(e);
                }
            }
            Ok((count, last))
        };
        // Prioritize recent/live requests without starving bounded historical
        // replay. Reopening starts afresh; persisted evidence merges idempotently.
        let (id, before) = if self.root.as_deref() == Some(root)
            && self.file.as_ref() == Some(&file)
            && self.id <= highest
        {
            let limit = BATCH_ROWS / 2;
            let (count, last) = page(self.id, highest, limit, true)?;
            let id = if count < limit { highest } else { last };
            let before = if let Some(before) = self.before {
                let limit = BATCH_ROWS - count;
                let (count, last) = page(0, before, limit, false)?;
                (count == limit && last > 1).then_some(last - 1)
            } else {
                None
            };
            (id, before)
        } else {
            let (count, last) = page(0, highest, BATCH_ROWS, false)?;
            (
                highest,
                (count == BATCH_ROWS && last > 1).then_some(last - 1),
            )
        };
        if file != same_file::Handle::from_path(&path)?
            || fs::symlink_metadata(&path)?.file_type().is_symlink()
        {
            return Err("sourceChanged".into());
        }
        Ok(Batch {
            root: root.to_path_buf(),
            file,
            id,
            before,
            evidence,
        })
    }

    pub fn committed(&mut self, batch: Batch) {
        self.root = Some(batch.root);
        self.file = Some(batch.file);
        self.id = batch.id;
        self.before = batch.before;
    }
}

pub fn project(db: &Connection, root: &str, batch: Option<&Batch>) -> Result<()> {
    if let Some(batch) = batch {
        let mut insert = db.prepare("INSERT INTO fast_request_evidence(root,thread,turn,flags) VALUES(?1,?2,?3,?4) ON CONFLICT(root,thread,turn) DO UPDATE SET flags=fast_request_evidence.flags | excluded.flags")?;
        for e in &batch.evidence {
            insert.execute(params![root, e.thread, e.turn, e.flags])?;
        }
    }
    // Reapply after legacy metadata repairs too. Request evidence survives log
    // rotation/restarts; contrary settings or requests remain Unknown on replay.
    db.execute("UPDATE model_turns AS m SET
        fast_conflict=MAX(fast_conflict,CASE WHEN e.flags=3 OR (m.fast_mode IS NOT NULL AND m.fast_mode != (e.flags=2)) THEN 1 ELSE 0 END),
        fast_mode=COALESCE(m.fast_mode,CASE WHEN e.flags!=3 THEN e.flags=2 END)
        FROM fast_request_evidence AS e WHERE m.root=?1 AND e.root=m.root AND e.thread=m.thread AND e.turn=m.turn", [root])?;
    Ok(())
}
