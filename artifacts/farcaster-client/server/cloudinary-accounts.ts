/**
 * Multi-account Cloudinary pool — each free Cloudinary account gives ~25
 * combined storage+bandwidth credits (roughly 25GB); spreading uploads
 * across N accounts multiplies that capacity roughly N-fold. Configure via
 * CLOUDINARY_ACCOUNTS (a JSON array), or fall back to the single
 * CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET vars as a one-account pool so
 * existing single-account deployments keep working unchanged.
 *
 * Example CLOUDINARY_ACCOUNTS value (set as ONE env var, valid JSON, no
 * line breaks needed — most process managers handle long values fine):
 *   [{"cloudName":"abc123","apiKey":"111","apiSecret":"secret1"},
 *    {"cloudName":"xyz789","apiKey":"222","apiSecret":"secret2"}]
 */

export interface CloudinaryAccount {
  /** Index into the configured list — stable identity for usage tracking,
   * independent of cloudName in case two accounts ever shared one. */
  id: number;
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function parseAccountsJson(): CloudinaryAccount[] | null {
  const raw = process.env.CLOUDINARY_ACCOUNTS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Array<{ cloudName?: string; apiKey?: string; apiSecret?: string }>;
    if (!Array.isArray(parsed)) return null;
    const accounts = parsed
      .filter((a) => a.cloudName && a.apiKey && a.apiSecret)
      .map((a, i) => ({ id: i, cloudName: a.cloudName!, apiKey: a.apiKey!, apiSecret: a.apiSecret! }));
    return accounts.length > 0 ? accounts : null;
  } catch (e) {
    console.warn("[cloudinary] CLOUDINARY_ACCOUNTS is not valid JSON:", (e as Error).message);
    return null;
  }
}

/** Read lazily — see cloudinary-upload.ts for why (ESM import evaluation
 * order runs before server/index.ts's own .env-loading code). */
export function getCloudinaryAccounts(): CloudinaryAccount[] {
  const fromJson = parseAccountsJson();
  if (fromJson) return fromJson;

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    return [{ id: 0, cloudName: CLOUDINARY_CLOUD_NAME, apiKey: CLOUDINARY_API_KEY, apiSecret: CLOUDINARY_API_SECRET }];
  }
  return [];
}

export function isCloudinaryConfigured(): boolean {
  return getCloudinaryAccounts().length > 0;
}
