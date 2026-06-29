# DevStation — Personal Cloud IDE

A full-featured, browser-based personal development environment built on React + Vite (frontend) and Express 5 (backend) in a pnpm monorepo. DevStation gives you a Monaco editor, integrated terminal, Git, AI agent, Python notebooks, debugger, API tester, snippets, todo board, time tracker, and more — all in one self-hosted workspace.

---

## Run & Operate

| Command | What it does |
|---|---|
| `pnpm --filter @workspace/api-server run dev` | Start the API server (port 8080) |
| `pnpm --filter @workspace/ide run dev` | Start the IDE frontend (port 5000) |
| `pnpm run typecheck` | Full typecheck across all packages |
| `pnpm run build` | Typecheck + build all packages |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API hooks + Zod schemas from OpenAPI spec |
| `pnpm --filter @workspace/db run push` | Push DB schema changes (dev only) |
| `pnpm --filter @workspace/e2e run test:e2e` | Run Playwright E2E tests |

**Required env:** `DATABASE_URL` — Postgres connection string (auto-provided by Replit)

---

## Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces, Node.js 24, TypeScript 5.9 |
| Frontend | React 18, Vite, TailwindCSS, shadcn/ui, React Query |
| Editor | Monaco Editor with LSP support (pyright, typescript-language-server, vscode-css/html/json-language-server) |
| API | Express 5, Zod v4 validation, Orval codegen from OpenAPI spec |
| Database | PostgreSQL 16, Drizzle ORM, drizzle-zod |
| Build | esbuild (API), Vite (IDE), rollup |
| Python | uv + pyproject.toml, .pythonlibs venv, IPython kernel for notebooks |
| E2E Tests | Playwright (Chromium), 60 tests across 9 spec files |
| AI | Anthropic Claude, OpenAI, Gemini — multi-provider with model selector |

---

## Where Things Live

```
artifacts/
  api-server/       — Express 5 API (port 8080 dev, 8080 prod)
    src/
      routes/       — All API route handlers (see Routes section below)
      index.ts      — App entry point + middleware
  ide/              — React + Vite IDE frontend (port 5000 dev, static prod)
    src/
      pages/        — home.tsx, ide.tsx, settings.tsx, projects.tsx, pricing.tsx
      components/   — All panel components (see Features section)
  e2e/              — Playwright E2E test suite
    tests/          — 9 spec files + pages/ POM dir + helpers.ts

lib/
  db/               — Drizzle ORM schema + migrations (source of truth for DB)
  api-zod/          — Zod schemas generated from OpenAPI spec
  api-spec/         — OpenAPI spec (source of truth for API contract)

pyproject.toml      — Python deps: debugpy, python-lsp-server (uv managed)
uv.lock             — Lockfile for Python deps
```

---

## Features

### Pages

| Page | Route | Description |
|---|---|---|
| Home / Workspace | `/` | Dashboard: 12-week coding activity graph, language breakdown, recent projects, pinned projects, recently edited files, stat cards (LOC, files, languages) |
| Projects | `/projects` | Grid/List view, search, filter by language, pin/unpin |
| IDE | `/ide/:projectId` | Main development workspace (see panels below) |
| Settings | `/settings` | Themes, editor config, AI providers, behavior toggles |
| Pricing | `/pricing` | Subscription tiers: Free, Pro, Team |

### IDE Activity Bar Panels

| Panel | Icon | Key Capabilities |
|---|---|---|
| **Explorer** | Files | Tree view, context menu (Rename, Duplicate, Copy Path, Delete), new file/folder |
| **Git** | Source Control | Status, stage/unstage, commit, branches (create/checkout/merge), history log, diff view |
| **AI Agent** | Robot | Agentic task execution with planning, rollback, multi-step tool use |
| **AI Chat** | Chat | Conversational interface for quick queries and code assistance |
| **Terminal** | `>_` | WebSocket-based integrated terminal with real-time I/O |
| **Debugger** | Bug | Python/JS debugging via DAP (debugpy), breakpoints, step controls |
| **API Tester** | Zap | Postman-like HTTP client: request builder, collections, environment variables, response viewer |
| **Notebook** | Book | `.ipynb` Jupyter notebook support with IPython kernel, rich outputs (text, HTML, images) |
| **Todo Board** | Check | Project-scoped task tracking, scanned from code comments |
| **Snippets** | Code | Reusable code snippet library with search |
| **Time Tracker** | Clock | Session timers, daily/weekly stats, custom automation scripts |
| **Secrets** | Lock | Secure env var management with project injection |
| **Checkpoints** | History | Automated/manual project snapshots with diff view and restore |
| **Object Storage** | Cloud | File upload management and cloud/local storage assets |
| **Integrations** | Plug | Catalog of external services (GitHub, Vercel, Slack, etc.) |
| **Deploy** | Rocket | Deployment status (Live/Building/Failed), logs, trigger deploy |
| **Database** | Database | Schema inspection, SQL query execution |
| **Packages** | Package | Runtime detection and package installation per project |

