---
name: Gamification system planned as future airdrop eligibility layer
description: Product decision (not yet built) for artifacts/farcaster-client — points/badges/quests are meant to double as future token-airdrop criteria.
---

The user wants a gamification layer (points, badges, streaks, leaderboard, quests) added to the FidCaster app specifically as a growth/retention mechanic in the Farcaster niche, with the explicit stated intent of later running a token airdrop gated on this activity history.

**Why:** stated directly by the user — "می‌خوام یه نیچ راه بندازیم تو فارکستر و کاربرا رو بکشونیم تو اپ خودمون. بعدا ایردراپ که دادیم شامل اینا بشه" (want to build a niche pull into the app, and have a future airdrop include people based on this). As of the conversation where this was captured, the user asked only for the idea/plan — explicitly said not to build it yet.

**How to apply:** when this feature is eventually built, treat it as airdrop-eligibility infrastructure from day one, not just a cosmetic UI feature:
- Persist points/badge events with timestamps (not just a running total) so a historical snapshot can be taken later for airdrop calculation.
- Design anti-sybil safeguards before launch or before any token/monetary value is attached — e.g. minimum Farcaster account age, verified signer/wallet requirement, rate-limiting point-earning actions. Without this, fake/farmed accounts will dominate once an airdrop is announced.
- Proposed shape discussed: points for daily login streaks, casting/replying via the app, using growth tools, FID Market trades, and referrals; badges/tiers for milestones; a leaderboard; and discrete "quests" (Galxe/Zealy-style) as a more airdrop-legible unit than raw point totals.
