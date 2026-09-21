-- Supplementary selection metadata only; accounting and quota history are frozen.
ALTER TABLE model_turns ADD COLUMN fast_mode INTEGER CHECK(fast_mode IN (0,1));
ALTER TABLE model_turns ADD COLUMN fast_conflict INTEGER NOT NULL DEFAULT 0 CHECK(fast_conflict IN (0,1));
DELETE FROM model_checkpoints;
PRAGMA user_version=4;
