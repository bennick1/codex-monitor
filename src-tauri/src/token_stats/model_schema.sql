-- Attribution is supplementary: no accounting table, cursor or rule is rewritten.
CREATE TABLE model_turns (
 root TEXT NOT NULL REFERENCES source_roots(root), thread TEXT NOT NULL, turn TEXT NOT NULL,
 model TEXT, conflict INTEGER NOT NULL DEFAULT 0 CHECK(conflict IN (0,1)),
 PRIMARY KEY(root,thread,turn)
);
CREATE TABLE model_identities (
 root TEXT NOT NULL REFERENCES source_roots(root), kind TEXT NOT NULL, identity TEXT NOT NULL,
 thread TEXT NOT NULL, turn TEXT, conflict INTEGER NOT NULL DEFAULT 0 CHECK(conflict IN (0,1)),
 PRIMARY KEY(root,kind,identity)
);
CREATE TABLE model_checkpoints (
 file TEXT PRIMARY KEY REFERENCES source_files(id), offset INTEGER NOT NULL CHECK(offset>=0),
 cursor TEXT NOT NULL
);
PRAGMA user_version=2;
CREATE INDEX model_fact_lookup ON fact_identities(fact,root,kind);
