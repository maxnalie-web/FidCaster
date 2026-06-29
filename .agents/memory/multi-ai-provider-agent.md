---
name: Multi-AI provider agent loop
description: How the agent/run endpoint resolves providers, keys, and which loop to use (Anthropic vs OpenAI-compat fetch).
---

## Provider resolution order in `/agent/run`

1. `resolveDefaultModel()` returns env-based default (may be "claude-sonnet-4-5" even with no key).
2. `getProviderForModel(model)` finds env-based provider; `getApiKeyForProvider(provider)` gets its key.
3. If `!apiKey` → query `aiProvidersTable` (Drizzle) for first active DB provider.
4. DB provider overrides `apiKey`, `resolvedModel`, `baseURL`, **and `isAnthropicLike`**.

## Critical: `isAnthropicLike` must be reset in DB fallback

When `envProvider` is Anthropic (detected from default model name) but has no key, `isAnthropicLike = true` is set. The DB fallback MUST set `isAnthropicLike = false` for non-Anthropic DB providers, otherwise the Anthropic SDK runs with a Gemini key → 404.

```typescript
if (dbProvider.provider === "anthropic") {
  isAnthropicLike = true;
} else {
  isAnthropicLike = false;  // ← essential reset
  ...
}
```

## baseURL empty-string trap

`dbProvider.baseURL` is `""` (empty string) when user hasn't set a custom base. Use `||` not `??`:
```typescript
baseURL = dbProvider.baseURL || GEMINI_BASE;  // correct
// NOT: dbProvider.baseURL ?? GEMINI_BASE  ← picks "" over the fallback
```

## runOpenAILoop uses direct fetch, not OpenAI SDK

OpenAI SDK v6 causes 404 against Gemini's OpenAI-compat endpoint (URL construction issue). `runOpenAILoop` now uses `fetch` directly, manually parses SSE stream, accumulates `tool_calls` by index. Signature:
```typescript
runOpenAILoop(apiKey, baseURL, model, systemPrompt, initialPrompt, projectId, projectDir, res, agentRunId, abortCtrl)
```

## Loop selection
- `isAnthropicLike = true` → `runAnthropicLoop` (Anthropic SDK, native streaming)
- `isAnthropicLike = false` → `runOpenAILoop` (fetch, handles Gemini/OpenAI/OpenRouter)

## Model availability
`GET /agent/models` merges `getAllModels()` (env-based) with DB providers (`aiProvidersTable`). A model is `available` if its provider is in env OR in DB.

**Why:** Gemini key is stored in DB (not env), so env-only check leaves all models unavailable. DB merge is needed for correct availability flags.
