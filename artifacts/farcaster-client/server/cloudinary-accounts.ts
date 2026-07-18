/**
 * Multi-account Cloudinary pool - each free Cloudinary account gives ~25
 * combined storage+bandwidth credits (roughly 25GB); spreading uploads
 * across N accounts multiplies that capacity roughly N-fold. Configure via
 * CLOUDINARY_ACCOUNTS (a JSON array), or fall back to the single
 * CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET vars as a one-account pool so
 * existing single-account deployments keep working unchanged.
 *
 * Example CLOUDINARY_ACCOUNTS value (set as ONE env var, valid JSON, no
 * line breaks needed - most process managers handle long values fine):
 *   [{"cloudName":"abc123","apiKey":"111","apiSecret":"secret1"},
 *    {"cloudName":"xyz789","apiKey":"222","apiSecret":"secret2"}]
 */
import { getAdminSecrets } from "./admin-store";

export interface CloudinaryAccount {
  /** Index into the configured list - stable identity for usage tracking,
   * independent of cloudName in case two accounts ever shared one. */
  id: number;
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function parseAccountsFromJsonString(raw: string | null | undefined, source: string): CloudinaryAccount[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Array<{ cloudName?: string; apiKey?: string; apiSecret?: string }>;
    if (!Array.isArray(parsed)) return null;
    const accounts = parsed
      .filter((a) => a.cloudName && a.apiKey && a.apiSecret)
      .map((a, i) => ({ id: i, cloudName: a.cloudName!, apiKey: a.apiKey!, apiSecret: a.apiSecret! }));
    return accounts.length > 0 ? accounts : null;
  } catch (e) {
    console.warn(`[cloudinary] ${source} is not valid JSON:`, (e as Error).message);
    return null;
  }
}

/** Read lazily - see cloudinary-upload.ts for why (ESM import evaluation
 * order runs before server/index.ts's own .env-loading code).
 *
 * Priority: admin-panel-configured accounts (hot-reloadable, no redeploy) >
 * CLOUDINARY_ACCOUNTS env var (JSON array) > single CLOUDINARY_CLOUD_NAME/
 * API_KEY/API_SECRET env vars. */
export function getCloudinaryAccounts(): CloudinaryAccount[] {
  const fromAdmin = parseAccountsFromJsonString(getAdminSecrets().cloudinaryAccountsJson, "admin-configured Cloudinary accounts");
  if (fromAdmin) return fromAdmin;

  const fromJson = parseAccountsFromJsonString(process.env.CLOUDINARY_ACCOUNTS, "CLOUDINARY_ACCOUNTS");
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
