use super::{model::*, store, Result, SCHEMA_VERSION};
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, SecondsFormat, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub input_tokens: String,
    pub cached_input_tokens: Option<String>,
    pub output_tokens: String,
    pub reasoning_output_tokens: Option<String>,
    pub total_tokens: String,
    pub fact_count: String,
    pub missing_cached_facts: String,
    pub missing_reasoning_facts: String,
    pub is_partial: bool,
}

#[derive(Default)]
struct Sum {
    input: i64,
    output: i64,
    cached: i64,
    reasoning: i64,
    count: i64,
    missing_cached: i64,
    missing_reasoning: i64,
}
impl Sum {
    fn add(&mut self, usage: &Usage) -> Result<()> {
        let checked = |a: i64, b: i64| a.checked_add(b).ok_or(super::Error("aggregateOverflow"));
        self.input = checked(self.input, usage.input)?;
        self.output = checked(self.output, usage.output)?;
        checked(self.input, self.output)?;
        self.count = checked(self.count, 1)?;
        if let Some(n) = usage.cached {
            self.cached = checked(self.cached, n)?;
        } else {
            self.missing_cached = checked(self.missing_cached, 1)?;
        }
        if let Some(n) = usage.reasoning {
            self.reasoning = checked(self.reasoning, n)?;
        } else {
            self.missing_reasoning = checked(self.missing_reasoning, 1)?;
        }
        Ok(())
    }
    fn export(&self) -> Totals {
        Totals {
            input_tokens: self.input.to_string(),
            output_tokens: self.output.to_string(),
            cached_input_tokens: (self.missing_cached == 0).then(|| self.cached.to_string()),
            reasoning_output_tokens: (self.missing_reasoning == 0)
                .then(|| self.reasoning.to_string()),
            total_tokens: (self.input + self.output).to_string(),
            fact_count: self.count.to_string(),
            missing_cached_facts: self.missing_cached.to_string(),
            missing_reasoning_facts: self.missing_reasoning.to_string(),
            is_partial: self.missing_cached > 0 || self.missing_reasoning > 0,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quality {
    pub issue_counts: BTreeMap<String, String>,
    pub pending_count: String,
    pub ambiguous_count: String,
    pub future_deferred_count: String,
    pub warning_codes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema_version: i64,
    pub generation: String,
    pub scope: &'static str,
    pub query_at_utc: String,
    pub time_zone: Option<String>,
    pub today_start_utc: Option<String>,
    pub this_week_start_utc: Option<String>,
    pub this_month_start_utc: Option<String>,
    pub today: Option<Totals>,
    pub this_week: Option<Totals>,
    pub this_month: Option<Totals>,
    pub total: Option<Totals>,
    pub dated_totals: Option<Totals>,
    pub undated_totals: Option<Totals>,
    pub time_uncertain_totals: Option<Totals>,
    pub future_deferred_totals: Option<Totals>,
    pub status: String,
    pub is_stale: bool,
    pub last_scan_at: Option<String>,
    pub last_success_at: Option<String>,
    pub coverage: Coverage,
    pub quality: Quality,
}

pub fn utc_string(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Nanos, true)
}

/// Some zones skip/repeat midnight, or an entire calendar date. Earliest valid
/// wall-clock instant at/after midnight is used; this is not a fixed-hour offset.
pub fn day_start(date: NaiveDate, zone: Tz) -> Result<DateTime<Utc>> {
    let midnight = date.and_hms_opt(0, 0, 0).ok_or("calendarUnavailable")?;
    for seconds in 0..=172800 {
        let wall = midnight
            .checked_add_signed(Duration::seconds(seconds))
            .ok_or("calendarUnavailable")?;
        match zone.from_local_datetime(&wall) {
            LocalResult::Single(time) => return Ok(time.with_timezone(&Utc)),
            LocalResult::Ambiguous(a, b) => return Ok(a.min(b).with_timezone(&Utc)),
            LocalResult::None => {}
        }
    }
    Err("calendarUnavailable".into())
}

pub fn system_query() -> Result<(DateTime<Utc>, Tz)> {
    let zone = iana_time_zone::get_timezone().map_err(|_| super::Error("timeZoneUnavailable"))?;
    let zone = zone
        .parse()
        .map_err(|_| super::Error("timeZoneUnavailable"))?;
    Ok((Utc::now(), zone))
}

pub fn unavailable(code: &str) -> Snapshot {
    Snapshot {
        schema_version: SCHEMA_VERSION,
        generation: "0".into(),
        scope: "localCodexHome",
        query_at_utc: utc_string(Utc::now()),
        time_zone: None,
        today_start_utc: None,
        this_week_start_utc: None,
        this_month_start_utc: None,
        today: None,
        this_week: None,
        this_month: None,
        total: None,
        dated_totals: None,
        undated_totals: None,
        time_uncertain_totals: None,
        future_deferred_totals: None,
        status: "unavailable".into(),
        is_stale: false,
        last_scan_at: None,
        last_success_at: None,
        coverage: Coverage::default(),
        quality: Quality {
            pending_count: "0".into(),
            ambiguous_count: "0".into(),
            future_deferred_count: "0".into(),
            warning_codes: vec![code.into()],
            ..Quality::default()
        },
    }
}

pub fn query(db: &mut Connection, root: &str, q: DateTime<Utc>, zone: Tz) -> Result<Snapshot> {
    let tx = db.transaction()?;
    // This first read fixes the SQLite snapshot for every subsequent read.
    let generation = store::generation(&tx)?;
    let mut state = store::root_state(&tx, root)?;
    let date = q.with_timezone(&zone).date_naive();
    let today = day_start(date, zone)?;
    let week = day_start(
        date.checked_sub_signed(Duration::days(date.weekday().num_days_from_monday() as i64))
            .ok_or("calendarUnavailable")?,
        zone,
    )?;
    let month = day_start(date.with_day(1).ok_or("calendarUnavailable")?, zone)?;
    let mut day_sum = Sum::default();
    let mut week_sum = Sum::default();
    let mut month_sum = Sum::default();
    let mut total = Sum::default();
    let mut dated = Sum::default();
    let mut undated = Sum::default();
    let mut uncertain = Sum::default();
    let mut future = Sum::default();
    let mut statement = tx.prepare("SELECT id,thread,input,output,cached,reasoning,cache_write,at,end_at,time_status,format FROM token_facts WHERE root=?1 AND active=1")?;
    let rows = statement.query_map([root], store::read_fact)?;
    let mut earliest: Option<DateTime<Utc>> = None;
    let mut latest: Option<DateTime<Utc>> = None;
    for row in rows {
        let fact = row?;
        let parse = |t: &str| {
            DateTime::parse_from_rfc3339(t)
                .map(|v| v.with_timezone(&Utc))
                .map_err(|_| super::Error("databaseInvalidTimestamp"))
        };
        let at = fact.at.as_deref().map(parse).transpose()?;
        let end = fact.end.as_deref().map(parse).transpose()?;
        if at.into_iter().chain(end).any(|t| t >= q) {
            future.add(&fact.usage)?;
            continue;
        }
        total.add(&fact.usage)?;
        match fact.time_status.as_str() {
            "dated" => {
                let at = at.ok_or("databaseInvalidTimestamp")?;
                earliest = Some(earliest.map_or(at, |v| v.min(at)));
                latest = Some(latest.map_or(at, |v| v.max(at)));
                dated.add(&fact.usage)?;
                if at >= today {
                    day_sum.add(&fact.usage)?;
                }
                if at >= week {
                    week_sum.add(&fact.usage)?;
                }
                if at >= month {
                    month_sum.add(&fact.usage)?;
                }
            }
            "undated" => undated.add(&fact.usage)?,
            "timeUncertain" => uncertain.add(&fact.usage)?,
            _ => return Err("databaseInvalidMetadata".into()),
        }
    }
    drop(statement);
    state.coverage.earliest_usage_at = earliest.map(utc_string);
    state.coverage.latest_usage_at = latest.map(utc_string);
    state.coverage.retained_missing_files=tx.query_row("SELECT count(DISTINCT s.file) FROM fact_sources s JOIN source_files f ON f.id=s.file WHERE f.root=?1 AND f.availability='missing'",[root],|r|r.get(0))?;
    state.coverage.threads_with_usage = tx.query_row(
        "SELECT count(DISTINCT thread) FROM token_facts WHERE root=?1 AND active=1",
        [root],
        |r| r.get(0),
    )?;
    state.coverage.threads_without_usage=tx.query_row("SELECT count(*) FROM threads t WHERE root=?1 AND NOT EXISTS(SELECT 1 FROM token_facts f WHERE f.root=t.root AND f.thread=t.thread)",[root],|r|r.get(0))?;
    let mut issues = BTreeMap::new();
    let mut statement =
        tx.prepare("SELECT code,count(*) FROM quality_issues WHERE root=?1 GROUP BY code")?;
    for row in statement.query_map([root], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?.to_string()))
    })? {
        let (code, count) = row?;
        issues.insert(code, count);
    }
    drop(statement);
    let pending: i64 = tx.query_row(
        "SELECT count(*) FROM reconciliation_candidates WHERE root=?1 AND status='pending'",
        [root],
        |r| r.get(0),
    )?;
    let ambiguous: i64 = tx.query_row(
        "SELECT count(*) FROM reconciliation_candidates WHERE root=?1 AND status='ambiguous'",
        [root],
        |r| r.get(0),
    )?;
    let mut warnings = state.warning_codes;
    let missing_child:i64=tx.query_row("SELECT count(*) FROM threads t WHERE root=?1 AND parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM token_facts f WHERE f.root=t.root AND f.thread=t.thread AND f.active=1)",[root],|r|r.get(0))?;
    if missing_child > 0 {
        issues.insert("childUsageMissing".into(), missing_child.to_string());
    }
    let lost_tails:i64=tx.query_row("SELECT count(*) FROM source_files WHERE root=?1 AND offset<size AND availability IN ('missing','unreadable','replaced')",[root],|r|r.get(0))?;
    if lost_tails > 0 {
        issues.insert("uncommittedSourceTail".into(), lost_tails.to_string());
    }
    for code in issues.keys().filter(|c| c.as_str() != "duplicate") {
        warnings.push(code.clone());
    }
    if pending + ambiguous > 0 {
        warnings.push("transitionAmbiguous".into());
    }
    if undated.count > 0 {
        warnings.push("undatedUsage".into());
    }
    if uncertain.count > 0 {
        warnings.push("timeUncertainUsage".into());
    }
    if future.count > 0 {
        warnings.push("futureDeferred".into());
    }
    if total.missing_cached + total.missing_reasoning > 0 {
        warnings.push("optionalCountsMissing".into());
    }
    warnings.sort();
    warnings.dedup();
    let status = if !warnings.is_empty() {
        "partial"
    } else if !state.coverage.complete {
        "scanning"
    } else if total.count == 0 {
        "empty"
    } else {
        "ready"
    };
    let period_partial = !warnings.is_empty() || !state.coverage.complete;
    let export_period = |sum: &Sum| {
        let mut t = sum.export();
        t.is_partial |= period_partial;
        t
    };
    let result = Snapshot {
        schema_version: SCHEMA_VERSION,
        generation: generation.to_string(),
        scope: "localCodexHome",
        query_at_utc: utc_string(q),
        time_zone: Some(zone.name().into()),
        today_start_utc: Some(utc_string(today)),
        this_week_start_utc: Some(utc_string(week)),
        this_month_start_utc: Some(utc_string(month)),
        today: Some(export_period(&day_sum)),
        this_week: Some(export_period(&week_sum)),
        this_month: Some(export_period(&month_sum)),
        total: Some(export_period(&total)),
        dated_totals: Some(dated.export()),
        undated_totals: Some(undated.export()),
        time_uncertain_totals: Some(uncertain.export()),
        future_deferred_totals: Some(future.export()),
        status: status.into(),
        is_stale: state.coverage.failed_files > 0,
        last_scan_at: state.last_scan_at,
        last_success_at: state.last_success_at,
        coverage: state.coverage,
        quality: Quality {
            issue_counts: issues,
            pending_count: pending.to_string(),
            ambiguous_count: ambiguous.to_string(),
            future_deferred_count: future.count.to_string(),
            warning_codes: warnings,
        },
    };
    tx.commit()?;
    Ok(result)
}
