# Web Server Code Review: Bug Analysis

**Repository:** `packages/web-server/`
**Analysis Date:** 2024
**Reviewer:** Code Review

---

## Executive Summary

This document catalogs bugs identified during static analysis of the web-server codebase (TypeScript/Node.js). Bugs are categorized into three severity tiers:

- **Critical (Tier 1)**: Runtime errors, crashes, data corruption, or security issues
- **Logic/Design (Tier 2)**: Behavioral inconsistencies, incorrect business logic, or state management issues
- **Performance/Maintenance (Tier 3)**: Performance concerns, memory leaks, edge cases, or code smells

---

## Critical Bugs (Tier 1) — Security & Crash Risks

### 1. Worktree Name Not Validated in DELETE Endpoint

**File:** `src/scale-routes.ts`
**Line:** ~940

```typescript
fastify.delete<{ Params: { worktreeName: string } }>(
    "/api/scale/worktrees/:worktreeName",
    async (request, reply) => {
        const { worktreeName } = request.params;
        // ...
        const target = worktrees.find(
            (wt) => wt.name === worktreeName && wt.path !== workspaceRoot
        );
        // Then: await execAsync(`git worktree remove "${wt.path}"`)
```

**Issue:** The `worktreeName` parameter from the URL is used directly without validation. Although there's a `validatePathComponent` function in log-stream-routes, it's NOT used here. A malicious request could potentially pass path separators or traversal sequences.

**Fix:** Apply the same validation used in log-stream-routes:

```typescript
import { validatePathComponent } from "./log-stream-routes.js";

// In handler:
validatePathComponent("worktreeName", worktreeName);
```

---

### 2. Global Mutable State in Orchestrator Routes

**File:** `src/orchestrator-routes.ts`
**Lines:** ~72-78

```typescript
let _piDir = "";

function getPiDir(): string {
    return _piDir;
}

function setPiDir(dir: string): void {
    _piDir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
```

**Issue:** Uses module-level mutable global state (`_piDir`). This causes problems:
- Makes testing difficult (global state pollution between tests)
- Race conditions in concurrent requests
- Difficult to reason about during debugging

**Fix:** Use dependency injection or a closure-based approach:

```typescript
interface OrchestratorDeps {
    piDir: string;
    workspaceRoot: string;
}

function createOrchestratorRoutes(deps: OrchestratorDeps) {
    return function registerRoutes(fastify: FastifyInstance) {
        // Use deps.piDir instead of global _piDir
    };
}
```

---

### 3. File Path Traversal Risk in Proposal Routes

**File:** `src/proposal-routes.ts`
**Lines:** ~105-120

```typescript
async function loadProposalsFromFile(piDir: string): Promise<ProposalResponse[]> {
    const proposalsFile = join(piDir, "proposals", "index.json");
    // The piDir comes from settings, but there's no validation
}

function setPiDir(dir: string): void {  // Same pattern as orchestrator
    _piDir = dir;
}
```

**Issue:** The `setPiDir` function accepts any path without validation. Combined with the global state issue, this could lead to directory traversal if an attacker can influence the value.

**Fix:** Validate the path is within expected workspace:

```typescript
function setPiDir(dir: string): void {
    const resolved = resolve(dir);
    // Ensure it's within the workspace root
    if (!resolved.startsWith(resolve(process.cwd()))) {
        throw new Error("Invalid pi directory");
    }
    _piDir = dir;
}
```

---

### 4. SQL Injection Risk in Proposal Routes (DB Backend)

**File:** `src/proposal-routes.ts`
**Lines:** ~133-147

```typescript
async function loadProposalsFromDb(filter?: ProposalQueryParams): Promise<ProposalResponse[]> {
    // ...
    const dbFilter: { status?: string; phase?: string; limit?: number; offset?: number } = {};
    if (filter?.status) dbFilter.status = filter.status;
    if (filter?.phase) dbFilter.phase = filter.phase;
    // ...
}
```

**Issue:** While this appears to use a parameterized approach, filter values come directly from query params without sanitization. If the repository doesn't validate these values, it could lead to SQL issues. More importantly, there's **no validation** that `limit` and `offset` are within reasonable bounds.

**Fix:** Add explicit validation:

```typescript
const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 1000);
const offset = Math.max(filter?.offset ?? 0, 0);
const dbFilter = {
    status: filter?.status,
    phase: filter?.phase,
    limit,
    offset,
};
```

---

## Logic/Design Bugs (Tier 2)

### 5. Cycle Detection Doesn't Return Complete Cycle Path

**File:** `src/plan-preview.ts`
**Lines:** ~107-135

```typescript
function dfs(nodeId: string): boolean {
    // ...
    if (neighborState === 1) {
        // Cycle found
        const _cycleStart = path.indexOf(neighbor);
        return true;  // <-- Returns true but _cycleStart is never used!
    }
    // ...
}
```

**Issue:** When a cycle is detected, the function returns `true` but the cycle information is lost. The `_cycleStart` variable is computed but never used. Later code tries to extract the cycle but it's empty.

