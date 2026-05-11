# Pi Plan Watch - User Guide

## Overview

`pi plan watch` is an observer-only dashboard for monitoring autonomous plan execution in real-time.

**Key Principles:**
- **Observer-only**: Never pauses, resumes, or controls execution
- **Read-only**: Never mutates `.pi/plan-state.json` or `.pi/execution-journal.ndjson`
- **Non-blocking**: Exit with `q` or Ctrl+C without affecting execution

## Usage

```bash
pi plan watch <plan-file>
```

## Display Panels

The dashboard shows:

1. **Plan Summary** - Phase, title, status, elapsed time
2. **Workspace Status** - Counts by stage (complete/active/pending/blocked/failed)
3. **Active Workers** - Currently executing workspaces with selection marker
4. **Selected Worker Detail** - Details for the selected worker
5. **Recent Events** - Scrollable event log with filtering

## Keyboard Shortcuts

### Worker Selection
- `1` - Select worker 1
- `2` - Select worker 2
- `3` - Select worker 3

### Navigation
- `tab` - Cycle between panels (workers ↔ events)
- `j` or `↓` - Scroll event log down
- `k` or `↑` - Scroll event log up

### Filtering & Control
- `f` - Toggle failed/retry event filter
- `r` - Force refresh (manual update)
- `q` - Exit watch (execution continues)

### Exit
- `q` - Exit watcher only (execution continues)
- `Ctrl+C` - Exit watcher only (execution continues)

**Important:** Exiting the watcher does NOT stop execution. The plan continues running in the background.

## Selected Worker Detail

When a worker is selected (using `1`/`2`/`3`), the dashboard shows:

- **Workspace ID** - The workspace identifier (e.g., "7.A")
- **Stage** - Current execution stage (pending/active/complete/blocked/failed)
- **Attempts** - Number of retry attempts
- **Recent Events** - Last 5 events specific to this worker

## Event Log

The event log shows recent execution events:

- **Scrolling** - Use `j`/`k` or arrow keys to scroll through events
- **Filtering** - Press `f` to show only failed/retry events
- **Display** - Shows 5 events at a time with scroll position indicator

Event types:
- `▶ Plan started` - Execution began
- `→ <workspace> started` - Workspace execution started
- `✓ <workspace> completed` - Workspace completed successfully
- `✗ <workspace> failed` - Workspace execution failed
- `⊘ <workspace> blocked` - Workspace blocked by dependencies
- `⟳ <workspace> retry N` - Retry attempt N
- `✓ Plan completed` - Execution completed successfully
- `✗ Plan failed` - Execution failed

## Fallback Mode

If the terminal doesn't support interactive mode (non-TTY environment), the dashboard automatically falls back to static status display with periodic updates.

Fallback triggers:
- Non-TTY environment (pipes, redirects, CI/CD)
- Terminal doesn't support raw mode
- Stdin setup fails

In fallback mode:
- No keyboard shortcuts available
- Static status updates every refresh interval
- Exit with Ctrl+C only

## Observer-Only Contract

The watcher is strictly observer-only:

**Never does:**
- ❌ Pause execution
- ❌ Resume execution
- ❌ Retry workspaces
- ❌ Approve/reject actions
- ❌ Kill/terminate execution
- ❌ Modify `.pi/plan-state.json`
- ❌ Modify `.pi/execution-journal.ndjson`
- ❌ Modify any execution state

**Only does:**
- ✅ Read `.pi/plan-state.json`
- ✅ Read `.pi/execution-journal.ndjson`
- ✅ Display current state
- ✅ Exit cleanly without affecting execution

## Examples

### Basic Usage

```bash
# Watch plan execution
pi plan watch docs/my-plan.md

# Watch with custom refresh rate (default: 500ms)
pi plan watch docs/my-plan.md --refresh 1000
```

### Monitoring Workflow

1. Start execution in one terminal:
   ```bash
   pi plan run docs/my-plan.md
   ```

2. Watch in another terminal:
   ```bash
   pi plan watch docs/my-plan.md
   ```

3. Navigate the dashboard:
   - Press `1`/`2`/`3` to select workers
   - Press `tab` to switch between panels
   - Press `j`/`k` to scroll events
   - Press `f` to filter failed/retry events
   - Press `q` to exit (execution continues)

### Troubleshooting

**Q: Dashboard shows "No active plan execution found"**
- A: No plan is currently running. Start execution with `pi plan run <plan-file>`

**Q: Keyboard shortcuts don't work**
- A: Terminal may not support interactive mode. Dashboard falls back to static display.

**Q: How do I stop execution?**
- A: The watcher cannot stop execution. It's observer-only. To stop execution, you must terminate the `pi plan run` process directly.

**Q: Does exiting the watcher stop execution?**
- A: No. Exiting the watcher (`q` or Ctrl+C) only closes the dashboard. Execution continues in the background.

## Technical Details

- **Refresh Rate**: Default 500ms, configurable
- **Event History**: Last 50 events loaded, 5 visible at a time
- **Worker Limit**: First 3 active workers selectable
- **Read-Only**: All file operations are read-only
- **Non-Blocking**: Exit does not signal execution process

## See Also

- `pi plan run` - Execute a plan
- `pi plan status` - Show current plan status (one-time)
- `pi plan doctor` - Validate plan safety
- `pi plan dry-run` - Preview execution order
