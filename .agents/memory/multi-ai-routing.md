---
name: Multi-AI provider routing
description: How DevStation routes AI chat to different providers; fallback behavior; DB schema and API shape.
---

# Multi-AI Provider Routing

## Rule
`artifacts/api-server/src/lib/aiClient.ts` is the single place all AI calls go through.
- Reads active provider from `ai_providers` table (isActive=true).
- If no active DB provider, falls back to env `ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY`.
- `provider` column determines routing: `anthropic` → Anthropic SDK streaming; `openai`/`gemini`/`custom` → fetch to OpenAI-compat `/v1/chat/completions`.

## DB table: ai_providers
Columns: id, label, provider, api_key, base_url, default_model, is_active.
Only one row should have is_active=true (activate endpoint deactivates all others first).

## API endpoints (settings-ai.ts)
- GET /api/settings/ai-providers — returns masked apiKeys (•••)
- POST /api/settings/ai-providers — create (requireLocalhost)
- PUT /api/settings/ai-providers/:id — update (only updates apiKey if not masked)
- DELETE /api/settings/ai-providers/:id
- POST /api/settings/ai-providers/:id/activate — sets isActive=true, others false
- POST /api/settings/ai-providers/:id/test — temporarily activates provider, sends one test message

## Validation panel
Routes: GET/POST /api/projects/:id/validate/configs, PATCH/DELETE /:configId, POST /validate/run.
Run writes project files to /tmp, runs commands in parallel (60s timeout), returns {results, summary}.
Frontend: validation-panel.tsx — ShieldCheck icon in IDE toolbar opens it as right panel.

**Why:**
Single aiClient.ts makes it trivial to add new providers and keeps all streaming logic in one place.
The masked-key pattern prevents leaking credentials through the settings GET endpoint.
