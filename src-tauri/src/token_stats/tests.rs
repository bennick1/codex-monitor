//! All fixtures are synthetic. Never point these tests at a real Codex home.
use super::{
    aggregate, normalize, parser,
    reader::{Scanner, Source},
    store,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
use tempfile::TempDir;

const AT: &str = "2026-09-05T01:00:00Z";
fn usage(input: i64, output: i64) -> Value {
    json!({"input_tokens":input,"output_tokens":output,"total_tokens":input+output,"cached_input_tokens":0,"reasoning_output_tokens":0})
}
fn meta(thread: &str) -> Value {
    json!({"type":"session_meta","payload":{"id":thread,"session_id":"shared-session","cwd":"SECRET-CWD","instructions":"SECRET-PROMPT"}})
}
fn turn(id: &str) -> Value {
    json!({"type":"turn_context","payload":{"turn_id":id}})
}
fn modern(thread: &str, id: &str, input: i64, total: i64) -> Value {
    json!({"type":"token_usage_record","timestamp":AT,"payload":{"thread_id":thread,"turn_id":"turn-a","response_id":id,"usage":usage(input,0),"thread_token_usage":usage(total,0)}})
}
fn legacy(total: i64, last: i64) -> Value {
    json!({"type":"event_msg","timestamp":AT,"payload":{"type":"token_count","info":{"total_token_usage":usage(total,0),"last_token_usage":usage(last,0)}}})
}
fn write(path: &Path, values: &[Value]) {
    let mut f = fs::File::create(path).unwrap();
    for v in values {
        writeln!(f, "{v}").unwrap();
    }
}
fn append(path: &Path, values: &[Value]) {
    let mut f = fs::OpenOptions::new().append(true).open(path).unwrap();
    for v in values {
        writeln!(f, "{v}").unwrap();
    }
}
struct Harness {
    temp: TempDir,
    home: PathBuf,
    path: PathBuf,
    db: rusqlite::Connection,
    scanner: Scanner,
    source: Source,
}
impl Harness {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("人工 Codex");
        fs::create_dir_all(home.join("sessions")).unwrap();
        let path = temp.path().join("app/token-statistics.sqlite3");
        let db = store::open(&path).unwrap();
        let source = Source::configured(Some(home.clone().into_os_string()), None).unwrap();
        Self {
            temp,
            home,
            path,
            db,
            scanner: Scanner::new(),
            source,
        }
    }
    fn log(&self) -> PathBuf {
        self.home.join("sessions/rollout-synthetic.jsonl")
    }
    fn scan(&mut self) {
        self.scanner
            .scan(&mut self.db, &self.source, &AtomicBool::new(false), |_| {})
            .unwrap();
    }
    fn snapshot(&mut self) -> aggregate::Snapshot {
        self.query("2026-09-05T02:00:00Z", "Asia/Shanghai")
    }
    fn query(&mut self, q: &str, tz: &str) -> aggregate::Snapshot {
        let root = self.source.resolve().unwrap().1;
        aggregate::query(
            &mut self.db,
            &root,
            DateTime::parse_from_rfc3339(q).unwrap().with_timezone(&Utc),
            tz.parse().unwrap(),
        )
        .unwrap()
    }
    fn restart(&mut self) {
        self.db = store::open(&self.path).unwrap();
        self.scanner = Scanner::new();
    }
    fn total(&mut self) -> String {
        self.snapshot().total.unwrap().total_tokens
    }
}

#[test]
fn core_counts_do_not_add_subsets() {
    let u=parser::usage(r#"{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":120}"#).unwrap();
    assert_eq!(u.total(), Some(120));
    let mut h = Harness::new();
    let mut r = modern("main", "r1", 100, 100);
    r["payload"]["usage"] = json!({"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":120});
    r["payload"]["thread_token_usage"] = r["payload"]["usage"].clone();
    write(&h.log(), &[meta("main"), r]);
    h.scan();
    let s = h.snapshot();
    assert_eq!(s.status, "ready");
    assert_eq!(s.total.unwrap().total_tokens, "120");
}

#[test]
fn modern_replay_scan_restart_archive_delete_and_reimport_are_idempotent() {
    let mut h = Harness::new();
    let r = modern("main", "r1", 120, 120);
    write(&h.log(), &[meta("main"), r.clone(), r]);
    h.scan();
    assert_eq!(h.total(), "120");
    h.scan();
    h.restart();
    h.scan();
    assert_eq!(h.total(), "120");
    let archived = h.home.join("archived_sessions");
    fs::create_dir(&archived).unwrap();
    fs::copy(h.log(), archived.join("copy.jsonl")).unwrap();
    h.scan();
    assert_eq!(h.total(), "120");
    let original = fs::read(h.log()).unwrap();
    fs::remove_file(h.log()).unwrap();
    fs::remove_file(archived.join("copy.jsonl")).unwrap();
    h.restart();
    h.scan();
    assert_eq!(h.total(), "120");
    assert!(h.snapshot().coverage.retained_missing_files >= 1);
    fs::write(h.log(), original).unwrap();
    h.scan();
    assert_eq!(h.total(), "120");
}

#[test]
fn legacy_differences_repeated_metadata_and_rollbacks() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(120, 120),
            meta("main"),
            legacy(120, 120),
            json!({"type":"compacted","payload":{"summary":"synthetic-only"}}),
            json!({"type":"event_msg","payload":{"type":"task_started"}}),
            json!({"type":"turn_context","payload":{"model":"synthetic-model-change"}}),
            legacy(170, 50),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "170");
    assert_eq!(h.snapshot().status, "ready");
    append(&h.log(), &[legacy(20, 20), legacy(40, 20)]);
    h.scan();
    assert_eq!(h.total(), "170");
    assert_eq!(h.snapshot().status, "partial");
}

