# Validation Architecture

Deferred validation lets implementation workspaces finish without heavy target commands when validationPolicy.mode is deferred and requiredBeforeWorkspaceComplete is false. Plan completion still requires final validation.

Final validation workspaces own heavy test execution and must pass before plan completion. Final repair workspaces consume final validation failures, fix localized issues, and rerun validation or produce handoff_required.

commandHistory stores bounded workspace-scoped command evidence: planExecId, workspaceId, command, cwd, timestamps, exit code, output summary, artifact path, target/equivalent matching, and noTestsFoundDetected.

validationRequirement defines semantic validation. acceptedEquivalentCommands can satisfy the requirement only with real command evidence, zero exit, non-watch mode, and no no-tests-found output.

No test files found is a hard targeted_test failure even when the command exits 0.
