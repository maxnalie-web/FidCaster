# FidCaster Points Security Plan v2.0

> این داکیومنت به عنوان تستر/هکر نوشته شده و بعد defenses طراحی شده.
> هر سوراخی که پیدا شده، یا بسته شده یا ریسکش پذیرفته شده (با توضیح).

---

## Phase 1: Attack Surface Map (Red Team Pass)

### A. Identity Attacks

#### A1. 🔴 Fresh sybil accounts — CRITICAL
**Attack:** Create 20 new FIDs today. Each earns max daily points immediately.
No minimum age/follower requirement existed.

**Exploit:**
- Register 20 FIDs → each earns 580pts/day → 11,600pts/day from nothing.
- Refer all of them to main account → +4,000pts instantly.

**Defense (implemented):**
- `server/db/eligibility.ts`: FID must have ≥5 followers, ≥3 casts, active Neynar status.
- Ineligible FIDs: actions stored but immediately excluded.
- Sybil R5 sweep: retroactive exclusion of ineligible FID actions.

**Residual risk:** Attacker buys aged FIDs with followers on secondary market.
Accepted — requires real social capital, not just throwaway accounts.

---

#### A2. 🟡 Buy aged FIDs on our own FID Market — MEDIUM
**Attack:** FidCaster FID Market sells aged FIDs with followers.
Buy one → pass eligibility gate → earn points.

**Why accepted:**
Real ETH cost acts as a sybil gate. Anyone willing to spend money to
participate is also creating market liquidity (a product goal). Excluded
from explicit defense — the cost is the friction.

---

#### A3. 🔴 Cross-client hash injection — CRITICAL (FIXED)
**Attack:** Do likes/follows in Warpcast → get valid message hashes from
Neynar → POST to `/api/actions/log` → auto-verified after 48h.

**Old behavior:**
- Any 8-200 char string as proof → accepted.
- Auto-verified after 48h with zero cryptographic check.

**Defense (implemented):**
- L3: Proof must be 40-64 hex chars (real Farcaster message hash format).
- Fake strings like "aaaaaaaa" → rejected at route level.
- Trust window reduced: likes/recasts auto-verify after 24h (was 48h).
- Follows: Neynar `viewer_context.following` check. Not following = excluded.

---

### B. Grow Farming

#### B1. 🔴 Slow-cycle re-follow — CRITICAL (FIXED)
**Attack:**
- Day 1: Follow 50 people → earn grow+follow points.
- Day 25: Unfollow (R1 was 24h only → misses this).
- Day 26: Re-follow same 50 → earn again.
- Repeat forever with the same 50 targets.

**Defense (implemented):**
- Sybil R1: churn window extended from 24h → **14 DAYS**.
- Grow R4: grow_targets table tracks verified follow targets.
  Re-using ≥80% of targets within 14 days → excluded.
- Verification job: 14-day cooldown enforced per target FID.

---

#### B2. 🔴 Fake succeeded count — CRITICAL (FIXED)
**Attack:**
- Call `/api/grow/campaign-complete` with `succeeded=50`.
- Never actually follow anyone.
- Earn 30pts × 5/day = 150pts from fake numbers.

**Old behavior:** Server trusted client's `succeeded` number.

**Defense (implemented):**
- Verification job: Neynar bulk check (`viewer_fid`) confirms how many
  of the stored `targetFidsSample` the user ACTUALLY follows.
- < 5 real new follows → excluded.
- Client-reported `succeeded` is stored as `clientReportedSucceeded`
  (audit trail) but NEVER used for points calculation.

---

#### B3. 🟠 Micro-campaigns on already-followed accounts — HIGH (FIXED)
**Attack:**
- Run 5 campaigns of 10 FIDs each, all already-followed.
- Each reports succeeded=10 → 150pts/day with no real effort.

**Defense:** Grow verification requires ≥5 of the sample to be NEWLY
followed (not in grow_targets from last 14 days). Already-followed
accounts don't count.

---

#### B4. 🟡 Sybil ring follows — MEDIUM (PARTIALLY FIXED)
**Attack:** 20 accounts follow each other in rotation every 2 weeks.
All earn grow+follow points.