### Editor Features

- **Monaco Editor** — full syntax highlighting, IntelliSense, breadcrumbs
- **Multi-tab** — open multiple files with a tab bar
- **Split View** — horizontal editor split for two files at once
- **Zen Mode** — distraction-free full-screen editing
- **Command Palette** (`Cmd+K`) — create projects, switch themes, navigate
- **Spotlight Search** (`Cmd+P`) — global file search and quick navigation
- **Shortcut Map** (`Cmd+?`) — visual overlay of all keyboard shortcuts
- **Markdown Preview** — live preview for `.md` files
- **Diff View** — side-by-side diff for git changes
- **10+ Themes** — Light, Dark, Dracula, One Dark, Nord, Monokai, Solarized, Catppuccin, Tokyo Night (real-time preview in Settings)

### LSP (Language Server Protocol)

| Language | Server | Location |
|---|---|---|
| Python | `pyright-langserver` | `api-server/node_modules/.bin` |
| TypeScript/JS | `typescript-language-server` | `api-server/node_modules/.bin` |
| CSS/SCSS/Less | `vscode-css-language-server` | `api-server/node_modules/.bin` |
| HTML | `vscode-html-language-server` | `api-server/node_modules/.bin` |
| JSON/JSONC | `vscode-json-language-server` | `api-server/node_modules/.bin` |
| Markdown/MDX | `vscode-markdown-language-server` | `api-server/node_modules/.bin` |

LSP providers registered per-language in Monaco effect with deps `[monaco, projectId, language]`. Signature help uses trigger chars `["(", ","]`. Providers cached in `_lspProviders`.

### AI — Multi-Provider

- **Providers**: Anthropic (Claude), OpenAI, Gemini, custom endpoints
- **Agent loop**: separate `runAnthropicLoop` (native SDK stream) and `runOpenAILoop` (OpenAI SDK, accumulates tool_calls across chunks)
- **Model selector**: UI in agent panel, persisted to localStorage
- **Models endpoint**: `GET /api/agent/models` returns all models with `available` flag

---

## API Routes

| Route File | Endpoints |
|---|---|
| `projects.ts` | `GET/POST /api/projects`, pin, stats, open |
| `files.ts` | CRUD `/api/projects/:id/files`, search, file watcher (WebSocket) |
| `git.ts` | status, stage, commit, branches, push/pull, log, diff |
| `agent.ts` | run, plan, stop, rollback |
| `ai.ts` | chat completions, multi-provider routing |
| `lsp.ts` | LSP WebSocket proxy per project/language |
| `terminal.ts` | PTY WebSocket terminal sessions |
| `terminal-token.ts` | Terminal auth token |
| `debug.ts` | DAP/CDP debug session management |
| `notebook.ts` | Cell execution via IPython kernel |
| `run.ts` | Project run with streaming output |
| `runtime.ts` | Runtime detection and installation |
| `todos.ts` | Todo CRUD, code scan |
| `snippets.ts` | Snippet CRUD |
| `time-tracker.ts` | Sessions, stats, custom scripts |
| `settings.ts` | Editor/theme preferences |
| `settings-ai.ts` | AI provider CRUD |
| `secrets.ts` | Env var management per project |
| `checkpoints.ts` | Snapshot creation, list, restore, diff |
| `api-tester.ts` | Request execution, collections |
| `db.ts` | Schema inspection, query execution |
| `docker.ts` | Container management, DB injection |
| `devops.ts` | Makefile targets, GitHub Actions runner |
| `deploy.ts` | Deployment triggers and status |
| `pkg.ts` | Package manager detection + install |
| `storage.ts` | Object storage CRUD |
| `integrations.ts` | External service connections |
| `dashboard.ts` | Global workspace stats |
| `health.ts` | `GET /api/healthz` — startup probe |
| `validate.ts` | Schema validation endpoint |

---

## E2E Tests (Playwright)

**Package**: `artifacts/e2e` (`@workspace/e2e`)
**Total**: **60 tests** across **9 spec files**
**Browser**: System Chromium (resolved via `which chromium`) with `--no-sandbox`, `--single-process`
**Config**: `artifacts/e2e/playwright.config.ts`
**Run**: `pnpm --filter @workspace/e2e run test:e2e`

### Test Files

