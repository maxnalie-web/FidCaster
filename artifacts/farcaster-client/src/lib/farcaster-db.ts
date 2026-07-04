/**
 * FidCaster local IndexedDB
 *
 * Object stores (tables):
 *   feed_cache        · casts per viewer FID (TTL 10 min)
 *   profile_cache     · user profiles by FID (TTL 30 min)
 *   notifications_cache · notifications per FID (TTL 5 min)
 *   drafts            · saved draft casts (no TTL)
 */

const DB_NAME = "fidcaster_data";
const DB_VERSION = 2;

export const STORES = {
  FEED: "feed_cache",
  PROFILES: "profile_cache",
  NOTIFICATIONS: "notifications_cache",
  DRAFTS: "drafts",
  FOLLOW_LIST: "follow_list_cache",
} as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      // feed_cache: keyed by viewer FID, stores last N casts + cursor
      if (!db.objectStoreNames.contains(STORES.FEED)) {
        db.createObjectStore(STORES.FEED, { keyPath: "viewerFid" });
      }

      // profile_cache: keyed by FID
      if (!db.objectStoreNames.contains(STORES.PROFILES)) {
        const ps = db.createObjectStore(STORES.PROFILES, { keyPath: "fid" });
        ps.createIndex("cachedAt", "cachedAt");
      }

      // notifications_cache: keyed by viewer FID
      if (!db.objectStoreNames.contains(STORES.NOTIFICATIONS)) {
        db.createObjectStore(STORES.NOTIFICATIONS, { keyPath: "viewerFid" });
      }

      // drafts: auto-increment key, indexed by FID
      if (!db.objectStoreNames.contains(STORES.DRAFTS)) {
        const ds = db.createObjectStore(STORES.DRAFTS, { keyPath: "id", autoIncrement: true });
        ds.createIndex("fid", "fid");
        ds.createIndex("createdAt", "createdAt");
      }

      // follow_list_cache: keyed by "mode:targetFid:viewerFid" (v2+)
      if (!db.objectStoreNames.contains(STORES.FOLLOW_LIST)) {
        db.createObjectStore(STORES.FOLLOW_LIST, { keyPath: "cacheKey" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function put(store: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function del(store: string, key: IDBValidKey): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function getAllFromIndex<T>(store: string, index: string): Promise<T[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).index(index).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

// ── Feed cache ────────────────────────────────────────────────────────────────

const FEED_TTL_MS = 10 * 60 * 1000; // 10 minutes

type FeedCacheEntry = {
  viewerFid: number;
  casts: unknown[];
  cursor?: string;
  cachedAt: number;
};

export async function getCachedFeed(viewerFid: number): Promise<{ casts: unknown[]; cursor?: string } | null> {
  const entry = await get<FeedCacheEntry>(STORES.FEED, viewerFid);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > FEED_TTL_MS) {
    await del(STORES.FEED, viewerFid);
    return null;
  }
  return { casts: entry.casts, cursor: entry.cursor };
}

export async function setCachedFeed(viewerFid: number, casts: unknown[], cursor?: string): Promise<void> {
  await put(STORES.FEED, { viewerFid, casts, cursor, cachedAt: Date.now() });
}

// ── Profile cache ─────────────────────────────────────────────────────────────

const PROFILE_TTL_MS = 30 * 60 * 1000; // 30 minutes

type ProfileCacheEntry = {
  fid: number;
  data: unknown;
  cachedAt: number;
};

export async function getCachedProfile(fid: number): Promise<unknown | null> {
  const entry = await get<ProfileCacheEntry>(STORES.PROFILES, fid);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > PROFILE_TTL_MS) {
    await del(STORES.PROFILES, fid);
    return null;
  }
  return entry.data;
}

export async function setCachedProfile(fid: number, data: unknown): Promise<void> {
  await put(STORES.PROFILES, { fid, data, cachedAt: Date.now() });
}

// ── Notifications cache ───────────────────────────────────────────────────────

const NOTIF_TTL_MS = 5 * 60 * 1000; // 5 minutes

type NotifCacheEntry = {
  viewerFid: number;
  notifications: unknown[];
  cursor?: string;
  cachedAt: number;
};

export async function getCachedNotifications(viewerFid: number): Promise<{ notifications: unknown[]; cursor?: string } | null> {
  const entry = await get<NotifCacheEntry>(STORES.NOTIFICATIONS, viewerFid);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > NOTIF_TTL_MS) {
    await del(STORES.NOTIFICATIONS, viewerFid);
    return null;
  }
  return { notifications: entry.notifications, cursor: entry.cursor };
}

export async function setCachedNotifications(viewerFid: number, notifications: unknown[], cursor?: string): Promise<void> {
  await put(STORES.NOTIFICATIONS, { viewerFid, notifications, cursor, cachedAt: Date.now() });
}

// ── Drafts ────────────────────────────────────────────────────────────────────

export type Draft = {
  id?: number;
  fid: number;
  text: string;
  replyToHash?: string;
  replyToFid?: number;
  embedUrls: string[];
  createdAt: number;
  updatedAt: number;
};

export async function getDrafts(fid: number): Promise<Draft[]> {
  const all = await getAllFromIndex<Draft>(STORES.DRAFTS, "fid");
  return all.filter((d) => d.fid === fid).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveDraft(draft: Omit<Draft, "id" | "createdAt" | "updatedAt">): Promise<void> {
  const now = Date.now();
  await put(STORES.DRAFTS, { ...draft, createdAt: now, updatedAt: now });
}

export async function updateDraft(id: number, text: string, embedUrls: string[]): Promise<void> {
  const entry = await get<Draft>(STORES.DRAFTS, id);
  if (!entry) return;
  await put(STORES.DRAFTS, { ...entry, text, embedUrls, updatedAt: Date.now() });
}

export async function deleteDraft(id: number): Promise<void> {
  await del(STORES.DRAFTS, id);
}

// ── Follow list cache ─────────────────────────────────────────────────────────
// Caches the fully-loaded follow list per (mode, targetFid, viewerFid).
// TTL 15 min · same window as server-side follow cache.
// This eliminates repeat Neynar calls when the user revisits FollowPage
// within the cache window (very common after running a batch operation).

const FOLLOW_LIST_TTL_MS = 15 * 60 * 1000;

type FollowListEntry = {
  cacheKey: string;
  users: unknown[];
  cachedAt: number;
};

export async function getCachedFollowList(
  mode: "followers" | "following",
  targetFid: number,
  viewerFid: number,
): Promise<unknown[] | null> {
  const key = `${mode}:${targetFid}:${viewerFid}`;
  const entry = await get<FollowListEntry>(STORES.FOLLOW_LIST, key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > FOLLOW_LIST_TTL_MS) {
    await del(STORES.FOLLOW_LIST, key);
    return null;
  }
  return entry.users;
}

export async function setCachedFollowList(
  mode: "followers" | "following",
  targetFid: number,
  viewerFid: number,
  users: unknown[],
): Promise<void> {
  const key = `${mode}:${targetFid}:${viewerFid}`;
  await put(STORES.FOLLOW_LIST, { cacheKey: key, users, cachedAt: Date.now() });
}

// ── Utility ───────────────────────────────────────────────────────────────────

export async function clearAllCaches(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(
        [STORES.FEED, STORES.PROFILES, STORES.NOTIFICATIONS, STORES.FOLLOW_LIST],
        "readwrite",
      );
      tx.objectStore(STORES.FEED).clear();
      tx.objectStore(STORES.PROFILES).clear();
      tx.objectStore(STORES.NOTIFICATIONS).clear();
      tx.objectStore(STORES.FOLLOW_LIST).clear();
      tx.oncomplete = () => resolve();
    });
  } catch {}
}
