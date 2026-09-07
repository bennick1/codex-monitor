//! Borrow the payload and skip unknown fields without constructing chat bodies.
use super::model::{key, Event, Legacy, Record, Usage};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{value::RawValue, Value};
use std::borrow::Cow;

#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(rename = "type")]
    kind: Cow<'a, str>,
    #[serde(borrow)]
    timestamp: Option<&'a RawValue>,
    #[serde(borrow)]
    ordinal: Option<&'a RawValue>,
    #[serde(borrow)]
    payload: &'a RawValue,
}

#[derive(Default, Deserialize)]
struct Payload<'a> {
    #[serde(rename = "type")]
    kind: Option<Cow<'a, str>>,
    id: Option<Cow<'a, str>>,
    parent_thread_id: Option<Cow<'a, str>>,
    thread_id: Option<Cow<'a, str>>,
    turn_id: Option<Cow<'a, str>>,
    #[serde(borrow)]
    model: Option<&'a RawValue>,
    response_id: Option<Cow<'a, str>>,
    #[serde(borrow)]
    usage: Option<&'a RawValue>,
    #[serde(borrow)]
    thread_token_usage: Option<&'a RawValue>,
    #[serde(borrow)]
    info: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct Info<'a> {
    #[serde(borrow)]
    total_token_usage: Option<&'a RawValue>,
    #[serde(borrow)]
    last_token_usage: Option<&'a RawValue>,
}

fn identity(raw: Option<&str>) -> Option<String> {
    raw.filter(|s| !s.trim().is_empty() && s.len() <= 512)
        .map(|s| key(&["codex", s]))
}

pub fn timestamp(raw: Option<&str>) -> Option<String> {
    DateTime::parse_from_rfc3339(raw?).ok().map(|t| {
        t.with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Nanos, true)
    })
}

fn counter(v: &Value, name: &str) -> Option<i64> {
    v.get(name)?.as_i64().filter(|n| *n >= 0)
}

pub fn usage(raw: &str) -> Option<Usage> {
    // Only count objects, never arbitrary envelope or message bodies.
    if raw.len() > 8192 {
        return None;
    }
    let v: Value = serde_json::from_str(raw).ok()?;
    let input = counter(&v, "input_tokens")?;
    let output = counter(&v, "output_tokens")?;
    if input.checked_add(output)? != counter(&v, "total_tokens")? {
        return None;
    }
    Some(Usage {
        input,
        output,
        cached: counter(&v, "cached_input_tokens").filter(|n| *n <= input),
        reasoning: counter(&v, "reasoning_output_tokens").filter(|n| *n <= output),
        cache_write: counter(&v, "cache_write_input_tokens"),
    })
}

pub fn parse(line: &[u8]) -> Event {
    let Ok(e) = serde_json::from_slice::<Envelope<'_>>(line) else {
        return Event::Problem("badLine");
    };
    if !matches!(
        e.kind.as_ref(),
        "session_meta" | "turn_context" | "token_usage_record" | "event_msg"
    ) {
        return if matches!(e.kind.as_ref(), "response_item" | "compacted") {
            Event::Ignore
        } else {
            Event::Problem("unknownFormat")
        };
    }
    let Ok(p) = serde_json::from_str::<Payload<'_>>(e.payload.get()) else {
        return Event::Problem("unsupportedFields");
    };
    let at = timestamp(
        e.timestamp
            .and_then(|v| serde_json::from_str::<&str>(v.get()).ok()),
    );
    match e.kind.as_ref() {
        "session_meta" => match identity(p.id.as_deref()) {
            Some(thread) => Event::Meta {
                thread,
                parent: identity(p.parent_thread_id.as_deref()),
            },
            None => Event::Problem("missingThreadIdentity"),
        },
        "turn_context" => Event::Turn(
            identity(p.turn_id.as_deref()),
            p.model
                .and_then(|v| serde_json::from_str::<String>(v.get()).ok())
                .filter(|m| {
                    !m.trim().is_empty() && m.len() <= 512 && !m.chars().any(char::is_control)
                }),
        ),
        "token_usage_record" => {
            let (Some(thread), Some(response), Some(counts)) = (
                identity(p.thread_id.as_deref()),
                identity(p.response_id.as_deref()),
                p.usage.and_then(|v| usage(v.get())),
            ) else {
                return Event::Problem("invalidResponseUsage");
            };
            Event::Modern(Record {
                thread,
                response,
                turn: identity(p.turn_id.as_deref()),
                at,
                ordinal: e.ordinal.and_then(|v| serde_json::from_str(v.get()).ok()),
                usage: counts,
                cumulative: p.thread_token_usage.and_then(|v| usage(v.get())),
            })
        }
        "event_msg" if p.kind.as_deref() == Some("token_count") => {
            let info = p
                .info
                .and_then(|v| serde_json::from_str::<Info<'_>>(v.get()).ok());
            let Some(info) = info else {
                return Event::Problem("missingLegacyTotal");
            };
            let Some(cumulative) = info.total_token_usage.and_then(|v| usage(v.get())) else {
                return Event::Problem("invalidLegacyTotal");
            };
            Event::Legacy(Legacy {
                cumulative,
                last: info.last_token_usage.and_then(|v| usage(v.get())),
                at,
                turn: None,
            })
        }
        "event_msg"
            if matches!(
                p.kind.as_deref(),
                Some("task_started" | "task_complete" | "turn_aborted")
            ) =>
        {
            Event::ModelBoundary
        }
        _ => Event::Ignore,
    }
}
