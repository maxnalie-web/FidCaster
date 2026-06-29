---
name: Auth implementation
description: Full JWT+scrypt auth system using Node.js built-in crypto (no bcryptjs/jsonwebtoken)
---

## Implementation
- **lib/auth.ts**: `hashPassword(plain)` using `crypto.scrypt`, `verifyPassword(plain, hash)`, `signJWT(payload)` using `crypto.createHmac('sha256', JWT_SECRET)`, `verifyJWT(token)`.
- **Cookie**: `ds_token` (httpOnly: true, sameSite: 'lax', secure: prod-only, maxAge: 7 days).
- **Middleware**: `middlewares/require-auth.ts` — reads `req.cookies.ds_token`, verifies JWT, sets `req.user = { userId, email }`.
- **Routes**: `routes/auth.ts` — POST /api/auth/register (201), POST /api/auth/login (200), POST /api/auth/logout (200 + cookie clear), GET /api/auth/me (200).
- **DB**: `lib/db/src/schema/users.ts` — pgTable('users'): id, email (unique), passwordHash, name, plan ('free'/'pro'/'enterprise'), createdAt.
- **projects.ts** schema: has `userId` column (integer, FK to users).

## Route protection
`routes/index.ts`: public routes (health, /api/auth/*) registered before `requireAuth`. All other routers mounted after `requireAuth` middleware.

## Frontend
- `hooks/use-auth.ts`: `useQuery(["auth-me"])` → fetchMe → GET /api/auth/me. Returns `{ user, isLoading, isAuthenticated, logout, refetch }`.
- `AuthGuard` component in App.tsx: if `isLoading` → null; if `!isAuthenticated` → `<Redirect to="/login" />`.
- Login/Register pages at `/login` and `/register` routes (public, outside AuthGuard).
- `useAllFiles` must return `[]` on non-ok responses (not pass error JSON to Spotlight which crashes on `.filter()`).
- `Spotlight` component: always coerce `files` prop with `Array.isArray(filesProp) ? filesProp : []`.

## Why Node.js built-ins
No external bcryptjs/jsonwebtoken needed. crypto.scrypt is async and secure. HMAC-SHA256 JWT is lightweight. Avoids pnpm install issues with new packages in the workspace:* protocol environment.
