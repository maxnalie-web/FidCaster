import { neynarScore, hasPowerBadge, type NeynarCast, type NeynarUser } from "@/lib/neynar";

export type FidGrade = "Elite" | "Strong" | "Solid" | "Emerging" | "Unranked";
export type ActivityLevel = "Active" | "Rising" | "Inactive" | "New";

export interface FidRatingFactors {
  neynarScore?: number;
  followerCount: number;
  accountAgeDays?: number;
  powerBadge: boolean;
  pro: boolean;
  verifiedCount: number;
  avgEngagement?: number;
}

export interface FidRating {
  score: number;
  grade: FidGrade;
  activity: ActivityLevel;
  factors: FidRatingFactors;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function accountAgeDays(user: NeynarUser): number | undefined {
  if (!user.registered_at) return undefined;
  const registered = new Date(user.registered_at).getTime();
  if (Number.isNaN(registered)) return undefined;
  return Math.max(0, (Date.now() - registered) / 86_400_000);
}

export function verificationCount(user: NeynarUser): number {
  return user.custody_address ? 1 : 0;
}

function gradeFor(score: number): FidGrade {
  if (score >= 80) return "Elite";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Solid";
  if (score >= 20) return "Emerging";
  return "Unranked";
}

function activityFor(ageDays: number | undefined, lastCastDays: number | undefined): ActivityLevel {
  if (ageDays !== undefined && ageDays < 30) return "New";
  if (lastCastDays === undefined) return "Inactive";
  if (lastCastDays <= 7) return "Active";
  if (lastCastDays <= 30) return "Rising";
  return "Inactive";
}

export function computeFidRating(user: NeynarUser, recentCasts?: NeynarCast[]): FidRating {
  const score01 = neynarScore(user) ?? 0;
  const followers = user.follower_count ?? 0;
  const ageDays = accountAgeDays(user);
  const powerBadge = hasPowerBadge(user);
  const pro = (user as { pro?: { status?: string } }).pro?.status === "subscribed";
  const verified = verificationCount(user);

  let avgEngagement: number | undefined;
  let lastCastDays: number | undefined;
  if (recentCasts && recentCasts.length > 0) {
    const totalEngagement = recentCasts.reduce(
      (sum, c) => sum + c.reactions.likes_count + c.reactions.recasts_count + c.replies.count,
      0,
    );
    avgEngagement = totalEngagement / recentCasts.length;
    const lastTs = new Date(recentCasts[0].timestamp).getTime();
    if (!Number.isNaN(lastTs)) lastCastDays = (Date.now() - lastTs) / 86_400_000;
  }

  const scoreComponent = score01 * 35;
  const followerComponent = clamp01(Math.log10(followers + 1) / 5) * 25;
  const ageComponent = clamp01((ageDays ?? 0) / 730) * 15;
  const trustComponent = (powerBadge ? 10 : 0) + (pro ? 5 : 0) + (verified > 0 ? 5 : 0);
  const engagementComponent =
    avgEngagement !== undefined ? clamp01(Math.log10(avgEngagement + 1) / 2.5) * 5 : 0;

  const score = Math.round(
    scoreComponent + followerComponent + ageComponent + trustComponent + engagementComponent,
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    grade: gradeFor(score),
    activity: activityFor(ageDays, lastCastDays),
    factors: { neynarScore: score01, followerCount: followers, accountAgeDays: ageDays, powerBadge, pro, verifiedCount: verified, avgEngagement },
  };
}

export function gradeColor(grade: FidGrade): string {
  switch (grade) {
    case "Elite":    return "#f0b429";
    case "Strong":   return "#22c55e";
    case "Solid":    return "#409cff";
    case "Emerging": return "#a679f0";
    case "Unranked": return "#8891a3";
  }
}

export function activityColor(activity: ActivityLevel): string {
  switch (activity) {
    case "Active":   return "#22c55e";
    case "Rising":   return "#f0b429";
    case "New":      return "#409cff";
    case "Inactive": return "#8891a3";
  }
}
