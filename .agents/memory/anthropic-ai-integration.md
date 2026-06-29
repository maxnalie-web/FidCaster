---
name: Anthropic AI integration
description: Anthropic AI integration status and fallback approach for DevStation IDE
---

# Anthropic AI Integration

## Rule
Do NOT attempt setupReplitAIIntegrations for Anthropic — it fails with `awaiting_phone_verification`. Use user's own ANTHROPIC_API_KEY env var instead.

**Why:** Replit's phone verification requirement blocks the Anthropic integration provisioning. The user explicitly said they'll add the API key later ("بعدا api میزارم").

**How to apply:**
- Backend `/api/ai/chat` reads `process.env.ANTHROPIC_API_KEY` (or `AI_INTEGRATIONS_ANTHROPIC_API_KEY` as fallback)
- If not set, returns HTTP 402 with a helpful message
- Frontend shows graceful "add API key in Settings" message when 402 received
- User sets `ANTHROPIC_API_KEY` in Replit Secrets when ready
