/**
 * Real server-side persistence for admin-configured site settings and API
 * secrets — replaces the old localStorage-only model, where every setting
 * only ever applied to the browser of whoever happened to open the admin
 * panel and never reached any other visitor of the actual site.
 *
 * Two separate tables, deliberately: `public_config` is served to every
 * visitor unauthenticated (branding, theme, copy, feature flags — nothing
 * sensitive), `secrets` is only ever read/written by an authenticated admin
 * request and is never included in any public response.
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);

export interface AdminSecrets {
  neynarApiKey: string;
  imgurClientId: string;
  /** JSON-encoded array of {cloudName, apiKey, apiSecret} — same shape as
   * the CLOUDINARY_ACCOUNTS env var; when set here it takes priority over
   * the env var, letting the admin add/rotate accounts without a redeploy. */
  cloudinaryAccountsJson: string;
}

const EMPTY_SECRETS: AdminSecrets = { neynarApiKey: "", imgurClientId: "", cloudinaryAccountsJson: "" };

type Db = {
  getPublicConfig: () => string | null;
  setPublicConfig: (json: string) => void;
  getSecrets: () => AdminSecrets;
  setSecrets: (partial: Partial<AdminSecrets>) => void;
};

let _db: Db | null = null;
let _initTried = false;

function initDb(): Db | null {
  try {
    const Database = requireCjs("better-sqlite3");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../admin-store.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS public_config (
        id   INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secrets (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const stmtGetConfig = sqlite.prepare<[], { data: string }>("SELECT data FROM public_config WHERE id = 1");
    const stmtSetConfig = sqlite.prepare<[string], void>(
      "INSERT INTO public_config (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    );
    const stmtGetSecret = sqlite.prepare<[string], { value: string }>("SELECT value FROM secrets WHERE key = ?");
    const stmtSetSecret = sqlite.prepare<[string, string], void>(
      "INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );

    return {
      getPublicConfig() {
        return stmtGetConfig.get()?.data ?? null;
      },
      setPublicConfig(json) {
        stmtSetConfig.run(json);
      },
      getSecrets() {
        const out = { ...EMPTY_SECRETS };
        for (const key of Object.keys(out) as (keyof AdminSecrets)[]) {
          const row = stmtGetSecret.get(key);
          if (row) out[key] = row.value;
        }
        return out;
      },
      setSecrets(partial) {
        for (const [key, value] of Object.entries(partial)) {
          if (value !== undefined) stmtSetSecret.run(key, value);
        }
      },
    };
  } catch (e) {
    console.warn("[admin-store] disabled (better-sqlite3 unavailable):", (e as Error).message);
    return null;
  }
}

function db(): Db | null {
  if (!_initTried) { _db = initDb(); _initTried = true; }
  return _db;
}

export function getPublicConfig(): string | null {
  return db()?.getPublicConfig() ?? null;
}

export function setPublicConfig(json: string): void {
  db()?.setPublicConfig(json);
}

export function getAdminSecrets(): AdminSecrets {
  return db()?.getSecrets() ?? { ...EMPTY_SECRETS };
}

export function setAdminSecrets(partial: Partial<AdminSecrets>): void {
  db()?.setSecrets(partial);
}
