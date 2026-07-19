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

-- Referrals: each user can only be referred once
CREATE TABLE IF NOT EXISTS referrals (
  id            BIGSERIAL PRIMARY KEY,
  referrer_fid  BIGINT      NOT NULL,
  referred_fid  BIGINT      NOT NULL,
  code          TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ref_referred  ON referrals (referred_fid);
CREATE        INDEX IF NOT EXISTS idx_ref_referrer   ON referrals (referrer_fid);

-- Grow target cooldown: track which FIDs each user has targeted in Grow campaigns.
-- Used to enforce 14-day cooldown per target to prevent slow-cycle farming.
CREATE TABLE IF NOT EXISTS grow_targets (
  id         BIGSERIAL PRIMARY KEY,
  fid        BIGINT NOT NULL,
  target_fid BIGINT NOT NULL,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gt_fid_target ON grow_targets (fid, target_fid);
CREATE INDEX IF NOT EXISTS idx_gt_fid_used   ON grow_targets (fid, used_at DESC);

-- ── Column additions (idempotent — safe to run on existing databases) ─────────
-- excluded_reason: human-readable label for why a row was excluded (watcher, sybil, etc.)
ALTER TABLE user_actions ADD COLUMN IF NOT EXISTS excluded_reason TEXT;

-- eligible / eligible_checked_at: Neynar quality-gate cache on the users row.
ALTER TABLE users ADD COLUMN IF NOT EXISTS eligible             BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS eligible_checked_at  TIMESTAMPTZ;

-- activated / activated_at: referral deferred-activation state.
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS activated     BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS activated_at  TIMESTAMPTZ;

-- Index for fast eligibility sweeps (sybil-detector R5, eligibility.ts sweepIneligibleActions)
CREATE INDEX IF NOT EXISTS idx_users_eligible ON users (eligible) WHERE eligible = false;

-- ── Airdrop wallet registration ───────────────────────────────────────────────
-- Maps FID → ETH address for the Clanker token airdrop on Base.
-- One address per FID (PRIMARY KEY). One FID per address (UNIQUE on lower(address)).
-- Rows are never deleted; updates track updated_at.
CREATE TABLE IF NOT EXISTS wallet_addresses (
  fid           BIGINT      PRIMARY KEY,
  address       TEXT        NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent one wallet address from claiming multiple FID allocations.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wa_address ON wallet_addresses (LOWER(address));
