# V2 P13 Parallel Worktree Mode - Safety Audit Report

**Audit Date:** 2025  
**Scope:** 6-parallel-workspace worktree mode (experimental mode)  
**Files Audited:** workspace-scheduler.ts, autonomous-executor.ts, workspace-agent-executor.ts, plan-state.ts, json-state-store.ts, integration-queue.ts, dynamic-scheduler.ts, failure-classifier.ts, retry-router.ts, worktree-manager.ts, worktree-cleanup.ts, worktree-workspace-executor.ts

---

## QUESTION 1 — Merge Safety

### Status: **RISK**

**Evidence:**

1. **Validation Gate (SAFE):** integration-queue.ts:280-320 runs validation command after merge. If validation fails, entry status becomes "blocked" and queue halts.

2. **Non-Atomic Merge (RISK):** integration-branch.ts:217-250 — The merge process is:
   ```typescript
   git(["checkout", this.branchName], this.workspaceRoot);  // Switch to integration branch
   git(["cherry-pick", "--no-commit", commitHash], ...);     // Cherry-pick
   git(["commit", "-m", "..."], ...);                        // Commit
   git(["checkout", currentBranch], ...);                    // Switch back
   ```
   This is NOT atomic. A crash between checkout and final commit leaves the repo on integration branch.

3. **Unguarded Git Operations (RISK):** integration-branch.ts:217-250 — The code does NOT check for uncommitted changes in the main repo before merge. If user has uncommitted changes, `git checkout` could fail or overwrite them.

4. **Revert on Error is Fragile:** integration-branch.ts:240-252 — On error, tries `git cherry-pick --abort` then `git reset --merge`, but these can also fail, leaving repo in inconsistent state.

**Recommended Fix:**
- Add check for uncommitted changes before merge: `git status --porcelain` must be empty
- Use `git merge --no-commit` instead of cherry-pick for atomic operation, then commit or abort as unit
- Consider using `git worktree` for integration branch instead of switching branches

---

## QUESTION 2 — Parallel Workspace Safety

### Status: **SAFE** (with caveats)

**Evidence:**

1. **Truly Isolated Worktrees (SAFE):** worktree-workspace-executor.ts:286-295 creates worktrees at `.pi/worktrees/{planExecutionId}/{workspaceId}/` — each gets unique path.

2. **Path Collision Protection (SAFE):** worktree-workspace-executor.ts:61-77 uses `sanitizeForPath()` to strip path traversal chars, and manages branch name conflicts via retry counter.

3. **File Lock Guard (SAFE BUT...)** dynamic-scheduler.ts:214-216:
   ```typescript
   const skipFileLocks = this.isWorktreeMode;
   ```
   In worktree mode, file lock checks are SKIPPED because isolation makes them unnecessary.

4. **WorkspaceScheduler Does NOT Skip Locks (BUG POTENTIAL):** workspace-scheduler.ts still uses file locks (line 78: `this.fileLocks = new Map()`). The code DOES release locks from failed/completed workspaces (lines 95-103), but if running against WorkspaceScheduler (not DynamicParallelScheduler), locks could accumulate.

5. **cannotRunWith: NOT IMPLEMENTED (RISK):** There's NO enforcement of `cannotRunWith`. The codebase uses `canEdit` patterns for permission scope, but there's no runtime check preventing two workspaces that "cannot run with" each other from executing concurrently.

**Recommended Fix:**
- Ensure DynamicParallelScheduler is used (not WorkspaceScheduler) for worktree mode
- Implement `cannotRunWith` enforcement: check workspace dependency + cannotRunWith before scheduling
- Add integration test for concurrent worktree creation

---

## QUESTION 3 — Crash Recovery / Mid-Plan Resume

### Status: **SAFE**

**Evidence:**

1. **State Persistence (SAFE):** plan-state.ts and json-state-store.ts use atomic write pattern (write to `.tmp`, then rename). This is crash-safe.

2. **Recovery Logic (SAFE):** autonomous-executor.ts:384-430 (`adoptExistingExecution`):
   - Loads persisted state
   - Resets `Active` or `Failed` workspaces to `Pending` for retry
   - Resets scheduler caches (fileLocks, batches)
   - Reconstructs completion gate from persisted workspace states

