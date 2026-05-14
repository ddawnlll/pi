# Worktree Isolation (6.A)

## Overview

Worktree isolation allows each workspace to execute inside its own git worktree,
preventing cross-contamination between parallel workspaces and enabling safe
concurrent execution. This is the foundation for higher parallelism in P6.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 Main Repository (Main Checkout)           │
│  .pi/worktrees/{planExecId}/{workspaceId}/              │
│    ├── 6.A/  (worktree - branch: worktree/<id>/6.A)     │
│    ├── 6.B/  (worktree - branch: worktree/<id>/6.B)     │
│    └── .../                                              │
└──────────────────────────────────────────────────────────┘
```

### Key Components

- **`WorktreeWorkspaceExecutor`** (`src/worktree/worktree-workspace-executor.ts`):
  Wraps the agent executor with git worktree lifecycle management.
  
- **`WorktreeState`** (`src/worktree/worktree-types.ts`):
  Records worktree metadata (path, base commit, branch, status).

- **`WorkspaceAgentExecutor`** (`src/core/workspace-agent-executor.ts`):
  Modified to support worktree mode via `worktree` config option.

## Usage

### Enabling Worktree Mode

Worktree mode is configured via `WorktreeConfig`:

```typescript
import { WorkspaceAgentExecutor } from "./core/workspace-agent-executor.js";

const executor = new WorkspaceAgentExecutor({
  workspaceRoot: "/path/to/repo",
  planExecutionId: "plan-123",
  worktree: { enabled: true }
});
```

### Using WorktreeWorkspaceExecutor Directly

For more control, use `WorktreeWorkspaceExecutor` directly:

```typescript
import { WorktreeWorkspaceExecutor } from "../worktree/worktree-workspace-executor.js";

const executor = new WorktreeWorkspaceExecutor({
  workspaceRoot: "/path/to/repo",
  planExecutionId: "plan-123",
  workspaceId: "7.A",
  worktree: { enabled: true }
});

// Create worktree
const result = await executor.createWorktree();
console.log(`Worktree at: ${result.state.worktreePath}`);
console.log(`Base commit: ${result.state.baseCommit}`);

// Execute (delegates to WorkspaceAgentExecutor with worktree as CWD)
const execResult = await executor.execute(packet, workspaceId);

// Cleanup
await executor.removeWorktree();     // Remove worktree
await executor.removeWorktree(true); // Quarantine (preserve for review)
```

### Checking Mode

```typescript
executor.isWorktreeModeEnabled   // boolean
executor.worktreePath            // string | null
executor.baseCommit              // string | null
executor.currentWorktreeState    // WorktreeState | null
executor.getEffectiveWorkspaceRoot() // string
```

## Worktree State

Each worktree records:

| Field | Description |
|-------|-------------|
| `worktreePath` | Absolute path to the worktree directory |
| `baseCommit` | Git hash at creation time |
| `branchName` | Git branch (format: `worktree/<planExecId>/<workspaceId>`) |
| `workspaceId` | Workspace identifier |
| `planExecutionId` | Owning plan execution |
| `createdAt` | Creation timestamp |
| `status` | `created` → `active` → `completed/failed/quarantined` |

## Path Safety

- All worktrees are scoped under `.pi/worktrees/{planExecId}/{workspaceId}/`
- Workspace IDs are sanitized to prevent path traversal
- `WorktreeWorkspaceExecutor.removeWorktree()` uses `git worktree remove`
  (safe git command), not raw `rm -rf`

## Fallback Mode

When `worktree.enabled` is `false` (the default), execution falls back to
the P5.5 shared-working-tree behavior. The workspace runs directly in the
main checkout directory.

```typescript
// P5.5 fallback (default)
const executor = new WorkspaceAgentExecutor({
  workspaceRoot: "/path/to/repo",
  worktree: { enabled: false } // or omitted
});
```

## Dependency Graph

```
WorktreeWorkspaceExecutor
  ├── createWorktree()       → creates git worktree
  ├── execute()              → delegates to WorkspaceAgentExecutor
  │     └── WorkspaceAgentExecutor (inner, worktree-cwd)
  └── removeWorktree()       → cleanup / quarantine

WorkspaceAgentExecutor
  ├── isWorktreeModeEnabled  → checks config
  ├── executeInWorktree()    → creates WorktreeWorkspaceExecutor
  └── execute()              → shared-working-tree (default)
```

## Test Coverage

Tests cover all acceptance criteria:

1. **AC1**: Workspace execution inside git worktree
2. **AC2**: Main checkout remains clean during edits
3. **AC3**: Worktree state records path, base commit, branch, etc.
4. **AC4**: Two workspaces can edit different files concurrently
5. **AC5**: Worktree mode can be disabled (P5.5 fallback)

Additional tests:
- Path traversal sanitization
- Non-git directory error handling
- Worktree creation, removal, quarantine
- Worktree mode detection via `WorkspaceAgentExecutor`