**Defense:**
- Eligibility gate stops fresh sybils (need ≥5 followers, ≥3 casts).
- R1 churn (14-day window) stops most cycling.
- Residual: coordinated rings of real-looking accounts. Accepted — these
  accounts are doing real social activity on Farcaster which benefits the
  ecosystem anyway.

---

### C. Market Farming

#### C1. 🟠 Self-trade wash — HIGH (MITIGATED)
**Attack:**
- Account A lists FID → Account B (same person) buys → A earns listing pts,
  B earns 100pts market_buy.
- Real cost: gas + listing price (negligible on Optimism).

**Defense:**
- On-chain nature of market events: real ETH must move.
- Minimal gas on Optimism (~$0.001). Not economical to do 3 buys/day
  purely for 300pts when the attacker needs to also sell/re-list.
- Market custody address check: **planned** but not yet implemented
  (requires Neynar custody address lookup at event time).
- **Accepted risk** for now: real ETH friction is the main gate.

#### C2. 🟢 FID flip cycling — LOW (ACCEPTED)
**Attack:** Buy→sell→rebuy the same FID daily for 300pts/day.
Real cost: gas × 3 transactions + market spread.

**Why accepted:** This is genuine market participation. If someone is
cycling FIDs, they're providing real trading volume to the market (a
product goal). The economics are tight enough to not be worth it
purely for points.

---

### D. Like/Cast Farming

#### D1. 🔴 Fake proof hashes for likes/follows — CRITICAL (FIXED)
**Old state:** Any 8-char string → accepted → auto-verified after 48h.
→ 50 fake likes/day = 50pts from nothing. Scale to 10 FIDs = 500pts/day.

**Defense:** Hex format validation (40-64 chars). Neynar follow graph
check for follows. Fake strings now fail at route level.

#### D2. 🟢 Self-like from alts — LOW (ACCEPTED)
1pt per like, max 50pts/day. Even if someone creates 5 alts to self-like,
each alt earns at most 50pts from likes. The eligibility gate (≥5 followers,
≥3 casts) means each alt needs real social presence first. Accepted.

---

### E. Referral Farming

#### E1. 🔴 Immediate referral points without activity — CRITICAL (FIXED)
**Old behavior:** Referrer earns 200pts immediately when code is claimed.
→ Create 10 FIDs, claim referral → 2,000pts instantly.

**Defense (implemented):**
- Referrer earns 200pts ONLY when referred user hits **100 organic pts**
  (non-referral, non-quest actions).