#[test]
fn mixed_forward_bracket_keeps_legacy_prefix() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            modern("main", "r1", 120, 120),
            legacy(1120, 120),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "1120");
    assert_eq!(h.snapshot().status, "ready");
    append(&h.log(), &[modern("main", "r2", 50, 170), legacy(1170, 50)]);
    h.scan();
    assert_eq!(h.total(), "1170");
    h.restart();
    h.scan();
    assert_eq!(h.total(), "1170");
}

#[test]
fn late_response_without_evidence_remains_pending_after_deletion() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            legacy(1120, 120),
        ],
    );
    h.scan();
    h.restart();
    append(&h.log(), &[modern("main", "r1", 120, 120)]);
    h.scan();
    assert_eq!(h.total(), "1120");
    assert_eq!(h.snapshot().quality.pending_count, "1");
    fs::remove_file(h.log()).unwrap();
    h.restart();
    h.scan();
    assert_eq!(h.total(), "1120");
    assert_eq!(h.snapshot().status, "partial");
}

#[test]
fn richer_verified_alias_replaces_committed_legacy_after_restart() {
    let mut h = Harness::new();
    let old = vec![
        meta("main"),
        legacy(1000, 1000),
        turn("turn-a"),
        legacy(1120, 120),
    ];
    write(&h.log(), &old);
    h.scan();
    h.restart();
    write(
        &h.home.join("sessions/richer.jsonl"),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            modern("main", "r1", 120, 120),
            legacy(1120, 120),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "1120");
    assert_eq!(h.snapshot().status, "ready");
    let replacements: i64 =
        h.db.query_row("SELECT count(*) FROM reconciliation_links", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(replacements, 1);
    h.restart();
    h.scan();
    assert_eq!(h.total(), "1120");
}

#[test]
fn equal_usage_distinct_responses_and_subagents_are_not_merged() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            modern("main", "r1", 120, 120),
            modern("main", "r2", 120, 240),
        ],
    );
    let mut child = meta("child");
    child["payload"]["parent_thread_id"] = json!("main");
    write(
        &h.home.join("sessions/child.jsonl"),
        &[child, modern("child", "r3", 120, 120)],
    );
    h.scan();
    assert_eq!(h.total(), "360");
}

#[test]
fn transition_pending_survives_batch_restart_and_legacy_only_replay() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            modern("main", "r1", 120, 120),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "1000");
    h.restart();
    append(&h.log(), &[legacy(1120, 120)]);
    h.scan();
    assert_eq!(h.total(), "1120");
    write(
        &h.home.join("sessions/legacy-only.jsonl"),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            legacy(1120, 120),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "1120");
}

#[test]
fn multi_response_complete_bracket_replaces_one_legacy_gap() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            legacy(1170, 50),
        ],
    );
    h.scan();
    assert_eq!(
        h.snapshot().time_uncertain_totals.unwrap().total_tokens,
        "170"
    );
    write(
        &h.home.join("sessions/richer.jsonl"),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            modern("main", "r1", 120, 120),
            modern("main", "r2", 50, 170),
            legacy(1170, 50),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "1170");
    assert_eq!(
        h.snapshot().time_uncertain_totals.unwrap().total_tokens,
        "0"
    );
    h.restart();
    h.scan();
    assert_eq!(h.total(), "1170");
}

#[test]
fn equal_values_turn_or_time_without_complete_sequence_do_not_match() {
    for alter in ["turn", "gap", "cumulative", "prefix"] {
        let mut h = Harness::new();
        let mut r = modern("main", "r1", 120, 120);
        if alter == "turn" {
            r["payload"]["turn_id"] = json!("unrelated");
        }
        if alter == "cumulative" {
            r["payload"]["thread_token_usage"] = usage(240, 0);
        }
        let mut values = vec![meta("main"), legacy(1000, 1000), turn("turn-a"), r];
        if alter == "gap" {
            values.push(json!({"type":"unrecognized-format","payload":{}}));
        }
        values.push(legacy(1120, 120));
        if alter == "prefix" {
            values[1] = legacy(1000, 500);
        }
        write(&h.log(), &values);
        h.scan();
        assert_eq!(h.snapshot().status, "partial", "{alter}");
        if alter == "prefix" {
            // The gap is before the known C=1000 baseline, outside this bracket.
            assert_eq!(h.total(), "120");
            assert_eq!(h.snapshot().quality.issue_counts["missingPrefix"], "1");
        } else {
            assert_ne!(h.snapshot().quality.pending_count, "0", "{alter}");
        }
    }
}

#[test]
fn unmatched_transition_cannot_reuse_a_later_equal_legacy_delta() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            modern("main", "r1", 120, 120),
            legacy(1100, 100),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "1000");
    h.restart();
    append(&h.log(), &[legacy(1220, 120)]);
    h.scan();
    // r1 preceded C=1100. Matching its 120 to the LATER 1100→1220
    // interval would only be a numeric coincidence in the same turn.
    assert_eq!(h.total(), "1000");
    assert_eq!(h.snapshot().quality.pending_count, "1");
    assert_eq!(h.snapshot().status, "partial");
}