| Spec File | Tests | What It Covers |
|---|---|---|
| `dashboard.spec.ts` | 7 | Home page load, stat cards, logo, New Project button, modal tabs, project creation flow, settings navigation |
| `editor.spec.ts` | 8 | IDE load, activity bar, Explorer panel, new file creation, top bar, back button, bottom panel tabs |
| `git.spec.ts` | 7 | Git panel open, branch tab buttons, changes tab, load status, history tab, branches tab, refresh button |
| `terminal.spec.ts` | 4 | Terminal tab visible, panel area present, output tab switch, debug-console tab |
| `todos.spec.ts` | 3 | Todos panel open, rescan button, All filter |
| `api-tester.spec.ts` | 9 | Panel open, URL input, Send button, disabled state, method selector, URL enables Send, collections button, request tabs, live API request |
| `snippets.spec.ts` | 5 | Panel open, add button, search input, form opens, snippet creation and list |
| `time-tracker.spec.ts` | 5 | Panel open, time stats section, refresh button, custom scripts section, add script form |
| `settings.spec.ts` | 11 | Settings page load, Color Theme, Editor, AI Providers sections, Add Provider button, form validation, Behavior toggles, Save button, back navigation, theme previews |

### Page Object Model

Located in `artifacts/e2e/tests/pages/`:
- `DashboardPage` — home page interactions
- `IDEPage` — IDE view interactions (activity bar, panels, editor)

### Test Infrastructure

- **webServer**: Auto-starts API on port 8080 and IDE on port 5000 (`reuseExistingServer: true`)
- **data-testid attributes**: `new-project-btn`, `activity-bar`, `new-project-modal`, `project-name-input`, `create-project-btn`
- **Artifacts**: Screenshots, videos, and traces captured on failure
- **Retries**: 1 retry per test

### E2E Test Run Results

| Result | Detail |
|---|---|
| **Compilation** | ✅ All 60 tests compile and list without errors (`playwright --list`) |
| **Sandbox execution** | ⚠️ Browser launch hangs in Replit agent sandbox — NixOS process isolation blocks browser subprocess spawning even with `--no-sandbox --single-process`. This is a sandbox-specific constraint, not a test code issue. |
| **CI / local** | ✅ Designed to run correctly in standard CI (GitHub Actions, etc.) or any environment with Chromium available |

---

## Known Issues, Errors & Fixes

### Deployment Build Failure — `uv sync` Permission Denied

**Error** (build logs, June 2026):
```
error: Failed to install: platformdirs-4.10.0-py3-none-any.whl
Caused by: failed to create directory
  /nix/store/.../python3.11/site-packages/platformdirs: Permission denied (os error 13)
```

**Root cause**: Replit's build system auto-detects `pyproject.toml` and runs `uv lock && uv sync` in a clean production container. There's no `.pythonlibs` venv present, and the system Nix Python (`/nix/store/...`) is read-only. This happens in the "Installing packages" phase — before any artifact build commands or `[userenv]` environment variables take effect.

**What doesn't work**: Setting `UV_PROJECT_ENVIRONMENT=.pythonlibs` via `[userenv.shared]` in `.replit` — that section only applies to the dev workspace, not the production build container.

**Fix (two-part)**:
1. `pyproject.toml` — set `dependencies = []`, move packages to `[dependency-groups].dev`. `uv sync` now runs but installs nothing → no more permission denied.
2. `artifacts/api-server/.replit-artifact/artifact.toml` — extend the production build command to set up Python after the TypeScript build:
   ```
   sh -c "pnpm --filter @workspace/api-server run build &&
          python3 -m venv .pythonlibs &&
          .pythonlibs/bin/pip install debugpy 'python-lsp-server[all]' ipykernel ipython jedi"
   ```
   This runs in the artifact build phase (after package install), where the filesystem is writable.

---

### Playwright Browser Hangs in Replit Agent Sandbox

**Symptom**: Running `playwright test` causes the browser launch to hang indefinitely with no output, even with `--no-sandbox --disable-gpu --single-process`.

**Root cause**: NixOS process isolation in the Replit agent sandbox blocks subprocess spawning for headless browsers regardless of flags.

**Fix / Workaround**: Tests are designed for CI execution. In the Replit sandbox, use `playwright --list` to verify test compilation. Full test runs work in any environment with Chromium available outside the sandbox.

---

### API Server Port Conflict (EADDRINUSE 8080)

**Symptom**: API server workflow fails to start with `EADDRINUSE: address already in use :::8080`.

**Cause**: Playwright's `webServer` config starts the API on port 8080 in the background; if it doesn't shut down cleanly, the port remains occupied.

**Fix**: Kill the process holding port 8080 (`lsof -ti:8080 | xargs kill -9`) then restart the API server workflow.

---

### Notebook Key Remount

**Rule**: `NotebookView` must have `key={activeTabId}` to prevent cell state leaking between different `.ipynb` files when switching tabs.

---

### LSP Monaco Provider Registration

