# Dashboard Code Review: Bug Analysis

**Repository:** `packages/web-ui/dashboard/`
**Analysis Date:** 2024
**Reviewer:** Code Review

---

## Executive Summary

This document catalogs bugs identified during static analysis of the dashboard codebase. Bugs are categorized into three severity tiers:

- **Critical (Tier 1)**: Runtime errors, crashes, data corruption, or security issues
- **Logic/Design (Tier 2)**: Behavioral inconsistencies, incorrect business logic, or state management issues
- **Performance/Maintenance (Tier 3)**: Performance concerns, memory leaks, edge cases, or code smells

---

## Critical Bugs (Tier 1)

### 1. Race Condition in ExecutionLogViewer Auto-Refresh

**File:** `src/components/ExecutionLogViewer.tsx`
**Line:** ~22-34

```typescript
useEffect(() => {
    if (isOpen && planExecId) {
        // ...
        const interval = setInterval(() => {
            fetchExecutionLog(planExecId).then(...)  // <-- Captures stale planExecId
        }, 2000);
        return () => clearInterval(interval);
    }
}, [isOpen, planExecId]);
```

**Issue:** The auto-refresh interval captures `planExecId` in closure. If `planExecId` changes while the modal remains open, the interval continues fetching the OLD planExecId until the component remounts or the modal closes and reopens.

**Fix:** Add `planExecId` to the interval callback or refetch when it changes:

```typescript
useEffect(() => {
    if (isOpen && planExecId) {
        setLoading(true);
        fetchExecutionLog(planExecId).then(...);
        const interval = setInterval(() => fetchExecutionLog(planExecId).then(...), 2000);
        return () => clearInterval(interval);
    }
}, [isOpen, planExecId]);  // planExecId already in deps, but interval doesn't use it
```

**Impact:** Users viewing execution logs may see stale or incorrect content after switching between executions while keeping the viewer open.

---

### 2. Memory Leak in usePlanEvents Reconnection

**File:** `src/hooks/usePlanEvents.ts`
**Line:** ~41-44

```typescript
source.onerror = () => {
    console.error("Plan events SSE error, reconnecting...");
    source.close();
    sourceRef.current = null;
    setTimeout(connect, 5000);  // <-- Never cleared!
};
```

**Issue:** The `setTimeout` for reconnection is never stored in a ref and never cleared in the cleanup function. This causes:
1. Memory leak - the timeout persists after unmount
2. Stale closure - `connect` may reference old props
3. Potential crash - if component unmounts during reconnect attempt

**Fix:** Store timeout in ref and clear in cleanup:

```typescript
const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// In onerror:
reconnectTimerRef.current = setTimeout(connect, 5000);

// In cleanup:
if (reconnectTimerRef.current) {
    clearTimeout(reconnectTimerRef.current);
}
```

---

### 3. Non-Null Assertion Crash in WorkerP6LifecycleTab

**File:** `src/components/WorkerP6LifecycleTab.tsx`
**Lines:** ~220, 229, 237

```typescript
{quarantineState!.reason && (  // <-- Bang operator!
    <p className="text-[10px]...">{quarantineState!.reason}</p>
)}
{quarantineState!.cleanedAt && (
    <p className="text-[10px]...">{formatTs(quarantineState!.cleanedAt)}</p>
)}
{quarantineState!.cleanupPending && !hasCleanup && (  // <-- Bang operator!
    <div>...</div>
)}
```

**Issue:** The component uses non-null assertions (`!`) on `quarantineState` after checking it's not null. However, React's conditional rendering can be tricky - the state could become null between the check and render. Additionally, the hook `useQuarantineState` can return `null` if the API fails, and this is rendered even when `quarantineState != null` condition is met.

**Impact:** If `quarantineState` becomes null unexpectedly (API race condition), the app will crash with "Cannot read property of null".

---

### 4. Inefficient API Polling in useWorkerQueueEntry

**File:** `src/hooks/useScaleStatus.ts`
**Line:** ~125-138

```typescript
export async function fetchWorkerQueueEntry(workspaceId: string): Promise<WorkerQueueEntry> {
    try {
        // We fetch the full queue and filter client-side.
        const queueData = await fetchIntegrationQueue();  // <-- Fetches ALL entries
        const entry = queueData.entries.find((e) => e.workspaceId === workspaceId) ?? null;
        // ...
    }
}
```

**Issue:** For each workspace that needs queue status (polled every 10 seconds via `useWorkerQueueEntry`), the code fetches the ENTIRE integration queue and filters client-side. With many workspaces, this creates:
- Excessive network traffic
- Slow UI updates
- Potential API rate limiting

**Fix:** Add a dedicated endpoint like `/api/scale/integration-queue/workspace/{workspaceId}` that returns a single entry.

---

## Logic/Design Bugs (Tier 2)

### 5. Stale Closure in useWorkerTranscript Reconnection

**File:** `src/hooks/useWorkerTranscript.ts`
**Line:** ~66-73