#[test]
fn response_conflicts_and_fork_legacy_prefixes_are_isolated() {
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    h.scan();
    let mut child = meta("child");
    child["payload"]["parent_thread_id"] = json!("main");
    write(
        &h.home.join("sessions/child.jsonl"),
        &[
            child,
            modern("main", "r1", 120, 120),
            modern("child", "r2", 50, 50),
            legacy(120, 120),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "170");
    assert_eq!(h.snapshot().status, "partial");
    append(&h.log(), &[modern("main", "r1", 121, 121)]);
    h.scan();
    assert_eq!(h.total(), "170");
    assert_ne!(h.snapshot().quality.ambiguous_count, "0");
}

#[test]
fn same_thread_legacy_fork_does_not_select_latest_mtime() {
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), legacy(120, 120), legacy(170, 50)]);
    h.scan();
    write(
        &h.home.join("sessions/conflict.jsonl"),
        &[meta("main"), legacy(120, 120), legacy(200, 80)],
    );
    h.scan();
    assert_eq!(h.total(), "170");
    assert_eq!(h.snapshot().status, "partial");
}

#[test]
fn unreadable_root_preserves_namespace_and_does_not_switch_sources() {
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    h.scan();
    let root = h.source.resolve().unwrap().1;
    fs::rename(&h.home, h.temp.path().join("temporarily-away")).unwrap();
    assert!(h
        .scanner
        .scan(&mut h.db, &h.source, &AtomicBool::new(false), |_| {})
        .is_err());
    assert_eq!(
        store::source(&h.db, &h.source.locator, None).unwrap(),
        Some(root.clone())
    );
    let s = aggregate::query(
        &mut h.db,
        &root,
        "2026-09-05T02:00:00Z".parse().unwrap(),
        chrono_tz::UTC,
    )
    .unwrap();
    assert_eq!(s.total.unwrap().total_tokens, "120");
    let second = h.temp.path().join("separate-home");
    fs::create_dir(&second).unwrap();
    let separate = Source::configured(Some(second.into_os_string()), None).unwrap();
    let (root2, _) = h
        .scanner
        .scan(&mut h.db, &separate, &AtomicBool::new(false), |_| {})
        .unwrap();
    assert_ne!(root, root2);
    assert_eq!(
        aggregate::query(&mut h.db, &root2, Utc::now(), chrono_tz::UTC)
            .unwrap()
            .status,
        "empty"
    );
    assert!(Source::configured(Some("".into()), Some(h.home.clone())).is_err());
    assert!(Source::configured(None, None).is_err());
}

#[test]
fn truncate_rewrite_and_same_length_edit_preserve_old_facts() {
    let mut h = Harness::new();
    let first = vec![
        meta("main"),
        modern("main", "r1", 120, 120),
        modern("main", "r2", 50, 170),
    ];
    write(&h.log(), &first);
    h.scan();
    write(&h.log(), &first[..2]);
    h.scan();
    assert_eq!(h.total(), "170");
    write(&h.log(), &[meta("main"), modern("main", "r3", 120, 120)]);
    h.scan();
    assert_eq!(h.total(), "290");
    h.restart();
    h.scan();
    assert_eq!(h.total(), "290");
}

#[test]
fn natural_week_month_and_empty_month_boundary() {
    let mut h = Harness::new();
    let mut august = modern("main", "a", 120, 120);
    august["timestamp"] = json!("2026-08-31T01:00:00Z");
    let mut september = modern("main", "b", 50, 170);
    september["timestamp"] = json!("2026-09-01T01:00:00Z");
    write(&h.log(), &[meta("main"), august, september]);
    h.scan();
    let s = h.snapshot();
    assert_eq!(s.this_week.unwrap().total_tokens, "170");
    assert_eq!(s.this_month.unwrap().total_tokens, "50");
    assert_eq!(
        s.this_week_start_utc.unwrap(),
        "2026-08-30T16:00:00.000000000Z"
    );
    let s = h.query("2026-09-30T16:00:00Z", "Asia/Shanghai");
    assert_eq!(s.this_month.unwrap().total_tokens, "0");
    assert_eq!(
        s.this_month_start_utc.as_deref(),
        Some(s.query_at_utc.as_str())
    );
    assert_eq!(s.total.unwrap().total_tokens, "170");
    let s = h.query("2027-01-01T00:00:00Z", "UTC");
    assert_eq!(
        s.this_week_start_utc.unwrap(),
        "2026-12-28T00:00:00.000000000Z"
    );
}

#[test]
fn dst_timezone_changes_skipped_and_repeated_midnight() {
    use chrono::{NaiveDate, TimeZone};
    let ny = chrono_tz::America::New_York;
    let before = aggregate::day_start(NaiveDate::from_ymd_opt(2026, 3, 8).unwrap(), ny).unwrap();
    let after = aggregate::day_start(NaiveDate::from_ymd_opt(2026, 3, 9).unwrap(), ny).unwrap();
    assert_eq!((after - before).num_hours(), 23);
    let before = aggregate::day_start(NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(), ny).unwrap();
    let after = aggregate::day_start(NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(), ny).unwrap();
    assert_eq!((after - before).num_hours(), 25);
    let skipped = aggregate::day_start(
        NaiveDate::from_ymd_opt(2011, 12, 30).unwrap(),
        chrono_tz::Pacific::Apia,
    )
    .unwrap();
    assert_eq!(skipped.to_rfc3339(), "2011-12-30T10:00:00+00:00");
    let havana = chrono_tz::America::Havana;
    let date = NaiveDate::from_ymd_opt(2020, 11, 1).unwrap();
    let earliest = havana
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .unwrap();
    assert_eq!(
        aggregate::day_start(date, havana).unwrap(),
        earliest.with_timezone(&Utc)
    );
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    h.scan();
    assert_eq!(
        h.query("2026-09-05T02:00:00Z", "Asia/Shanghai")
            .today
            .unwrap()
            .total_tokens,
        "120"
    );
    let s = h.query("2026-09-05T02:00:00Z", "America/Los_Angeles");
    assert_eq!(s.today_start_utc.unwrap(), "2026-09-04T07:00:00.000000000Z");
    assert_eq!(s.total.unwrap().total_tokens, "120");
    let shanghai = h.query("2026-09-05T08:00:00Z", "Asia/Shanghai");
    let los_angeles = h.query("2026-09-05T08:00:00Z", "America/Los_Angeles");
    assert_eq!(shanghai.today.unwrap().total_tokens, "120");
    assert_eq!(los_angeles.today.unwrap().total_tokens, "0");
    assert_eq!(shanghai.generation, los_angeles.generation);
    assert_eq!(los_angeles.total.unwrap().total_tokens, "120");
}

