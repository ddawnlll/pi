# P37 Recovery

1. Restart the web-server/executor process to drop old executor promises.
2. Inspect the current P37 plan state through the dashboard or API.
3. Identify workspaces failed only by illegal PENDING -> SUCCEEDED, illegal SUCCEEDED -> RUNNING, or missing command evidence.
4. Use the supported Continue/Rerun action. Do not manually edit DB state.
5. Preserve completed workspaces and queue snapshots.
6. If queue snapshot is missing, use the clear continue error and rerun from the original plan file.
7. Preserve execution journal, workspace logs, command artifacts, and this report directory.

No manual SQL was executed. If supported recovery fails, write exact manual SQL to this file for review before execution.

Current harness result: server restart and live P37 continuation were not performed here.

## Local P37 snapshot observed

A P37 queue snapshot exists at `.pi/8e0f058f-bd3a-497b-9116-b9abb5936b75.workspace-queue.json`.
Local file search found historical P37 workspace artifacts with `Illegal attempt transition: PENDING -> SUCCEEDED` and missing targetCommand evidence on P37.03. The legacy `.pi/plan-state.json` currently points at P19, so live P37 status likely resides in the configured state-store backend or archived execution metadata, not that legacy JSON file.

Supported recovery should target execution id `8e0f058f-bd3a-497b-9116-b9abb5936b75` only if the server/API confirms it is the current P37 execution. Do not infer from artifact filenames alone.
