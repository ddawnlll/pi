# LLM Commit Message Composer Circuit Breaker — P44.5

## Decision

`bounded_llm_with_fallback`

## Parameters (Frozen)

| Parameter            | Value                                      |
|----------------------|--------------------------------------------|
| Timeout              | 8 seconds                                  |
| Max repair attempts  | 1                                          |
| Fallback             | `deterministic_runtime_fact_commit_message`|
| Failure policy       | `fallback_not_block_unless_runtime_fact_packet_missing` |
| Allowed models       | cheap or flash model preferred             |

## What LLM Is NOT Authoritative For

The LLM commit message composer produces **prose only**. It is never authoritative for:

1. **Gate verdict** — CompletionGate vNext determines pass/block/HIR.
2. **Evidence validation** — EvidenceLedger is the authority.
3. **Validation truth** — Test command results are authoritative.
4. **Mutation authorization** — ScopeAndWriteSetStage determines authorization.

## Fallback Behavior

When the LLM composer fails (timeout, error, invalid output):

1. **Attempt 1**: Retry once with the same runtime fact packet.
2. **After 1 failed attempt**: Use `deterministic_runtime_fact_commit_message`.
3. **Fallback message format**: The deterministic fallback constructs a commit message
   from runtime facts only — files changed, workspace ID, plan ID, outcome. No prose.

### Deterministic Fallback Format

```
<type>(<scope>): <files-summary>

Workspace: <workspaceId>
Plan: <planId>
Files: <file-list>
Outcome: <runtime-outcome>
```

## Runtime Fact Packet (Input to Composer)

The LLM composer receives a runtime fact packet containing only verified facts:

- Workspace ID, plan ID, wave ID
- List of files changed (from git diff, not from agent claims)
- Number of files added/modified/deleted
- Validation results (pass/fail)
- ACCP report references

The composer must NOT receive:
- Agent-generated prose about the changes
- Unverified claims about what was accomplished
- Files that are outside the writeSet

## Validator Rules

The `CommitMessageValidator` (P44.5.06 `commit-message-validator.ts`) must reject:

1. References to files not in the runtime fact packet's verified file list.
2. Claims about tests passing when test results show failure.
3. Mention of scope or packages not in the runtime fact packet.
4. Missing body for commits that touch more than 5 files.
5. Missing git identity trailers (Pi-Plan, Pi-Workspace, Pi-Agent, etc.).

### Rejection Handling

A rejected message follows the same circuit breaker path:
- 1 repair attempt → deterministic fallback.

## Timeout Behavior

The 8-second timeout applies to:
- LLM API round trip (generate commit message)
- Repair attempt (generate revised message)

If the runtime fact packet is missing or empty (cannot compute fallback):
- **Block completion** (cannot produce an auditable commit message).
- This is the ONLY case where the composer blocks completion.
