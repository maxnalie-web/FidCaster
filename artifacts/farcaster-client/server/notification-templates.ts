/**
 * Native Farcaster notification text bank.
 *
 * These are the notifications delivered through Farcaster's own notification
 * tab (via db/notifications.ts's sendFarcasterNotification), not the FCM/web
 * push channel in fcm.ts + push-token-store.ts — that's a separate delivery
 * path with its own opt-in and doesn't reach anyone who hasn't granted
 * browser push permission. This is the one every user who tapped "Add App"
 * gets automatically.
 *
 * Farcaster truncates title to 32 chars and body to 128 chars, so every
 * template here is written to already fit (checked, not just hoped).
 */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function giftReceivedNotif(amount: number, fromUsername?: string | null): { title: string; body: string } {
  const from = fromUsername ? `@${fromUsername}` : "another user";
  return pick([
    { title: "You got a gift!", body: `+${amount} FidCaster points from ${from} just landed in your account.` },
    { title: "Gift received", body: `${from} sent you ${amount} points on FidCaster. Nice.` },
    { title: `+${amount} points, just for you`, body: `${from} sent you a gift. Go check your total.` },
    { title: "Points incoming", body: `You received a ${amount}-point gift from ${from}.` },
  ]);
}

export function giftSentNotif(amount: number): { title: string; body: string } {
  return pick([
    { title: "Gift sent!", body: `Your ${amount}-point gift was delivered successfully.` },
    { title: "Gift delivered", body: `${amount} points sent. Thanks for spreading the love.` },
    { title: "Gift confirmed", body: `Your gift of ${amount} points went through.` },
  ]);
}

export function giftFailedNotif(): { title: string; body: string } {
  return pick([
    { title: "Gift didn't go through", body: "Your gift cast didn't tag a valid recipient, so no points moved." },
    { title: "Gift not sent", body: "We couldn't find a valid recipient in your gift cast. Try again." },
  ]);
}

export function giftInsufficientAllowanceNotif(amount: number): { title: string; body: string } {
  return pick([
    { title: "Gift not sent", body: `You didn't have enough daily allowance to gift ${amount} pts.` },
    { title: "Not enough allowance", body: `That ${amount}-point gift didn't go through, allowance ran out.` },
  ]);
}

export function promotionOkNotif(pts: number): { title: string; body: string } {
  return pick([
    { title: `Promotion counted, +${pts} pts`, body: "Your FidCaster promotion cast just earned you points." },
    { title: "Promotion earned points!", body: `+${pts} points added for promoting FidCaster.` },
    { title: "Nice cast!", body: `Your promotion earned +${pts} points on FidCaster.` },
  ]);
}

export function promotionFailedNotif(reason: "cap" | "allowance"): { title: string; body: string } {
  return reason === "cap"
    ? pick([
        { title: "Promotion not counted", body: "You've hit today's promote limit. Try again tomorrow." },
        { title: "Daily promote limit reached", body: "That cast didn't earn points, you're at today's cap." },
      ])
    : pick([
        { title: "Promotion not counted", body: "You're out of daily allowance. It resets at midnight UTC." },
        { title: "Out of allowance", body: "That promotion cast didn't earn points, no allowance left today." },
      ]);
}

export function achievementUnlockedNotif(label: string, pts: number): { title: string; body: string } {
  const title = `Achievement unlocked!`.slice(0, 32);
  return pick([
    { title, body: `You unlocked "${label}"${pts > 0 ? ` (+${pts} pts)` : ""}. Keep going.` },
    { title: "New achievement!", body: `"${label}" unlocked${pts > 0 ? `, +${pts} points` : ""}. Nice work.` },
    { title: "Milestone reached", body: `You just unlocked "${label}" on FidCaster.` },
  ]);
}

export function referralWelcomeNotif(): { title: string; body: string } {
  return pick([
    { title: "Welcome to FidCaster!", body: "You joined via a referral, points are already in your account." },
    { title: "You're in!", body: "Thanks for joining FidCaster through a referral. Start earning points." },
  ]);
}

export function referralBonusNotif(pts: number): { title: string; body: string } {
  return pick([
    { title: `Referral bonus, +${pts} pts`, body: "Someone joined FidCaster using your referral link." },
    { title: "Your referral joined!", body: `+${pts} points for bringing a new user to FidCaster.` },
    { title: "Referral paid out", body: `+${pts} points, your invited friend just signed up.` },
  ]);
}
