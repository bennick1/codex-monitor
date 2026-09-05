//! Rules are deliberately conservative; see the implementation report for R1-R6.
use super::{model::*, store, Result, PARSER_VERSION};
use rusqlite::{params, Connection, OptionalExtension};

pub struct Position<'a> {
    pub root: &'a str,
    pub file: &'a str,
    pub start: u64,
    pub end: u64,
}

fn problem(db: &Connection, p: &Position<'_>, code: &str) -> Result<()> {
    store::issue(db, p.root, p.file, p.start, code)
}

fn same_response(a: &Record, b: &Record) -> bool {
    a.thread == b.thread
        && a.response == b.response
        && a.turn == b.turn
        && a.usage == b.usage
        && a.at == b.at
}

fn candidate(db: &Connection, p: &Position<'_>, record: &Record, reason: &str) -> Result<String> {
    let id = key(&[p.root, "response", &record.response]);
    let old: Option<String> = db
        .query_row(
            "SELECT record FROM reconciliation_candidates WHERE id=?1",
            [&id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old) = old {
        if !same_response(&from_json::<Record>(&old)?, record) {
            // Keep both sanitized observations, preserving the first trusted value.
            let conflict = key(&[&id, &json(record)?]);
            db.execute("INSERT OR IGNORE INTO reconciliation_candidates VALUES(?1,?2,?3,?4,'ambiguous','responseConflict')", params![conflict,p.root,record.thread,json(record)?])?;
            db.execute(
                "INSERT OR IGNORE INTO candidate_sources VALUES(?1,?2,?3,?4)",
                params![conflict, p.file, p.start, p.end],
            )?;
            problem(db, p, "responseConflict")?;
            return Ok(conflict);
        }
    } else {
        let status = if matches!(reason, "responseConflict" | "threadConflict") {
            "ambiguous"
        } else {
            "pending"
        };
        db.execute(
            "INSERT INTO reconciliation_candidates VALUES(?1,?2,?3,?4,?5,?6)",
            params![id, p.root, record.thread, json(record)?, status, reason],
        )?;
    }
    db.execute(
        "INSERT OR IGNORE INTO candidate_sources VALUES(?1,?2,?3,?4)",
        params![id, p.file, p.start, p.end],
    )?;
    Ok(id)
}

fn accept_response(db: &Connection, p: &Position<'_>, r: &Record) -> Result<String> {
    let id = key(&[p.root, "response", &r.response]);
    if let Some(existing) = store::identity(db, p.root, "response", &r.response)? {
        let saved = store::get_fact(db, &existing)?.ok_or("databaseInvalidMetadata")?;
        if saved.thread != r.thread || saved.usage != r.usage || saved.at != r.at {
            return Err("responseConflict".into());
        }
        store::reference(db, &existing, p.file, p.start, p.end, r.ordinal)?;
        return Ok(existing);
    }
    store::add_fact(
        db,
        p.root,
        &Fact {
            id: id.clone(),
            thread: r.thread.clone(),
            usage: r.usage.clone(),
            at: r.at.clone(),
            end: None,
            time_status: if r.at.is_some() { "dated" } else { "undated" }.into(),
            format: "response".into(),
        },
    )?;
    store::bind(db, p.root, "response", &r.response, &id)?;
    store::reference(db, &id, p.file, p.start, p.end, r.ordinal)?;
    let candidate = candidate(db, p, r, "responseIdentity")?;
    db.execute("UPDATE reconciliation_candidates SET status='resolved',reason='responseIdentity' WHERE id=?1",[candidate])?;
    let latest: Option<String> = db.query_row(
        "SELECT latest_response FROM threads WHERE root=?1 AND thread=?2",
        params![p.root, r.thread],
        |row| row.get(0),
    )?;
    let previous = latest.map(|raw| from_json::<Record>(&raw)).transpose()?;
    let advances = previous.as_ref().is_none_or(|old| {
        old.cumulative
            .as_ref()
            .zip(r.cumulative.as_ref())
            .is_some_and(|(a, b)| b.delta(a).is_some())
    });
    if advances {
        db.execute("UPDATE threads SET mode='responseRecords',latest_response=?1 WHERE root=?2 AND thread=?3",params![json(r)?,p.root,r.thread])?;
    }
    Ok(id)
}

fn load_candidate(db: &Connection, id: &str) -> Result<Record> {
    let raw: String = db.query_row(
        "SELECT record FROM reconciliation_candidates WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    from_json(&raw)
}

/// Complete forward bracket: verified legacy prefix, contiguous new response
/// chain starting at zero, then its cumulative legacy echo in the same turn.
/// Replaying a richer alias can resolve an OLD fact committed in an earlier run.
fn reconcile(
    db: &Connection,
    p: &Position<'_>,
    cursor: &Cursor,
    legacy: &Legacy,
    delta: &Usage,
    legacy_fact: Option<&str>,
) -> Result<bool> {
    if cursor.pending.is_empty() || cursor.gap || cursor.legacy_blocked || cursor.identity_conflict
    {
        return Ok(false);
    }
    let Some(turn) = legacy.turn.as_ref() else {
        return Ok(false);
    };
    let mut sum = Usage {
        cached: Some(0),
        reasoning: Some(0),
        ..Usage::default()
    };
    let mut records = Vec::new();
    let mut previous_ordinal = None;
    for id in &cursor.pending {
        let status: String = db.query_row(
            "SELECT status FROM reconciliation_candidates WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        if status == "ambiguous" {
            return Ok(false);
        }
        let r = load_candidate(db, id)?;
        if r.turn.as_ref() != Some(turn)
            || Some(&r.thread) != cursor.thread.as_ref()
            || !r.usage.complete()
            || !r.cumulative.as_ref().is_some_and(Usage::complete)
        {
            return Ok(false);
        }
        if let (Some(prev), Some(next)) = (previous_ordinal, r.ordinal) {
            if next <= prev {
                return Ok(false);
            }
        }
        previous_ordinal = r.ordinal;
        let Some(total) = r.cumulative.as_ref() else {
            return Ok(false);
        };
        if !total.delta(&sum).is_some_and(|d| d.five_equal(&r.usage)) {
            return Ok(false);
        }
        sum = total.clone();
        // A global response key must agree before changing ANY old active fact.
        if let Some(fact) = store::identity(db, p.root, "response", &r.response)? {
            let old = store::get_fact(db, &fact)?.ok_or("databaseInvalidMetadata")?;
            if old.thread != r.thread || old.usage != r.usage || old.at != r.at {
                return Ok(false);
            }
        }
        records.push(r);
    }
    if !delta.complete()
        || !sum.five_equal(delta)
        || !legacy.last.as_ref().is_some_and(|l| {
            records
                .last()
                .is_some_and(|r| l.complete() && l.five_equal(&r.usage))
        })
    {
        return Ok(false);
    }
    if let Some(old) = legacy_fact {
        db.execute(
            "UPDATE token_facts SET active=0 WHERE id=?1 AND root=?2",
            params![old, p.root],
        )?;
        fault("replacement")?;
    }
    for (id, r) in cursor.pending.iter().zip(&records) {
        let fact = accept_response(db, p, r)?;
        db.execute("INSERT OR IGNORE INTO fact_sources SELECT ?1,file,start,end,NULL FROM candidate_sources WHERE candidate=?2", params![fact,id])?;
        if let Some(old) = legacy_fact {
            db.execute("INSERT OR IGNORE INTO reconciliation_links VALUES(?1,?2,'verifiedForwardBracketV1',?3)", params![old,fact,PARSER_VERSION])?;
            db.execute("INSERT OR IGNORE INTO fact_sources SELECT ?1,file,start,end,ordinal FROM fact_sources WHERE fact=?2", params![fact,old])?;
            if records.len() == 1 {
                db.execute("UPDATE fact_identities SET fact=?1 WHERE root=?2 AND kind='legacy' AND fact=?3",params![fact,p.root,old])?;
            }
        }
        db.execute("UPDATE reconciliation_candidates SET status='resolved',reason='verifiedForwardBracketV1' WHERE id=?1", [id])?;
    }
    Ok(true)
}

fn modern(db: &Connection, p: &Position<'_>, cursor: &mut Cursor, record: Record) -> Result<()> {
    if let Some(existing) = store::identity(db, p.root, "response", &record.response)? {
        let old = store::get_fact(db, &existing)?.ok_or("databaseInvalidMetadata")?;
        if old.thread != record.thread || old.usage != record.usage || old.at != record.at {
            candidate(db, p, &record, "responseConflict")?;
            problem(db, p, "responseConflict")?;
            return Ok(());
        }
        store::reference(db, &existing, p.file, p.start, p.end, record.ordinal)?;
        problem(db, p, "duplicate")?;
        // A copied parent response retains its ORIGINAL payload.thread_id.
        if cursor.thread.as_ref() != Some(&record.thread) {
            if cursor.parent.as_ref() != Some(&record.thread) {
                problem(db, p, "threadConflict")?;
            }
            return Ok(());
        }
        if cursor.previous.is_none() || cursor.mode == Mode::ResponseRecords {
            return Ok(());
        }
    }
    if cursor.identity_conflict
        || cursor
            .thread
            .as_ref()
            .is_some_and(|id| id != &record.thread)
    {
        candidate(db, p, &record, "threadConflict")?;
        problem(db, p, "threadConflict")?;
        return Ok(());
    }
    if cursor.thread.is_none() {
        cursor.thread = Some(record.thread.clone());
    }
    db.execute(
        "INSERT OR IGNORE INTO threads(root,thread,parent) VALUES(?1,?2,?3)",
        params![p.root, record.thread, cursor.parent],
    )?;
    let has_legacy: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM legacy_events WHERE root=?1 AND thread=?2)",
        params![p.root, record.thread],
        |r| r.get(0),
    )?;
    let active_legacy:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM token_facts WHERE root=?1 AND thread=?2 AND format='legacy' AND active=1)",params![p.root,record.thread],|r|r.get(0))?;
    if cursor.previous.is_none() && cursor.mode != Mode::ResponseRecords {
        let previous: Option<String> = db.query_row(
            "SELECT latest_response FROM threads WHERE root=?1 AND thread=?2",
            params![p.root, record.thread],
            |r| r.get(0),
        )?;
        if let Some(previous) = previous.map(|raw| from_json::<Record>(&raw)).transpose()? {
            if previous
                .cumulative
                .as_ref()
                .zip(record.cumulative.as_ref())
                .is_some_and(|(a, b)| b.delta(a).is_some_and(|d| d.five_equal(&record.usage)))
            {
                cursor.mode = Mode::ResponseRecords;
                cursor.modern_total = previous.cumulative;
            }
        }
    }
    if cursor.mode == Mode::ResponseRecords
        && active_legacy
        && !cursor
            .modern_total
            .as_ref()
            .zip(record.cumulative.as_ref())
            .is_some_and(|(a, b)| b.delta(a).is_some_and(|d| d.five_equal(&record.usage)))
    {
        candidate(db, p, &record, "lateResponseEvidenceMissing")?;
        return Ok(());
    }
    if cursor.mode != Mode::ResponseRecords && (cursor.previous.is_some() || has_legacy) {
        let id = candidate(db, p, &record, "transitionEvidenceMissing")?;
        if !cursor.pending.contains(&id) {
            if cursor.pending.len() < 256 {
                cursor.pending.push(id);
            } else {
                cursor.gap = true;
                problem(db, p, "candidateWindowLimit")?;
            }
        }
        cursor.mode = Mode::TransitionPending;
        return Ok(());
    }
    if let Some(total) = &record.cumulative {
        if let Some(previous) = &cursor.modern_total {
            if !total
                .delta(previous)
                .is_some_and(|d| d.five_equal(&record.usage))
            {
                problem(db, p, "responseCumulativeMismatch")?;
            }
        } else if !total.five_equal(&record.usage) {
            problem(db, p, "missingPrefix")?;
        }
        cursor.modern_total = Some(total.clone());
    }
    accept_response(db, p, &record)?;
    cursor.mode = Mode::ResponseRecords;
    Ok(())
}