**Fix:** Return the actual cycle path:

```typescript
if (neighborState === 1) {
    const cycleStart = path.indexOf(neighbor);
    const cycle = path.slice(cycleStart);
    cycle.push(neighbor);  // Complete the cycle
    return { hasCycle: true, cycle };
}
```

Then update the return type accordingly.

---

### 6. Inconsistent Error Handling in Scale Routes

**File:** `src/scale-routes.ts`
**Lines:** ~686-700, 720-735

```typescript
// Route A: Returns error object inside return
return reply.code(500).send({
    error: "Failed to get worktree list",
    message: String(error),
});

// Route B: Throws error (will be caught by Fastify)
throw error;
```

**Issue:** Error handling is inconsistent across routes. Some return proper error responses, others throw. This leads to:
- Inconsistent error formatting to clients
- Some errors may leak stack traces in production

**Fix:** Standardize error handling in a utility function:

```typescript
function handleRouteError(fastify: FastifyInstance, error: unknown, reply: FastifyReply, context: string) {
    fastify.log.error({ error }, context);
    return reply.code(500).send({
        error: context,
        message: String(error),
    });
}
```

---

### 7. WorkspaceCompletionBus Race Condition

**File:** `src/plan-runner.ts`
**Lines:** ~85-130

```typescript
class WorkspaceCompletionBus extends EventEmitter {
    async nextCompletion(): Promise<WorkspaceCompletionSignal> {
        if (this.lastSignal !== null) {
            const signal = this.lastSignal;
            this.lastSignal = null;  // <-- Race: another signal could arrive between check and null
            return signal;
        }
        return new Promise((resolve) => {
            this.pendingNext = { resolve };
        });
    }

    signalCompletion(): void {
        if (this.pendingNext) {
            // resolve immediately
        } else {
            this.lastSignal = WorkspaceCompletionSignal.complete();
            // <-- Race: nextCompletion might have just checked lastSignal and failed
        }
    }
}
```

**Issue:** There's a race condition between checking `lastSignal` and setting it to null. If `signalCompletion()` is called between the null check and the null assignment in `nextCompletion()`, the signal could be lost.

**Fix:** Use a lock/mutex pattern:

```typescript
private signalLock = false;

async nextCompletion(): Promise<WorkspaceCompletionSignal> {
    while (this.signalLock) {
        await new Promise(r => setTimeout(r, 10));
    }
    // ... rest
}
```

---

### 8. Hardcoded Git Timeout in index.ts

**File:** `src/index.ts`
**Lines:** ~88-113

```typescript
function getGitInfo(workspaceRoot: string) {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: workspaceRoot,
        encoding: "utf-8",
        timeout: 2000,  // Hardcoded
        stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // ... similar for status and log
}
```

**Issue:** Multiple synchronous git calls with hardcoded 2-second timeouts. On slow filesystems or repositories with large histories, these will timeout more often than needed. Each call also spawns a new process.

**Fix:** Make timeouts configurable and increase for larger repos:

```typescript
const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS) || 5000;

// Also consider batching: git ForEachRef instead of multiple commands
```

---

## Performance/Maintenance Bugs (Tier 3)

### 9. Memory Leak: Cleanup Timers Not Cleared on Server Shutdown

**File:** `src/plan-runner.ts`
**Lines:** ~58-62

```typescript
const cleanupTimers = new Map<string, NodeJS.Timeout>();

// Timers are set but never cleared on server shutdown
// If the server is stopped, these setTimeout references keep the event loop alive
```

**Issue:** When executions complete, cleanup timers are set but there's no graceful shutdown handler to clear them. This can cause:
- Memory leaks during long-running server sessions
- Delayed shutdown
- Tests may hang

**Fix:** Add a shutdown handler:

```typescript
process.on("beforeExit", () => {
    for (const timer of cleanupTimers.values()) {
        clearTimeout(timer);
    }
    cleanupTimers.clear();
});
```

---

### 10. Duplicate Git Executions in scale-routes

**File:** `src/scale-routes.ts`
**Lines:** ~698-708

```typescript
fastify.get("/api/scale/worktrees", async (_request, reply) => {
    const { stdout } = await execAsync("git worktree list", { cwd: workspaceRoot });
    const worktrees = parseGitWorktreeList(stdout);
    
    // Then for EACH worktree, run another git command
    for (const wt of worktrees) {
        const { stdout: statusOut } = await execAsync("git status --porcelain", {
            cwd: wt.path,  // N+1 problem!
        });
    }
});
```

**Issue:** For each worktree, a separate `git status` command is executed. With 10 worktrees, that's 11 separate git process invocations. This is an N+1 problem.

**Fix:** Batch into one command:

```typescript
// Get all worktree roots and run once
const worktreeRoots = worktrees.map(wt => wt.path).join(" ");
const { stdout } = await execAsync(`git -C "${workspaceRoot}" status --porcelain --short ${worktreeRoots}`);
// Then parse output to associate with each worktree
```

---

### 11. No Input Validation for Plan Queue Operations