- Verification job checks pending referrals every 5 min.
- Fresh sybil alts can't earn 100pts easily (eligibility gate + time).
- Referred user still gets 50pt welcome bonus immediately (they're real).

#### E2. 🔴 Self-referral — CRITICAL (WAS PARTIALLY BLOCKED)
**Defense:** `claimReferral()` explicitly checks `referrerFid === newFid`.

#### E3. 🔴 Circular referral (A refers B, B refers A) — HIGH (FIXED)
**Old behavior:** Not explicitly checked.

**Defense:** DB query: if `(B→A)` exists in referrals table, reject `(A→B)` claim.

#### E4. 🟡 Max referral cap — MEDIUM (IMPLEMENTED)
- Lifetime max: **20 activated referrals per FID**.
- Beyond 20: referrals stored for audit but not paid out.

---

### F. Timing Attacks

#### F1. 🟡 Pre-snapshot burst — MEDIUM
**Attack:** Snapshot date announced → everyone maxes out every day for 2 weeks.

**Defense:** Never announce exact snapshot date. Window is approximately
Q3 2025. Rolling 30-day average: not yet implemented but planned.

#### F2. 🟢 Midnight UTC clock abuse — LOW (IRRELEVANT)
Server-side timestamps prevent client from gaming the daily cap window.

---

## Phase 2: Defense Architecture

```
Request → [Rate Limit] → [Hex Format Check] → [Eligibility Gate]
                                                      ↓
                                              [logUserAction()]
                                                      ↓
                          [Verification Job (5min)] + [Sybil Detector (1hr)]
                                                      ↓
                                           [Points Calculation]
                                           (verified=true AND excluded=false)
```

### Implemented Rules Summary

| ID | Rule | Window | Kills |
|----|------|--------|-------|
| L2 | FID Eligibility Gate | checked on action | Fresh sybils, bot referrals |
| L3 | Hex proof format validation | instant | Fake hash injection |
| R1 | Follow-churn window | **14 days** (was 24h) | Slow cycling |
| R2 | Action velocity cap | 1 hour | Burst bots |
| R3 | Grow empty campaign | — | Zero-follow campaigns |
| R4 | Grow target recycling | 14 days | Same-target re-farming |
| R5 | Ineligible FID sweep | hourly | Late-detected sybils |
| V1 | Cast Neynar verification | 7d deadline | Fake cast proofs |
| V2 | Follow Neynar graph check | 24h window | Cross-client attribution |
| V3 | Grow follow count check | 2h after complete | Fake succeeded count |
| Ref | Referral pending activation | until 100pts | Bot referral bombing |
| Ref | Circular referral check | instant | A→B, B→A loops |

---

## Phase 3: Red Team Review (Tester Pass — After Implementing Defenses)

### Test 1: I have 5 aged FIDs (>5 followers, >3 casts, active)

- Eligibility: PASSES (accounts are real)
- Max daily per FID:
  - cast: 50pts (5 casts)
  - like: 50pts (50 likes — low value but real)
  - recast: 30pts
  - follow: 50pts
  - grow: ~60pts (2 full campaigns × 20pts + 2 × 10pts; after diminishing)
  - market: depends on actual trading
- Total: ~240pts/day × 5 FIDs = **1,200pts/day**
- For 60-day campaign: ~72,000pts across 5 FIDs

**Verdict:** Still possible but requires maintaining 5 real-looking accounts,
doing real follows (Neynar verified), and real casts. That's actual Farcaster
activity — the system is working as intended.

---

### Test 2: Grow farming with valid aged accounts

- Each campaign needs ≥5 FRESH targets (not in grow_targets last 14 days)
- After verification: Neynar confirms they actually follow those FIDs
- 14-day pool needed: 14 days × 5 minimum × 5 campaigns = 350 unique real FIDs to follow
- These 350 FIDs need to exist on Farcaster (can't be bots due to eligibility gate on follows)
- **Verdict:** Grow farming becomes genuine Grow usage. Working as intended.

---

### Test 3: Referral bomb with aged alts

- Alt FID must be ≥eligible (≥5 followers, ≥3 casts)
- After claiming: alt must earn 100 organic pts (≈ 2-5 days of genuine activity)
- Referrer waits ≥2-5 days per referral
- Max 20 referrals ever paid out = 4,000pts total lifetime
- To set up 20 aged alts with real activity: requires significant ongoing effort
- **Verdict:** Not worth gaming. Barely worth doing honestly vs just using the app.

---

### Test 4: Fake follow hashes

- Proof must be 40-64 hex chars ✓ (format check)
- Neynar follow graph check: user must ACTUALLY follow targetFid within 24h
- Without really following: excluded
- **Verdict:** Effectively closed.

---

### Remaining Accepted Risks

| Risk | Why Accepted |
|------|-------------|
| Multi-account with real aged FIDs | No defense without KYC. Real activity = ecosystem contribution. |
| Market cycling (ETH cost) | Economic friction is the gate. Real market participation. |
| Coordinated rings of real accounts | Real social activity. Hard to distinguish from organic use. |
| Warpcast users with aged accounts claiming points | Must actually do actions on our platform (session logs, not implemented yet). |

---

## What Is NOT Implemented (Future Work)

- **Session binding:** Require FidCaster session cookie on `/api/actions/log`
  to prevent cross-client attribution. Complex, breaks some native app flows.
  Consider after V1 launch.

- **Market custody address check:** Flag wallet address if buyer and seller
  custody addresses match (via Neynar user.custody_address).

- **Rolling snapshot average:** Weight older points more than last-7-day burst.
  Simple to add to `getFullSnapshot()` SQL.

- **IP-based multi-account detection:** If 5+ eligible FIDs submit actions
  from the same IP range within 1 hour → flag for manual review.