fn legacy(db: &Connection, p: &Position<'_>, cursor: &mut Cursor, mut event: Legacy) -> Result<()> {
    let Some(thread) = cursor.thread.clone() else {
        problem(db, p, "missingThreadIdentity")?;
        return Ok(());
    };
    event.turn = cursor.turn.clone();
    // Repeated notifications do not add another sequence element or reset mode.
    if cursor
        .previous
        .as_ref()
        .is_some_and(|old| old.cumulative.five_equal(&event.cumulative))
    {
        problem(db, p, "duplicate")?;
        return Ok(());
    }
    let encoded = json(&event)?;
    let chain = key(&[&cursor.chain, &encoded]);
    let sequence = cursor.legacy_index;
    let existing: Option<(String, Option<String>)> = db
        .query_row(
            "SELECT digest,fact FROM legacy_events WHERE root=?1 AND thread=?2 AND sequence=?3",
            params![p.root, thread, sequence],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let mut old_fact = None;
    if let Some((digest, fact)) = &existing {
        if digest != &chain {
            cursor.legacy_blocked = true;
            problem(db, p, "legacyStreamConflict")?;
        } else {
            old_fact = fact.clone();
        }
    }
    if cursor.parent.is_some() {
        // Legacy fork copies have no response identity. Preserve evidence, isolate.
        cursor.legacy_blocked = true;
        problem(db, p, "legacyForkAmbiguous")?;
    }
    let delta = match &cursor.previous {
        Some(old) => event.cumulative.delta(&old.cumulative),
        None if event
            .last
            .as_ref()
            .is_some_and(|l| event.cumulative.five_equal(l)) =>
        {
            Some(event.cumulative.clone())
        }
        None => {
            problem(db, p, "missingPrefix")?;
            None
        }
    };
    let mut new_fact = old_fact.clone();
    if cursor.previous.is_some() && delta.is_none() {
        cursor.legacy_blocked = true;
        problem(db, p, "legacyRollback")?;
    }
    if !cursor.legacy_blocked && !cursor.identity_conflict {
        if let Some(delta) = delta {
            if cursor.previous.is_none() && existing.is_none() && cursor.mode == Mode::Legacy {
                let responses:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM token_facts WHERE root=?1 AND thread=?2 AND format='response')",params![p.root,thread],|r|r.get(0))?;
                if responses {
                    cursor.mode = Mode::TransitionPending;
                    problem(db, p, "legacyAfterResponseAmbiguous")?;
                }
            }
            // Retain a non-countable legacy identity for diagnostic/switch echoes.
            // Otherwise a later legacy-only alias could recreate the same usage.
            if cursor.mode != Mode::Legacy && new_fact.is_none() {
                let id = key(&[p.root, &thread, "legacy", &chain]);
                store::add_fact(
                    db,
                    p.root,
                    &Fact {
                        id: id.clone(),
                        thread: thread.clone(),
                        usage: delta.clone(),
                        at: event.at.clone(),
                        end: None,
                        time_status: if event.at.is_some() {
                            "dated"
                        } else {
                            "undated"
                        }
                        .into(),
                        format: "legacy".into(),
                    },
                )?;
                db.execute("UPDATE token_facts SET active=0 WHERE id=?1", [&id])?;
                store::bind(db, p.root, "legacy", &id, &id)?;
                new_fact = Some(id);
            }
            if cursor.mode == Mode::TransitionPending {
                if reconcile(db, p, cursor, &event, &delta, new_fact.as_deref())? {
                    cursor.modern_total = cursor
                        .pending
                        .last()
                        .map(|id| load_candidate(db, id))
                        .transpose()?
                        .and_then(|r| r.cumulative);
                    cursor.mode = Mode::ResponseRecords;
                    cursor.pending.clear();
                } else {
                    // This changed legacy boundary closes the physical window.
                    // Keep unresolved evidence in SQLite, but never reuse it
                    // against an unrelated later delta with matching numbers.
                    for id in &cursor.pending {
                        db.execute("UPDATE reconciliation_candidates SET reason='transitionBoundaryMismatch' WHERE id=?1 AND status='pending'", [id])?;
                    }
                    cursor.pending.clear();
                }
                // Unmatched boundary is persisted, never guessed as fresh legacy.
            } else if cursor.mode == Mode::Legacy && old_fact.is_none() {
                let id = key(&[p.root, &thread, "legacy", &chain]);
                let gap = cursor.gap || !event.last.as_ref().is_some_and(|l| delta.five_equal(l));
                let fact = Fact {
                    id: id.clone(),
                    thread: thread.clone(),
                    usage: delta,
                    at: if gap {
                        cursor.previous.as_ref().and_then(|old| old.at.clone())
                    } else {
                        event.at.clone()
                    },
                    end: if gap { event.at.clone() } else { None },
                    time_status: if gap {
                        "timeUncertain"
                    } else if event.at.is_some() {
                        "dated"
                    } else {
                        "undated"
                    }
                    .into(),
                    format: "legacy".into(),
                };
                store::add_fact(db, p.root, &fact)?;
                store::bind(db, p.root, "legacy", &id, &id)?;
                new_fact = Some(id);
            }
        }
    }
    if let Some(id) = &new_fact {
        store::reference(db, id, p.file, p.start, p.end, None)?;
    }
    if existing.is_none() {
        db.execute(
            "INSERT INTO legacy_events VALUES(?1,?2,?3,?4,?5,?6)",
            params![p.root, thread, sequence, chain, new_fact, encoded],
        )?;
    }
    cursor.chain = chain;
    cursor.legacy_index = cursor
        .legacy_index
        .checked_add(1)
        .ok_or("sequenceOverflow")?;
    cursor.previous = Some(event);
    cursor.gap = false;
    Ok(())
}

