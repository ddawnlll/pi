# P4.5.F Stability Report — Doctor Checks, Tests, and Dogfood Replay

**Phase:** P4.5.F
**Date:** 2026-05-13
**Status:** Complete — All acceptance criteria met

## Summary

P4.5.F validates that the adaptive edit strategy works correctly against real failure modes, the doctor warns on risky configurations, and documentation explains all thresholds and overrides.

## Acceptance Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| Doctor warns on large existing editable files without patch-first instruction | PASS | New `checkLargeEditableFiles` function added to doctor; warns when canEdit files exceed mode thresholds |
| Dogfood replay simulates SettingsDialog repeated rewrite failure | PASS | SettingsDialog.tsx (815-line TSX) scenario covers hybrid mode truncation + exact-match failure leading to handoff |
| Second and third full-write attempts are blocked in dogfood | PASS | After truncation, patch mode forced; after handoff threshold, all writes blocked |
| Documentation explains thresholds and overrides | PASS | Updated `docs/pi/adaptive-edit-strategy.md` with threshold table, override instructions, and recovery flow |
| Stability report published | PASS | This document |
| TypeScript compiles cleanly | PASS | `npm run typecheck` passes with no errors |

## Test Coverage

### patch-first-dogfood.test.ts (19 tests)

| Category | Tests | Status |
|----------|-------|--------|
| AC1: Doctor warns on large editable files | 6 | All passing |
| AC2: SettingsDialog repeated rewrite failure | 2 | All passing |
| AC3: Second/third full-write blocked | 3 | All passing |
| AC4: Documentation thresholds and overrides | 5 | All passing |
| AC5: Stability report schema validation | 2 | All passing |
| AC6: TypeScript type validation | 1 | All passing |

### Dogfood Replay Scenarios

#### Scenario 1: SettingsDialog Hybrid Mode Truncation Loop

- **Given:** SettingsDialog.tsx is an 815-line TSX component in hybrid mode
- **When:** First full write is allowed (under 1000 lines, budget passes) but truncation occurs
- **Then:** Patch mode is forced; targeted edit also fails with exact-match; handoff triggered after 2 failures
- **Result:** Agent cannot loop; handoff payload includes diff, snapshot, suggested fixes

#### Scenario 2: SettingsDialog Token Saving Mode Blocked

- **Given:** SettingsDialog.tsx is an 815-line TSX component in token_saving mode
- **When:** Full rewrite immediately blocked (TSX 300-line limit exceeded)
- **Then:** Targeted edits attempted but fail exact match twice; handoff triggered
- **Result:** Suggested fix includes switching to Hybrid or Speed mode

#### Scenario 3: Second Full-Write Blocked After Truncation

- **Given:** First full write allowed then truncated
- **Then:** `isPatchModeForced` returns true; `isFullWriteAllowed` returns false with "patch mode forced" reason
- **Result:** Agent cannot attempt another full write for this file

#### Scenario 4: Third Full-Write Blocked After Handoff Threshold

- **Given:** Two failures (truncation + exact-match) reach handoff threshold
- **Then:** `check()` returns `allowed: false`, `handoffTriggered: true`
- **Result:** All further writes blocked; workspace must be manually resolved

## Doctor Enhancement

### New Function: `checkLargeEditableFiles`

Added to `src/cli/doctor.ts`:

- Accepts `EditableFileInfo[]` with filePath, lineCount, byteSize, isTsx
- Checks each file against current mode thresholds via `getModeThresholds(mode)`
- Returns "pass" when no files exceed thresholds
- Returns "warn" when files exceed thresholds, listing affected files and suggesting mode switch or restructuring

### New Function: `getModeThresholds`

Returns threshold limits for each mode:

| Mode | maxLines | maxBytes | tsxPatchRequiredLines |
|------|----------|---------|----------------------|
| token_saving | 200 | 8192 (8KB) | 300 |
| hybrid | 1000 | 40960 (40KB) | 1000 |
| speed | 1000 | MAX_SAFE_INTEGER | MAX_SAFE_INTEGER |

### Extended `runDoctor` Signature

`runDoctor(settingsManager, modelRegistry, editableFiles?)` now accepts an optional `EditableFileInfo[]` parameter. When provided, large file warnings are included in the doctor results.

## Documentation Updates

Updated `docs/pi/adaptive-edit-strategy.md` with:

1. **Large Editable File Detection** section with threshold table
2. **Threshold Overrides** section explaining:
   - Mode switching (token_saving → hybrid → speed)
   - Handoff threshold adjustment
   - Force patch mode as safety mechanism (not overridable)
   - Generated file manifest marking
   - Environment variable enforcement override

## Integration with Existing Tests

The `patch-first-dogfood` test file complements the existing test suite:

- `adaptive-edit-dogfood.test.ts` — general dogfood scenarios
- `p45-verification.test.ts` — comprehensive P4.5 verification
- `edit-attempt-tracker.test.ts` — tracker unit tests
- `write-gate.test.ts` — gate unit tests
- `safety-doctor.test.ts` — safety doctor tests

All existing tests continue to pass with no regressions.

## Known Limitations

1. Doctor large file check requires the caller to provide file size information; it does not automatically scan the filesystem
2. The `runDoctor` function accepts editable files optionally, maintaining backward compatibility with existing callers that do not provide file info
3. Speed mode large file warnings use the hard safety gate line limit (1000) rather than the soft limit
