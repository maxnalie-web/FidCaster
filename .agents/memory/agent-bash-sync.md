---
name: Agent bash-file sync gap
description: Why agent tasks completed with 0 files — bash writes to tmpdir but never sync'd to DB
---

## The Rule
After every `bash` tool call, scan the project tmpdir and sync any new/changed files to the database. Never rely solely on `str_replace_editor` for file persistence.

## Why
The `bash` tool in `executeAgentTool` (agent.ts) runs commands in `/tmp/devstation-agent-{projectId}/`. When the agent uses `echo`, heredocs, or any other shell file-write, those files land on disk. But `syncFileFromDir` was only called from the `str_replace_editor` handler — the bash handler had no post-execution file scan. Non-Anthropic models (gpt-4.1-nano via FreeLLM/GitHub Models) routinely ignore the "use str_replace_editor" instruction and write files via bash. Result: files exist in tmpdir, DB is empty, IDE shows nothing, agent reports "Completed."

Secondary cause: `MAX_ITERATIONS = 8` — a real build task (install + 3 files + verify + fix) needs ≥7 iterations minimum.

## How to Apply
- `syncNewFilesFromDir(projectId, dir)` walks tmpdir recursively, skips `node_modules/.git/__pycache__/dist/build/...`, reads each file, compares MD5 hash against `fileSyncHashes` cache, calls `syncFileFromDir` only on changed files.
- Call it: (1) after every bash command in the tool handler, (2) before `agent_done` in both Anthropic and OpenAI loop terminators, (3) in the `/agent/run` finally block as a hard safety net.
- `MAX_ITERATIONS` = 25 in both `runAnthropicLoop` and `runOpenAILoop`.
- FreeLLM gateway returns HTTP 413 for large payloads (system prompt + tools too large for GitHub Models gpt-4.1-nano). It falls through to static providers. This is expected behavior — the gateway's fallback chain handles it.
