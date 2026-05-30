# Dashboard Stability Notes

The dashboard stability panel can show DB plan status, control action events, stale completion counts, CompletionGate block reasons, workspace errors, retry/attempt counts, and command diagnostics from journal events.

Major issues are visible through command_completed, completion_gate_blocked_visible, stale_attempt_completion_ignored, active_registry_db_mismatch, plan_stop_draining_started, plan_stop_drained, continue_rerun_started, and continue_rerun_completed.

If stop/continue is stuck, compare the last control event timestamp with active workspace count and stale stream warnings.

Known limitation: this pass did not redesign the dashboard or run full web UI tests.
