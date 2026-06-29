---
name: WebSocket unmount reconnect race
description: ws.onclose fires async after React cleanup, scheduling reconnect timers on unmounted components
---

## Problem
React's cleanup function closes the WebSocket (`wsRef.current?.close()`). This fires `ws.onclose` **asynchronously** — after the cleanup has already completed. The `onclose` handler then calls `setTimeout(connect, 3000)`, scheduling a reconnect on a component that no longer exists. This causes memory leaks, phantom API calls, and potential state updates on unmounted components.

## Why the clearTimeout in cleanup doesn't help
The cleanup clears `reconnectRef.current` before `onclose` fires. The new timer created by `onclose` is never stored in `reconnectRef` and never cleared.

## Fix
Add an `unmountedRef = useRef(false)`. In the cleanup, set `unmountedRef.current = true` **before** closing the WebSocket. In every reconnect scheduling path (`onclose`, `onerror`, catch blocks), check `if (unmountedRef.current) return` before calling `setTimeout(connect, ...)`.

```typescript
const unmountedRef = useRef(false);

// In cleanup:
return () => {
  unmountedRef.current = true;  // Must be first
  if (reconnectRef.current) clearTimeout(reconnectRef.current);
  wsRef.current?.close();
  // ... other cleanup
};

// In onclose/onerror:
ws.onclose = () => {
  if (unmountedRef.current) return;
  reconnectRef.current = setTimeout(connect, 3000);
};
```

**Why:** React cleanup is synchronous but WebSocket events are asynchronous. Setting the flag before close() ensures any subsequently fired event handlers see it immediately.

**How to apply:** Any component with a WebSocket + auto-reconnect pattern (terminal-panel, debugger-panel, etc.).
