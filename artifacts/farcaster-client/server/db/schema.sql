-- Points/airdrop action ledger. Append-only: rows are inserted once and never
-- mutated except to flip `verified`/`verified_at` once a background job has
-- confirmed the row's `proof` against the real hub/chain state. See
-- artifacts/farcaster-client/server/db/actions-ledger.ts for the writer and
-- the airdrop plan doc for why this table exists (Attribution section).

CREATE TABLE IF NOT EXISTS users (
  fid         BIGINT PRIMARY KEY,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_actions (
  id           BIGSERIAL PRIMARY KEY,
  fid          BIGINT NOT NULL REFERENCES users(fid),
  action_type  TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- proof: message hash (cast/like/recast/follow) or tx hash (market events).
  -- NULL for action types that are inherently first-party (app_open, quest,
  -- referral) where the row itself, written by our own server, is the proof.
  proof        TEXT,
  verified     BOOLEAN NOT NULL DEFAULT false,
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_actions_fid_type_created
  ON user_actions (fid, action_type, created_at);

-- One row per (action_type, proof): the market-event indexer re-scans
-- overlapping block ranges on every poll, and a client could retry a log
-- call after a network blip — both must be idempotent inserts, not
-- duplicate points.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_actions_type_proof
  ON user_actions (action_type, proof) WHERE proof IS NOT NULL;
