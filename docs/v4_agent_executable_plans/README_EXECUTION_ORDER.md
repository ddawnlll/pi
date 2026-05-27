# v4 Execution Plans — Execution Order

These plans are written for an execution-capable coding agent.

The agent **may edit repository files and run scoped validation commands** when the human explicitly supplies these plans. The agent must not run Pi’s autonomous plan executor until the relevant promotion gates pass.

## Execution order

```text
0. Read prompts/AGENT_MASTER_PROMPT.md
1. Execute 01_P27X_EMERGENCY_EXECUTION_KERNEL_CUTOVER.md
2. Execute 02_P27_EXECUTION_KERNEL_FOUNDATION.md if P27X was split or left incomplete
3. Execute 03_P28_RUNTIME_AUDIT_AND_SHADOW_MODE.md
4. Execute 04_P29_ACTOR_MIGRATION_EVENT_ONLY.md
5. Execute 05_P30_ENFORCEMENT_CUTOVER.md
6. Execute 06_P31_INTENT_TEMPLATE_V4_AND_LEGACY_NORMALIZER.md
7. Execute 07_P32_DOGFOOD_PRODUCTION_LOCK.md
```

## Mode

```yaml
agent_mode: execution_capable_patch_agent
agent_may_edit_repo: true
agent_may_run_scoped_commands: true
agent_may_run_tests: true
agent_may_start_pi_autonomous_plan_execution: false_until_promotion
agent_may_git_push: false
agent_may_run_destructive_cleanup: false
```

## Practical tonight goal

```text
Tonight success = P27X core is implemented and tested:
  - PostgreSQL attempt/event tables
  - Attempt FSM
  - WorkspaceAttemptController
  - StateAuthority token
  - controller leadership + optimistic versioning
  - DeadlineWatchdog
  - HandoffQueue
  - AdmissionGate
  - legacy write detector / compatibility adapter
  - retry-before-terminal blocked
```

## Promotion ladder

```text
manual_1:
  current mode; agent writes patches and runs scoped tests.

stable_1:
  allowed only after P30 cutover gates pass; one autonomous workspace.

stable_3:
  allowed only after stable_3 dogfood passes.

stable_6:
  allowed only after stable_6 stress passes.
```
