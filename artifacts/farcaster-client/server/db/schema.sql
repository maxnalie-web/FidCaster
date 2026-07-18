-- Action ledger: append-only log of every user action FidCaster witnesses.
-- Rows are NEVER deleted or updated (except verified/excluded flags).
-- This table is the single source of truth for points/airdrop calculation.

CREATE TABLE IF NOT EXISTS users (
  fid        BIGINT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_actions (
  id          BIGSERIAL PRIMARY KEY,
  fid         BIGINT      NOT NULL,
  action_type TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- proof: message hash (cast/like/follow) or tx hash (market events).
  -- NULL only for first-party server events (app_open, referral).
  proof       TEXT,
  -- verified=true once a background job confirms this proof against hub/chain.
  -- Market events are pre-verified (server is the source of truth).
  verified    BOOLEAN     NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  -- excluded=true when fraud detection flags this row.
  -- Never delete rows - set excluded=true so audit trail stays intact.
  excluded    BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query pattern: per-user history by type and time
CREATE INDEX IF NOT EXISTS idx_ua_fid_type_created
  ON user_actions (fid, action_type, created_at DESC);

-- Dedup: the same (action_type, proof) pair can only exist once.
-- The market indexer re-scans overlapping block ranges on every poll
-- and hub-submit.ts may retry - both must be idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ua_type_proof
  ON user_actions (action_type, proof)
  WHERE proof IS NOT NULL;

-- Snapshot query: all non-excluded verified actions ordered by time
CREATE INDEX IF NOT EXISTS idx_ua_verified_excl_created
  ON user_actions (created_at DESC)
  WHERE verified = true AND excluded = false;
