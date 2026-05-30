# P37.RCA — Completion Gate Wiring Fix

## The Problem

P37.03 retries 12 times with:
```
Completion gate blocked: Target command has not been executed:
npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts
```

The agent runs the test command via the bash tool. The test exists (34546 bytes,
created by P37 workspace work). The bash tool executes the command and returns
the result. But the completion gate never sees evidence that the command was run.

## Why The Gate Doesn't See Commands

The completion gate has `recordCommand()` and `recordCompletion()` methods that
populate `commandHistory`. These methods are **never called** during agent
execution:

- `packages/coding-agent/src/core/tools/bash.ts` — does NOT call completion gate
- `packages/coding-agent/src/core/workspace-agent-executor.ts` — does NOT call
  completion gate
- `packages/coding-agent/src/core/autonomous-executor.ts` — only calls
  `markImplementationFinished()` on COMPLETE verdict, then `evaluateWorkspace()`

The only bridge is the agent report scanning in `executeWorkspace()` (lines
1048-1081), which looks for equivalent command strings in the agent's text
report. But this requires `workspace.acceptedEquivalentCommands` or
`workspace.validationRequirement` to be set — neither is set for P37.03.

## What Happens Step by Step

1. Agent starts on P37.03 workspace
2. Agent reads role packet which says: "After implementation, run:
   `npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts`"
3. Agent implements code changes
4. Agent runs the test command via the bash tool
5. Bash tool executes command, output shown to agent, exit code 0 returned
6. Agent sees tests pass (or "no test files found" exit 0)
7. Agent reports COMPLETE
8. `executeWorkspace` handler: calls `markImplementationFinished()`
9. `executeWorkspace` handler: calls `evaluateWorkspace()`
10. Completion gate: `targetCommandPassed === null` (never set)
11. Completion gate: no equivalent commands satisfied (commandHistory empty)
12. Gate blocks: "Target command has not been executed"
13. Workspace transitions Failed → Pending → retry

## The Missing Wiring

To fix this, the bash tool must notify the completion gate when it runs and
completes commands. The architecture needs one of:

### Option A (Minimal): Record all bash commands via callback

Add a `commandRecorder` callback to the bash tool options. The callback receives
`(command: string, exitCode: number)` and records to the completion gate.

### Option B (Ideal): Wire agent session to completion gate

The agent session has access to all tool calls. After session completes, scan
all bash tool calls and record them in the completion gate.

### Option C (Pragmatic): Check command history from agent transcript

When evaluating completion, scan the agent's message history (not just the final
report text) for bash command invocations and their exit codes. Compare against
the target command.

## Recommended Fix

**Option C** is the most pragmatic:

1. In `executeWorkspace()`, after the agent completes, scan ALL messages in the
   agent transcript for bash tool call/result pairs
2. For each bash command found with exit 0, call
   `completionGate.recordCommand()` and `completionGate.recordCompletion()`
3. After recording all commands, run `evaluateWorkspace()`

This doesn't require changing the bash tool or agent executor interface — it
post-processes the agent transcript which is already available.

## Alternative Quick Fix for P37.03

Change the target command in the workspace definition to use the `--prefix`
syntax that works from the monorepo root:

```
npm --prefix packages/coding-agent run test:patch-coordinator
```

This is already set up in `package.json` as `test:patch-coordinator` and
actually runs the test file. Combined with making the completion gate check
the agent transcript for command evidence, this would break the retry loop.

## Files to Change

| File | Change |
|------|--------|
| `autonomous-executor.ts` | Scan agent message history for bash commands before evaluating completion gate |
| `tools/bash.ts` (optional) | Accept `commandRecorder` callback to push commands to gate during execution |
| Plan file | Update targetCommand for P37.03 |