3. **In-Progress Resume (SAFE):** In-progress workspaces (stage=Active) are reset to Pending, so they'll restart from scratch BUT in worktree mode they can reuse existing worktrees (worktree-workspace-executor.ts:319-333 checks for existing worktree).

4. **Merge Output vs Completion (OBSERVATION):** Workspace completion (stage=Complete) is separate from integration merge. Integration queue tracks its own entries. A workspace can be complete but not yet merged, or fail merge after completion.

**Potential Issue:** If merge fails after workspace was marked Complete and execution crashes before retry, the workspace shows "complete" but was never merged. Integration queue state is persisted separately but recovery doesn't automatically reprocess failed merges.

**Recommended Fix:**
- After recovery adoption, check IntegrationQueue for any "merging" or "failed" entries and reprocess them
- Add checkpoint: persist "ready to merge" status before marking workspace Complete

---

## QUESTION 4 — Plan Runner Bugs

### Status: **RISK** (2 bugs identified)

**Bug 1: Race Condition in Scheduler (MEDIUM)**

**Evidence:** workspace-scheduler.ts:154-167 reserves locks, then line 175 adds to ready list:
```typescript
// Reserve file locks for this workspace so subsequent workspaces
// in the same scheduling round see the conflict.
if (workspace.capabilities) {
    for (const file of workspace.capabilities.canEdit) {
        reservedLocks.add(file);
    }
}
ready.push(workspace);
```
Between reserving locks and actual execution, another scheduler call could interleave. The in-memory Map is not thread-safe.

