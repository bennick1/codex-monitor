use super::{
    model::*,
    normalize::{self, Position},
    parser, store, Result,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::OsString,
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, UNIX_EPOCH},
};

pub const LINE_LIMIT: usize = 16 * 1024 * 1024;
pub const BATCH_BUDGET: u64 = 8 * 1024 * 1024;

#[derive(Clone)]
pub struct Source {
    path: PathBuf,
    pub locator: String,
}

fn path_key(path: &Path) -> String {
    format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()))
}

impl Source {
    pub fn environment() -> Result<Self> {
        Self::configured(std::env::var_os("CODEX_HOME"), dirs::home_dir())
    }

    pub fn configured(explicit: Option<OsString>, home: Option<PathBuf>) -> Result<Self> {
        let path = match explicit {
            Some(value)
                if value.is_empty() || value.to_str().is_some_and(|v| v.trim().is_empty()) =>
            {
                return Err("invalidCodexHome".into())
            }
            Some(value) => PathBuf::from(value),
            None => home.ok_or("homeDirectoryUnavailable")?.join(".codex"),
        };
        let path = if path.is_absolute() {
            path
        } else {
            std::env::current_dir()?.join(path)
        };
        Ok(Self {
            locator: path_key(&path),
            path,
        })
    }

    pub fn resolve(&self) -> Result<(PathBuf, String)> {
        let path = self
            .path
            .canonicalize()
            .map_err(|_| super::Error("sourceUnavailable"))?;
        if !path.is_dir() {
            return Err("invalidCodexHome".into());
        }
        Ok((path.clone(), path_key(&path)))
    }
}

pub struct Discovery {
    files: Vec<PathBuf>,
    pub complete: bool,
    pub failed: u64,
}

fn allowed(root: &Path, path: &Path) -> bool {
    path.starts_with(root.join("sessions")) || path.starts_with(root.join("archived_sessions"))
}

fn discover(root: &Path, cancel: &AtomicBool) -> Result<Discovery> {
    let mut result = Discovery {
        files: Vec::new(),
        complete: true,
        failed: 0,
    };
    let mut stack = Vec::new();
    for name in ["sessions", "archived_sessions"] {
        let p = root.join(name);
        match fs::symlink_metadata(&p) {
            Ok(_) => stack.push((p, 0)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                result.complete = false;
                result.failed += 1;
            }
        }
    }
    // Prove root readability even when both optional directories are absent.
    fs::read_dir(root)?;
    let mut seen = HashSet::new();
    while let Some((dir, depth)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            return Err("scanCancelled".into());
        }
        let canonical = match dir.canonicalize() {
            Ok(p) if allowed(root, &p) && depth <= 64 => p,
            _ => {
                result.complete = false;
                result.failed += 1;
                continue;
            }
        };
        if !seen.insert(canonical.clone()) {
            continue;
        }
        let entries = match fs::read_dir(&canonical) {
            Ok(entries) => entries,
            Err(_) => {
                result.complete = false;
                result.failed += 1;
                continue;
            }
        };
        for entry in entries {
            let Ok(entry) = entry else {
                result.complete = false;
                result.failed += 1;
                continue;
            };
            let path = entry.path();
            let Ok(target) = path.canonicalize() else {
                result.complete = false;
                result.failed += 1;
                continue;
            };
            if !allowed(root, &target) {
                result.complete = false;
                result.failed += 1;
                continue;
            }
            let Ok(meta) = target.metadata() else {
                result.complete = false;
                result.failed += 1;
                continue;
            };
            if meta.is_dir() {
                stack.push((target, depth + 1));
            } else if path.extension().is_some_and(|e| e == "jsonl") {
                if meta.is_file() && target.extension().is_some_and(|e| e == "jsonl") {
                    result.files.push(path);
                } else {
                    result.complete = false;
                    result.failed += 1;
                }
            }
            if result.files.len() + stack.len() > 100_000 {
                return Err("discoveryLimit".into());
            }
        }
    }
    result
        .files
        .sort_by_key(|p| std::cmp::Reverse(p.metadata().and_then(|m| m.modified()).ok()));
    result.files.dedup();
    Ok(result)
}

#[derive(Clone)]
struct Checkpoint {
    id: String,
    version: i64,
    native: String,
    size: u64,
    modified: String,
    offset: u64,
    edge: String,
    cursor: Cursor,
    verified_at: i64,
}

