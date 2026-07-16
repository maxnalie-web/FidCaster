/**
 * SSRF guard for any server-side "fetch a URL the client gave us" endpoint
 * (currently just the in-app DeFi browser proxy).
 *
 * Before this existed, /api/browser-proxy validated only that the URL started
 * with http:// or https:// — nothing stopped it from being pointed at the
 * server's own internal network: cloud metadata endpoints
 * (http://169.254.169.254/...), other services on localhost/the private
 * network, etc. The server would dutifully fetch it and hand the response
 * back to whoever asked.
 *
 * This checks the ACTUAL resolved IP address(es) of the target host against
 * the private/reserved ranges, not just the hostname text (a hostname can
 * look like anything and still resolve to 127.0.0.1 or a private IP — DNS
 * rebinding is exactly this trick). It also has to be re-checked on every
 * redirect hop, since a URL that resolves to something public can still
 * redirect the request to an internal address.
 */
import { promises as dns } from "dns";
import { isIP } from "net";

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

// Private, loopback, link-local (incl. the 169.254.169.254 cloud metadata
// address), CGNAT, documentation, and multicast/reserved ranges.
const BLOCKED_V4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function isBlockedIPv4(ip: string): boolean {
  return BLOCKED_V4_RANGES.some(([base, bits]) => inCidr4(ip, base, bits));
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local fe80::/10
  if (/^f[c-d]/.test(lower)) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — unwrap and check the embedded v4 address
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true; // unrecognized — fail closed
}

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

export async function isUrlSafeToFetch(rawUrl: string): Promise<{ safe: boolean; reason?: string }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { safe: false, reason: "invalid URL" }; }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: "unsupported protocol" };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || BLOCKED_HOSTNAME_SUFFIXES.some(s => hostname.endsWith(s))) {
    return { safe: false, reason: "blocked hostname" };
  }

  // URL.hostname keeps the brackets around an IPv6 literal (e.g. "[::1]"),
  // which isIP() doesn't recognize — strip them before checking.
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  // If the hostname is already a literal IP, check it directly.
  if (isIP(bareHost)) {
    return isBlockedIp(bareHost) ? { safe: false, reason: "blocked IP literal" } : { safe: true };
  }

  // Otherwise resolve DNS and check every returned address (A + AAAA) — an
  // attacker-controlled or rebinding DNS name could point anywhere.
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return { safe: false, reason: "no DNS records" };
    if (records.some(r => isBlockedIp(r.address))) {
      return { safe: false, reason: "resolves to a private/reserved address" };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: "DNS resolution failed" };
  }
}

const MAX_REDIRECTS = 5;

/**
 * fetch() that re-validates the destination on every redirect hop, not just
 * the initial URL — a URL that resolves to something public can still
 * redirect the actual request to an internal address.
 */
export async function safeFetch(initialUrl: string, init: RequestInit): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await isUrlSafeToFetch(currentUrl);
    if (!check.safe) {
      throw new Error(`Blocked target (${check.reason ?? "disallowed"}): ${currentUrl}`);
    }
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res; // no Location header — nothing to follow, return as-is
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
