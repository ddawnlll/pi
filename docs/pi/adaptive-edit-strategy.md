# Adaptive Edit Strategy & Failure Handoff

**Phase:** P4.5
**Status:** Implemented
**Default Mode:** Hybrid

## Overview

P4.5 replaces hard token-saving edit behavior with an adaptive edit strategy that chooses between full rewrite, targeted patch, and human handoff based on file size, selected mode, failure history, and safety constraints.

The goal is **successful completion per minute**, not maximum token saving at all costs.

## Edit Strategy Modes

| Mode | Full Rewrite | Patch | Handoff Threshold |
|------|-------------|-------|-------------------|
| **Token Saving** | Blocked above 200 lines / 8KB | Required above 200L / 8KB; TSX above 300L | 2 failures |
| **Hybrid** (default) | Allowed under 1000 lines / 40KB when budget passes | Required above 1000L / 40KB; TSX above 1000L | 2 failures |
| **Speed** | Allowed under 1000 lines (hard gate above) | Not required | 2 failures |

### Token Saving Mode

- Strict patch-first: full rewrites only for small files
- TSX/JSX components over 300 lines require targeted patch
- Best for expensive API runs where token consumption matters most
- May block useful full rewrites on medium-sized files

### Hybrid Mode (Default)

- Like Token Saving for small files without an output budget
- When output budget passes: allows full rewrites under 1000 lines and 40KB
- TSX/JSX components over 1000 lines require targeted patch
- Best balance of flexibility and efficiency

### Speed Mode

- Token-saving edit restrictions are disabled
- Full rewrites allowed under 1000 lines
- **Hard safety gates always remain active**: files over 1000 lines are blocked
- Best for fast iteration when token cost is not a concern
- Emits warnings/audit events even when restrictions are loosened

## Threshold Defaults

```yaml
edit_strategy:
  default_mode: hybrid
  modes:
    token_saving:
      existing_file_full_rewrite_max_lines: 200
      existing_file_full_rewrite_max_bytes: 8000
      tsx_component_patch_required_lines: 300
      same_file_edit_failure_handoff_threshold: 2

    hybrid:
      existing_file_full_rewrite_max_lines: 1000
      existing_file_full_rewrite_max_bytes: 40000
      tsx_component_patch_required_lines: 1000
      same_file_edit_failure_handoff_threshold: 2

    speed:
      token_saving_edit_restrictions_enabled: false
      existing_file_full_rewrite_soft_limit_lines: 1000
      hard_safety_gates_enabled: true
      same_file_edit_failure_handoff_threshold: 2
```

## Failure Detection

### Truncation Markers

The system detects truncation from tool output text containing:
- `truncated`
- `The file got truncated`
- `write is truncating`
- `Let me write the complete file again`
- `complete file in parts`
- `... more lines`

**Truncation always forces fallback to patch mode in all modes.**

### Exact-Match Failures

Detected from tool output containing:
- `Could not find the exact text`
- `old text must match exactly`

Exact-match failures increment the same-file edit failure counter.

## Failure Handoff

When the same file accumulates 2 failed edit attempts (configurable threshold):

1. The workspace is marked `BLOCKED_EDIT_FAILURE`
2. An `edit_failure_handoff` event is emitted
3. The handoff payload includes:
   - File path and current diff
   - Failed strategy list with failure types
   - Pre-edit snapshot path (for restore)
   - Suggested manual fix steps
   - Suggested resume instruction
4. The dashboard shows a handoff panel with:
   - Current diff view
   - Failed edit attempts
   - Restore snapshot button
   - Continue after manual fix button
   - Retry with different edit mode selector
5. CLI prints equivalent handoff summary

## Generated Files

Generated files (e.g., build artifacts) can only be full-rewritten if they are marked `rewriteAllowed: true` in the generated file manifest. Without this marking, generated-file rewrites are blocked.

## Audit Events

| Event Type | When |
|------------|------|
| `edit_strategy_selected` | When a file's edit strategy decision is made |
| `edit_strategy_blocked` | When a full rewrite is blocked by policy |
| `full_rewrite_attempted` | When a full rewrite is attempted |
| `edit_truncation_detected` | When truncation is detected in output |
| `edit_exact_match_failed` | When an exact-match edit fails |
| `patch_fallback_forced` | When truncation forces fallback to patch |
| `edit_failure_handoff` | When the handoff threshold is reached |
| `token_waste_prevented` | When a blocked rewrite prevents token waste |

## Doctor Checks

`pi plan doctor` reports:
- Selected edit strategy mode
- Warnings for Token Saving mode (may block useful rewrites)
- Warnings for Speed mode (may cause token spikes)
- Handoff threshold validation

## Recovery Flow

After an edit failure handoff:

1. **Review** the suggested manual fix steps
2. **Option A**: Restore the pre-edit snapshot to get back to a known state
3. **Option B**: Manually edit the file to fix the issue
4. **Option C**: Retry with a different edit mode (e.g., switch from Token Saving to Hybrid)
5. **Resume** the workspace after fixing

Manual fix + resume must not lose workspace state.

## Rollback

If the edit strategy causes problems:
1. Set `editStrategyMode=speed` to relax restrictions
2. Set `PI_EDIT_STRATEGY_ENFORCEMENT=warn` to downgrade enforcement
3. Keep audit events enabled for observation
4. Full revert P4.5 if write/edit behavior remains unstable