**File:** `src/index.ts` (plan queue endpoints)
**Lines:** ~500+ (various queue endpoints)

```typescript
fastify.post("/api/projects/:projectId/queue/enqueue", async (request, reply) => {
    const { plans } = request.body as { plans: Array<...> };
    // No validation that plans is an array, has elements, elements have required fields
});
```

**Issue:** Request body is cast without validation. Missing/null `plans` will cause cryptic errors somewhere downstream.

**Fix:** Add runtime validation:

```typescript
const plans = request.body?.plans;
if (!Array.isArray(plans) || plans.length === 0) {
    return reply.code(400).send({ error: "plans must be a non-empty array" });
}
for (const plan of plans) {
    if (!plan.planContent || typeof plan.planContent !== "string") {
        return reply.code(400).send({ error: "Each plan must have planContent string" });
    }
}
```

---

### 12. Read Race Condition in Plan Queue

**File:** `src/index.ts` (queue endpoints)
**Lines:** ~various

```typescript
// GET /api/projects/:projectId/queue
// POST /api/projects/:projectId/queue/enqueue
// POST /api/projects/:projectId/queue/reorder

// All these read/write the same JSON file with no locking mechanism
```

**Issue:** Multiple concurrent requests can read/write the queue file simultaneously without any file locking. This can lead to lost updates.

**Fix:** Use a file lock or atomic writes:

```typescript
import { lock } from "proper-lockfile";

async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockFile = join(piDir, "queue.lock");
    const release = await lock(lockFile, { retries: 3 });
    try {
        return await fn();
    } finally {
        release();
    }
}
```

---

### 13. Silent Failure in Proposal Routes

**File:** `src/proposal-routes.ts`
**Lines:** ~132-147, ~161-180

```typescript
} catch (error) {
    console.error("[proposal-routes] DB load error:", error);
    return [];  // <-- Silent failure - client gets no indication of error
}
```

**Issue:** Database errors are caught and logged but the client receives an empty array as if there were no proposals. This makes it impossible to distinguish between "no proposals" and "database error".

**Fix:** Return error information:

```typescript
} catch (error) {
    return {
        error: "Database error",
        message: String(error),
        proposals: []  // Include both error and fallback data
    };
}
```

Or throw to let Fastify error handler deal with it.

---

### 14. Unused Variable in Cycle Detection

**File:** `src/plan-preview.ts`
**Line:** ~119

```typescript
const _cycleStart = path.indexOf(neighbor);  // Underscore prefix but still computed
```

**Issue:** Variable is computed but never used, indicating incomplete implementation. The underscore convention typically means "intentionally unused" but this appears to be a mistake.

**Fix:** Either use it or remove it based on intended behavior.

---

### 15. No Rate Limiting on API Endpoints

**Multiple files** - No rate limiting on any endpoints.

**Issue:** API endpoints are vulnerable to:
- DoS attacks
- Resource exhaustion from repeated requests
- Brute force on sensitive operations

**Fix:** Add rate limiting:

```typescript
import rateLimit from "@fastify/rate-limit";

await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "minute",
    allowList: ["/health"],  // Exempt health check
});
```

---

## Summary Table

| # | Category | File | Severity | Description |
|---|----------|------|----------|-------------|
| 1 | Security | scale-routes.ts | **Critical** | Worktree name not validated before use in shell command |
| 2 | Design | orchestrator-routes.ts | High | Global mutable state via module-level `_piDir` |
| 3 | Security | proposal-routes.ts | High | Path validation missing in `setPiDir` |
| 4 | Security | proposal-routes.ts | Medium | No bounds checking on limit/offset params |
| 5 | Logic | plan-preview.ts | High | Cycle detection loses cycle path information |
| 6 | Logic | scale-routes.ts | Medium | Inconsistent error handling patterns |
| 7 | Logic | plan-runner.ts | Medium | Race condition in WorkspaceCompletionBus |
| 8 | Perf | index.ts | Low | Hardcoded git timeouts, multiple process spawns |
| 9 | Perf | plan-runner.ts | Medium | Cleanup timers not cleared on shutdown |
| 10 | Perf | scale-routes.ts | Medium | N+1 git execution pattern |
| 11 | Logic | index.ts | Medium | No validation on queue request bodies |
| 12 | Logic | index.ts | Medium | No file locking on queue operations |
| 13 | Logic | proposal-routes.ts | Medium | Silent failures return empty instead of error |
| 14 | Code | plan-preview.ts | Low | Unused variable indicates incomplete code |
| 15 | Security | Multiple | Medium | No rate limiting on API endpoints |

---

## Recommendations

1. **Immediate (Critical):** Fix items 1, 2, 3 - security vulnerabilities
2. **Short-term:** Fix items 4, 5, 6, 7 - logic/logic issues causing data problems
3. **Medium-term:** Fix items 8-13 - performance and robustness improvements
4. **Long-term:** Fix items 14, 15 - code quality and defense in depth

**Priority Order:** 1, 3, 2, 5, 7, 6, 11, 12, 4, 8, 10, 9, 13, 15, 14
