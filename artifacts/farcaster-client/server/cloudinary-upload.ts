/**
 * Minimal signed upload to Cloudinary via its REST API directly (no SDK
 * dependency needed — this is the only Cloudinary call this server makes).
 * Signing follows Cloudinary's documented scheme: sort every param that will
 * be sent (excluding file/api_key/signature), join as "key=value&...", and
 * SHA1 the result with the API secret appended.
 */
import { createHash } from "crypto";

// Read lazily (not at module-load time): server/index.ts populates
// process.env from .env in its own top-level code, and ESM import
// evaluation order means this module's imports would otherwise run before
// that — capturing `undefined` into module-level constants here even
// though the .env file genuinely has the values by the time a request
// actually comes in.
function creds() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };
}

export function isCloudinaryConfigured(): boolean {
  const { cloudName, apiKey, apiSecret } = creds();
  return !!(cloudName && apiKey && apiSecret);
}

/** Uploads a base64 data URI (or raw base64 + mimeType) to Cloudinary and
 * returns the resulting secure (https) URL. `resourceType` must be "image"
 * or "video" — Cloudinary uses separate upload endpoints per type. */
export async function uploadToCloudinary(
  base64: string,
  mimeType: string,
  resourceType: "image" | "video",
): Promise<string> {
  const { cloudName: CLOUD_NAME, apiKey: API_KEY, apiSecret: API_SECRET } = creds();
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    throw new Error("Cloudinary is not configured");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "fidcaster";
  // Only params actually sent to Cloudinary (besides file/api_key/signature)
  // are part of the signature, in alphabetical order.
  const signaturePayload = `folder=${folder}&timestamp=${timestamp}${API_SECRET}`;
  const signature = createHash("sha1").update(signaturePayload).digest("hex");

  const dataUri = base64.startsWith("data:") ? base64 : `data:${mimeType};base64,${base64}`;

  const form = new FormData();
  form.append("file", dataUri);
  form.append("api_key", API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
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
