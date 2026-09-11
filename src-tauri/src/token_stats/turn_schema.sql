-- Supplementary metadata only; accounting and parser version remain frozen.
ALTER TABLE model_turns ADD COLUMN effort TEXT;
ALTER TABLE model_turns ADD COLUMN effort_conflict INTEGER NOT NULL DEFAULT 0 CHECK(effort_conflict IN (0,1));
ALTER TABLE model_turns ADD COLUMN completed_at TEXT;
ALTER TABLE model_turns ADD COLUMN completion_status TEXT CHECK(completion_status IN ('completed','aborted','conflict'));
CREATE TABLE quota_snapshots (
 root TEXT NOT NULL REFERENCES source_roots(root),
 weekly_reset_at TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 remaining_percent REAL NOT NULL CHECK(remaining_percent >= 0 AND remaining_percent <= 100),
 PRIMARY KEY(root,weekly_reset_at,observed_at)
);
CREATE INDEX turn_identity_lookup ON model_identities(root,thread,turn);
-- Replay only metadata. Accounting cursors and facts are never reset.
DELETE FROM model_checkpoints;
PRAGMA user_version=3;
CREATE INDEX turn_completion_lookup ON model_turns(root,completion_status,completed_at);