#[test]
fn future_undated_and_uncertain_times_never_become_today() {
    let mut h = Harness::new();
    let mut future = modern("main", "f", 120, 120);
    future["timestamp"] = json!("2026-09-06T00:00:00Z");
    let mut undated = modern("main", "u", 50, 170);
    undated["timestamp"] = json!("invalid");
    write(&h.log(), &[meta("main"), future, undated]);
    h.scan();
    let s = h.snapshot();
    assert_eq!(s.total.unwrap().total_tokens, "50");
    assert_eq!(s.today.unwrap().total_tokens, "0");
    assert_eq!(s.future_deferred_totals.unwrap().total_tokens, "120");
    assert_eq!(s.undated_totals.unwrap().total_tokens, "50");
    assert_eq!(
        h.query("2026-09-06T00:00:00Z", "UTC")
            .total
            .unwrap()
            .total_tokens,
        "50"
    );
    assert_eq!(
        h.query("2026-09-06T00:00:00.000000001Z", "UTC")
            .total
            .unwrap()
            .total_tokens,
        "170"
    );
    let mut h = Harness::new();
    let mut gap = legacy(170, 20);
    gap["timestamp"] = json!("2026-09-06T00:00:00Z");
    write(&h.log(), &[meta("main"), legacy(120, 120), gap]);
    h.scan();
    assert_eq!(h.total(), "120");
    let s = h.query("2026-09-07T02:00:00Z", "UTC");
    assert_eq!(s.time_uncertain_totals.unwrap().total_tokens, "50");
    assert_eq!(s.today.unwrap().total_tokens, "0");
}

#[test]
fn optional_missing_invalid_and_integer_boundaries() {
    for raw in [
        r#"{"input_tokens":-1,"output_tokens":0,"total_tokens":0}"#,
        r#"{"input_tokens":1.5,"output_tokens":0,"total_tokens":1.5}"#,
        r#"{"input_tokens":9223372036854775807,"output_tokens":1,"total_tokens":9223372036854775808}"#,
        r#"{"last_token_usage":{}}"#,
    ] {
        assert!(parser::usage(raw).is_none());
    }
    let mut h = Harness::new();
    let mut r = modern("main", "large", 9007199254740993, 9007199254740993);
    r["payload"]["usage"]
        .as_object_mut()
        .unwrap()
        .remove("cached_input_tokens");
    r["payload"]["usage"]["reasoning_output_tokens"] = json!(1);
    write(&h.log(), &[meta("main"), r]);
    h.scan();
    let s = h.snapshot();
    let totals = s.total.unwrap();
    assert_eq!(totals.total_tokens, "9007199254740993");
    assert_eq!(totals.cached_input_tokens, None);
    assert_eq!(totals.reasoning_output_tokens, None);
    assert_eq!(s.status, "partial");
    let mut h = Harness::new();
    write(
        &h.log(),
        &[meta("main"), modern("main", "max", i64::MAX, i64::MAX)],
    );
    h.scan();
    assert_eq!(h.total(), i64::MAX.to_string());
    append(&h.log(), &[modern("main", "overflow", 1, 1)]);
    h.scan();
    let root = h.source.resolve().unwrap().1;
    assert_eq!(
        aggregate::query(&mut h.db, &root, Utc::now(), chrono_tz::UTC)
            .unwrap_err()
            .0,
        "aggregateOverflow"
    );
}

#[test]
fn streaming_half_line_crlf_utf8_bad_and_oversize_are_bounded() {
    let mut h = Harness::new();
    write(&h.log(), &[meta("中文线程")]);
    let r = modern("中文线程", "response", 120, 120);
    let serialized = format!("{r}\r\n");
    let split = serialized.find("中文").unwrap() + 1;
    {
        let mut f = fs::OpenOptions::new().append(true).open(h.log()).unwrap();
        f.write_all(&serialized.as_bytes()[..split]).unwrap();
    }
    h.scan();
    assert_eq!(h.total(), "0");
    assert_eq!(h.snapshot().status, "partial");
    {
        let mut f = fs::OpenOptions::new().append(true).open(h.log()).unwrap();
        f.write_all(&serialized.as_bytes()[split..]).unwrap();
        f.write_all(b"not-json\n").unwrap();
        let bytes = vec![b'x'; super::reader::LINE_LIMIT + 1];
        f.write_all(&bytes).unwrap();
        f.write_all(b"\n").unwrap();
    }
    append(
        &h.log(),
        &[
            modern("中文线程", "r2", 50, 170),
            json!({"type":"event_msg","payload":{"type":"token_count","info":null}}),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "170");
    let s = h.snapshot();
    assert_eq!(s.quality.issue_counts["badLine"], "1");
    assert_eq!(s.quality.issue_counts["oversizeLine"], "1");
    h.scan();
    assert_eq!(h.total(), "170");
}

#[test]
fn first_cumulative_prefix_and_missing_response_never_backfill_guesses() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[meta("main"), legacy(1000, 120), legacy(1050, 50)],
    );
    h.scan();
    assert_eq!(h.total(), "50");
    assert_eq!(h.snapshot().status, "partial");
    let mut h = Harness::new();
    let mut r = modern("main", "x", 120, 120);
    r["payload"].as_object_mut().unwrap().remove("response_id");
    write(&h.log(), &[meta("main"), r, legacy(120, 120)]);
    h.scan();
    assert_eq!(h.total(), "0");
    assert_eq!(h.snapshot().status, "partial");
}