pub fn apply(db: &Connection, p: &Position<'_>, cursor: &mut Cursor, event: Event) -> Result<()> {
    match event {
        Event::Meta { thread, parent } => {
            if cursor.thread.as_ref().is_some_and(|old| old != &thread) {
                cursor.identity_conflict = true;
                problem(db, p, "threadConflict")?;
            } else {
                if cursor.parent.is_some() && cursor.parent != parent {
                    cursor.identity_conflict = true;
                    problem(db, p, "threadConflict")?;
                }
                db.execute(
                    "INSERT OR IGNORE INTO threads(root,thread,parent) VALUES(?1,?2,?3)",
                    params![p.root, thread, parent],
                )?;
                cursor.thread = Some(thread);
                cursor.parent = parent;
            }
        }
        Event::Turn(turn) => cursor.turn = turn,
        Event::Modern(record) => modern(db, p, cursor, record)?,
        Event::Legacy(event) => legacy(db, p, cursor, event)?,
        Event::Problem(code) => {
            cursor.gap = true;
            if code == "invalidResponseUsage" {
                cursor.mode = Mode::TransitionPending;
            }
            problem(db, p, code)?;
        }
        Event::Ignore => {}
    }
    Ok(())
}

#[cfg(test)]
thread_local! {
    pub static FAILURE: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
    pub static EXIT_ON_FAILURE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub fn fault(_point: &str) -> Result<()> {
    #[cfg(test)]
    {
        if FAILURE.with(|v| v.get() == Some(_point)) {
            if EXIT_ON_FAILURE.with(|v| v.get()) {
                std::process::exit(91);
            }
            return Err("injectedFailure".into());
        }
    }
    Ok(())
}
