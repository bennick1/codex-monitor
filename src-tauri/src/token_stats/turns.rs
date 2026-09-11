//! Turn metadata aggregates the existing active accounting facts; never creates usage.
use super::{aggregate::QuotaWindow, parser, Result};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStatistics {
    pub weekly_reset_at: String,
    pub turns: Vec<TurnUsage>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsage {
    pub model: String,
    pub effort: Option<String>,
    pub tokens: String,
    pub completed_at: String,
    pub weekly_remaining: Option<f64>,
    pub quota_observed_at: Option<String>,
    pub is_partial: bool,
}
fn utc(v: DateTime<Utc>) -> String {
    v.to_rfc3339_opts(SecondsFormat::Nanos, true)
}

pub fn observe(
    db: &mut Connection,
    root: &str,
    weekly: Option<&crate::models::UsageWindow>,
    observed: DateTime<Utc>,
) -> Result<bool> {
    let Some(weekly) = weekly else {
        return Ok(false);
    };
    if !weekly.remaining_percent.is_finite() || !(0.0..=100.0).contains(&weekly.remaining_percent) {
        return Err("invalidQuotaRemaining".into());
    }
    let Some(reset) = weekly
        .resets_at
        .as_deref()
        .and_then(|s| parser::timestamp(Some(s)))
    else {
        return Ok(false);
    };
    let window = QuotaWindow {
        resets_at: reset.clone(),
        window_seconds: i64::try_from(weekly.window_seconds).unwrap_or(0),
    };
    if window.start(observed).is_none() {
        return Ok(false);
    }
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let changed = tx.execute("INSERT OR IGNORE INTO quota_snapshots(root,weekly_reset_at,observed_at,remaining_percent) VALUES(?1,?2,?3,?4)", params![root,reset,utc(observed),weekly.remaining_percent])?;
    if changed > 0 {
        super::store::bump(&tx)?;
    }
    tx.commit()?;
    Ok(changed > 0)
}

pub fn query(
    db: &Connection,
    root: &str,
    now: DateTime<Utc>,
    quota: Option<&QuotaWindow>,
    partial: bool,
) -> Result<Option<TurnStatistics>> {
    let Some((quota, start)) = quota.and_then(|w| w.start(now).map(|s| (w, s))) else {
        return Ok(None);
    };
    let reset = parser::timestamp(Some(&quota.resets_at)).ok_or("invalidQuotaPeriod")?;
    let mut result = TurnStatistics {
        weekly_reset_at: reset.clone(),
        turns: Vec::new(),
    };
    let mut stmt = db.prepare("SELECT thread,turn,CASE WHEN conflict=0 THEN model ELSE NULL END,CASE WHEN effort_conflict=0 THEN effort ELSE NULL END,completed_at FROM model_turns WHERE root=?1 AND completion_status='completed' AND completed_at>=?2 AND completed_at<=?3 AND completed_at<?4 ORDER BY completed_at,thread,turn")?;
    let rows = stmt.query_map(params![root, utc(start), utc(now), reset], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    for row in rows {
        let (thread, turn, model, effort, completed) = row?;
        // Exactly one proven identity, matching the existing By Model ownership rule.
        let mut facts = db.prepare("SELECT f.input,f.output FROM model_identities mi JOIN fact_identities fi ON fi.root=mi.root AND fi.kind=mi.kind AND fi.identity=mi.identity JOIN token_facts f ON f.id=fi.fact AND f.root=fi.root WHERE mi.root=?1 AND mi.thread=?2 AND mi.turn=?3 AND mi.conflict=0 AND f.thread=mi.thread AND f.active=1 AND fi.kind=CASE WHEN f.format='response' THEN 'response' ELSE 'legacy' END AND (f.at IS NULL OR f.at<?4) AND (f.end_at IS NULL OR f.end_at<?4) AND (SELECT COUNT(*) FROM fact_identities ownership WHERE ownership.root=f.root AND ownership.fact=f.id AND ownership.kind=fi.kind)=1")?;
        let mut total = 0i64;
        let mut count = 0;
        for f in facts.query_map(params![root, thread, turn, utc(now)], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        })? {
            let (input, output) = f?;
            total = total
                .checked_add(input)
                .and_then(|n| n.checked_add(output))
                .ok_or("aggregateOverflow")?;
            count += 1;
        }
        if count == 0 {
            continue;
        }
        let end = DateTime::parse_from_rfc3339(&completed)
            .map_err(|_| super::Error("databaseInvalidTimestamp"))?
            .with_timezone(&Utc)
            .checked_add_signed(Duration::minutes(15))
            .ok_or("databaseInvalidTimestamp")?;
        let observation = db.query_row("SELECT remaining_percent,observed_at FROM quota_snapshots WHERE root=?1 AND weekly_reset_at=?2 AND observed_at>=?3 AND observed_at<=?4 AND observed_at<=?5 ORDER BY observed_at LIMIT 1", params![root,reset,completed,utc(end),utc(now)], |r| Ok((r.get::<_,f64>(0)?,r.get::<_,String>(1)?))).optional()?;
        result.turns.push(TurnUsage {
            model: model.unwrap_or_else(|| "unknown".into()),
            effort,
            tokens: total.to_string(),
            completed_at: completed,
            weekly_remaining: observation.as_ref().map(|v| v.0),
            quota_observed_at: observation.map(|v| v.1),
            is_partial: partial,
        });
    }
    Ok(Some(result))
}
