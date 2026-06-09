# Real Validation Case Catalog — PlanSpec v5 alpha2

Each case is distinct and tied to a PlanSpec field.
## CASE-SCHEMA-001 — Reject unknown security field

- **Category:** `schema`
- **Input:** security.hardStopz typo
- **Expected:** `reject`
- **Reason:** Strict security schema catches typo
- **Related fields:** `security`

## CASE-SCHEMA-002 — Reject invalid enforcedBy

- **Category:** `schema`
- **Input:** instruction uses magic_review
- **Expected:** `reject`
- **Reason:** Mechanism must be in registry
- **Related fields:** `brief.hardRequirements`

## CASE-SCHEMA-003 — Reject invalid confidence

- **Category:** `schema`
- **Input:** evidence confidence maybe
- **Expected:** `reject`
- **Reason:** Confidence enum only
- **Related fields:** `evidence.confidenceEnum`

## CASE-SCHEMA-004 — Reject p45 implementation true

- **Category:** `schema`
- **Input:** p45Bridge.implementationAllowed true
- **Expected:** `reject`
- **Reason:** P44 bridge cannot implement P45
- **Related fields:** `p45Bridge`

## CASE-LOCK-001 — Spec hash mismatch

- **Category:** `lock`
- **Input:** specHash differs
- **Expected:** `reject`
- **Reason:** No lock, no execution
- **Related fields:** `PlanLock.source`

## CASE-LOCK-002 — Allowed files changed

- **Category:** `lock`
- **Input:** allowedFilesHash mismatch
- **Expected:** `reject`
- **Reason:** Allowed file drift unsafe
- **Related fields:** `integrity.allowedFilesHash`

## CASE-LOCK-003 — AC drift

- **Category:** `lock`
- **Input:** acceptanceCriteriaHash mismatch
- **Expected:** `reject`
- **Reason:** AC drift changes done criteria
- **Related fields:** `integrity.acceptanceCriteriaHash`

## CASE-LOCK-004 — Worker wrong lock echo

- **Category:** `lock`
- **Input:** workerLockHash mismatch
- **Expected:** `reject completion`
- **Reason:** Prevents stale worker packet
- **Related fields:** `workerPacket`

## CASE-CMD-001 — Exact command accepted

- **Category:** `command`
- **Input:** CMD-P4403-UNIT exact argv
- **Expected:** `allow`
- **Reason:** Exact allowed command evidence
- **Related fields:** `commands.exactAllowedCommands`

## CASE-CMD-002 — Prefix injection rejected

- **Category:** `command`
- **Input:** vitest command plus || true
- **Expected:** `reject`
- **Reason:** No prefix whitelist, silent pass forbidden
- **Related fields:** `commands`

## CASE-CMD-003 — Discovery allowed

- **Category:** `command`
- **Input:** rg CompletionGate src
- **Expected:** `allow discovery`
- **Reason:** Read-only class
- **Related fields:** `commandClasses`

## CASE-CMD-004 — Discovery not final

- **Category:** `command`
- **Input:** rg used as final validation
- **Expected:** `reject final`
- **Reason:** Discovery cannot satisfy final
- **Related fields:** `validationEvidenceRules`

## CASE-CMD-005 — Runtime grant low risk

- **Category:** `command`
- **Input:** node reads package scripts
- **Expected:** `auto grant`
- **Reason:** Low risk read-only
- **Related fields:** `runtimeCommandGrant`

## CASE-CMD-006 — Git reset denied

- **Category:** `command`
- **Input:** git reset --hard
- **Expected:** `reject`
- **Reason:** Hard denied command
- **Related fields:** `hardDeniedCommands`

## CASE-CMD-007 — Watch mode rejected

- **Category:** `command`
- **Input:** vitest --watch
- **Expected:** `reject`
- **Reason:** Watch mode forbidden
- **Related fields:** `falsePositiveGuards`

## CASE-CMD-008 — No tests found rejected

- **Category:** `command`
- **Input:** vitest exits 0 no tests
- **Expected:** `reject`
- **Reason:** No tests found failure
- **Related fields:** `falsePositiveGuards`

## CASE-PERM-001 — Allowed edit

- **Category:** `permission`
- **Input:** P44.03 edits gate file
- **Expected:** `allow`
- **Reason:** File in allowedFiles
- **Related fields:** `workspaces.allowedFiles`

## CASE-PERM-002 — Forbidden file edit

- **Category:** `permission`
- **Input:** P44.03 edits package.json
- **Expected:** `reject`
- **Reason:** Forbidden file
- **Related fields:** `workspaces.forbiddenFiles`

## CASE-PERM-003 — P45 runtime write blocked

- **Category:** `permission`
- **Input:** write src/p45/static-partitioner.ts
- **Expected:** `reject`
- **Reason:** P45 runtime forbidden
- **Related fields:** `p45Bridge.forbiddenRuntimePaths`

## CASE-PERM-004 — P45 artifact allowed

- **Category:** `permission`
- **Input:** write p45-readiness-report.json
- **Expected:** `allow`
- **Reason:** Allowed bridge artifact
- **Related fields:** `p45Bridge.allowedArtifactPaths`

## CASE-EVID-001 — Missing AC evidence

- **Category:** `evidence`
- **Input:** AC-P4403-001 no evidence
- **Expected:** `block completion`
- **Reason:** Missing evidence blocks
- **Related fields:** `authority.completion`

## CASE-EVID-002 — Unknown AC ref

- **Category:** `evidence`
- **Input:** evidence references nonexistent AC
- **Expected:** `reject evidence`
- **Reason:** AC refs must resolve
- **Related fields:** `evidence`

## CASE-EVID-003 — Invalid report confidence

- **Category:** `evidence`
- **Input:** TVR confidence maybe
- **Expected:** `reject report`
- **Reason:** ACCP confidence enum
- **Related fields:** `reports`

## CASE-EVID-004 — Missing command output

- **Category:** `evidence`
- **Input:** TVR lacks output_excerpt
- **Expected:** `reject report`
- **Reason:** Command evidence required
- **Related fields:** `reports`

## CASE-P45-001 — Allowed bridge export

- **Category:** `p45_bridge`
- **Input:** ownership-summary.json written
- **Expected:** `allow`
- **Reason:** Bridge artifact allowed
- **Related fields:** `p45Bridge.allowedArtifactPaths`

## CASE-P45-002 — Forbidden runtime implementation

- **Category:** `p45_bridge`
- **Input:** deterministic assembler source added
- **Expected:** `reject`
- **Reason:** P45 runtime forbidden
- **Related fields:** `p45Bridge.forbiddenRuntimePaths`

## CASE-P45-003 — Missing readiness report

- **Category:** `p45_bridge`
- **Input:** final gate lacks p45-readiness
- **Expected:** `block promotion`
- **Reason:** Bridge artifact required
- **Related fields:** `p45Bridge.artifactExports`

## CASE-MIG-001 — v4 Part 3 extracted

- **Category:** `migration`
- **Input:** v4 JSON maps to PlanSpec
- **Expected:** `accept`
- **Reason:** Adapter path supported
- **Related fields:** `migration`

## CASE-MIG-002 — Prose-only requirement

- **Category:** `migration`
- **Input:** no enforcement mapping
- **Expected:** `operator note or block`
- **Reason:** Prose cannot be authority
- **Related fields:** `migration`

## CASE-MIG-003 — Legacy prefix command

- **Category:** `migration`
- **Input:** allowedCommandPrefixes exists
- **Expected:** `convert`
- **Reason:** Prefix removed
- **Related fields:** `commands`
