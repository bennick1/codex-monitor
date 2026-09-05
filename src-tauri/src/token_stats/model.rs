use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub fn key(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Usage {
    pub input: i64,
    pub output: i64,
    pub cached: Option<i64>,
    pub reasoning: Option<i64>,
    pub cache_write: Option<i64>,
}

impl Usage {
    pub fn total(&self) -> Option<i64> {
        self.input.checked_add(self.output)
    }

    pub fn delta(&self, previous: &Self) -> Option<Self> {
        let subtract = |a: i64, b: i64| a.checked_sub(b).filter(|v| *v >= 0);
        let optional = |a: Option<i64>, b: Option<i64>| match (a, b) {
            (Some(a), Some(b)) => subtract(a, b).map(Some),
            _ => Some(None),
        };
        let result = Self {
            input: subtract(self.input, previous.input)?,
            output: subtract(self.output, previous.output)?,
            cached: optional(self.cached, previous.cached)?,
            reasoning: optional(self.reasoning, previous.reasoning)?,
            // This extension is not part of the five-field continuity proof.
            cache_write: self
                .cache_write
                .zip(previous.cache_write)
                .and_then(|(a, b)| subtract(a, b)),
        };
        if result.cached.is_some_and(|v| v > result.input)
            || result.reasoning.is_some_and(|v| v > result.output)
            || result.total().is_none()
        {
            return None;
        }
        Some(result)
    }

    pub fn five_equal(&self, other: &Self) -> bool {
        self.input == other.input
            && self.output == other.output
            && self.cached == other.cached
            && self.reasoning == other.reasoning
    }

    pub fn complete(&self) -> bool {
        self.cached.is_some() && self.reasoning.is_some()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub thread: String,
    pub response: String,
    pub turn: Option<String>,
    pub at: Option<String>,
    pub ordinal: Option<u64>,
    pub usage: Usage,
    pub cumulative: Option<Usage>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Legacy {
    pub cumulative: Usage,
    pub last: Option<Usage>,
    pub at: Option<String>,
    pub turn: Option<String>,
}

#[derive(Clone, Debug)]
pub enum Event {
    Meta {
        thread: String,
        parent: Option<String>,
    },
    Turn(Option<String>),
    Modern(Record),
    Legacy(Legacy),
    Problem(&'static str),
    Ignore,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Cursor {
    pub partial_tail: bool,
    pub thread: Option<String>,
    pub parent: Option<String>,
    pub turn: Option<String>,
    pub legacy_index: i64,
    pub chain: String,
    pub previous: Option<Legacy>,
    pub legacy_blocked: bool,
    pub gap: bool,
    pub identity_conflict: bool,
    pub mode: Mode,
    pub pending: Vec<String>,
    pub modern_total: Option<Usage>,
    pub last_ordinal: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    #[default]
    Legacy,
    TransitionPending,
    ResponseRecords,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Fact {
    pub id: String,
    pub thread: String,
    pub usage: Usage,
    pub at: Option<String>,
    pub end: Option<String>,
    pub time_status: String,
    pub format: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub discovered_files: u64,
    pub scanned_files: u64,
    pub failed_files: u64,
    pub retained_missing_files: u64,
    pub threads_with_usage: u64,
    pub threads_without_usage: u64,
    pub earliest_usage_at: Option<String>,
    pub latest_usage_at: Option<String>,
    pub read_bytes: u64,
    pub integrity_read_bytes: u64,
    pub complete: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootState {
    pub coverage: Coverage,
    pub last_scan_at: Option<String>,
    pub last_success_at: Option<String>,
    pub warning_codes: Vec<String>,
}

pub fn json<T: Serialize>(value: &T) -> super::Result<String> {
    serde_json::to_string(value).map_err(|_| "internalSerialization".into())
}

pub fn from_json<T: serde::de::DeserializeOwned>(value: &str) -> super::Result<T> {
    serde_json::from_str(value).map_err(|_| "databaseInvalidMetadata".into())
}