#[test]
fn empty_voice_session_and_privacy_whitelist() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            json!({"type":"response_item","payload":{"role":"user","content":"SECRET-CHAT","audio_duration":1000}}),
        ],
    );
    h.scan();
    assert_eq!(h.snapshot().status, "empty");
    assert_eq!(h.snapshot().coverage.threads_without_usage, 1);
    append(&h.log(), &[modern("main", "r1", 120, 120)]);
    h.scan();
    h.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    let bytes = fs::read(&h.path).unwrap();
    for forbidden in [
        "SECRET-CWD",
        "SECRET-PROMPT",
        "SECRET-CHAT",
        "shared-session",
    ] {
        assert!(!bytes
            .windows(forbidden.len())
            .any(|w| w == forbidden.as_bytes()));
    }
    assert!(!serde_json::to_string(&h.snapshot())
        .unwrap()
        .contains("rollout-synthetic"));
}

#[test]
fn transaction_errors_rollback_facts_and_checkpoint_together() {
    for point in ["facts", "checkpoint", "committed"] {
        let mut h = Harness::new();
        write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
        h.scan();
        let old_offset: i64 =
            h.db.query_row("SELECT max(offset) FROM source_files", [], |r| r.get(0))
                .unwrap();
        append(&h.log(), &[modern("main", "r2", 50, 170)]);
        normalize::FAILURE.with(|f| f.set(Some(point)));
        assert!(h
            .scanner
            .scan(&mut h.db, &h.source, &AtomicBool::new(false), |_| {})
            .is_err());
        normalize::FAILURE.with(|f| f.set(None));
        let new_offset: i64 =
            h.db.query_row("SELECT max(offset) FROM source_files", [], |r| r.get(0))
                .unwrap();
        if point == "committed" {
            assert!(new_offset > old_offset);
            assert_eq!(h.total(), "170");
        } else {
            assert_eq!(new_offset, old_offset);
            assert_eq!(h.total(), "120");
        }
        h.restart();
        h.scan();
        assert_eq!(h.total(), "170");
    }
}

#[test]
fn database_busy_disk_full_unknown_versions_and_corruption_preserve_files() {
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    h.scan();
    append(&h.log(), &[modern("main", "r2", 50, 170)]);
    let other = store::open(&h.path).unwrap();
    other.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert_eq!(
        h.scanner
            .scan(&mut h.db, &h.source, &AtomicBool::new(false), |_| {})
            .unwrap_err()
            .0,
        "databaseBusy"
    );
    other.execute_batch("ROLLBACK").unwrap();
    assert_eq!(h.total(), "120");
    h.scan();
    assert_eq!(h.total(), "170");
    let gen = store::generation(&h.db).unwrap();
    h.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA max_page_count=1;")
        .unwrap();
    let result = h.db.execute(
        "CREATE TABLE simulated_full AS SELECT randomblob(10000000)",
        [],
    );
    assert!(result.is_err());
    assert_eq!(store::generation(&h.db).unwrap(), gen);
    assert_eq!(h.total(), "170");
    for pragma in [
        "PRAGMA user_version=999",
        "UPDATE statistics_meta SET parser_version=999",
    ] {
        let mut h = Harness::new();
        write(&h.log(), &[meta("main"), legacy(120, 120)]);
        h.scan();
        h.db.execute_batch(pragma).unwrap();
        h.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        let before = fs::read(&h.path).unwrap();
        assert!(store::open(&h.path).is_err());
        assert_eq!(before, fs::read(&h.path).unwrap());
    }
    let temp = tempfile::tempdir().unwrap();
    let bad = temp.path().join("corrupt.sqlite3");
    fs::write(&bad, b"corrupt synthetic database only").unwrap();
    let before = fs::read(&bad).unwrap();
    assert!(store::open(&bad).is_err());
    assert_eq!(before, fs::read(&bad).unwrap());
}

#[test]
fn consistent_online_backup_includes_wal_and_deleted_source_history() {
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    h.scan();
    let backup = h.temp.path().join("verified.sqlite3");
    store::backup(&h.db, &backup).unwrap();
    fs::remove_file(h.log()).unwrap();
    let mut recovered = store::open(&backup).unwrap();
    let root = h.source.resolve().unwrap().1;
    assert_eq!(
        aggregate::query(&mut recovered, &root, Utc::now(), chrono_tz::UTC)
            .unwrap()
            .total
            .unwrap()
            .total_tokens,
        "120"
    );
    assert!(store::backup(&h.db, &backup).is_err());
}

