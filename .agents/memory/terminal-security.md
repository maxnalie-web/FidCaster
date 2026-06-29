---
name: Terminal Security
description: How the DevStation terminal WebSocket is secured — HMAC tokens + Origin guards
---

# Terminal Security Model

The interactive terminal (bash shell) is high-risk. Two layers protect it:

## Layer 1 — HMAC-signed short-lived tokens
- `TERMINAL_SECRET`: 32-byte random hex, generated at API server startup
- Token format: `${timestamp}.${nonce}.${hmac_sha256}`
- TTL: 30 seconds; replayed/expired tokens are rejected
- `/api/terminal/token` issues a token only to localhost callers with a local Origin

## Layer 2 — Origin + IP checks on every connection
- Terminal WS rejects connections not from 127.0.0.1 / ::1
- Terminal WS rejects connections with non-localhost Origin/Referer header

**Why:** IP-localhost checks alone are unreliable in reverse-proxy setups (connections often appear from localhost even when proxied). The HMAC token proves the caller legitimately fetched the token through the same security gate. Origin/Referer adds CSRF protection.

**How to apply:** If adding new shell-access endpoints, always use `verifyTerminalToken()` from `terminal-token.ts` — do not use the old static `TERMINAL_TOKEN` string comparison.
