---
name: E2E Remaining Bugs
description: Known failing/unverified Playwright tests in artifacts/e2e after the session fixes
---

## Confirmed Bugs

### git.spec.ts — tests 2 & 3
`getByRole('button', { name: 'history' })` matches TWO elements:
- Activity bar "History" button (title attribute)
- Git panel tab ("history" lowercase)

Fix: add `{ exact: true }` to all three: `getByRole("button", { name: "history", exact: true })` etc.
Same applies to "branches" and "changes" if they collide.

### editor.spec.ts — test 5 ("creating a new file")
Hangs beyond 50 seconds. Likely the file-creation UI interaction is slow or stuck.
Tests 6-8 not yet verified.

## Unverified Specs (never run in this session)
- `api-tester.spec.ts` — 9 tests, looks reasonable but not confirmed
- `snippets.spec.ts` — unknown count, not confirmed
- `time-tracker.spec.ts` — 5 tests, not confirmed

## Verified-passing specs
- `dashboard.spec.ts` (8 tests) ✅
- `settings.spec.ts` (11 tests) ✅
- `editor.spec.ts` tests 1-4 ✅
- `terminal.spec.ts` (4 tests) — defensive if-isVisible guards, expected to pass
- `todos.spec.ts` (3 tests) — defensive guards, expected to pass

## Other Non-E2E Issues Found
- `plan-preview` and `agent/plan` endpoints ONLY use Anthropic API key (hardcoded env check).
  If user configures only OpenAI/Gemini in Settings → AI, plan generation 402s even though agent/run works.
- Python dev tools (debugpy, pylsp, ipykernel) exist only in .pythonlibs from prior install.
  Removed from pyproject.toml to fix deploy; fresh clones won't have them auto-installed.
- artifact.toml for api-server has previewPath = "/api" # TODO — API shows in preview dropdown unnecessarily.

**Why:** Saving to avoid re-discovering these in future sessions.