```typescript
source.onerror = () => {
    setIsConnected(false);
    const msg = "Transcript stream disconnected";
    setError(msg);
    source.close();
    sourceRef.current = null;

    setIsReconnecting(true);
    reconnectTimerRef.current = setTimeout(() => {  // <-- Captures stale planExecId/workspaceId
        reconnectTimerRef.current = null;
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30_000);
        connect();
    }, reconnectDelayRef.current);
};
```

**Issue:** The reconnection callback calls `connect()` but captures the CURRENT values of `planExecId` and `workspaceId` from the closure. If these changed between the initial connection and the error, the reconnection will use stale values.

**Fix:** Use functional update pattern or ensure dependencies are captured correctly:

```typescript
reconnectTimerRef.current = setTimeout(() => {
    reconnectTimerRef.current = null;
    reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30_000);
    // Force re-read from latest props via dependency
    connect();
}, reconnectDelayRef.current);
// Actually, connect IS in the dependency array correctly, but the setTimeout bypasses that
```

**Better Fix:** Use a ref to track current values:

```typescript
const paramsRef = useRef({ planExecId, workspaceId });
paramsRef.current = { planExecId, workspaceId };

// In connect:
const { planExecId: currPlanExecId, workspaceId: currWorkspaceId } = paramsRef.current;
```

---

### 6. LogViewer Scroll State Not Reset on Stream Switch

**File:** `src/components/LogViewer.tsx`
**Line:** ~24-31

```typescript
const userScrolledUpRef = useRef(false);

const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 40;
};
```

**Issue:** When the user switches log streams (e.g., from "raw" to "structured") or changes workers, the `userScrolledUpRef` is never reset. This means:
- If user scrolled up to read old logs, then switched streams, the view might auto-scroll (or not) incorrectly
- The scroll position isn't reset when content changes

**Fix:** Reset the ref when stream or worker changes:

```typescript
useEffect(() => {
    userScrolledUpRef.current = false;
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
}, [activeStream, selectedWorkerId]);
```

---

### 7. PlanSummary Elapsed Time Shows "0s" for Unstarted Plans

**File:** `src/components/PlanSummary.tsx`
**Line:** ~51-58

```typescript
function formatElapsed(state: PlanState): string {
    const now = Date.now();
    const start = state.startedAt ?? now;  // <-- Defaults to now if null
    const end = state.completedAt ?? now;
    const ms = end - start;
    // ...
}
```

