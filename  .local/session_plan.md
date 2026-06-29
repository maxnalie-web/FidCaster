# Objective
Perform an in-depth production-scope security scan of DevStation and report only concrete, exploitable vulnerabilities.

# Relevant information
- Public autoscale deployment with `visibility: public`.
- Multi-user application: authenticated users must not access other users' projects, files, secrets, databases, or execution surfaces.
- Express `requireAuth` protects most `/api` routes, but WebSocket upgrade handlers in `app.ts` and route-specific `attach*WS` functions sit outside normal Express middleware.
- Highest-risk code areas are terminal, debug, LSP, file watcher, secrets, project-scoped DB helpers, run, docker, storage, and agent routes.
- Production-only assumptions: mockup sandbox is not deployed; dev/test-only code is out of scope unless reachable from production.

# Tasks

### T001: Verify cross-tenant access control on project data and helper routes
- **Blocked By**: []
- **Details**:
  - Audit `projects.ts`, `files.ts`, `secrets.ts`, `storage.ts`, `integrations.ts`, and project-scoped DB helper routes.
  - Focus on missing ownership checks, IDOR, and secret/database exposure.
  - Acceptance: Confirm or rule out cross-tenant read/write paths with concrete route and file evidence.

### T002: Verify WebSocket and localhost/proxy trust boundaries
- **Blocked By**: []
- **Details**:
  - Audit `terminal.ts`, `terminal-token.ts`, `lsp.ts`, `filewatcher.ts`, `debug.ts`, `notebook.ts`, and `app.ts` upgrade wiring.
  - Focus on auth bypass, upgrade-handler exposure, reverse-proxy localhost bypasses, and origin weaknesses.
  - Acceptance: Confirm whether public clients can reach WebSocket or localhost-only features in production.

### T003: Verify execution and host-control surfaces
- **Blocked By**: []
- **Details**:
  - Audit `run.ts`, `docker.ts`, `agent.ts`, and any shared helper logic used to materialize files or execute commands.
  - Focus on missing authorization, secret injection to attacker-controlled runs, arbitrary Docker control, and host-impacting actions.
  - Acceptance: Confirm or rule out unauthorized code execution, secret exfiltration, or host-control escalation paths.

### T004: Verify auth/session weaknesses and fallback secrets
- **Blocked By**: []
- **Details**:
  - Audit `auth.ts`, `oauth.ts`, `lib/auth.ts`, and related middleware.
  - Focus on session forgery, unsafe defaults, account confusion, and production-relevant auth weaknesses.
  - Acceptance: Confirm whether authentication can be bypassed or materially weakened in production.
