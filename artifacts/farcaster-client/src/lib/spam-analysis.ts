import { neynarScore, hasPowerBadge, xAccount, type NeynarUser, type NeynarCast } from "@/lib/neynar";

/**
 * Farcaster/Neynar don't publish the exact weights behind the quality score or
 * the platform's spam filter · both are proprietary and actively tuned. This
 * is a transparent, rule-based approximation built from what IS public:
 * Neynar's own quality-score docs (verified identity, network quality, and
 * engagement authenticity are the three pillars they name), Farcaster's
 * stated spam signals (burst posting, templated/duplicate content, mass-follow
 * behavior), and the same signals this app's own Grow `smartScore` already
 * treats as "real account" indicators. Every check below is computed from
 * THIS account's own numbers · nothing here is copy shared across accounts.
 */

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckImpact = "high" | "medium" | "low";

export interface SpamCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fixHint?: string;
  impact: CheckImpact;
}

export interface SpamAnalysisResult {
  overallScore: number; // 0-100
  neynarScore?: number; // 0-1, raw, if Neynar has scored this account
  checks: SpamCheck[];
  topActions: SpamCheck[]; // worst offenders first, capped
  narrative: string; // one paragraph, unique to this account's specific numbers
}

const STATUS_WEIGHT: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };
const IMPACT_WEIGHT: Record<CheckImpact, number> = { high: 3, medium: 2, low: 1 };

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function daysSince(isoTimestamp: string): number {
  return (Date.now() - new Date(isoTimestamp).getTime()) / 86_400_000;
}

const PROMO_PATTERNS = [
  /airdrop/i, /claim now/i, /free mint/i, /giveaway/i, /follow.{0,15}back/i,
  /\$\w+.{0,10}(pump|moon|100x)/i, /dm me/i, /link in bio/i,
];

// Stock phrasing that shows up disproportionately in templated, auto-generated
// marketing/reply text. Not proof any single cast is machine-written · a human
// can use these too · but a cluster of them across many casts from one account
// is a real, observable pattern worth flagging honestly as a heuristic.
const STOCK_PHRASE_PATTERNS = [
  /\bgame[\s-]?changer\b/i, /\blet'?s dive into\b/i, /\bdelve into\b/i,
  /\bin today'?s fast[\s-]?paced world\b/i, /\bunlock the power of\b/i,
  /\brevolutioniz\w+\b/i, /\bnavigate the complexities\b/i, /\belevate your\b/i,
  /\bit'?s (worth noting|important to note)\b/i, /\bin conclusion\b/i,
  /\boverall,/i, /\bfurthermore,/i, /\bmoreover,/i, /\bthe world of\b/i,
  /\bseamless(ly)?\b/i, /\bleverage\b/i, /\brobust\b/i, /\bin summary\b/i,
];

