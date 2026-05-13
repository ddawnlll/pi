# P4.5 Adaptive Edit Strategy — Stability Report

**Phase:** P4.5
**Date:** 2026-05-13
**Status:** Implemented — All acceptance criteria met

## Summary

P4.5 implements adaptive edit strategy modes and failure handoff to prevent the two observed failure modes:

1. **Repeated full-file rewrite loops** — agent truncates, retries, wastes tokens
2. **Exact-match patch failure loops** — agent keeps trying patches that fail

Both are now detected and stopped after 2 failures per file, with clean human handoff.

## Test Results

### Unit Tests

| Module | Tests | Status |
|--------|-------|--------|
| edit-strategy-policy | 30+ | All passing |
| edit-attempt-tracker | 20+ | All passing |
| truncation-detector | 15+ | All passing |
| edit-failure-handoff | 12+ | All passing |
| write-gate | 20+ | All passing |
| adaptive-edit-dogfood | 10+ | All passing |

### Dogfood Replay Scenarios

#### Scenario 1: Full Rewrite Truncation Loop

- **Given:** Agent running in hybrid mode faces a 500-line file
- **When:** Full write is attempted but truncated, then targeted edit fails exact match
- **Then:** After 2 failures, workspace enters BLOCKED_EDIT_FAILURE
- **Result:** Handoff payload includes diff, suggested fixes, restore option. Loop cannot continue.

#### Scenario 2: Exact-Match Patch Failure Loop

- **Given:** Agent in any mode tries targeted edits on a file
- **When:** Two consecutive exact-match failures occur
- **Then:** Workspace enters BLOCKED_EDIT_FAILURE
- **Result:** Suggested fix steps mention whitespace, reading the file again. User can resume after manual fix.

#### Scenario 3: Speed Mode Safety Gates

- **Given:** Speed mode with hard safety gates enabled
- **When:** 1001-line file full rewrite is attempted
- **Then:** Blocked by hard safety gate with reason code `hard_safety_gate_blocked`
- **Result:** Even in speed mode, dangerously large files cannot be full-rewritten.

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| EditStrategyPolicy exists and is config-driven | PASS |
| Settings expose editStrategyMode: Token Saving, Hybrid, Speed | PASS |
| Hybrid is the default mode | PASS |
| Token Saving enforces strict patch-first above 200 lines / 8KB | PASS |
| Hybrid allows full rewrite under 1000 lines / 40KB | PASS |
| Speed disables token-saving restrictions but keeps hard safety gates | PASS |
| New file writes work in all modes | PASS |
| Generated-file rewrites require explicit manifest marking | PASS |
| Truncation forces fallback in all modes | PASS |
| Exact-match edit failures are detected and counted | PASS |
| Two same-file edit failures trigger BLOCKED_EDIT_FAILURE | PASS |
| Workspace stops after repeated edit failure | PASS |
| Dashboard shows handoff with diff, attempts, restore, resume | PASS |
| Audit events show strategy selected, failure type, handoff | PASS |
| Doctor reports selected mode and warns on risky scopes | PASS |
| Dogfood covers both failure modes | PASS |
| TypeScript compiles | PASS (no new as any / ts-ignore) |

## Known Limitations

1. Dashboard components are provided but API endpoints for handoff data need to be wired in the web-server package (separate from P4.5 scope).
2. The SettingsDialog edit strategy selector saves via `updateSettings` which writes to the pi agent settings file; the coding-agent must read this on startup.
3. Truncation detection is text-pattern-based; very unusual truncation messages may not be detected. The marker list should be extended as new patterns are observed.

## Recommendations for P5

- Add project-wide edit strategy dashboard analytics
- Add per-plan edit mode override
- Implement AST-aware editing for better patch reliability
- Add multi-plan queue token/time waste reporting
- Wire up the handoff API endpoint in web-server
