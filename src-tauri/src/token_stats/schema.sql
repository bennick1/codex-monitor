CREATE TABLE statistics_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 parser_version INTEGER NOT NULL, generation INTEGER NOT NULL CHECK(generation>=0)
);
INSERT INTO statistics_meta VALUES(1,1,0);
CREATE TABLE source_roots (root TEXT PRIMARY KEY, state TEXT NOT NULL);
CREATE TABLE root_locators (locator TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES source_roots(root));
CREATE TABLE source_files (
 id TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES source_roots(root),
 relative_path TEXT NOT NULL, version INTEGER NOT NULL, native_id TEXT NOT NULL,
 size INTEGER NOT NULL, modified TEXT NOT NULL, offset INTEGER NOT NULL CHECK(offset>=0),
 edge TEXT NOT NULL, cursor TEXT NOT NULL, availability TEXT NOT NULL,
 verified_at INTEGER NOT NULL, UNIQUE(root,relative_path,version)
);
CREATE TABLE file_chunks (
 file TEXT NOT NULL REFERENCES source_files(id), start INTEGER NOT NULL,
 end INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(file,start)
);
CREATE TABLE threads (
 root TEXT NOT NULL REFERENCES source_roots(root), thread TEXT NOT NULL,
 parent TEXT, mode TEXT NOT NULL DEFAULT 'legacy', latest_response TEXT, PRIMARY KEY(root,thread)
);
CREATE TABLE legacy_events (
 root TEXT NOT NULL, thread TEXT NOT NULL, sequence INTEGER NOT NULL,
 digest TEXT NOT NULL, fact TEXT, evidence TEXT NOT NULL,
 PRIMARY KEY(root,thread,sequence), FOREIGN KEY(root,thread) REFERENCES threads(root,thread)
);
CREATE TABLE token_facts (
 id TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES source_roots(root),
 thread TEXT NOT NULL, input INTEGER NOT NULL CHECK(input>=0),
 output INTEGER NOT NULL CHECK(output>=0), cached INTEGER CHECK(cached>=0 AND cached<=input),
 reasoning INTEGER CHECK(reasoning>=0 AND reasoning<=output), cache_write INTEGER CHECK(cache_write>=0),
 at TEXT, end_at TEXT, time_status TEXT NOT NULL, format TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)), rule_version INTEGER NOT NULL,
 CHECK(input<=9223372036854775807-output)
);
CREATE INDEX facts_scope ON token_facts(root,active,at);
CREATE TABLE fact_identities (
 root TEXT NOT NULL REFERENCES source_roots(root), kind TEXT NOT NULL,
 identity TEXT NOT NULL, fact TEXT NOT NULL REFERENCES token_facts(id),
 PRIMARY KEY(root,kind,identity)
);
CREATE TABLE fact_sources (
 fact TEXT NOT NULL REFERENCES token_facts(id), file TEXT NOT NULL REFERENCES source_files(id),
 start INTEGER NOT NULL, end INTEGER NOT NULL, ordinal TEXT,
 PRIMARY KEY(fact,file,start)
);
CREATE TABLE reconciliation_candidates (
 id TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES source_roots(root), thread TEXT NOT NULL,
 record TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE candidate_sources (
 candidate TEXT NOT NULL REFERENCES reconciliation_candidates(id),
 file TEXT NOT NULL REFERENCES source_files(id), start INTEGER NOT NULL, end INTEGER NOT NULL,
 PRIMARY KEY(candidate,file,start)
);
CREATE TABLE reconciliation_links (
 old_fact TEXT NOT NULL REFERENCES token_facts(id), new_fact TEXT NOT NULL REFERENCES token_facts(id),
 evidence TEXT NOT NULL, rule_version INTEGER NOT NULL,
 PRIMARY KEY(old_fact,new_fact)
);
CREATE TABLE quality_issues (
 root TEXT NOT NULL REFERENCES source_roots(root), file TEXT NOT NULL REFERENCES source_files(id),
 position INTEGER NOT NULL, code TEXT NOT NULL, PRIMARY KEY(file,position,code)
);
PRAGMA application_id=1129598795;
PRAGMA user_version=1;
