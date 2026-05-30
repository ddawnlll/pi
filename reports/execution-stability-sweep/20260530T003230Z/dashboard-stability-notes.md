# Dashboard Stability Notes

## What dashboard now shows

The run view includes an `Execution Stability / Control Plane Health` panel. It shows:

- PostgreSQL-backed plan status.
- Event stream connection state: disconnected, connecting, connected, or reconnecting.
- Last event timestamp.
- Stale stream warning when no event has arrived for the threshold.
- Ready, active, blocked, failed, complete counts.
- Count of ignored stale completions.
- Last stop/continue control-plane event.
- Recent major control-plane issue events.
- Last visible control command error.
- A worker-level `Pi CLI` tab with raw workspace agent output rather than summarized transcript events.

## Big problems now visible

- Stop pending/draining via `plan_stop_draining_started` without `plan_stop_drained`.
- Stale worker completion ignored via `stale_attempt_completion_ignored`.
- Illegal transition prevented before router via `illegal_transition_prevented_before_router`.
- Active registry vs DB mismatch via `active_registry_db_mismatch`.
- Runner stopped by DB state via `runner_stopped_by_db_state`.
- Queue snapshot/metadata missing via `continue_failed_queue_missing`.
- No resettable workspaces via `continue_no_resettable_workspaces`.
- Completion gate block reasons via `completion_gate_blocked_visible`.

## How to tell if Stop/Continue is stuck

- Stop is likely stuck if the panel shows `Stop is draining active workers` for more than the configured drain timeout and active count remains nonzero.
- Continue is blocked if the panel or banner shows queue/metadata missing or no resettable workspaces.
- The event stream is stale if the panel shows `stream stale`; refresh or restart the server before trusting button state.
- A DB/registry mismatch indicates the runner observed PostgreSQL terminal state while the active registry still claimed another status; PostgreSQL wins.

## Known UI limitations

- The panel is intentionally minimal and not a redesign.
- It does not yet provide per-attempt ownership IDs.
- It relies on journal events; if old runs predate these events, only current state/counts are visible.
- The Pi CLI tab mirrors workspace agent logs and visible assistant deltas; it is not a byte-for-byte terminal emulator for the full TUI renderer.
- Dedicated dashboard tests were not added in this scoped pass.
