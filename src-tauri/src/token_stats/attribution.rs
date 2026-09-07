//! Supplementary metadata only. Never calls normalization or changes accounting facts.
use super::{model::*, normalize::Position, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Context {
    thread: Option<String>,
    turn: Option<String>,
    conflict: bool,
    previous_turn: Option<String>,
    previous_usage: Option<Usage>,
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
        WHEN model_identities.thread != excluded.thread OR (model_identities.turn IS NOT NULL AND excluded.turn IS NOT NULL AND model_identities.turn != excluded.turn)
        THEN 1 ELSE model_identities.conflict END,
        turn=COALESCE(model_identities.turn,excluded.turn)", params![p.root,kind,id,thread,turn])?;
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
            c.previous_turn = None;
        }
        Event::Turn(turn, model) => {
            if c.turn != *turn {
                c.previous_turn = None;
            }
            c.turn = turn.clone();
            // A broken file identity cannot contradict evidence from an independent,
            // well-formed rollout. Keep the conflict local to this source context.
            if let (false, Some(thread), Some(turn)) = (c.conflict, &c.thread, turn) {
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
        Event::Legacy(event) => {
            // Exact source range of an already persisted LEGACY fact. Reconciled response
            // sources and deltas crossing an unproven turn boundary cannot establish ownership.
            let mut statement = db.prepare("SELECT f.id,f.thread,f.input,f.output,f.cached,f.reasoning,f.cache_write,f.at,f.end_at,f.time_status,f.format FROM token_facts f JOIN fact_sources s ON s.fact=f.id
                WHERE f.root=?1 AND s.file=?2 AND s.start=?3 AND s.end=?4 AND f.format='legacy'")?;
            let rows = statement.query_map(
                params![p.root, p.file, p.start, p.end],
                super::store::read_fact,
            )?;
            for row in rows {
                let fact = row?;
                // Time uncertainty does not imply model uncertainty when both
                // cumulative endpoints are inside one uninterrupted explicit turn.
                let bounded = fact.time_status != "timeUncertain"
                    || (c.turn.is_some()
                        && c.previous_turn == c.turn
                        && c.previous_usage
                            .as_ref()
                            .and_then(|u| event.cumulative.delta(u))
                            .is_some_and(|u| u.five_equal(&fact.usage)));
                let turn = if bounded && !c.conflict && c.thread.as_ref() == Some(&fact.thread) {
                    c.turn.as_deref()
                } else {
                    None
                };
                bind(db, p, "legacy", &fact.id, &fact.thread, turn)?;
            }
            c.previous_turn = c.turn.clone();
            c.previous_usage = Some(event.cumulative.clone());
        }
        Event::Problem(_) | Event::ModelBoundary => {
            c.turn = None;
            c.previous_turn = None;
        }
        Event::Ignore => {}
    }
    Ok(())
}
