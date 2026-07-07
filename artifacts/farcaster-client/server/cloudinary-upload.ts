/**
 * Signed upload to Cloudinary via its REST API directly (no SDK dependency
 * needed — this is the only Cloudinary call this server makes), spread
 * across a pool of accounts for scale (see cloudinary-accounts.ts) with
 * automatic failover if the chosen account errors out.
 *
 * Signing follows Cloudinary's documented scheme: sort every param that
 * will be sent (excluding file/api_key/signature), join as
 * "key=value&...", and SHA1 the result with the API secret appended.
 */
import { createHash } from "crypto";
import { getCloudinaryAccounts, isCloudinaryConfigured, type CloudinaryAccount } from "./cloudinary-accounts.js";
import { monthlyUploadCount, recordAccountUpload, markAccountFailure, isAccountInCooldown } from "./cloudinary-usage.js";

export { isCloudinaryConfigured };

/** Best account first: not in a post-failure cooldown, then fewest uploads
 * this month (keeps a multi-account pool roughly evenly loaded). */
function rankAccounts(accounts: CloudinaryAccount[]): CloudinaryAccount[] {
  return [...accounts].sort((a, b) => {
    const aCooling = isAccountInCooldown(a.id);
    const bCooling = isAccountInCooldown(b.id);
    if (aCooling !== bCooling) return aCooling ? 1 : -1;
    return monthlyUploadCount(a.id) - monthlyUploadCount(b.id);
  });
}

async function uploadToAccount(
  account: CloudinaryAccount,
  base64: string,
  mimeType: string,
  resourceType: "image" | "video",
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "fidcaster";
  // Only params actually sent to Cloudinary (besides file/api_key/signature)
  // are part of the signature, in alphabetical order.
  const signaturePayload = `folder=${folder}&timestamp=${timestamp}${account.apiSecret}`;
  const signature = createHash("sha1").update(signaturePayload).digest("hex");

  const dataUri = base64.startsWith("data:") ? base64 : `data:${mimeType};base64,${base64}`;

  const form = new FormData();
  form.append("file", dataUri);
  form.append("api_key", account.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${account.cloudName}/${resourceType}/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Cloudinary upload failed (${res.status}): ${errBody.slice(0, 300)}`);
  }
  const data = await res.json() as { secure_url?: string };
  if (!data.secure_url) throw new Error("Cloudinary upload returned no URL");
  return data.secure_url;
}

/** Uploads to the best-ranked account in the pool, automatically failing
 * over to the next-best account (and marking the failed one on a cooldown)
 * if the first attempt errors — a single account having an outage or
 * hitting its monthly cap shouldn't fail uploads for everyone. */
export async function uploadToCloudinary(
  base64: string,
  mimeType: string,
  resourceType: "image" | "video",
): Promise<string> {
  const accounts = rankAccounts(getCloudinaryAccounts());
  if (accounts.length === 0) throw new Error("Cloudinary is not configured");

  let lastErr: Error | null = null;
  for (const account of accounts) {
    try {
      const url = await uploadToAccount(account, base64, mimeType, resourceType);
      recordAccountUpload(account.id);
      return url;
    } catch (e) {
      lastErr = e as Error;
      // Only put an account into cooldown for server-side or auth failures
      // (401 Unauthorized, 403 Forbidden, 429 Rate Limited, 5xx).
      // A 400 Bad Request means the file itself is invalid — the account is
      // fine and cooling it down would unnecessarily block future uploads.
      const statusMatch = lastErr.message.match(/\((\d+)\)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const isAccountFault = status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
      if (isAccountFault) markAccountFailure(account.id);
      console.warn(`[cloudinary] account #${account.id} (${account.cloudName}) failed (${isAccountFault ? "cooldown" : "no cooldown"}):`, lastErr.message);
    }
  }
  throw lastErr ?? new Error("All Cloudinary accounts failed");
}
