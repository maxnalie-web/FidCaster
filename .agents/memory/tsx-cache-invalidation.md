---
name: tsx cache invalidation
description: tsx caches compiled TS in /tmp/tsx-{uid}/; stale entries survive workflow restarts and cause new routes to silently return 404 while old routes in the same file still work.
---

# tsx cache invalidation

## The rule
After editing server TypeScript files, the tsx module cache at `/tmp/tsx-{uid}/` may serve stale compiled output. Symptom: **new routes/functions return 404 while old routes in the same file still work**.

**Why:** tsx v4 uses content-hash-based cache keys, but the cache is keyed against the compiled file from a previous process. Under Replit workflow restarts, the new process may load a stale entry if the hash collision is hit or the mtime check passes incorrectly.

**How to apply:** After any server-side TypeScript change that adds new exports or routes, if the new routes return 404 but old ones work:
1. `rm -rf /tmp/tsx-1000` (user 1000 cache dir)
2. `touch` all modified `.ts` files
3. Restart the workflow

One-liner: `rm -rf /tmp/tsx-1000 && touch <modified files> && restart workflow`
