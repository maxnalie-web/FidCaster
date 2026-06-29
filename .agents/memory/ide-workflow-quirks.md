---
name: DevStation IDE workflow quirks
description: How to start/stop the DevStation IDE (artifacts/ide) — use ONLY the artifact-managed workflow, never create a manual one
---

## The rule
Use ONLY the artifact-managed `artifacts/ide: web` workflow. Do NOT create a manual "DevStation IDE" workflow — doing so causes a port 5000 conflict that kills `artifacts/ide: web`.

**Why:** Both the artifact-managed workflow and any manual workflow run `pnpm --filter @workspace/ide run dev`, which binds to port 5000. If a manual workflow starts first, the artifact-managed one fails with "Port 5000 is already in use". The platform cannot delete artifact-managed workflows via `removeWorkflow`.

**How to apply:**
- To restart the IDE server: `restart_workflow({ name: "artifacts/ide: web" })` — this works fine now
- Do NOT call `configureWorkflow({ name: "DevStation IDE", ... })` — it creates a duplicate that breaks things
- If a manual "DevStation IDE" workflow exists and conflicts: `removeWorkflow({ name: "DevStation IDE" })` then `restart_workflow({ name: "artifacts/ide: web" })`
- Vite config reads `process.env.PORT ?? "5000"` and the artifact.toml sets `PORT = "5000"` in `[services.env]`
- `verifyAndReplaceArtifactToml` requires the artifact to be registered in the platform — if artifact is deregistered, it returns NOT_FOUND
- `createArtifact` at previewPath "/" always returns "Service path conflicts" due to a race condition (bootstrap writes artifact.toml which triggers auto-scan before `createArtifact` validates). This is a platform bug.
