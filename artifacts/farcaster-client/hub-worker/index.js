/**
 * Farcaster Hub CORS Proxy — Cloudflare Worker
 *
 * مشکل: browser نمیتونه مستقیم به هاب‌های رایگان فارکستر وصل بشه (CORS ندارن)
 * راه‌حل: این Worker روی شبکه Cloudflare اجرا میشه، CORS header اضافه می‌کنه،
 *         و signed bytes رو به چند هاب همزمان (Promise.any) می‌فرسته.
 *         هر data center Cloudflare یه IP مجزاست → rate limit هاب تقریباً نامحدود.
 *
 * Deploy:
 *  1. dash.cloudflare.com → Workers & Pages → Create → رویه "Hello World"
 *  2. کل این فایل رو paste کن
 *  3. Save & Deploy
 *  4. URL مثلاً: https://farcaster-hub.USERNAME.workers.dev
 *  5. اون URL رو به Replit بده: VITE_HUB_WORKER_URL=https://farcaster-hub.USERNAME.workers.dev
 */

const FREE_HUBS = [
  "https://hoyt.farcaster.xyz:2281",
  "https://hub.farcaster.standardcrypto.vc:2281",
  "https://api.hub.wevm.dev",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.arrayBuffer();

    try {
      const winner = await Promise.any(
        FREE_HUBS.map(hub =>
          fetch(`${hub}/v1/submitMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body,
            signal: AbortSignal.timeout(8_000),
          }).then(async r => {
            const txt = await r.text();
            if (r.ok) return txt || '{"ok":true}';
            if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) return txt;
            throw new Error(`${hub} HTTP ${r.status}: ${txt.slice(0, 80)}`);
          })
        )
      );

      return new Response(winner, {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (e) {
      const msg = e instanceof AggregateError
        ? e.errors.map(x => String(x)).join(" | ")
        : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  },
};