export function analyzeAccount(user: NeynarUser, casts: NeynarCast[], spamLabel?: 0 | 2 | 3): SpamAnalysisResult {
  const checks: SpamCheck[] = [];
  const score = neynarScore(user);
  const username = user.username ? `@${user.username}` : "this account";

  // ── Neynar quality score itself ──────────────────────────────────────────
  if (score !== undefined) {
    checks.push({
      id: "neynar-score",
      label: "Neynar quality score",
      status: score >= 0.7 ? "pass" : score >= 0.4 ? "warn" : "fail",
      detail: `${username}'s current score is ${(score * 100).toFixed(0)}/100. ${score >= 0.7 ? "That's healthy." : score >= 0.4 ? "That's mid-range, with real room to climb." : "That's low enough to hurt visibility in feeds and search results."}`,
      fixHint: score < 0.7 ? `This number is a composite of everything below · closing the specific gaps flagged for ${username} in this report is what moves it, not any single action.` : undefined,
      impact: "high",
    });
  } else {
    checks.push({
      id: "neynar-score",
      label: "Neynar quality score",
      status: "warn",
      detail: `Neynar hasn't scored ${username} yet · this usually means the account is very new or has posted very little so far.`,
      fixHint: "Post consistently and engage genuinely for a few weeks · scoring kicks in once there's enough signal to work from.",
      impact: "high",
    });
  }

  // ── Real Farcaster spam label (github.com/merkle-team/labels) ─────────────
  // This is the actual platform label, not an approximation · 0 = flagged
  // likely-spammy, 2 = flagged unlikely-spammy, 3 = nerfed for malicious
  // activity, undefined = no label yet (not enough data, not a verdict).
  if (spamLabel === 0) {
    checks.push({ id: "spam-label", label: "Farcaster spam label", status: "fail", detail: `${username} is currently labelled likely-spammy (0) in Farcaster's own published dataset · this directly suppresses reach in feeds and search.`, fixHint: "This label is recalculated weekly from your account's real activity, social graph, and content · every other fix in this report feeds into it, there's no direct appeal.", impact: "high" });
  } else if (spamLabel === 3) {
    checks.push({ id: "spam-label", label: "Farcaster spam label", status: "fail", detail: `${username} is labelled "nerfed for malicious activity" · the most severe label Farcaster publishes.`, fixHint: "This is reserved for confirmed malicious behavior, not ordinary low-quality posting · if this seems wrong, it's worth appealing directly with Farcaster/Warpcast support.", impact: "high" });
  } else if (spamLabel === 2) {
    checks.push({ id: "spam-label", label: "Farcaster spam label", status: "pass", detail: `${username} is labelled unlikely-spammy (2) in Farcaster's own published dataset.`, impact: "high" });
  } else {
    checks.push({ id: "spam-label", label: "Farcaster spam label", status: "warn", detail: `${username} has no spam label yet in Farcaster's published dataset · usually means too little recent activity to be scored, not a verdict either way.`, impact: "low" });
  }

  // ── Purple (Pro) badge ─────────────────────────────────────────────────────
  // Farcaster's purple badge is the Pro subscriber badge · a real, active,
  // in-good-standing signal.
  checks.push({
    id: "power-badge",
    label: "Purple badge",
    status: hasPowerBadge(user) ? "pass" : "warn",
    detail: hasPowerBadge(user)
      ? `${username} holds the purple badge · one of the strongest "real, active user" signals on the network.`
      : `${username} doesn't currently hold the purple badge.`,
    impact: "medium",
  });

  // ── Verified identity ─────────────────────────────────────────────────────
  const eth = (user as NeynarUser & { verified_addresses?: { eth_addresses?: string[] } }).verified_addresses?.eth_addresses;
  const hasEth = Array.isArray(eth) && eth.length > 0;
  const hasX = Boolean(xAccount(user));
  if (hasEth && hasX) {
    checks.push({ id: "verified", label: "Verified identity", status: "pass", detail: `${username} has both a verified wallet and a verified X/Twitter account linked · a strong real-identity signal.`, impact: "medium" });
  } else if (hasEth || hasX) {
    checks.push({ id: "verified", label: "Verified identity", status: "warn", detail: `${username} has ${hasEth ? "a verified wallet" : "a verified X/Twitter account"} linked but not both.`, fixHint: `Link ${hasEth ? "an X/Twitter account" : "a wallet address"} too, from Settings → Profile, to strengthen this signal further.`, impact: "medium" });
  } else {
    checks.push({ id: "verified", label: "Verified identity", status: "fail", detail: `${username} has no verified wallet and no verified X/Twitter account · this is the single clearest anti-spam signal missing here.`, fixHint: "Verify a wallet address and/or an X account in Settings → Profile · this alone is one of the highest-leverage fixes available.", impact: "high" });
  }

  // ── Profile completeness ─────────────────────────────────────────────────
  const bio = user.profile?.bio?.text?.trim() ?? "";
  const hasPfp = Boolean(user.pfp_url);
  const hasName = Boolean(user.display_name?.trim());
  const missingFields = [!hasName && "display name", !hasPfp && "profile photo", bio.length <= 10 && "bio"].filter(Boolean) as string[];
  const completeness = 3 - missingFields.length;
  checks.push({
    id: "profile-complete",
    label: "Profile completeness",
    status: completeness === 3 ? "pass" : completeness >= 1 ? "warn" : "fail",
    detail: completeness === 3
      ? `${username}'s profile has a display name, photo, and a ${bio.length}-character bio · fully filled in.`
      : `${username} is missing: ${missingFields.join(", ")}.`,
    fixHint: missingFields.length > 0 ? `Add ${missingFields.join(" and ")} from Edit Profile · blank fields are one of the fastest tells of a bot/spam account.` : undefined,
    impact: "medium",
  });

  // ── Follow ratio ──────────────────────────────────────────────────────────
  const followers = user.follower_count ?? 0;
  const following = user.following_count ?? 0;
  const ratio = followers > 0 ? following / followers : following > 0 ? Infinity : 0;
  // Target ratio to aim for when flagged · how many unfollows THIS account
  // specifically needs to get back under it (real number, not a platitude).
  const targetRatio = 2.5;
  const unfollowsNeeded = Math.max(0, Math.ceil(following - followers * targetRatio));
  if (following > 200 && ratio > 5) {
    checks.push({
      id: "follow-ratio", label: "Follower / following ratio", status: "fail",
      detail: `${username} follows ${following.toLocaleString()} accounts against ${followers.toLocaleString()} followers (${ratio === Infinity ? "∞" : ratio.toFixed(1)}× more following than followers) · mass-following with little reciprocity is one of the strongest bot signals there is.`,
      fixHint: `Unfollowing roughly ${unfollowsNeeded.toLocaleString()} of the accounts that never followed back (Grow → Clean Up, sorted by "skip mutuals") would bring this under a healthy ${targetRatio}×.`,
      impact: "high",
    });
  } else if (following > 100 && ratio > targetRatio) {
    checks.push({
      id: "follow-ratio", label: "Follower / following ratio", status: "warn",
      detail: `${username} is following ${following.toLocaleString()} accounts against ${followers.toLocaleString()} followers · following is notably ahead of followers.`,
      fixHint: `Not urgent, but roughly ${unfollowsNeeded.toLocaleString()} unfollows would bring the ratio back under ${targetRatio}×, or just let followers catch up organically.`,
      impact: "medium",
    });
  } else {
    checks.push({ id: "follow-ratio", label: "Follower / following ratio", status: "pass", detail: `${username}'s following (${following.toLocaleString()}) vs followers (${followers.toLocaleString()}) is within a healthy range.`, impact: "medium" });
  }

  // ── Account age ───────────────────────────────────────────────────────────
  if (user.registered_at) {
    const days = daysSince(user.registered_at);
    if (days < 14 && following > 150) {
      checks.push({ id: "account-age", label: "Account age vs. activity", status: "fail", detail: `${username} is only ${Math.max(1, Math.round(days))} day(s) old but already follows ${following.toLocaleString()} accounts · a brand-new account with aggressive following reads as automated.`, fixHint: `Pause new follow batches for a while and let the existing ${following.toLocaleString()} relationships settle before following more.`, impact: "high" });
    } else if (days < 30) {
      checks.push({ id: "account-age", label: "Account age", status: "warn", detail: `${username} is ${Math.max(1, Math.round(days))} day(s) old · new accounts score lower until they build a track record, independent of behavior.`, fixHint: "This resolves on its own with time and consistent activity · nothing to force here.", impact: "low" });
    } else {
      checks.push({ id: "account-age", label: "Account age", status: "pass", detail: `${username} is ${Math.round(days)} days old · established enough that age alone won't hold the score back.`, impact: "low" });
    }
  }

  // ── Cast sample analysis ─────────────────────────────────────────────────
  if (casts.length > 0) {
    const totalEngagement = casts.reduce((s, c) => s + c.reactions.likes_count + c.reactions.recasts_count + c.replies.count, 0);
    const avgEngagement = totalEngagement / casts.length;
    const expectedFloor = followers > 0 ? Math.max(0.3, Math.min(followers, 500) * 0.01) : 0.3;
    if (avgEngagement < expectedFloor * 0.25 && casts.length >= 8) {
      checks.push({ id: "engagement", label: "Engagement on your casts", status: "warn", detail: `${username}'s last ${casts.length} casts averaged ${avgEngagement.toFixed(1)} combined likes, recasts, and replies · low relative to ${followers.toLocaleString()} followers, which can read as broadcast-only behavior.`, fixHint: "Reply into other people's threads instead of only posting outward · reciprocal engagement is a real-account signal Neynar can actually observe.", impact: "medium" });
    } else {
      checks.push({ id: "engagement", label: "Engagement on your casts", status: "pass", detail: `${username}'s last ${casts.length} casts averaged ${avgEngagement.toFixed(1)} combined reactions · reasonable for the follower count.`, impact: "medium" });
    }

    // Duplicate / near-duplicate content
    const seen = new Map<string, number>();
    for (const c of casts) {
      const norm = normalizeText(c.text || "");
      if (norm.length < 8) continue;
      const key = norm.slice(0, 60);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupGroups = [...seen.values()].filter((n) => n > 1);
    const dupCount = dupGroups.reduce((s, n) => s + n, 0);
    if (dupCount >= 3) {
      checks.push({ id: "duplicate-content", label: "Repeated content", status: "fail", detail: `${dupCount} of ${username}'s last ${casts.length} casts are near-identical to each other across ${dupGroups.length} repeated group${dupGroups.length === 1 ? "" : "s"} · templated text is one of the clearest spam-filter triggers there is.`, fixHint: "Write each cast fresh, even when repeating the same promotion or update · reuse the idea, not the exact sentence.", impact: "high" });
    } else if (dupCount > 0) {
      checks.push({ id: "duplicate-content", label: "Repeated content", status: "warn", detail: `${dupCount} of ${username}'s last ${casts.length} casts look near-identical to another recent one.`, fixHint: "Keep casts varied even when the underlying message repeats.", impact: "medium" });
    } else {
      checks.push({ id: "duplicate-content", label: "Repeated content", status: "pass", detail: `No repeated or templated casts detected across ${username}'s last ${casts.length}.`, impact: "medium" });
    }

    // Promotional-language density
    const promoHits = casts.filter((c) => PROMO_PATTERNS.some((re) => re.test(c.text || ""))).length;
    const promoRatio = promoHits / casts.length;
    if (promoRatio > 0.35) {
      checks.push({ id: "promo-language", label: "Promotional language", status: "fail", detail: `${promoHits} of ${username}'s last ${casts.length} casts (${Math.round(promoRatio * 100)}%) use promo-style phrasing (airdrop/giveaway/claim/dm-me style language) · this density alone is enough to trip most quality filters.`, fixHint: `Bring promotional casts down from ${promoHits} to roughly ${Math.floor(casts.length * 0.15)} or fewer out of every ${casts.length}, and fill the rest with non-promotional posts.`, impact: "high" });
    } else if (promoRatio > 0.15) {
      checks.push({ id: "promo-language", label: "Promotional language", status: "warn", detail: `${promoHits} of ${username}'s last ${casts.length} casts (${Math.round(promoRatio * 100)}%) read as promotional.`, fixHint: "Fine in moderation · just don't let it grow past what it already is.", impact: "low" });
    } else {
      checks.push({ id: "promo-language", label: "Promotional language", status: "pass", detail: `Only ${promoHits} of ${username}'s last ${casts.length} casts read as promotional · not a concern.`, impact: "low" });
    }

    // Content originality · clusters of stock, generic-sounding phrasing across
    // many casts. This is a heuristic on wording patterns, not a detector
    // that reads intent · framed honestly as a signal, not a verdict.
    const stockPhraseHits = casts.filter((c) => STOCK_PHRASE_PATTERNS.filter((re) => re.test(c.text || "")).length > 0).length;
    const stockPhraseRatio = stockPhraseHits / casts.length;
    if (stockPhraseRatio > 0.3 && stockPhraseHits >= 4) {
      checks.push({ id: "content-quality", label: "Content originality", status: "warn", detail: `${stockPhraseHits} of ${username}'s last ${casts.length} casts (${Math.round(stockPhraseRatio * 100)}%) use stock phrasing common in templated marketing text (e.g. "game-changer", "let's dive into", "in today's fast-paced world"). This is a wording pattern, not proof of anything, but it clusters strongly here.`, fixHint: "Write in your own voice · casts that read as generic/templated get less genuine engagement even before any algorithm looks at them.", impact: "medium" });
    } else if (stockPhraseHits > 0) {
      checks.push({ id: "content-quality", label: "Content originality", status: "pass", detail: `${username}'s casts read as written in a personal voice, with only occasional stock phrasing.`, impact: "low" });
    } else {
      checks.push({ id: "content-quality", label: "Content originality", status: "pass", detail: `No templated/stock phrasing patterns detected across ${username}'s last ${casts.length} casts.`, impact: "low" });
    }

    // Posting burstiness (many casts in a very short window)
    const timestamps = casts.map((c) => new Date(c.timestamp).getTime()).filter((t) => !isNaN(t)).sort((a, b) => b - a);
    if (timestamps.length >= 10) {
      const spanHours = (timestamps[0] - timestamps[timestamps.length - 1]) / 3_600_000;
      if (spanHours > 0 && spanHours < 2 && timestamps.length >= 15) {
        checks.push({ id: "burst-posting", label: "Posting pace", status: "warn", detail: `${timestamps.length} of ${username}'s casts landed within a single ${spanHours.toFixed(1)}-hour window · that pace reads as automated even when it isn't.`, fixHint: "Spread posts out across the day instead of batching many casts back-to-back.", impact: "medium" });
      } else {
        checks.push({ id: "burst-posting", label: "Posting pace", status: "pass", detail: `${username}'s posting pace across the sampled casts looks organic, not bursty.`, impact: "low" });
      }
    }
  } else {
    checks.push({ id: "activity", label: "Recent activity", status: "warn", detail: `No recent casts found for ${username} to analyze content patterns from.`, fixHint: "Start casting regularly · an account with little to no content is hard to score favorably no matter what else is fixed.", impact: "medium" });
  }

  // ── Weighted overall score ────────────────────────────────────────────────
  const totalWeight = checks.reduce((s, c) => s + IMPACT_WEIGHT[c.impact], 0);
  const earned = checks.reduce((s, c) => s + IMPACT_WEIGHT[c.impact] * STATUS_WEIGHT[c.status], 0);
  const overallScore = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  const topActions = checks
    .filter((c) => c.status !== "pass")
    .sort((a, b) => {
      const statusRank = { fail: 0, warn: 1, pass: 2 } as const;
      if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status];
      return IMPACT_WEIGHT[b.impact] - IMPACT_WEIGHT[a.impact];
    })
    .slice(0, 5);

  // ── Personalized narrative · built from THIS account's actual worst issues,
  //    never a fixed sentence shared across accounts. ────────────────────────
  let narrative: string;
  if (topActions.length === 0) {
    narrative = `${username} clears every signal this report checks for · nothing specific to fix right now.`;
  } else {
    const worst = topActions[0];
    const rest = topActions.slice(1, 3);
    narrative = `${username}'s biggest issue right now is ${worst.label.toLowerCase()}: ${worst.detail}`;
    if (rest.length > 0) {
      narrative += ` On top of that, ${rest.map((c) => c.label.toLowerCase()).join(" and ")} also need${rest.length === 1 ? "s" : ""} attention.`;
    }
  }

  return { overallScore, neynarScore: score, checks, topActions, narrative };
}
