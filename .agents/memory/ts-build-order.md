---
name: TypeScript Build Order
description: lib/db must be built before api-server typecheck passes; no "build" script in package.json
---

# TypeScript Build Order for DevStation

**Rule:** Always build `lib/db` (and `lib/api-zod`) before running typecheck on `api-server`.

**Why:** `api-server` imports from `@workspace/db` which needs compiled `.js` + `.d.ts` outputs before tsc can resolve them. The packages don't have a `build` script so the standard `pnpm build` won't trigger them.

**How to apply:** Run `npx tsc --build lib/db lib/api-zod` from the workspace root before running `pnpm --filter @workspace/api-server run typecheck`. If you see "Cannot find module '@workspace/db'" errors, this is the cause.