**Issue:** If `startedAt` is null (plan hasn't started yet), the function treats it as "now", showing elapsed time as "0h 0m 0s". This is misleading - users cannot distinguish between:
- A plan that just started
- A plan that hasn't started yet

**Fix:** Return a different indicator for unstarted plans:

```typescript
function formatElapsed(state: PlanState): string {
    if (state.startedAt === null) {
        return "Not started";
    }
    // ... rest of logic
}
```

---

### 8. Duplicate Key Warning Risk in LogViewer

**File:** `src/components/LogViewer.tsx`
**Line:** ~74-77

```typescript
{lines.map((line, i) => (
    <div key={i} className="whitespace-pre-wrap break-words">
        {line}
    </div>
))}
```

**Issue:** Using array index (`i`) as key is an anti-pattern when items can be added or removed from the array. When new log lines arrive:
- React may incorrectly reconcile DOM nodes
- Animation or focus state could break
- The "auto-scroll to bottom" behavior may jump unpredictably

**Fix:** Use a stable identifier. Consider adding a unique `id` field to log messages or use the line content + timestamp as a composite key:

```typescript
{lines.map((line, i) => (
    <div key={`${line}-${i}`} className="whitespace-pre-wrap break-words">
        {line}
    </div>
))}
// Or better: have the backend/include backend generate IDs
```

---

## Performance/Maintenance Bugs (Tier 3)

### 9. Exponential Backoff Reset on Every Effect Run

**File:** `src/hooks/useWorkspaceLogStream.ts`
**Line:** ~126-132

```typescript
useEffect(() => {
    // Reset reconnect state when switching workspaces
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
    connectedWsRef.current = null;
    // ...
}, [connect]);
```

**Issue:** The backoff delay is reset to initial value on EVERY effect run, including when dependencies change. This means during transient re-renders (unrelated to workspace changes), the backoff timing is lost. This behaviors defeats the purpose of exponential backoff during connection instability.

**Fix:** Only reset backoff when workspace actually changes:

```typescript
useEffect(() => {
    const hasWorkspaceChanged = connectedWsRef.current !== workspaceId;
    if (hasWorkspaceChanged) {
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        connectedWsRef.current = workspaceId;
    }
    // ...
}, [connect]);  // Or better: include workspaceId directly
```

---

### 10. Unbounded State Growth in useLiveLogTerminal

**File:** `src/hooks/useLiveLogTerminal.ts`
**Line:** ~187-195

```typescript
const addLog = useCallback((workerId: string, channel: LogChannel, text: string) => {
    const id = ++idCounterRef.current;
    const entry: LogEntry = { id, channel, text, timestamp: Date.now(), workerId };
    setLogMap(prev => {
        const existing = prev[workerId] ?? [];
        const updated = [...existing, entry];
        if (updated.length > MAX_LOG_ENTRIES_PER_WORKER) {
            return { ...prev, [workerId]: updated.slice(-MAX_LOG_ENTRIES_PER_WORKER) };
        }
        return { ...prev, [workerId]: updated };
    });
}, []);
```

**Issue:** While there's a cap of 2000 entries per worker, the code:
1. Creates new arrays on every log entry (O(n) copy)
2. Doesn't batch updates - every single log line triggers a re-render
3. During high-throughput phases (many events per second), this causes UI jank

**Fix:** Use a queue with batched updates:

```typescript
const bufferRef = useRef<LogEntry[]>([]);

// Flush buffer periodically (e.g., every 100ms)
useEffect(() => {
    const interval = setInterval(() => {
        if (bufferRef.current.length > 0) {
            setLogMap(prev => {
                // Accumulate buffer into state
                const newEntries = bufferRef.current;
                bufferRef.current = [];
                // Merge into existing state
            });
        }
    }, 100);
    return () => clearInterval(interval);
}, []);
```

---

### 11. No Error Boundary for Component Failures

**Multiple components** lack error boundaries, meaning a single component error can take down the entire dashboard.

**Issue:** Components like `LogViewer`, `WorkerDetail`, `WorkerP6LifecycleTab` make async calls and render dynamic data. A single malformed data point or uncaught exception crashes the whole page.

**Fix:** Wrap critical components with React error boundaries:

```typescript
class LogViewerErrorBoundary extends React.Component {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    render() {
        if (this.state.hasError) {
            return <div>Log viewer failed. <button onClick={() => this.setState({hasError: false})}>Retry</button></div>;
        }
        return this.props.children;
    }
}
```

---

### 12. Missing Type Safety for API Responses

**Multiple files** - API fetch functions don't validate response shapes.

**Example:** `src/hooks/useScaleStatus.ts` line ~53

```typescript
async function fetchIntegrationQueue(): Promise<IntegrationQueueStatus> {
    const res = await fetch(`${API_BASE}/api/scale/integration-queue`);
    if (!res.ok) {
        // Returns partial/default object, masking errors
        return { /* ... */ };
    }
    return res.json();  // No runtime validation!
}
```

**Issue:** If the API returns an unexpected shape, the app fails silently or with cryptic errors. TypeScript only checks at compile time.

**Fix:** Add runtime validation (e.g., zod):

```typescript
import { z } from "zod";
const QueueSchema = z.object({
    isProcessing: z.boolean(),
    entries: z.array(QueueEntrySchema),
    // ...
});
// Then: QueueSchema.parse(await res.json())
```

---

### 13. Hardcoded Empty String for API_BASE

**Multiple files** - `const API_BASE = "";` appears in many hooks and components.

**Issue:** While this works in some deployment scenarios (same-origin API), it:
- Makes local development harder
- Doesn't support API prefix configuration
- Creates inconsistent behavior across different deployment modes

**Fix:** Use environment variable or centralized config:

```typescript
const API_BASE = import.meta.env.VITE_API_BASE || "";
// Or centralized:
import { API_BASE } from "../config";
```

---

## Summary Table

| # | Category | File | Severity | Description |
|---|----------|------|----------|-------------|
| 1 | Critical | ExecutionLogViewer.tsx | High | Stale closure in auto-refresh interval |
| 2 | Critical | usePlanEvents.ts | High | Memory leak from uncleared setTimeout |
| 3 | Critical | WorkerP6LifecycleTab.tsx | High | Non-null assertion crash risk |
| 4 | Critical | useScaleStatus.ts | Medium | Inefficient full-queue fetch per workspace |
| 5 | Logic | useWorkerTranscript.ts | Medium | Stale closure in reconnect callback |
| 6 | Logic | LogViewer.tsx | Medium | Scroll state not reset on stream switch |
| 7 | Logic | PlanSummary.tsx | Low | Misleading elapsed time for unstarted plans |
| 8 | Logic | LogViewer.tsx | Low | Using array index as key |
| 9 | Perf | useWorkspaceLogStream.ts | Low | Backoff reset on every effect run |
| 10 | Perf | useLiveLogTerminal.ts | Medium | Unbounded re-renders on high log volume |
| 11 | Perf | Multiple | Medium | No error boundaries |
| 12 | Perf | Multiple | Low | No runtime API response validation |
| 13 | Main. | Multiple | Low | Hardcoded empty API_BASE |

---

## Recommendations

1. **Immediate (Critical):** Fix items 1-4 - these can cause runtime failures or data issues
2. **Short-term:** Fix items 5-8 - these cause incorrect behavior or confusion
3. **Long-term:** Fix items 9-13 - these are maintenance/code quality improvements

**Priority Order:** 1, 2, 3, 4, 5, 6, 10, 7, 8, 9, 11, 12, 13
