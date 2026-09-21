//! Persisted selected/requested thread settings, never backend execution proof.
//! Separate projection keeps the Version 1 accounting parser and rules unchanged.
use super::{
    model::{key, Event},
    normalize::Position,
    parser, Result,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

#[derive(Default)]
pub struct Evidence {
    at: Option<String>,
    settings: Option<(Option<String>, Option<bool>)>,
    reset: bool,
}

#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(borrow)]
    timestamp: Option<&'a RawValue>,
    #[serde(borrow)]
    payload: &'a RawValue,
}
#[derive(Deserialize)]
struct Payload<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    #[serde(borrow)]
    thread_id: Option<&'a RawValue>,
    #[serde(borrow)]
    thread_settings: Option<&'a RawValue>,
}
#[derive(Deserialize)]
struct Settings<'a> {
    #[serde(borrow)]
    service_tier: Option<&'a RawValue>,
}

pub fn parse(line: &[u8]) -> Evidence {
    let Ok(e) = serde_json::from_slice::<Envelope<'_>>(line) else {
        return Evidence {
            reset: true,
            ..Evidence::default()
        };
    };
    let mut evidence = Evidence {
        at: parser::timestamp(
            e.timestamp
                .and_then(|v| serde_json::from_str::<&str>(v.get()).ok()),
        ),
        reset: e.kind == "compacted",
        ..Evidence::default()
    };
    if e.kind == "event_msg" {
        let Ok(p) = serde_json::from_str::<Payload<'_>>(e.payload.get()) else {
            evidence.reset = true;
            return evidence;
        };
        if p.kind == Some("thread_settings_applied") {
            let thread = p
                .thread_id
                .and_then(|v| serde_json::from_str::<&str>(v.get()).ok())
                .filter(|v| !v.trim().is_empty() && v.len() <= 512)
                .map(|v| key(&["codex", v]));
            let settings = p
                .thread_settings
                .and_then(|v| serde_json::from_str::<Settings<'_>>(v.get()).ok());
            let tier = settings
                .and_then(|s| s.service_tier)
                .and_then(|v| serde_json::from_str::<&str>(v.get()).ok());
            evidence.settings = Some((
                thread,
                match tier {
                    Some("priority") => Some(true),
                    Some("default") => Some(false),
                    _ => None,
                },
            ));
        }
        evidence.reset |= matches!(
            p.kind,
            Some("thread_rolled_back" | "thread_forked" | "context_compacted")
        );
    }
    evidence
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Context {
    thread: Option<String>,
    conflicted: bool,
    selected: Option<bool>,
    last_at: Option<String>,
}

pub fn observe(
    db: &Connection,
    p: &Position<'_>,
    c: &mut Context,
    event: &Event,
    evidence: &Evidence,
) -> Result<()> {
    if let Event::Meta { thread, .. } = event {
        c.conflicted |= c.thread.as_ref().is_some_and(|old| old != thread);
        c.thread = Some(thread.clone());
        c.selected = None;
        c.last_at = None;
    }
    let reversed = c
        .last_at
        .as_ref()
        .zip(evidence.at.as_ref())
        .is_some_and(|(old, new)| new < old);
    if evidence.reset || reversed || matches!(event, Event::Problem(_)) {
        c.selected = None;
    }
    if let Some(at) = &evidence.at {
        if c.last_at.as_ref().is_none_or(|old| at >= old) {
            c.last_at = Some(at.clone());
        }
    }
    if let Some((thread, selected)) = &evidence.settings {
        // A parent's copied setting cannot establish the child's selection.
        c.selected = if !c.conflicted && !reversed && thread.is_some() && thread == &c.thread {
            *selected
        } else {
            None
        };
    }
    if let (false, Some(thread), Event::Turn(Some(turn), _, _)) = (c.conflicted, &c.thread, event) {
        db.execute("UPDATE model_turns SET fast_conflict=MAX(fast_conflict, CASE WHEN fast_mode IS NOT NULL AND ?4 IS NOT NULL AND fast_mode != ?4 THEN 1 ELSE 0 END), fast_mode=COALESCE(fast_mode,?4) WHERE root=?1 AND thread=?2 AND turn=?3", params![p.root, thread, turn, c.selected])?;
    }
    Ok(())
}