impl Checkpoint {
    fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        let cursor: String = row.get(7)?;
        Ok(Self {
            id: row.get(0)?,
            version: row.get(1)?,
            native: row.get(2)?,
            size: row.get(3)?,
            modified: row.get(4)?,
            offset: row.get(5)?,
            edge: row.get(6)?,
            cursor: serde_json::from_str(&cursor).map_err(|_| rusqlite::Error::InvalidQuery)?,
            verified_at: row.get(8)?,
        })
    }
}

struct ScanScope<'a> {
    path: &'a Path,
    key: &'a str,
}

fn native_id(file: &File) -> Result<String> {
    let handle = same_file::Handle::from_file(file.try_clone()?)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    handle.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

fn modified(meta: &fs::Metadata) -> String {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_default()
}

fn edge(file: &mut File, offset: u64, read: &mut u64) -> Result<String> {
    let mut hash = Sha256::new();
    for start in [0, offset.saturating_sub(4096)] {
        file.seek(SeekFrom::Start(start))?;
        let mut bytes = [0u8; 4096];
        let count = (offset - start).min(4096) as usize;
        file.read_exact(&mut bytes[..count])?;
        hash.update(&bytes[..count]);
        *read += count as u64;
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn verify_chunks(
    db: &Connection,
    cp: &Checkpoint,
    file: &mut File,
    read: &mut u64,
    cancel: &AtomicBool,
) -> Result<bool> {
    let mut statement =
        db.prepare("SELECT start,end,digest FROM file_chunks WHERE file=?1 ORDER BY start")?;
    let rows = statement.query_map([&cp.id], |r| {
        Ok((
            r.get::<_, u64>(0)?,
            r.get::<_, u64>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut buffer = [0u8; 65536];
    let mut expected = 0;
    let began = std::time::Instant::now();
    let mut verified = 0u64;
    for row in rows {
        let (start, end, digest) = row?;
        if start != expected || end > cp.offset {
            return Ok(false);
        }
        expected = end;
        file.seek(SeekFrom::Start(start))?;
        let mut remaining = end - start;
        let mut hash = Sha256::new();
        while remaining > 0 {
            if cancel.load(Ordering::Relaxed) {
                return Err("scanCancelled".into());
            }
            let n = remaining.min(buffer.len() as u64) as usize;
            file.read_exact(&mut buffer[..n])?;
            hash.update(&buffer[..n]);
            remaining -= n as u64;
            *read += n as u64;
            verified += n as u64;
            // Low-frequency integrity work is capped at roughly 128 MiB/s.
            let target = Duration::from_secs_f64(verified as f64 / (128.0 * 1024.0 * 1024.0));
            if let Some(delay) = target.checked_sub(began.elapsed()) {
                std::thread::sleep(delay.min(Duration::from_millis(2)));
            }
        }
        if format!("{:x}", hash.finalize()) != digest {
            return Ok(false);
        }
    }
    Ok(expected == cp.offset)
}

struct Line {
    start: u64,
    end: u64,
    event: Event,
}
struct Batch {
    lines: Vec<Line>,
    end: u64,
    digest: String,
    read: u64,
}

fn read_batch(file: &mut File, start: u64, limit: u64, cancel: &AtomicBool) -> Result<Batch> {
    file.seek(SeekFrom::Start(start))?;
    let mut reader = BufReader::with_capacity(65536, file.take(limit - start));
    let mut bytes = Vec::new();
    let mut lines = Vec::new();
    let mut position = start;
    let mut line_start = start;
    let mut committed = start;
    let mut hash = Sha256::new();
    let mut committed_hash = hash.clone();
    let mut oversize = false;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("scanCancelled".into());
        }
        let available = reader.fill_buf()?;
        if available.is_empty() {
            break;
        }
        let newline = available.iter().position(|b| *b == b'\n');
        let n = newline.map(|i| i + 1).unwrap_or(available.len());
        hash.update(&available[..n]);
        if !oversize {
            if bytes.len().saturating_add(n) > LINE_LIMIT {
                bytes.clear();
                oversize = true;
            } else {
                bytes.extend_from_slice(&available[..n]);
            }
        }
        position += n as u64;
        reader.consume(n);
        if newline.is_some() {
            let event = if oversize {
                Event::Problem("oversizeLine")
            } else {
                parser::parse(&bytes)
            };
            if !matches!(&event, Event::Ignore) {
                lines.push(Line {
                    start: line_start,
                    end: position,
                    event,
                });
            }
            committed = position;
            committed_hash = hash.clone();
            bytes.clear();
            oversize = false;
            line_start = position;
            if position - start >= BATCH_BUDGET {
                break;
            }
        }
    }
    Ok(Batch {
        lines,
        end: committed,
        digest: format!("{:x}", committed_hash.finalize()),
        read: position - start,
    })
}

// Reuse the bounded reader and the verified source handle, with an independent
// metadata checkpoint. Backfill NEVER feeds old lines back into normalize::apply.
fn backfill_models(
    db: &mut Connection,
    file: &mut File,
    cp: &Checkpoint,
    root: &str,
    cancel: &AtomicBool,
    coverage: &mut Coverage,
) -> Result<()> {
    let saved: Option<(u64, String)> = db
        .query_row(
            "SELECT offset,cursor FROM model_checkpoints WHERE file=?1",
            [&cp.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (mut offset, mut context) = match saved {
        Some((offset, raw)) => (offset, from_json::<super::attribution::Context>(&raw)?),
        None => (0, super::attribution::Context::default()),
    };
    if offset > cp.offset {
        return Err("databaseInvalidMetadata".into());
    }
    while offset < cp.offset {
        let batch = read_batch(file, offset, cp.offset, cancel)?;
        coverage.integrity_read_bytes += batch.read;
        if batch.end == offset {
            return Err("sourceChanged".into());
        }
        let meta = file.metadata()?;
        if meta.len() < cp.size
            || (meta.len() == cp.size && modified(&meta) != cp.modified)
            || native_id(file)? != cp.native
        {
            return Err("sourceChanged".into());
        }
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        for line in batch.lines {
            super::attribution::observe(
                &tx,
                &Position {
                    root,
                    file: &cp.id,
                    start: line.start,
                    end: line.end,
                },
                &mut context,
                &line.event,
            )?;
        }
        tx.execute("INSERT INTO model_checkpoints VALUES(?1,?2,?3) ON CONFLICT(file) DO UPDATE SET offset=excluded.offset,cursor=excluded.cursor",
            params![cp.id,batch.end,json(&context)?])?;
        store::bump(&tx)?;
        tx.commit()?;
        offset = batch.end;
    }
    Ok(())
}

#[derive(Default)]
pub struct Scanner {
    pub startup: bool,
}

impl Scanner {
    pub fn new() -> Self {
        Self { startup: true }
    }

    fn file(
        &self,
        db: &mut Connection,
        scope: ScanScope<'_>,
        path: &Path,
        coverage: &mut Coverage,
        cancel: &AtomicBool,
        committed: &mut impl FnMut(i64),
    ) -> Result<(String, bool)> {
        let root_path = scope.path;
        let root = scope.key;
        let target = path.canonicalize()?;
        if !allowed(root_path, &target) || !target.metadata()?.is_file() {
            return Err("unsafeSourcePath".into());
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            // A raced replacement must not follow a new link or block on a FIFO.
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let mut file = options.open(&target)?;
        // Compare opened handle with the current, re-resolved alias BEFORE reading bytes.
        let check = path.canonicalize()?;
        if check != target
            || !allowed(root_path, &check)
            || same_file::Handle::from_file(file.try_clone()?)?
                != same_file::Handle::from_path(&check)?
        {
            return Err("sourceChanged".into());
        }
        let meta = file.metadata()?;
        if !meta.is_file() {
            return Err("unsafeSourcePath".into());
        }
        let native = native_id(&file)?;
        let size = meta.len();
        if size > i64::MAX as u64 {
            return Err("sourceTooLarge".into());
        }
        let mtime = modified(&meta);
        let relative = path
            .strip_prefix(root_path)
            .ok()
            .and_then(Path::to_str)
            .ok_or("unsupportedPath")?;
        let saved: Option<Checkpoint> = db.query_row(
            "SELECT id,version,native_id,size,modified,offset,edge,cursor,verified_at FROM source_files WHERE root=?1 AND relative_path=?2 ORDER BY version DESC LIMIT 1",
            params![root,relative], Checkpoint::read).optional()?;
        let mut cp = saved.unwrap_or_else(|| Checkpoint {
            id: String::new(),
            version: 0,
            native: String::new(),
            size: 0,
            modified: String::new(),
            offset: 0,
            edge: String::new(),
            cursor: Cursor::default(),
            verified_at: 0,
        });
        let now = Utc::now().timestamp();
        let due = self.startup || now.saturating_sub(cp.verified_at) >= 86400;
        let mut changed_version = cp.id.is_empty() || cp.native != native || size < cp.size;
        if !changed_version && (due || cp.size != size || cp.modified != mtime) {
            if edge(&mut file, cp.offset, &mut coverage.integrity_read_bytes)? != cp.edge {
                changed_version = true;
            }
            if !changed_version && (due || (cp.size == size && cp.modified != mtime)) {
                if verify_chunks(
                    db,
                    &cp,
                    &mut file,
                    &mut coverage.integrity_read_bytes,
                    cancel,
                )? {
                    cp.verified_at = now;
                } else {
                    changed_version = true;
                }
            }
        }
        if changed_version {
            let old_id = cp.id.clone();
            cp = Checkpoint {
                id: key(&[root, relative, &(cp.version + 1).to_string()]),
                version: cp.version + 1,
                native: native.clone(),
                size,
                modified: mtime.clone(),
                offset: 0,
                edge: edge(&mut file, 0, &mut coverage.integrity_read_bytes)?,
                cursor: Cursor::default(),
                verified_at: now,
            };
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute(
                "UPDATE source_files SET availability='replaced' WHERE id=?1",
                [&old_id],
            )?;
            tx.execute(
                "INSERT INTO source_files VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8,?9,'present',?10)",
                params![
                    cp.id,
                    root,
                    relative,
                    cp.version,
                    native,
                    size,
                    mtime,
                    cp.edge,
                    json(&cp.cursor)?,
                    now
                ],
            )?;
            let generation = store::bump(&tx)?;
            tx.commit()?;
            committed(generation);
        } else if !due
            && cp.size == size
            && cp.modified == mtime
            && (cp.offset == size || cp.cursor.partial_tail)
        {
            db.execute(
                "UPDATE source_files SET availability='present' WHERE id=?1",
                [&cp.id],
            )?;
            backfill_models(db, &mut file, &cp, root, cancel, coverage)?;
            return Ok((cp.id, cp.offset == size));
        }
        // Record the observed boundary WITHOUT advancing the committed offset.
        // If a later fact transaction fails and the source disappears, we can
        // still report a known uncommitted tail rather than claim full coverage.
        if !changed_version && (cp.size != size || cp.modified != mtime) {
            cp.cursor.partial_tail = false;
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute(
                "UPDATE source_files SET size=?1,modified=?2,cursor=?3 WHERE id=?4",
                params![size, mtime, json(&cp.cursor)?, cp.id],
            )?;
            let generation = store::bump(&tx)?;
            tx.commit()?;
            committed(generation);
        }
        while cp.offset < size {
            let batch = read_batch(&mut file, cp.offset, size, cancel)?;
            coverage.read_bytes += batch.read;
            if batch.end == cp.offset {
                break;
            }
            let current_meta = file.metadata()?;
            if current_meta.len() < size
                || (current_meta.len() == size && modified(&current_meta) != mtime)
                || native_id(&file)? != native
                || path.canonicalize()? != target
                || same_file::Handle::from_file(file.try_clone()?)?
                    != same_file::Handle::from_path(path)?
                || edge(&mut file, cp.offset, &mut coverage.integrity_read_bytes)? != cp.edge
            {
                return Err("sourceChanged".into());
            }
            let next_edge = edge(&mut file, batch.end, &mut coverage.integrity_read_bytes)?;
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let offset: u64 = tx.query_row(
                "SELECT offset FROM source_files WHERE id=?1",
                [&cp.id],
                |r| r.get(0),
            )?;
            if offset != cp.offset {
                return Err("checkpointConflict".into());
            }
            let mut cursor = cp.cursor.clone();
            for line in batch.lines {
                normalize::apply(
                    &tx,
                    &Position {
                        root,
                        file: &cp.id,
                        start: line.start,
                        end: line.end,
                    },
                    &mut cursor,
                    line.event,
                )?;
            }
            normalize::fault("facts")?;
            tx.execute(
                "INSERT INTO file_chunks VALUES(?1,?2,?3,?4)",
                params![cp.id, cp.offset, batch.end, batch.digest],
            )?;
            tx.execute("UPDATE source_files SET offset=?1,cursor=?2,edge=?3,size=?4,modified=?5,verified_at=?6,availability='present' WHERE id=?7",
                params![batch.end,json(&cursor)?,next_edge,size,mtime,cp.verified_at,cp.id])?;
            let generation = store::bump(&tx)?;
            normalize::fault("checkpoint")?;
            tx.commit()?;
            normalize::fault("committed")?;
            committed(generation);
            cp.offset = batch.end;
            cp.cursor = cursor;
            cp.edge = next_edge;
        }
        cp.size = size;
        cp.modified = mtime.clone();
        backfill_models(db, &mut file, &cp, root, cancel, coverage)?;
        cp.cursor.partial_tail = cp.offset < size;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("UPDATE source_files SET size=?1,modified=?2,verified_at=?3,availability='present',cursor=?5 WHERE id=?4", params![size,mtime,cp.verified_at,cp.id,json(&cp.cursor)?])?;
        let generation = store::bump(&tx)?;
        tx.commit()?;
        committed(generation);
        Ok((cp.id, cp.offset == size))
    }

    pub fn scan(
        &mut self,
        db: &mut Connection,
        source: &Source,
        cancel: &AtomicBool,
        mut committed: impl FnMut(i64),
    ) -> Result<(String, RootState)> {
        store::validate(db)?;
        let (path, root) = source.resolve()?;
        store::source(db, &source.locator, Some(&root))?;
        let discovery = discover(&path, cancel)?;
        let mut state = store::root_state(db, &root)?;
        state.coverage = Coverage {
            discovered_files: discovery.files.len() as u64,
            failed_files: discovery.failed,
            complete: discovery.complete,
            ..Coverage::default()
        };
        state.warning_codes.clear();
        let mut present = HashSet::new();
        for source_file in &discovery.files {
            if cancel.load(Ordering::Relaxed) {
                return Err("scanCancelled".into());
            }
            match self.file(
                db,
                ScanScope {
                    path: &path,
                    key: &root,
                },
                source_file,
                &mut state.coverage,
                cancel,
                &mut committed,
            ) {
                Ok((id, complete)) => {
                    present.insert(id);
                    if complete {
                        state.coverage.scanned_files += 1;
                    } else {
                        state.coverage.complete = false;
                        state.warning_codes.push("incompleteTail".into());
                    }
                }
                Err(error)
                    if error.0.starts_with("database")
                        || matches!(
                            error.0,
                            "persistenceDegraded" | "injectedFailure" | "scanCancelled"
                        ) =>
                {
                    return Err(error)
                }
                Err(error) => {
                    state.coverage.failed_files += 1;
                    state.coverage.complete = false;
                    state.warning_codes.push(error.0.into());
                    let relative = source_file.strip_prefix(&path).ok().and_then(Path::to_str);
                    db.execute("UPDATE source_files SET availability='unreadable',verified_at=0 WHERE root=?1 AND relative_path=?2 AND availability!='replaced'", params![root,relative])?;
                }
            }
        }
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Only a COMPLETE directory enumeration may declare an absent alias missing.
        if discovery.complete {
            let mut statement = tx.prepare("SELECT id,relative_path FROM source_files WHERE root=?1 AND availability!='replaced'")?;
            let rows = statement.query_map([&root], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (id, relative) = row?;
                if !present.contains(&id) && !discovery.files.contains(&path.join(relative)) {
                    tx.execute(
                        "UPDATE source_files SET availability='missing' WHERE id=?1",
                        [id],
                    )?;
                }
            }
        } else {
            state.warning_codes.push("sourceCoverageGap".into());
        }
        state.last_scan_at = Some(Utc::now().to_rfc3339());
        if state.coverage.complete {
            state.last_success_at = state.last_scan_at.clone();
        }
        state.warning_codes.sort();
        state.warning_codes.dedup();
        tx.execute(
            "UPDATE source_roots SET state=?1 WHERE root=?2",
            params![json(&state)?, root],
        )?;
        let generation = store::bump(&tx)?;
        tx.commit()?;
        committed(generation);
        self.startup = false;
        Ok((root, state))
    }
}
