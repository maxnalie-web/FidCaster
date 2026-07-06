/**
 * Client-side API for the real (server-checked) admin auth + secrets
 * endpoints in server/admin-auth.ts and server/admin-store.ts. Session state
 * is a signed httpOnly cookie the browser can't read directly — these calls
 * are the only way the UI learns whether it's actually logged in.
 */

export interface AdminSecrets {
  neynarApiKey: string;
  imgurClientId: string;
  cloudinaryAccountsJson: string;
}

async function parseError(r: Response, fallback: string): Promise<string> {
  try {
    const data = await r.json();
    return (data as { error?: string }).error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function adminLogin(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) return { ok: false, error: await parseError(r, "Invalid password") };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Login failed" };
  }
}

export async function adminLogout(): Promise<void> {
  try { await fetch("/api/admin/logout", { method: "POST" }); } catch {}
}

export async function checkAdminSession(): Promise<boolean> {
  try {
    const r = await fetch("/api/admin/session");
    if (!r.ok) return false;
    const data = await r.json() as { valid?: boolean };
    return !!data.valid;
  } catch {
    return false;
  }
}

export async function fetchAdminSecrets(): Promise<AdminSecrets | null> {
  try {
    const r = await fetch("/api/admin/secrets");
    if (!r.ok) return null;
    return await r.json() as AdminSecrets;
  } catch {
    return null;
  }
}

export async function pushAdminSecrets(partial: Partial<AdminSecrets>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/admin/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!r.ok) return { ok: false, error: await parseError(r, `Save failed (${r.status})`) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}
