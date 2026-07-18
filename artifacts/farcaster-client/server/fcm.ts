/**
 * Firebase Cloud Messaging sender - HTTP v1 API, authenticated with a
 * service-account JWT (self-signed with Node's crypto, no googleapis/
 * google-auth-library dependency needed). FCM sending itself is free
 * regardless of Firebase billing plan; this calls FCM directly from our
 * own always-on server, so no Cloud Functions / Blaze plan is required.
 *
 * Setup: Firebase Console -> Project Settings -> Service Accounts ->
 * "Generate new private key" -> paste the downloaded JSON as the
 * FCM_SERVICE_ACCOUNT_JSON env var (single line).
 */

import { createSign } from "crypto";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function getServiceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    console.warn("[fcm] FCM_SERVICE_ACCOUNT_JSON is not valid JSON");
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signInput = `${header}.${claimSet}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const signature = base64url(signer.sign(sa.private_key));
  const assertion = `${signInput}.${signature}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`FCM OAuth token exchange failed: ${r.status} ${t.slice(0, 200)}`);
  }
  const data = await r.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export function isFcmConfigured(): boolean {
  return getServiceAccount() !== null;
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

// FCM's v1 API has no multicast endpoint - one HTTP call per token. Sent
// with limited concurrency so a user with several devices doesn't serialize.
export async function sendPushToTokens(tokens: string[], payload: PushPayload): Promise<{ sent: number; invalidTokens: string[] }> {
  const sa = getServiceAccount();
  if (!sa || tokens.length === 0) return { sent: 0, invalidTokens: [] };

  const accessToken = await getAccessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const invalidTokens: string[] = [];
  let sent = 0;

  const CONCURRENCY = 10;
  for (let i = 0; i < tokens.length; i += CONCURRENCY) {
    const batch = tokens.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (token) => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: payload.title, body: payload.body },
              data: payload.data ?? {},
              android: { priority: "high" },
              apns: { headers: { "apns-priority": "10" } },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) { sent++; return; }
        const errBody = await r.json().catch(() => null) as { error?: { status?: string } } | null;
        const status = errBody?.error?.status;
        if (status === "UNREGISTERED" || status === "NOT_FOUND" || status === "INVALID_ARGUMENT") {
          invalidTokens.push(token);
        } else {
          console.warn(`[fcm] send failed (${r.status} ${status ?? ""}) for token ...${token.slice(-8)}`);
        }
      } catch (e) {
        console.warn("[fcm] send error:", (e as Error).message);
      }
    }));
  }

  return { sent, invalidTokens };
}