#[test]
#[ignore = "helper run only by the crash recovery test in a marked temporary directory"]
fn crash_child() {
    let base = PathBuf::from(std::env::var_os("TOKEN_TEST_TEMP").unwrap())
        .canonicalize()
        .unwrap();
    assert!(base.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    assert_eq!(
        fs::read(base.join("synthetic-test-marker")).unwrap(),
        b"synthetic-only"
    );
    let point = std::env::var("TOKEN_TEST_POINT").unwrap();
    let point = match point.as_str() {
        "facts" => "facts",
        "checkpoint" => "checkpoint",
        "committed" => "committed",
        "replacement" => "replacement",
        _ => panic!("invalid test hook"),
    };
    let mut db = store::open(&base.join("app/token-statistics.sqlite3")).unwrap();
    let source = Source::configured(Some(base.join("人工 Codex").into_os_string()), None).unwrap();
    normalize::FAILURE.with(|v| v.set(Some(point)));
    normalize::EXIT_ON_FAILURE.with(|v| v.set(true));
    Scanner::new()
        .scan(&mut db, &source, &AtomicBool::new(false), |_| {})
        .unwrap();
    panic!("crash hook not reached");
}

#[test]
fn abrupt_process_exit_recovers_wal_before_after_commit_and_replacement() {
    for point in ["facts", "checkpoint", "committed", "replacement"] {
        let mut h = Harness::new();
        fs::write(
            h.temp.path().join("synthetic-test-marker"),
            b"synthetic-only",
        )
        .unwrap();
        if point == "replacement" {
            write(
                &h.log(),
                &[
                    meta("main"),
                    legacy(1000, 1000),
                    turn("turn-a"),
                    legacy(1120, 120),
                ],
            );
            h.scan();
            write(
                &h.home.join("sessions/richer.jsonl"),
                &[
                    meta("main"),
                    legacy(1000, 1000),
                    turn("turn-a"),
                    modern("main", "r1", 120, 120),
                    legacy(1120, 120),
                ],
            );
        } else {
            write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
            h.scan();
            append(&h.log(), &[modern("main", "r2", 50, 170)]);
        }
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "token_stats::tests::crash_child", "--ignored"])
            .env("TOKEN_TEST_TEMP", h.temp.path())
            .env("TOKEN_TEST_POINT", point)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(91));
        h.restart();
        assert_eq!(
            h.total(),
            if point == "replacement" {
                "1120"
            } else if point == "committed" {
                "170"
            } else {
                "120"
            }
        );
        h.scan();
        assert_eq!(
            h.total(),
            if point == "replacement" {
                "1120"
            } else {
                "170"
            }
        );
    }
}

#[test]
fn concurrent_refresh_is_coalesced_and_queries_use_committed_generation() {
    use super::service::{TokenStatisticsService, Trigger};
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    let trigger = Arc::new(Trigger::default());
    let mut joins = Vec::new();
    for _ in 0..16 {
        let t = trigger.clone();
        joins.push(std::thread::spawn(move || {
            for _ in 0..100 {
                t.request();
            }
        }));
    }
    for j in joins {
        j.join().unwrap();
    }
    assert!(trigger.wait(Duration::ZERO));
    let begin = Instant::now();
    assert!(trigger.wait(Duration::from_millis(20)));
    assert!(begin.elapsed() >= Duration::from_millis(15));
    trigger.cancel();
    assert!(!trigger.wait(Duration::ZERO));
    let h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    let service =
        TokenStatisticsService::start_source(Some(h.path.clone()), Ok(h.source.clone()), |_| {});
    let begin = Instant::now();
    loop {
        let s = service.query();
        if s.status == "ready" {
            assert_eq!(s.total.unwrap().total_tokens, "120");
            break;
        }
        assert!(begin.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(5));
    }
    let mut joins = Vec::new();
    for _ in 0..8 {
        let s = service.clone();
        joins.push(std::thread::spawn(move || {
            for _ in 0..20 {
                s.refresh();
                let value = s.query();
                assert_eq!(value.total.unwrap().total_tokens, "120");
            }
        }));
    }
    for j in joins {
        j.join().unwrap();
    }
    service.stop();
}

#[test]
fn scan_failure_retains_confirmed_empty_and_future_only_results() {
    use super::service::TokenStatisticsService;
    use std::{sync::mpsc, time::Duration};
    for future_only in [false, true] {
        let h = Harness::new();
        if future_only {
            let mut r = modern("main", "future", 120, 120);
            r["timestamp"] = json!("2099-01-01T00:00:00Z");
            write(&h.log(), &[meta("main"), r]);
        }
        let (send, receive) = mpsc::channel();
        let service = TokenStatisticsService::start_source(
            Some(h.path.clone()),
            Ok(h.source.clone()),
            move |event| {
                let _ = send.send(serde_json::to_value(event).unwrap());
            },
        );
        let wait_for_scan = || loop {
            let event = receive.recv_timeout(Duration::from_secs(5)).unwrap();
            if event["scanning"] == false {
                break;
            }
        };
        wait_for_scan();
        let before = service.query();
        assert_eq!(before.status, if future_only { "partial" } else { "empty" });
        assert_eq!(before.total.unwrap().total_tokens, "0");
        fs::rename(&h.home, h.temp.path().join("temporarily-offline")).unwrap();
        service.refresh();
        wait_for_scan();
        let after = service.query();
        service.stop();
        assert_eq!(after.status, "partial");
        assert!(after.is_stale);
        assert_eq!(after.total.unwrap().total_tokens, "0");
        assert_eq!(after.last_success_at, before.last_success_at);
        assert_eq!(
            after.quality.future_deferred_count,
            if future_only { "1" } else { "0" }
        );
    }
}

