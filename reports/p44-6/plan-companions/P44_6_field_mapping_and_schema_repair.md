# Field Mapping & Schema Repair — P44.6 PlanSpec

## Summary

The P44.6 plan was authored against an expanded/custom PlanSpec shape. The actual PlanSpec v5 alpha2 validator (in ) expects a strict schema with different field names and shapes. This document maps every discrepancy.

## intent

### Expected fields: ["goal", "successCriteria", "outOfScope", "dependencies?", "blockers?"]

### Unexpected fields: ["executionClass", "safetyLevel", "executionMode", "parallelism", "targetPromotionMode", "p45ImplementationAllowed", "humanReviewRecommended"]

### Action: move to companion artifact

## authority

### Expected fields: ["specification", "executionState", "completion", "commands?"]

### Unexpected fields: ["repositoryMutation", "reports"]

### Action: remove; move reports to companion

## authority.executionState

### Expected fields: ["mode", "maxParallelWorkspaces", "scaleMode?", "worktreeIsolation?", "integrationQueue?", "validationLock?"]

### Unexpected fields: ["owner", "workersMayMutateState", "stateTransitionRequiresGate"]

### Action: remove unexpected fields

## authority.completion

### Expected fields: ["requiresAcceptanceCriteria", "requiresValidationEvidence", "requiresReport", "requiresRollbackPlan", "requiresFinalVerdict"]

### Unexpected fields: ["workerSelfReportIsClaimOnly", "completionGate", "evidenceLedgerRequired", "missingEvidenceBlocksCompletion", "staleAttemptVerdictIgnored"]

### Action: remove unexpected fields

## enforcementRegistry

### Expected fields: ["rules", "policies"]

### Unexpected fields: ["mechanisms"]

### Action: rename mechanisms -> rules+policies or move to companion

## security

### Expected fields: ["selfModificationFirewall", "dataExfiltrationGuard", "secretProtection", "networkAccess?"]

### Unexpected fields: ["schemaValidationRequired", "lockRequiredForExecution", "canonicalJsonHashRequired", "signatureRequired", "signatureAlgorithm", "hardStops", "forbiddenFiles"]

### Action: remove unexpected fields or move to companion

## commands

### Expected fields: ["policy", "allowedCommands?", "blockedCommands?", "timeoutSeconds?", "maxOutputBytes?"]

### Unexpected fields: ["defaultMode", "shellDefault", "exactAllowedCommands", "commandClasses", "runtimeCommandGrant", "hardDeniedCommands", "validationEvidenceRules"]

### Action: restructure to schema shape

## locking

### Expected fields: ["enabled", "hashAlgorithm", "includeTimestamp", "signatureRequired?"]

### Unexpected fields: ["lockVersion", "lockFile", "lockRequired", "workerMustEchoPlanLockHash", "workerMustEchoWorkspaceLockHash", "hashes", "lifecycle", "mutationRules"]

### Action: restructure to schema shape or move to companion

## brief

### Expected fields: ["summary", "keyChanges", "risks", "mitigations"]

### Unexpected fields: ["mission", "hardRequirements", "antiPatterns", "operatorNotes"]

### Action: rename/restructure fields

## waves[n]

### Expected fields: ["id", "title", "description", "order", "tasks", "dependencies?", "estimatedDurationMinutes?"]

### Unexpected fields: ["workspaceIds", "batchSize", "gate"]

### Action: replace workspaceIds with tasks array

## workspaces[n]

### Expected fields: ["id", "name", "rootDir", "canEdit", "canRead?", "isolationLevel?"]

### Unexpected fields: ["title", "waveId", "dependencies", "role", "allowedFiles", "forbiddenFiles", "instructions", "acceptanceCriteria", "validation", "reports", "rollback"]

### Action: keep only schema-compliant fields; move details to companion

## Companion Artifact Strategy

Fields that do not fit the strict schema are moved to companion artifacts:

-  — detailed test gate runbooks and operator notes
-  — structured matrices and scenario tables

