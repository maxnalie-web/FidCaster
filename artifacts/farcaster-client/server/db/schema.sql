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

-- ── Daily allowance ───────────────────────────────────────────────────────────
-- Tracks each user's daily budget for promotion/gifting. One row per (fid, UTC date).
-- base_amount = min(followers*2, 500) + 100, computed on first access each day.
-- used = cumulative allowance spent today (promotions + gifts sent).
CREATE TABLE IF NOT EXISTS daily_allowance (
  fid          BIGINT  NOT NULL,
  date         DATE    NOT NULL DEFAULT CURRENT_DATE,
  base_amount  INTEGER NOT NULL DEFAULT 100,
  used         INTEGER NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fid, date)
);

CREATE INDEX IF NOT EXISTS idx_da_fid_date ON daily_allowance (fid, date DESC);

-- Per-category sub-caps so a user can't dump their entire daily allowance
-- into a single promotion or a single gift spree - promo_used and gift_used
-- are tracked and capped independently (see db/allowance.ts), in addition
-- to the overall `used` still being bounded by base_amount.
ALTER TABLE daily_allowance ADD COLUMN IF NOT EXISTS promo_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_allowance ADD COLUMN IF NOT EXISTS gift_used  INTEGER NOT NULL DEFAULT 0;

-- ── Pending points ────────────────────────────────────────────────────────────
-- Holds gifted points for recipients not yet registered in FidCaster.
-- Points are credited to the ledger and marked claimed on first mini-app open.
CREATE TABLE IF NOT EXISTS pending_points (
  id            BIGSERIAL   PRIMARY KEY,
  recipient_fid BIGINT      NOT NULL,
  amount        INTEGER     NOT NULL,
  from_fid      BIGINT      NOT NULL,
  cast_hash     TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed       BOOLEAN     NOT NULL DEFAULT false,
  claimed_at    TIMESTAMPTZ
);

CREATE INDEX  IF NOT EXISTS idx_pp_recipient ON pending_points (recipient_fid) WHERE claimed = false;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pp_cast_hash ON pending_points (cast_hash);

-- ── Farcaster Mini App notification tokens ────────────────────────────────────
-- Received via webhookUrl when a user adds the mini app or enables notifications.
-- One row per FID (upsert). Token is a UUID issued by Farcaster; url is the
-- Farcaster notification API endpoint to POST to.
CREATE TABLE IF NOT EXISTS notification_tokens (
  id         BIGSERIAL   PRIMARY KEY,
  fid        BIGINT      NOT NULL,
  token      TEXT        NOT NULL,
  url        TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_nt_fid     ON notification_tokens (fid);
CREATE        INDEX IF NOT EXISTS idx_nt_enabled  ON notification_tokens (enabled) WHERE enabled = true;

-- ── NFT pass mint attempt log ─────────────────────────────────────────────────
-- /api/nft-pass/mint pays real gas from a server-held wallet on every attempt
-- (balanceOf is keyed on the caller-supplied address, which is free to
-- regenerate, so it can't rate-limit by itself). This table lets the route
-- enforce a per-fid attempt cap so a script can't drain the mint wallet.
CREATE TABLE IF NOT EXISTS nft_pass_mint_log (
  id         BIGSERIAL   PRIMARY KEY,
  fid        BIGINT      NOT NULL,
  address    TEXT        NOT NULL,
  tx_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_npm_fid_created ON nft_pass_mint_log (fid, created_at DESC);
