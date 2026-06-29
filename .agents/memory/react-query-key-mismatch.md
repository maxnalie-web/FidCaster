---
name: React Query key mismatch
description: Custom queryKey in useListFiles overrides generated key, making invalidateQueries a no-op
---

# React Query Key Mismatch

## The Rule
Never pass a custom `queryKey` to a generated hook (e.g. `useListFiles`) unless every `invalidateQueries` call also uses that exact same custom key.

## Why
The generated `getListFilesQueryKey(projectId)` returns `["/api/projects/${projectId}/files"]`.
If you call `useListFiles(projectId, { query: { queryKey: ["listFiles", projectId] } })`,
the query is cached under `["listFiles", projectId]`.
But all `invalidateQueries({ queryKey: getListFilesQueryKey(projectId) })` calls target
`["/api/projects/${projectId}/files"]` — a different key — so the cache is never invalidated
and the file tree never refreshes after create/delete/rename.

## How to Apply
- When using generated hooks from `@workspace/api-client-react`, omit the `queryKey` override
  unless you're prepared to update all invalidation sites to match.
- The `refetchInterval` option is safe to pass without affecting the key.
- Bug symptom: UI mutation succeeds (API returns 200) but the list doesn't update.