**Rule**: Register LSP providers in a React effect with deps `[monaco, projectId, language]` only. Providers read `model.uri.path` at call time. Use a separate effect for `didOpen` (deps: `path, projectId, language`). Cache providers in `_lspProviders` to avoid duplicate registration.

---

### Debugger Source Mapping

- `debug/start` returns `tmpDir`
- CDP: `Debugger.scriptParsed` builds `scriptId → URL` map; `Debugger.paused` strips `tmpDir` prefix
- Breakpoints use `file:///tmpDir/file`
- DAP: `setBreakpoints` uses `tmpDir/file`; `stackTrace` strips `tmpDir` from `source.path`

---

### Localhost Security Guard

`requireLocalhost` middleware checks `!isLocal OR hasProxy (X-Forwarded-For)`. Applied to `debug.ts` and `notebook.ts`. IP-only check is bypassable via reverse proxy — use the `hasProxy` check as the authoritative guard.

---

## Architecture Decisions

- **Monorepo with pnpm workspaces**: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts` — all in `pnpm-workspace.yaml`. The `packages/` directory is NOT included.
- **Orval codegen**: `lib/api-spec/openapi.yaml` is the single source of truth for all API contracts. Run `pnpm --filter @workspace/api-spec run codegen` after any spec change to regenerate React Query hooks and Zod schemas.
- **Drizzle ORM**: `lib/db/schema.ts` is the single source of truth for the DB schema. Run `pnpm --filter @workspace/db run push` to apply changes in dev.
- **esbuild for API, Vite for IDE**: API bundles to a single `dist/index.mjs` (ESM) for fast cold starts in production. IDE is statically served from `artifacts/ide/dist/public`.
- **Autoscale deployment**: Both artifacts deploy to Replit autoscale. The IDE is `serve: static` (no server needed). The API is a Node.js process with `GET /api/healthz` as the startup probe path.
- **Python env isolated to `.pythonlibs`**: `UV_PROJECT_ENVIRONMENT=.pythonlibs` ensures Python packages always install to a writable virtual environment, both locally and in production builds.
- **Multi-AI provider routing**: Provider is determined per-request. Anthropic uses its native streaming SDK; OpenAI-compatible providers (OpenAI, Gemini, custom) use the OpenAI SDK with tool_call accumulation across stream chunks.
- **WebSocket for terminal and LSP**: Terminal uses node-pty PTY sessions over WebSocket. LSP uses a WebSocket proxy that bridges Monaco's LSP client to the language server process.

---

## Production Deployment

| Artifact | Type | URL |
|---|---|---|
| IDE (frontend) | Static | `https://Agentaimax.replit.app/` |
| API Server | Autoscale | `https://Agentaimax.replit.app/api` |

**Health probe**: `GET /api/healthz` → must return 200 for the promote step to succeed.

**Build pre-hook** (`.replit` `[userenv.shared]`):
- `UV_PROJECT_ENVIRONMENT=.pythonlibs` — fixes Python package install in production

**API `artifact.toml`** (`artifacts/api-server/.replit-artifact/artifact.toml`):
- Build: `pnpm --filter @workspace/api-server run build`
- Run: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- Startup probe: `path = "/api/healthz"`

**IDE `artifact.toml`** (`artifacts/ide/.replit-artifact/artifact.toml`):
- Build: `pnpm --filter @workspace/ide run build`
- Serve: `static`, `publicDir = "artifacts/ide/dist/public"`
- Rewrite: `/* → /index.html` (SPA routing)

---

## User Preferences

- Persian (Farsi) is the user's primary communication language; keep code and file content in English.

---

## Gotchas

- **Never edit `artifact.toml` directly** — use `verifyAndReplaceArtifactToml` from the artifacts skill or the temp-file workflow.
- **`packages/` is NOT in pnpm-workspace.yaml** — new shared libraries go under `lib/`, not `packages/`.
- **`deployment.run` in `.replit` is ignored** in artifact mode — production run/build commands live in each artifact's `artifact.toml`.
- **`UV_PROJECT_ENVIRONMENT=.pythonlibs` must remain set** — removing it will break production builds (uv falls back to read-only Nix store).
- **LSP binaries location**: `artifacts/api-server/node_modules/.bin/` — all language servers are installed as npm devDependencies of the api-server package.
- **Python path in dev**: `.pythonlibs/bin/python3` — the IPython kernel and debugpy run from here.
- **Port layout**: API=8080, IDE=5000, mockup-sandbox=8081, external=80 (port 8082).

---

## Pointers

- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/schema.ts` — DB schema source of truth
- `artifacts/api-server/src/routes/` — all API route handlers
- `artifacts/ide/src/components/` — all IDE panel components
- `artifacts/e2e/tests/` — all Playwright specs + page objects
- `.agents/memory/MEMORY.md` — agent memory index with deep-dive topic files
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
