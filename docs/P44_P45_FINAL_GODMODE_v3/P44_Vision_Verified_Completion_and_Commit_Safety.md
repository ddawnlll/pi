# P44 Vision — Verified Completion Spine & Workspace-Scoped Commit Safety

**Date:** 2026-06-04  
**Purpose:** Explain P44 as a trust layer.

---

## 1. Vision

Pi must stop trusting worker self-report.

The new model:

```txt
worker said it is done
  -> not enough

worker proved it is done
  -> gate verifies evidence
  -> commit gate stages only owned files
  -> ExecutionKernel transitions state
```

P44 turns Pi into a system that can answer:

```txt
Was it done?
How do we know?
What files were touched?
Were only allowed files committed?
Why did the gate accept or block it?
```

---

## 2. Why Commit Scope Is Part of Completion

Completion without scoped commit safety is still unsafe.

A worker might implement the right thing, then accidentally commit unrelated work with:

```bash
git add .
```

So P44 treats commit scope as a first-class trust boundary.

```txt
CompletionGate verifies done-ness.
WorkspaceCommitGate verifies commit scope.
Both must pass.
```

---

## 3. Operator Experience

The dashboard should show three separate truths:

```txt
Claim:
  Worker said COMPLETE.

Evidence:
  AC coverage, tests, negative checks, target command.

Commit:
  accepted write-set, staged files, committed files, illegal files.
```

This prevents the UI from lying because a live log contains `VERDICT: COMPLETE`.

---

## 4. Minimum Useful P44

If the team is tired, P44-lite is enough:

```txt
VERDICT COMPLETE is claim-only.
Missing evidence blocks completion.
Target command required.
Stale completion ignored.
Terminal attempt cannot remain RUNNING.
CompletionGate reason visible.
git add . / git add -A / git commit -a forbidden.
Commit only workspace-owned files.
Fake complete and commit-scope tests exist.
```

That is enough to make Pi substantially safer for real projects.
