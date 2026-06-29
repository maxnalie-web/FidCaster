---
name: Power Tools panels
description: Architecture of API Tester, Todo Board, Snippets, Time Tracker panels in DevStation IDE.
---

# Power Tools Panels

## DB Tables
- `api_collections` — collections per project (id, projectId, name)
- `api_requests` — saved requests in a collection (method, url, headers JSON, body, bodyType, auth JSON, tests)
- `api_environments` — environments per project (id, projectId, name, variables JSON)
- `snippets` — global personal code snippets (id, name, trigger, language, content, description)
- `time_sessions` — per-project time tracking (id, projectId, startedAt, endedAt, durationSeconds)
- `project_scripts` — per-project one-click scripts (id, projectId, name, command, icon, color)

## Backend routes (all in api-server/src/routes/)
- `api-tester.ts` — POST /projects/:id/api-tester/send (native fetch, 30s timeout), CRUD for collections/requests/environments
- `todos.ts` — GET /projects/:id/todos — scans file content in DB for TODO/FIXME/HACK/NOTE/XXX/BUG patterns
- `snippets.ts` — GET/POST/PUT/DELETE /snippets (global, not per-project)
- `time-tracker.ts` — POST /projects/:id/time/start|stop, GET /stats. Also CRUD + /run for project_scripts. Active sessions tracked in-memory Map (activeSessions).

## Frontend panels (artifacts/ide/src/components/)
- `api-tester-panel.tsx` — Postman-like UI: method+URL bar, Headers/Body/Auth/Tests tabs, pretty JSON response, collections sidebar, environment variable substitution {{var}}, inline test runner using pm.test/pm.expect
- `todo-panel.tsx` — Auto-scans on mount, filter tabs per type, grouped by file
- `snippets-panel.tsx` — Search, add/edit/delete, copy to clipboard, expand preview
- `time-tracker-panel.tsx` — Auto-starts session on mount (stops on unmount), 7-day bar chart, custom scripts with run+output

## Pattern for adding new IDE panels
1. Add to `RightPanel` union type in ide.tsx
2. Add icon import + toolbar button (with colored active state)
3. Add `{rightPanel === "panel-name" && <Panel />}` in render block
4. Export from components/, register route in routes/index.ts

**Why:**
The toolbar uses compact icon buttons (p-1.5 w-4 h-4). A visual separator (w-px h-4 bg-white/10) was added before the Power Tools group to distinguish them from system tools.