#[cfg(unix)]
#[test]
fn safe_unicode_paths_links_permissions_and_cancelled_discovery() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), legacy(120, 120)]);
    h.scan();
    let outside = h.temp.path().join("outside.jsonl");
    write(&outside, &[meta("other"), modern("other", "x", 999, 999)]);
    symlink(&outside, h.home.join("sessions/escape.jsonl")).unwrap();
    symlink(h.home.join("sessions"), h.home.join("sessions/loop")).unwrap();
    h.scan();
    assert_eq!(h.total(), "120");
    assert_eq!(h.snapshot().status, "partial");
    let before = store::generation(&h.db).unwrap();
    assert!(h
        .scanner
        .scan(&mut h.db, &h.source, &AtomicBool::new(true), |_| {})
        .is_err());
    assert_eq!(store::generation(&h.db).unwrap(), before);
    let path = h.log();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o0)).unwrap();
    h.scan();
    assert_eq!(h.total(), "120");
    assert!(h.snapshot().is_stale);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    h.scan();
    assert_eq!(h.total(), "120");
}

#[test]
#[ignore = "1 GiB synthetic performance run; execute explicitly with --ignored --nocapture"]
fn synthetic_gib_backfill_and_idle_increment() {
    let mut h = Harness::new();
    let mut f = std::io::BufWriter::new(fs::File::create(h.log()).unwrap());
    writeln!(f, "{}", meta("performance-main")).unwrap();
    let padding = "s".repeat(65500);
    let body =
        format!("{{\"type\":\"response_item\",\"payload\":{{\"synthetic\":\"{padding}\"}}}}\n");
    let mut responses = 0i64;
    for i in 0..16384 {
        f.write_all(body.as_bytes()).unwrap();
        if i % 16 == 0 {
            responses += 1;
            writeln!(
                f,
                "{}",
                modern(
                    "performance-main",
                    &format!("r{responses}"),
                    120,
                    responses * 120
                )
            )
            .unwrap();
        }
    }
    f.flush().unwrap();
    drop(f);
    let bytes = fs::metadata(h.log()).unwrap().len();
    let begin = std::time::Instant::now();
    h.scan();
    let elapsed = begin.elapsed();
    let s = h.snapshot();
    assert_eq!(s.total.unwrap().total_tokens, (responses * 120).to_string());
    assert_eq!(s.coverage.read_bytes, bytes);
    println!("PERF bytes={bytes} responses={responses} backfill_ms={} read_bytes={} integrity_bytes={} sqlite={}",elapsed.as_millis(),s.coverage.read_bytes,s.coverage.integrity_read_bytes,rusqlite::version());
    let begin = std::time::Instant::now();
    h.scan();
    let s = h.snapshot();
    println!(
        "PERF idle_ms={} read_bytes={} integrity_bytes={}",
        begin.elapsed().as_millis(),
        s.coverage.read_bytes,
        s.coverage.integrity_read_bytes
    );
    assert_eq!(s.coverage.read_bytes, 0);
    assert_eq!(s.coverage.integrity_read_bytes, 0);
    let begin = std::time::Instant::now();
    h.restart();
    h.scan();
    let s = h.snapshot();
    println!(
        "PERF restart_ms={} read_bytes={} integrity_bytes={}",
        begin.elapsed().as_millis(),
        s.coverage.read_bytes,
        s.coverage.integrity_read_bytes
    );
    assert_eq!(s.coverage.read_bytes, 0);
}

#[test]
fn mixed_thread_continuation_and_late_response_after_switch() {
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            modern("main", "r1", 120, 120),
            legacy(1120, 120),
        ],
    );
    h.scan();
    h.restart();
    write(
        &h.home.join("sessions/continued.jsonl"),
        &[meta("main"), modern("main", "r2", 50, 170)],
    );
    h.scan();
    assert_eq!(h.total(), "1170");
    assert_eq!(h.snapshot().status, "ready");
    append(&h.log(), &[modern("main", "late-unmapped", 120, 120)]);
    h.scan();
    assert_eq!(h.total(), "1170");
    assert_eq!(h.snapshot().status, "partial");
}

#[test]
fn invalid_timestamp_type_keeps_confirmed_usage_undated() {
    let mut h = Harness::new();
    let mut r = modern("中文", "r", 120, 120);
    r["timestamp"] = json!(123456);
    write(&h.log(), &[meta("中文"), r]);
    h.scan();
    assert_eq!(h.total(), "120");
    assert_eq!(h.snapshot().undated_totals.unwrap().total_tokens, "120");
    let escaped = br#"{"type":"session_meta","payload":{"id":"\u4e2d\u6587"}}"#;
    assert!(matches!(
        parser::parse(escaped),
        super::model::Event::Meta { .. }
    ));
}