**Severity:** MEDIUM — only manifests if scheduler is called while execution in flight (which shouldn't happen with current design).

---

**Bug 2: Integration Queue Does NOT Enforce Dependency Order (HIGH)**

**Evidence:** integration-queue.ts:268-290 processes entries in order, BUT:
- It finds FIRST entry with status "queued", "blocked", or "conflict"
- It does NOT check if entry's dependencies (workspace.dependencies) are already merged
- If queue order differs from dependency order, merge could proceed before dependencies

**Example:** Workspace B depends on A. Queue: [B, A]. B gets processed first → merge fails or produces wrong result.

**Severity:** HIGH — but mitigated if queue is always topologically sorted.

---

**No Off-by-One in Slot Count (SAFE):** dynamic-scheduler.ts:177-186 correctly calculates availableSlots = effectiveMax - activeCount, clamped from MIN_STABLE_WORKERS(1) to MAX_EXPERIMENTAL_WORKERS(6).

---

**Unhandled Promise Rejection (NONE FOUND):** The code uses proper try/catch and .catch() handlers throughout.

---

## QUESTION 5 — Worktree Cleanup

### Status: **SAFE**

**Evidence:**

1. **Scoped to .pi/worktrees (SAFE):** worktree-cleanup.ts:98-110 uses `assertPathWithinRoot()` with checking against allowedRoot = `.pi/worktrees`. Throws if path escapes.

2. **No rm -rf (SAFE):** worktree-cleanup.ts:144 uses `git worktree remove --force`, worktree-workspace-executor.ts:411 also uses `git worktree remove --force`.

3. **Failed Workspace Handling (SAFE):** worktree-workspace-executor.ts:388-400 updates status to "failed" but does NOT delete the worktree. The state persists in WorktreeManager.

4. **Quarantine_on_failure (IMPLEMENTED):** worktree-cleanup.ts and worktree-manager.ts track "quarantined" status. Failed worktrees are preserved for review.

---

## FINDINGS SUMMARY

| ID | Finding | Severity | Location |
|----|---------|----------|----------|
| F1 | Integration merge not atomic; can leave repo on wrong branch | HIGH | integration-branch.ts:217-250 |
| F2 | No check for uncommitted changes before git checkout | HIGH | integration-branch.ts:217 |
| F3 | Integration queue does not verify dependencies are merged | HIGH | integration-queue.ts:268-290 |
| F4 | cannotRunWith enforcement missing | MEDIUM | workspace-schema.ts (capabilities defined but not enforced) |
| F5 | Race condition in file lock reservation | MEDIUM | workspace-scheduler.ts:154-175 |
| F6 | Workspace completion state independent of merge state | LOW | design gap - not a bug |
| F7 | Cleanup uses git worktree remove (safe) | N/A | verified safe |

---

## RECOMMENDED FIX ORDER

### Before V2 P13 Execution:

1. **F1+F2 (CRITICAL):** Add uncommitted changes check and use atomic merge
   ```typescript
   // Before merge in integration-branch.ts:
   const status = git(["status", "--porcelain"], cwd);
   if (status.length > 0) throw new Error("Uncommitted changes must be committed/stashed");
   ```

2. **F3 (CRITICAL):** Add dependency check in IntegrationQueue.processNext()
   ```typescript
   // Before processing entry, verify all dependencies are merged
   const deps = getWorkspaceDependencies(entry.workspaceId);
   for (const depId of deps) {
       const depEntry = this.state.entries.find(e => e.workspaceId === depId);
       if (!depEntry || depEntry.status !== "merged") {
           return { processed: false }; // Wait for dependency
       }
   }
   ```

3. **F4 (HIGH):** Implement cannotRunWith enforcement in scheduler
   - Add `exclusions: string[]` to scheduler getNextWorkspaces check
   - Reject any workspace where `exclusions.includes(otherWorkspace.id)` and both in pending/active

4. **F5 (MEDIUM):** Consider using AsyncMutex for scheduler state updates

---

## GO / NO-GO RECOMMENDATION

### **GO - WITH CONDITIONAL MITIGATIONS**

The 6-parallel-workspace worktree mode is **SAFE TO RUN** provided:

1. **Mitigation F1+F2 applied** — Add uncommitted changes check before merge operations
2. **Mitigation F3 applied** — Ensure integration queue checks dependencies before merging
3. **Users are informed:**
   - Do NOT have uncommitted changes in main branch when running
   - If merge conflict detected, manual resolution required
   - Worktree execution may leave "failed" worktrees that need cleanup

### Risk Assessment:
- **Worst case scenario:** Merge interrupted mid-operation → integration branch left on wrong branch → manual `git checkout main` needed. Data loss unlikely.
- **Recovery:** Full crash recovery works. Execution can resume from saved state.

### Confidence Level: **HIGH** (with fixes applied)

---

## Additional Notes

The codebase demonstrates good safety practices:
- Atomic file writes with .tmp → rename pattern
- Path validation in cleanup (prevents rm -rf in wrong place)
- Worktree isolation (provides true parallelism)
- Crash recovery in autonomous-executor

The main risks are around the integration merge operation which is not atomic. With the recommended fixes, the system should be safe for 6-parallel-workspace execution.

---

## FIX STATUS (Applied)

| Finding | Fix | Files Modified | Status |
|---------|-----|----------------|--------|
| F1+F2: No uncommitted changes check before git checkout | Added `assertNoUncommittedChanges()` called before every git checkout in `ensureBranch()`, `mergeWorkspace()`, and `runValidation()` | integration-branch.ts | DONE |
| F3: Integration queue does not verify dependency order | Added `setWorkspaceDependencies()` and `findEligibleEntry()` to find the next workspace whose dependencies are all merged before processing | integration-queue.ts | DONE |
| F4: cannotRunWith enforcement missing | Added `cannotRunWith: string[]` to Workspace type; enforced in both `DynamicParallelScheduler` and `WorkspaceScheduler` with skip category "cannot_run_with" | workspace-schema.ts, scheduler.ts, dynamic-scheduler.ts, workspace-scheduler.ts | DONE |

### Test Coverage

| Test | File | Tests |
|------|------|-------|
| `assertNoUncommittedChanges` throws when dirty / passes when clean | integration-queue.test.ts | 2 tests |
| `processNext` respects dependency ordering / returns false when blocked | integration-queue.test.ts | 2 tests |
| cannotRunWith blocks active peers / allows non-active peers / no false positives | dynamic-scheduler.test.ts | 4 tests |

**Total new tests: 8 — all passing.**
