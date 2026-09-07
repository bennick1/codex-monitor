//! Local-only accounting. This module has no dependency on the quota client.
mod aggregate;
mod attribution;
mod model;
mod normalize;
mod parser;
mod reader;
pub(crate) mod service;
mod store;

pub use service::TokenStatisticsService;

#[derive(Debug, Clone)]
struct Error(&'static str);
impl From<&'static str> for Error {
    fn from(code: &'static str) -> Self {
        Self(code)
    }
}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        use rusqlite::ErrorCode;
        Self(match error.sqlite_error_code() {
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => "databaseBusy",
            Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => "databaseCorrupt",
            _ => "persistenceDegraded",
        })
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self("sourceUnreadable")
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Error {}
type Result<T> = std::result::Result<T, Error>;
const SCHEMA_VERSION: i64 = 2;
const PARSER_VERSION: i64 = 1;

#[cfg(test)]
mod tests;
