---
name: Terminal xterm.js testing
description: How to send commands to the bash shell in E2E tests via the xterm.js terminal component
---

# Terminal xterm.js E2E Testing

## The Problem
Playwright `page.keyboard.type()` and `textarea.focus()` do not reliably send input to xterm.js terminals. The xterm.js `term.input()` method also doesn't trigger `onData` reliably in headless Chromium.

## The Solution
Expose a `__terminalSend` function on `window` in DEV mode from within `ws.onopen` in terminal-panel.tsx. This gives tests direct WebSocket access to the bash shell.

```typescript
// In terminal-panel.tsx ws.onopen:
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__terminalSend =
    (data: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); };
}
```

## Usage in tests
```typescript
await page.waitForFunction(
  () => typeof (window as any).__terminalSend === "function",
  { timeout: 10_000 }
);
await page.evaluate(() => {
  (window as any).__terminalSend("echo hello\n");  // Use \n not \r
});
```

**Why:**
- Terminal backend spawns bash WITHOUT a PTY — bash stdin expects `\n` (LF) not `\r` (CR)
- Without PTY, xterm.js keyboard events don't propagate through the browser focus chain reliably
- The WebSocket is the actual conduit; bypassing xterm event system is more reliable

**How to apply:**
- Use `waitForFunction` to ensure `__terminalSend` is set before calling (set in ws.onopen, not before)
- Always use `\n` for line endings when sending to non-PTY bash stdin
- The ls output in HOME is `workspace` on Replit (not `package/src/index`)