#[test]
fn collector_sqlite_full_does_not_advance_checkpoint() {
    let mut h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    h.scan();
    let old_offset: i64 =
        h.db.query_row("SELECT max(offset) FROM source_files", [], |r| r.get(0))
            .unwrap();
    h.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA max_page_count=1;")
        .unwrap();
    let values: Vec<_> = (1..3000)
        .map(|n| modern("main", &format!("fill{n}"), 1, 120 + n))
        .collect();
    append(&h.log(), &values);
    let result = h
        .scanner
        .scan(&mut h.db, &h.source, &AtomicBool::new(false), |_| {});
    assert_eq!(result.unwrap_err().0, "persistenceDegraded");
    assert_eq!(h.total(), "120");
    assert_eq!(
        h.db.query_row("SELECT max(offset) FROM source_files", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        old_offset
    );
}

#[test]
fn tauri_ipc_contract_uses_registered_independent_commands() {
    use super::service::TokenStatisticsService;
    use std::time::{Duration, Instant};
    let h = Harness::new();
    write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
    let service =
        TokenStatisticsService::start_source(Some(h.path.clone()), Ok(h.source.clone()), |_| {});
    let begin = Instant::now();
    while service.query().status != "ready" {
        assert!(begin.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(5));
    }
    let app = tauri::test::mock_builder()
        .manage(service.clone())
        .invoke_handler(tauri::generate_handler![
            super::service::get_token_statistics,
            super::service::refresh_token_statistics
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "widget", Default::default())
        .build()
        .unwrap();
    let invoke = |name: &str| {
        tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: name.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize::<Value>()
        .unwrap()
    };
    let result = invoke("get_token_statistics");
    assert_eq!(result["scope"], "localCodexHome");
    assert_eq!(result["total"]["totalTokens"], "120");
    assert!(result["generation"].is_string());
    assert_eq!(invoke("refresh_token_statistics")["queued"], true);
    service.stop();
}

#[test]
fn daily_integrity_check_detects_middle_rewrite_with_unchanged_mtime() {
    let mut h = Harness::new();
    let body = json!({"type":"response_item","payload":{"content":"synthetic".repeat(10000)}});
    write(
        &h.log(),
        &[
            meta("main"),
            modern("main", "first", 120, 120),
            body.clone(),
            modern("main", "middle-a", 50, 170),
            body,
            modern("main", "last", 20, 190),
        ],
    );
    h.scan();
    let verified = Utc::now().timestamp() - 3600;
    h.db.execute("UPDATE source_files SET verified_at=?1", [verified])
        .unwrap();
    append(&h.log(), &[modern("main", "zero", 0, 190)]);
    h.scan();
    // Appends must not postpone the daily full check indefinitely.
    assert_eq!(
        h.db.query_row("SELECT verified_at FROM source_files LIMIT 1", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        verified
    );
    let mtime = fs::metadata(h.log()).unwrap().modified().unwrap();
    let text = fs::read_to_string(h.log())
        .unwrap()
        .replace("middle-a", "middle-b");
    fs::write(h.log(), text).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(h.log())
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(mtime))
        .unwrap();
    h.scan();
    assert_eq!(h.total(), "190");
    assert_eq!(h.snapshot().coverage.read_bytes, 0);
    h.db.execute("UPDATE source_files SET verified_at=0", [])
        .unwrap();
    h.scan();
    assert_eq!(h.total(), "240");
    assert!(h.snapshot().coverage.integrity_read_bytes > 10000);
}

#[test]
fn observed_child_without_usage_reports_coverage_gap() {
    let mut h = Harness::new();
    let mut child = meta("child");
    child["payload"]["parent_thread_id"] = json!("main");
    write(&h.log(), &[child]);
    h.scan();
    let s = h.snapshot();
    assert_eq!(s.status, "partial");
    assert_eq!(s.quality.issue_counts["childUsageMissing"], "1");
}

#[test]
fn verified_reconciliation_can_reduce_a_synthetic_duplicate_committed_state() {
    use super::model::{key, Event, Fact};
    let mut h = Harness::new();
    write(
        &h.log(),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            legacy(1120, 120),
        ],
    );
    h.scan();
    // Simulate an already committed duplicate fact, NOT a claimed historical migration.
    let r = modern("main", "r1", 120, 120);
    let Event::Modern(record) = parser::parse(r.to_string().as_bytes()) else {
        panic!("fixture")
    };
    let root = h.source.resolve().unwrap().1;
    let id = key(&[&root, "response", &record.response]);
    let tx = h.db.transaction().unwrap();
    store::add_fact(
        &tx,
        &root,
        &Fact {
            id: id.clone(),
            thread: record.thread.clone(),
            usage: record.usage.clone(),
            at: record.at.clone(),
            end: None,
            time_status: "dated".into(),
            format: "response".into(),
        },
    )
    .unwrap();
    store::bind(&tx, &root, "response", &record.response, &id).unwrap();
    store::bump(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(h.total(), "1240");
    write(
        &h.home.join("sessions/richer.jsonl"),
        &[
            meta("main"),
            legacy(1000, 1000),
            turn("turn-a"),
            r,
            legacy(1120, 120),
        ],
    );
    h.scan();
    assert_eq!(h.total(), "1120");
    h.restart();
    h.scan();
    assert_eq!(h.total(), "1120");
}

#[test]
fn failed_or_partial_tail_deleted_later_remains_a_reported_gap() {
    for fail in [false, true] {
        let mut h = Harness::new();
        write(&h.log(), &[meta("main"), modern("main", "r1", 120, 120)]);
        h.scan();
        if fail {
            append(&h.log(), &[modern("main", "r2", 50, 170)]);
            normalize::FAILURE.with(|f| f.set(Some("checkpoint")));
            assert!(h
                .scanner
                .scan(&mut h.db, &h.source, &AtomicBool::new(false), |_| {})
                .is_err());
            normalize::FAILURE.with(|f| f.set(None));
        } else {
            fs::OpenOptions::new()
                .append(true)
                .open(h.log())
                .unwrap()
                .write_all(b"{\"type\":")
                .unwrap();
            h.scan();
        }
        fs::remove_file(h.log()).unwrap();
        h.restart();
        h.scan();
        assert_eq!(h.total(), "120");
        let s = h.snapshot();
        assert_eq!(s.status, "partial");
        assert_eq!(s.quality.issue_counts["uncommittedSourceTail"], "1");
    }
}
