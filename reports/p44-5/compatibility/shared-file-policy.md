# Shared-File Policy — P44.5

## Decision

`declared_owner_or_block`

## Rules

### 1. Undeclared Parallel Mutation Blocks at Admission

If two parallel workspaces write the same file and no shared owner or merge owner
is declared, admission blocks before execution begins. The workspace lock verifier
detects this during workspace admission.

### 2. Declared Shared File Requires Single Commit Owner

If a shared file is declared in the workspace's `sharedFilePolicy.sharedFiles`,
exactly one workspace is the `commitOwner`. The commit owner is responsible for
the actual git commit that includes the shared file.

Other workspaces:
- Contribute patch or evidence artifacts
- May modify the file in their worktree but do NOT commit it
- Route changes through an integration queue if automatic merge is declared

### 3. Same-File Write Drift Routes to NEEDS_HIR

If the runtime detects same-file write drift during completion (different
workspaces modified the same file in parallel and the commit owner already
committed), route to NEEDS_HIR unless an automatic merge policy is explicitly
declared in the planspec.

### 4. Worktree Isolation Is Necessary But Not Sufficient

Worktree isolation prevents filesystem conflicts, but writeSet ownership remains
authoritative. Even in isolated worktrees, the commit gate checks ownership
declarations before allowing commits on shared files.

### 5. Commit Owner Responsibilities

The commit owner workspace:
- Includes the shared file in its `writeSet`
- Stages and commits the shared file with proper git identity
- Is subject to post-commit verification for the shared file
- Records the shared file in its ACCP IPR report

### 6. Non-Commit Owner Contributions

Non-commit owner workspaces that declare shared file participation:
- List the file in `sharedFilePolicy.sharedFiles`
- Reference the commit owner workspace by ID
- Produce patch/evidence artifacts for the shared file changes
- Do NOT include the shared file in their `writeSet`
- Document their contributions in ACCP IPR reports

## Enforcement

| Stage | Enforcement |
|-------|-------------|
| Admission | `workspace_lock_verifier` checks parallel file conflicts |
| Scope | `scope_and_writeset_stage` validates ownership declarations |
| Commit | `completion_gate_vnext` blocks unauthorized shared file commits |
| Completion | Same-file drift detection routes to NEEDS_HIR |

## Implementation Notes

This policy is frozen at design time. The implementation in P44.5.04
(ScopeAndWriteSetStage) and P44.5.08 (CompletionRecoveryRouter) must implement
these rules exactly without deviation.
