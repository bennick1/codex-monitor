//! Supplementary metadata only. Never calls normalization or changes accounting facts.
use super::{model::*, normalize::Position, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize)]
pub struct Context {
    thread: Option<String>,
    turn: Option<String>,
    conflict: bool,
}

fn bind(
    db: &Connection,
    p: &Position<'_>,
    kind: &str,
    id: &str,
    thread: &str,
    turn: Option<&str>,
) -> Result<()> {
    db.execute("INSERT INTO model_identities(root,kind,identity,thread,turn) VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(root,kind,identity) DO UPDATE SET conflict=CASE
        WHEN model_identities.thread != excluded.thread OR model_identities.turn IS NOT excluded.turn
        THEN 1 ELSE model_identities.conflict END", params![p.root,kind,id,thread,turn])?;
    Ok(())
}

pub fn observe(db: &Connection, p: &Position<'_>, c: &mut Context, event: &Event) -> Result<()> {
    match event {
        Event::Meta { thread, .. } => {
            if c.thread.as_ref().is_some_and(|old| old != thread) {
                c.conflict = true;
            }
            c.thread = Some(thread.clone());
            c.turn = None;
        }
        Event::Turn(turn, model) => {
            c.turn = turn.clone();
            if let (Some(thread), Some(turn)) = (&c.thread, turn) {
                db.execute("INSERT INTO model_turns(root,thread,turn,model,conflict) VALUES(?1,?2,?3,?4,?5)
                    ON CONFLICT(root,thread,turn) DO UPDATE SET
                    conflict=MAX(model_turns.conflict,excluded.conflict,CASE WHEN model_turns.model IS NOT NULL AND excluded.model IS NOT NULL AND model_turns.model != excluded.model THEN 1 ELSE 0 END),
                    model=COALESCE(model_turns.model,excluded.model)", params![p.root,thread,turn,model,c.conflict])?;
            }
        }
        Event::Modern(r) => {
            // The record's own thread/turn are authoritative, never the previous context.
            bind(db, p, "response", &r.response, &r.thread, r.turn.as_deref())?;
        }
        Event::Legacy(_) => {
            // Exact source range of an already persisted LEGACY fact. Reconciled response
            // sources and uncertain multi-event deltas cannot establish model ownership.
            let mut statement = db.prepare("SELECT f.id,f.thread FROM token_facts f JOIN fact_sources s ON s.fact=f.id
                WHERE f.root=?1 AND s.file=?2 AND s.start=?3 AND s.end=?4 AND f.format='legacy' AND f.time_status!='timeUncertain'")?;
            let rows = statement.query_map(params![p.root, p.file, p.start, p.end], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (id, thread) = row?;
                let turn = if !c.conflict && c.thread.as_ref() == Some(&thread) {
                    c.turn.as_deref()
                } else {
                    None
                };
                bind(db, p, "legacy", &id, &thread, turn)?;
            }
        }
        Event::Problem(_) | Event::ModelBoundary => c.turn = None,
        Event::Ignore => {}
    }
    Ok(())
}
