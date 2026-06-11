# Compiler Error Dump — Before Fix

## Summary

| Severity | Count |
| --- | --- |
| info | 0 |
| warning | 0 |
| error | 251 |
| fatal | 0 |

## Total: 251 diagnostics

## By Section

### intent (4 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.intent.goal | Invalid input: expected string, received undefined |
| 1 | error | E_INVALID_TYPE | $.intent.successCriteria | Invalid input: expected array, received undefined |
| 2 | error | E_INVALID_TYPE | $.intent.outOfScope | Invalid input: expected array, received undefined |
| 3 | error | E_UNKNOWN_PROPERTY | $.intent | Unknown property: executionClass, safetyLevel, executionMode, parallelism, targetPromotionMode, p45ImplementationAllowed, humanReviewRecommended |

### authority (11 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.authority.specification | Invalid input: expected string, received undefined |
| 1 | error | E_INVALID_TYPE | $.authority.executionState.mode | Invalid input: expected string, received undefined |
| 2 | error | E_INVALID_TYPE | $.authority.executionState.maxParallelWorkspaces | Invalid input: expected number, received undefined |
| 3 | error | E_UNKNOWN_PROPERTY | $.authority.executionState | Unknown property: owner, workersMayMutateState, stateTransitionRequiresGate |
| 4 | error | E_INVALID_TYPE | $.authority.completion.requiresAcceptanceCriteria | Invalid input: expected boolean, received undefined |
| 5 | error | E_INVALID_TYPE | $.authority.completion.requiresValidationEvidence | Invalid input: expected boolean, received undefined |
| 6 | error | E_INVALID_TYPE | $.authority.completion.requiresReport | Invalid input: expected boolean, received undefined |
| 7 | error | E_INVALID_TYPE | $.authority.completion.requiresRollbackPlan | Invalid input: expected boolean, received undefined |
| 8 | error | E_INVALID_TYPE | $.authority.completion.requiresFinalVerdict | Invalid input: expected boolean, received undefined |
| 9 | error | E_UNKNOWN_PROPERTY | $.authority.completion | Unknown property: workerSelfReportIsClaimOnly, completionGate, evidenceLedgerRequired, missingEvidenceBlocksCompletion, staleAttemptVerdictIgnored |
| 10 | error | E_UNKNOWN_PROPERTY | $.authority | Unknown property: repositoryMutation, reports |

### enforcementRegistry (3 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.enforcementRegistry.rules | Invalid input: expected array, received undefined |
| 1 | error | E_INVALID_TYPE | $.enforcementRegistry.policies | Invalid input: expected array, received undefined |
| 2 | error | E_UNKNOWN_PROPERTY | $.enforcementRegistry | Unknown property: mechanisms |

### security (4 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.security.selfModificationFirewall | Invalid input: expected object, received undefined |
| 1 | error | E_INVALID_TYPE | $.security.dataExfiltrationGuard | Invalid input: expected object, received undefined |
| 2 | error | E_INVALID_TYPE | $.security.secretProtection | Invalid input: expected object, received undefined |
| 3 | error | E_UNKNOWN_PROPERTY | $.security | Unknown property: schemaValidationRequired, lockRequiredForExecution, canonicalJsonHashRequired, signatureRequired, signatureAlgorithm, hardStops, forbiddenFiles |

### commands (2 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_VALUE | $.commands.policy | Invalid option: expected one of "strict"|"moderate"|"permissive" |
| 1 | error | E_UNKNOWN_PROPERTY | $.commands | Unknown property: defaultMode, shellDefault, exactAllowedCommands, commandClasses, runtimeCommandGrant, hardDeniedCommands, validationEvidenceRules |

### validation (1 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_UNKNOWN_PROPERTY | $.validation | Unknown property: finalRequired, watchModeForbidden, noTestsFoundIsFailure, commandEvidenceRequired, forbiddenPatterns, finalValidationCommandRefs, discoveryCommandsMayNotSatisfyFinalValidation |

### evidence (3 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_VALUE | $.evidence.captureMode | Invalid option: expected one of "automatic"|"manual"|"hybrid" |
| 1 | error | E_INVALID_TYPE | $.evidence.types | Invalid input: expected array, received undefined |
| 2 | error | E_UNKNOWN_PROPERTY | $.evidence | Unknown property: ledgerRequired, confidenceEnum, requiredEvidenceTypes, evidenceItemRequiredFields, hashWhenAvailable |

### brief (5 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.brief.summary | Invalid input: expected string, received undefined |
| 1 | error | E_INVALID_TYPE | $.brief.keyChanges | Invalid input: expected array, received undefined |
| 2 | error | E_INVALID_TYPE | $.brief.risks | Invalid input: expected array, received undefined |
| 3 | error | E_INVALID_TYPE | $.brief.mitigations | Invalid input: expected array, received undefined |
| 4 | error | E_UNKNOWN_PROPERTY | $.brief | Unknown property: mission, hardRequirements, antiPatterns, operatorNotes |

### locking (4 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.locking.enabled | Invalid input: expected boolean, received undefined |
| 1 | error | E_INVALID_VALUE | $.locking.hashAlgorithm | Invalid option: expected one of "sha256"|"sha512" |
| 2 | error | E_INVALID_TYPE | $.locking.includeTimestamp | Invalid input: expected boolean, received undefined |
| 3 | error | E_UNKNOWN_PROPERTY | $.locking | Unknown property: lockVersion, lockFile, lockRequired, workerMustEchoPlanLockHash, workerMustEchoWorkspaceLockHash, hashes, lifecycle, mutationRules |

### migration (3 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.migration.breakingChanges | Invalid input: expected array, received undefined |
| 1 | error | E_INVALID_TYPE | $.migration.adaptationSteps | Invalid input: expected array, received undefined |
| 2 | error | E_UNKNOWN_PROPERTY | $.migration | Unknown property: from, strategy, adapterRequired, legacyFieldsMapped |

### p45Bridge (5 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.p45Bridge.enabled | Invalid input: expected boolean, received undefined |
| 1 | error | E_INVALID_TYPE | $.p45Bridge.artifactSafety | Invalid input: expected boolean, received undefined |
| 2 | error | E_INVALID_TYPE | $.p45Bridge.mutationTracking | Invalid input: expected boolean, received undefined |
| 3 | error | E_INVALID_TYPE | $.p45Bridge.commitGating | Invalid input: expected boolean, received undefined |
| 4 | error | E_UNKNOWN_PROPERTY | $.p45Bridge | Unknown property: implementationAllowed, allowedArtifactPaths, forbiddenRuntimePaths, artifactExports |

### reports (5 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_VALUE | $.reports.format | Invalid option: expected one of "markdown"|"json"|"html" |
| 1 | error | E_INVALID_TYPE | $.reports.includeMetrics | Invalid input: expected boolean, received undefined |
| 2 | error | E_INVALID_TYPE | $.reports.includeTimeline | Invalid input: expected boolean, received undefined |
| 3 | error | E_INVALID_TYPE | $.reports.includeDiffSummary | Invalid input: expected boolean, received undefined |
| 4 | error | E_UNKNOWN_PROPERTY | $.reports | Unknown property: protocol, version, required, artifactDirectory, stableIdsRequired, commandEvidenceRequired, rollbackPlanRequiredForMutation |

### waves (33 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.waves.0.order | Invalid input: expected number, received undefined |
| 1 | error | E_INVALID_TYPE | $.waves.0.tasks | Invalid input: expected array, received undefined |
| 2 | error | E_UNKNOWN_PROPERTY | $.waves.0 | Unknown property: workspaceIds, batchSize, gate |
| 3 | error | E_INVALID_TYPE | $.waves.1.order | Invalid input: expected number, received undefined |
| 4 | error | E_INVALID_TYPE | $.waves.1.tasks | Invalid input: expected array, received undefined |
| 5 | error | E_UNKNOWN_PROPERTY | $.waves.1 | Unknown property: workspaceIds, batchSize, gate |
| 6 | error | E_INVALID_TYPE | $.waves.2.order | Invalid input: expected number, received undefined |
| 7 | error | E_INVALID_TYPE | $.waves.2.tasks | Invalid input: expected array, received undefined |
| 8 | error | E_UNKNOWN_PROPERTY | $.waves.2 | Unknown property: workspaceIds, batchSize, gate |
| 9 | error | E_INVALID_TYPE | $.waves.3.order | Invalid input: expected number, received undefined |
| 10 | error | E_INVALID_TYPE | $.waves.3.tasks | Invalid input: expected array, received undefined |
| 11 | error | E_UNKNOWN_PROPERTY | $.waves.3 | Unknown property: workspaceIds, batchSize, gate |
| 12 | error | E_INVALID_TYPE | $.waves.4.order | Invalid input: expected number, received undefined |
| 13 | error | E_INVALID_TYPE | $.waves.4.tasks | Invalid input: expected array, received undefined |
| 14 | error | E_UNKNOWN_PROPERTY | $.waves.4 | Unknown property: workspaceIds, batchSize, gate |
| 15 | error | E_INVALID_TYPE | $.waves.5.order | Invalid input: expected number, received undefined |
| 16 | error | E_INVALID_TYPE | $.waves.5.tasks | Invalid input: expected array, received undefined |
| 17 | error | E_UNKNOWN_PROPERTY | $.waves.5 | Unknown property: workspaceIds, batchSize, gate |
| 18 | error | E_INVALID_TYPE | $.waves.6.order | Invalid input: expected number, received undefined |
| 19 | error | E_INVALID_TYPE | $.waves.6.tasks | Invalid input: expected array, received undefined |
| 20 | error | E_UNKNOWN_PROPERTY | $.waves.6 | Unknown property: workspaceIds, batchSize, gate |
| 21 | error | E_INVALID_TYPE | $.waves.7.order | Invalid input: expected number, received undefined |
| 22 | error | E_INVALID_TYPE | $.waves.7.tasks | Invalid input: expected array, received undefined |
| 23 | error | E_UNKNOWN_PROPERTY | $.waves.7 | Unknown property: workspaceIds, batchSize, gate |
| 24 | error | E_INVALID_TYPE | $.waves.8.order | Invalid input: expected number, received undefined |
| 25 | error | E_INVALID_TYPE | $.waves.8.tasks | Invalid input: expected array, received undefined |
| 26 | error | E_UNKNOWN_PROPERTY | $.waves.8 | Unknown property: workspaceIds, batchSize, gate |
| 27 | error | E_INVALID_TYPE | $.waves.9.order | Invalid input: expected number, received undefined |
| 28 | error | E_INVALID_TYPE | $.waves.9.tasks | Invalid input: expected array, received undefined |
| 29 | error | E_UNKNOWN_PROPERTY | $.waves.9 | Unknown property: workspaceIds, batchSize, gate |
| 30 | error | E_INVALID_TYPE | $.waves.10.order | Invalid input: expected number, received undefined |
| 31 | error | E_INVALID_TYPE | $.waves.10.tasks | Invalid input: expected array, received undefined |
| 32 | error | E_UNKNOWN_PROPERTY | $.waves.10 | Unknown property: workspaceIds, batchSize, gate |

### workspaces (168 issues)

| Index | Severity | Code | Path | Message |
| --- | --- | --- | --- | --- |
| 0 | error | E_INVALID_TYPE | $.workspaces.0.name | Invalid input: expected string, received undefined |
| 1 | error | E_INVALID_TYPE | $.workspaces.0.rootDir | Invalid input: expected string, received undefined |
| 2 | error | E_INVALID_TYPE | $.workspaces.0.canEdit | Invalid input: expected array, received undefined |
| 3 | error | E_UNKNOWN_PROPERTY | $.workspaces.0 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 4 | error | E_INVALID_TYPE | $.workspaces.1.name | Invalid input: expected string, received undefined |
| 5 | error | E_INVALID_TYPE | $.workspaces.1.rootDir | Invalid input: expected string, received undefined |
| 6 | error | E_INVALID_TYPE | $.workspaces.1.canEdit | Invalid input: expected array, received undefined |
| 7 | error | E_UNKNOWN_PROPERTY | $.workspaces.1 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 8 | error | E_INVALID_TYPE | $.workspaces.2.name | Invalid input: expected string, received undefined |
| 9 | error | E_INVALID_TYPE | $.workspaces.2.rootDir | Invalid input: expected string, received undefined |
| 10 | error | E_INVALID_TYPE | $.workspaces.2.canEdit | Invalid input: expected array, received undefined |
| 11 | error | E_UNKNOWN_PROPERTY | $.workspaces.2 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 12 | error | E_INVALID_TYPE | $.workspaces.3.name | Invalid input: expected string, received undefined |
| 13 | error | E_INVALID_TYPE | $.workspaces.3.rootDir | Invalid input: expected string, received undefined |
| 14 | error | E_INVALID_TYPE | $.workspaces.3.canEdit | Invalid input: expected array, received undefined |
| 15 | error | E_UNKNOWN_PROPERTY | $.workspaces.3 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 16 | error | E_INVALID_TYPE | $.workspaces.4.name | Invalid input: expected string, received undefined |
| 17 | error | E_INVALID_TYPE | $.workspaces.4.rootDir | Invalid input: expected string, received undefined |
| 18 | error | E_INVALID_TYPE | $.workspaces.4.canEdit | Invalid input: expected array, received undefined |
| 19 | error | E_UNKNOWN_PROPERTY | $.workspaces.4 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 20 | error | E_INVALID_TYPE | $.workspaces.5.name | Invalid input: expected string, received undefined |
| 21 | error | E_INVALID_TYPE | $.workspaces.5.rootDir | Invalid input: expected string, received undefined |
| 22 | error | E_INVALID_TYPE | $.workspaces.5.canEdit | Invalid input: expected array, received undefined |
| 23 | error | E_UNKNOWN_PROPERTY | $.workspaces.5 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 24 | error | E_INVALID_TYPE | $.workspaces.6.name | Invalid input: expected string, received undefined |
| 25 | error | E_INVALID_TYPE | $.workspaces.6.rootDir | Invalid input: expected string, received undefined |
| 26 | error | E_INVALID_TYPE | $.workspaces.6.canEdit | Invalid input: expected array, received undefined |
| 27 | error | E_UNKNOWN_PROPERTY | $.workspaces.6 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 28 | error | E_INVALID_TYPE | $.workspaces.7.name | Invalid input: expected string, received undefined |
| 29 | error | E_INVALID_TYPE | $.workspaces.7.rootDir | Invalid input: expected string, received undefined |
| 30 | error | E_INVALID_TYPE | $.workspaces.7.canEdit | Invalid input: expected array, received undefined |
| 31 | error | E_UNKNOWN_PROPERTY | $.workspaces.7 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 32 | error | E_INVALID_TYPE | $.workspaces.8.name | Invalid input: expected string, received undefined |
| 33 | error | E_INVALID_TYPE | $.workspaces.8.rootDir | Invalid input: expected string, received undefined |
| 34 | error | E_INVALID_TYPE | $.workspaces.8.canEdit | Invalid input: expected array, received undefined |
| 35 | error | E_UNKNOWN_PROPERTY | $.workspaces.8 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 36 | error | E_INVALID_TYPE | $.workspaces.9.name | Invalid input: expected string, received undefined |
| 37 | error | E_INVALID_TYPE | $.workspaces.9.rootDir | Invalid input: expected string, received undefined |
| 38 | error | E_INVALID_TYPE | $.workspaces.9.canEdit | Invalid input: expected array, received undefined |
| 39 | error | E_UNKNOWN_PROPERTY | $.workspaces.9 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 40 | error | E_INVALID_TYPE | $.workspaces.10.name | Invalid input: expected string, received undefined |
| 41 | error | E_INVALID_TYPE | $.workspaces.10.rootDir | Invalid input: expected string, received undefined |
| 42 | error | E_INVALID_TYPE | $.workspaces.10.canEdit | Invalid input: expected array, received undefined |
| 43 | error | E_UNKNOWN_PROPERTY | $.workspaces.10 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 44 | error | E_INVALID_TYPE | $.workspaces.11.name | Invalid input: expected string, received undefined |
| 45 | error | E_INVALID_TYPE | $.workspaces.11.rootDir | Invalid input: expected string, received undefined |
| 46 | error | E_INVALID_TYPE | $.workspaces.11.canEdit | Invalid input: expected array, received undefined |
| 47 | error | E_UNKNOWN_PROPERTY | $.workspaces.11 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 48 | error | E_INVALID_TYPE | $.workspaces.12.name | Invalid input: expected string, received undefined |
| 49 | error | E_INVALID_TYPE | $.workspaces.12.rootDir | Invalid input: expected string, received undefined |
| 50 | error | E_INVALID_TYPE | $.workspaces.12.canEdit | Invalid input: expected array, received undefined |
| 51 | error | E_UNKNOWN_PROPERTY | $.workspaces.12 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 52 | error | E_INVALID_TYPE | $.workspaces.13.name | Invalid input: expected string, received undefined |
| 53 | error | E_INVALID_TYPE | $.workspaces.13.rootDir | Invalid input: expected string, received undefined |
| 54 | error | E_INVALID_TYPE | $.workspaces.13.canEdit | Invalid input: expected array, received undefined |
| 55 | error | E_UNKNOWN_PROPERTY | $.workspaces.13 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 56 | error | E_INVALID_TYPE | $.workspaces.14.name | Invalid input: expected string, received undefined |
| 57 | error | E_INVALID_TYPE | $.workspaces.14.rootDir | Invalid input: expected string, received undefined |
| 58 | error | E_INVALID_TYPE | $.workspaces.14.canEdit | Invalid input: expected array, received undefined |
| 59 | error | E_UNKNOWN_PROPERTY | $.workspaces.14 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 60 | error | E_INVALID_TYPE | $.workspaces.15.name | Invalid input: expected string, received undefined |
| 61 | error | E_INVALID_TYPE | $.workspaces.15.rootDir | Invalid input: expected string, received undefined |
| 62 | error | E_INVALID_TYPE | $.workspaces.15.canEdit | Invalid input: expected array, received undefined |
| 63 | error | E_UNKNOWN_PROPERTY | $.workspaces.15 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 64 | error | E_INVALID_TYPE | $.workspaces.16.name | Invalid input: expected string, received undefined |
| 65 | error | E_INVALID_TYPE | $.workspaces.16.rootDir | Invalid input: expected string, received undefined |
| 66 | error | E_INVALID_TYPE | $.workspaces.16.canEdit | Invalid input: expected array, received undefined |
| 67 | error | E_UNKNOWN_PROPERTY | $.workspaces.16 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 68 | error | E_INVALID_TYPE | $.workspaces.17.name | Invalid input: expected string, received undefined |
| 69 | error | E_INVALID_TYPE | $.workspaces.17.rootDir | Invalid input: expected string, received undefined |
| 70 | error | E_INVALID_TYPE | $.workspaces.17.canEdit | Invalid input: expected array, received undefined |
| 71 | error | E_UNKNOWN_PROPERTY | $.workspaces.17 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 72 | error | E_INVALID_TYPE | $.workspaces.18.name | Invalid input: expected string, received undefined |
| 73 | error | E_INVALID_TYPE | $.workspaces.18.rootDir | Invalid input: expected string, received undefined |
| 74 | error | E_INVALID_TYPE | $.workspaces.18.canEdit | Invalid input: expected array, received undefined |
| 75 | error | E_UNKNOWN_PROPERTY | $.workspaces.18 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 76 | error | E_INVALID_TYPE | $.workspaces.19.name | Invalid input: expected string, received undefined |
| 77 | error | E_INVALID_TYPE | $.workspaces.19.rootDir | Invalid input: expected string, received undefined |
| 78 | error | E_INVALID_TYPE | $.workspaces.19.canEdit | Invalid input: expected array, received undefined |
| 79 | error | E_UNKNOWN_PROPERTY | $.workspaces.19 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 80 | error | E_INVALID_TYPE | $.workspaces.20.name | Invalid input: expected string, received undefined |
| 81 | error | E_INVALID_TYPE | $.workspaces.20.rootDir | Invalid input: expected string, received undefined |
| 82 | error | E_INVALID_TYPE | $.workspaces.20.canEdit | Invalid input: expected array, received undefined |
| 83 | error | E_UNKNOWN_PROPERTY | $.workspaces.20 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 84 | error | E_INVALID_TYPE | $.workspaces.21.name | Invalid input: expected string, received undefined |
| 85 | error | E_INVALID_TYPE | $.workspaces.21.rootDir | Invalid input: expected string, received undefined |
| 86 | error | E_INVALID_TYPE | $.workspaces.21.canEdit | Invalid input: expected array, received undefined |
| 87 | error | E_UNKNOWN_PROPERTY | $.workspaces.21 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 88 | error | E_INVALID_TYPE | $.workspaces.22.name | Invalid input: expected string, received undefined |
| 89 | error | E_INVALID_TYPE | $.workspaces.22.rootDir | Invalid input: expected string, received undefined |
| 90 | error | E_INVALID_TYPE | $.workspaces.22.canEdit | Invalid input: expected array, received undefined |
| 91 | error | E_UNKNOWN_PROPERTY | $.workspaces.22 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 92 | error | E_INVALID_TYPE | $.workspaces.23.name | Invalid input: expected string, received undefined |
| 93 | error | E_INVALID_TYPE | $.workspaces.23.rootDir | Invalid input: expected string, received undefined |
| 94 | error | E_INVALID_TYPE | $.workspaces.23.canEdit | Invalid input: expected array, received undefined |
| 95 | error | E_UNKNOWN_PROPERTY | $.workspaces.23 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 96 | error | E_INVALID_TYPE | $.workspaces.24.name | Invalid input: expected string, received undefined |
| 97 | error | E_INVALID_TYPE | $.workspaces.24.rootDir | Invalid input: expected string, received undefined |
| 98 | error | E_INVALID_TYPE | $.workspaces.24.canEdit | Invalid input: expected array, received undefined |
| 99 | error | E_UNKNOWN_PROPERTY | $.workspaces.24 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 100 | error | E_INVALID_TYPE | $.workspaces.25.name | Invalid input: expected string, received undefined |
| 101 | error | E_INVALID_TYPE | $.workspaces.25.rootDir | Invalid input: expected string, received undefined |
| 102 | error | E_INVALID_TYPE | $.workspaces.25.canEdit | Invalid input: expected array, received undefined |
| 103 | error | E_UNKNOWN_PROPERTY | $.workspaces.25 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 104 | error | E_INVALID_TYPE | $.workspaces.26.name | Invalid input: expected string, received undefined |
| 105 | error | E_INVALID_TYPE | $.workspaces.26.rootDir | Invalid input: expected string, received undefined |
| 106 | error | E_INVALID_TYPE | $.workspaces.26.canEdit | Invalid input: expected array, received undefined |
| 107 | error | E_UNKNOWN_PROPERTY | $.workspaces.26 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 108 | error | E_INVALID_TYPE | $.workspaces.27.name | Invalid input: expected string, received undefined |
| 109 | error | E_INVALID_TYPE | $.workspaces.27.rootDir | Invalid input: expected string, received undefined |
| 110 | error | E_INVALID_TYPE | $.workspaces.27.canEdit | Invalid input: expected array, received undefined |
| 111 | error | E_UNKNOWN_PROPERTY | $.workspaces.27 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 112 | error | E_INVALID_TYPE | $.workspaces.28.name | Invalid input: expected string, received undefined |
| 113 | error | E_INVALID_TYPE | $.workspaces.28.rootDir | Invalid input: expected string, received undefined |
| 114 | error | E_INVALID_TYPE | $.workspaces.28.canEdit | Invalid input: expected array, received undefined |
| 115 | error | E_UNKNOWN_PROPERTY | $.workspaces.28 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 116 | error | E_INVALID_TYPE | $.workspaces.29.name | Invalid input: expected string, received undefined |
| 117 | error | E_INVALID_TYPE | $.workspaces.29.rootDir | Invalid input: expected string, received undefined |
| 118 | error | E_INVALID_TYPE | $.workspaces.29.canEdit | Invalid input: expected array, received undefined |
| 119 | error | E_UNKNOWN_PROPERTY | $.workspaces.29 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 120 | error | E_INVALID_TYPE | $.workspaces.30.name | Invalid input: expected string, received undefined |
| 121 | error | E_INVALID_TYPE | $.workspaces.30.rootDir | Invalid input: expected string, received undefined |
| 122 | error | E_INVALID_TYPE | $.workspaces.30.canEdit | Invalid input: expected array, received undefined |
| 123 | error | E_UNKNOWN_PROPERTY | $.workspaces.30 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 124 | error | E_INVALID_TYPE | $.workspaces.31.name | Invalid input: expected string, received undefined |
| 125 | error | E_INVALID_TYPE | $.workspaces.31.rootDir | Invalid input: expected string, received undefined |
| 126 | error | E_INVALID_TYPE | $.workspaces.31.canEdit | Invalid input: expected array, received undefined |
| 127 | error | E_UNKNOWN_PROPERTY | $.workspaces.31 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 128 | error | E_INVALID_TYPE | $.workspaces.32.name | Invalid input: expected string, received undefined |
| 129 | error | E_INVALID_TYPE | $.workspaces.32.rootDir | Invalid input: expected string, received undefined |
| 130 | error | E_INVALID_TYPE | $.workspaces.32.canEdit | Invalid input: expected array, received undefined |
| 131 | error | E_UNKNOWN_PROPERTY | $.workspaces.32 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 132 | error | E_INVALID_TYPE | $.workspaces.33.name | Invalid input: expected string, received undefined |
| 133 | error | E_INVALID_TYPE | $.workspaces.33.rootDir | Invalid input: expected string, received undefined |
| 134 | error | E_INVALID_TYPE | $.workspaces.33.canEdit | Invalid input: expected array, received undefined |
| 135 | error | E_UNKNOWN_PROPERTY | $.workspaces.33 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 136 | error | E_INVALID_TYPE | $.workspaces.34.name | Invalid input: expected string, received undefined |
| 137 | error | E_INVALID_TYPE | $.workspaces.34.rootDir | Invalid input: expected string, received undefined |
| 138 | error | E_INVALID_TYPE | $.workspaces.34.canEdit | Invalid input: expected array, received undefined |
| 139 | error | E_UNKNOWN_PROPERTY | $.workspaces.34 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 140 | error | E_INVALID_TYPE | $.workspaces.35.name | Invalid input: expected string, received undefined |
| 141 | error | E_INVALID_TYPE | $.workspaces.35.rootDir | Invalid input: expected string, received undefined |
| 142 | error | E_INVALID_TYPE | $.workspaces.35.canEdit | Invalid input: expected array, received undefined |
| 143 | error | E_UNKNOWN_PROPERTY | $.workspaces.35 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 144 | error | E_INVALID_TYPE | $.workspaces.36.name | Invalid input: expected string, received undefined |
| 145 | error | E_INVALID_TYPE | $.workspaces.36.rootDir | Invalid input: expected string, received undefined |
| 146 | error | E_INVALID_TYPE | $.workspaces.36.canEdit | Invalid input: expected array, received undefined |
| 147 | error | E_UNKNOWN_PROPERTY | $.workspaces.36 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 148 | error | E_INVALID_TYPE | $.workspaces.37.name | Invalid input: expected string, received undefined |
| 149 | error | E_INVALID_TYPE | $.workspaces.37.rootDir | Invalid input: expected string, received undefined |
| 150 | error | E_INVALID_TYPE | $.workspaces.37.canEdit | Invalid input: expected array, received undefined |
| 151 | error | E_UNKNOWN_PROPERTY | $.workspaces.37 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 152 | error | E_INVALID_TYPE | $.workspaces.38.name | Invalid input: expected string, received undefined |
| 153 | error | E_INVALID_TYPE | $.workspaces.38.rootDir | Invalid input: expected string, received undefined |
| 154 | error | E_INVALID_TYPE | $.workspaces.38.canEdit | Invalid input: expected array, received undefined |
| 155 | error | E_UNKNOWN_PROPERTY | $.workspaces.38 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 156 | error | E_INVALID_TYPE | $.workspaces.39.name | Invalid input: expected string, received undefined |
| 157 | error | E_INVALID_TYPE | $.workspaces.39.rootDir | Invalid input: expected string, received undefined |
| 158 | error | E_INVALID_TYPE | $.workspaces.39.canEdit | Invalid input: expected array, received undefined |
| 159 | error | E_UNKNOWN_PROPERTY | $.workspaces.39 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 160 | error | E_INVALID_TYPE | $.workspaces.40.name | Invalid input: expected string, received undefined |
| 161 | error | E_INVALID_TYPE | $.workspaces.40.rootDir | Invalid input: expected string, received undefined |
| 162 | error | E_INVALID_TYPE | $.workspaces.40.canEdit | Invalid input: expected array, received undefined |
| 163 | error | E_UNKNOWN_PROPERTY | $.workspaces.40 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |
| 164 | error | E_INVALID_TYPE | $.workspaces.41.name | Invalid input: expected string, received undefined |
| 165 | error | E_INVALID_TYPE | $.workspaces.41.rootDir | Invalid input: expected string, received undefined |
| 166 | error | E_INVALID_TYPE | $.workspaces.41.canEdit | Invalid input: expected array, received undefined |
| 167 | error | E_UNKNOWN_PROPERTY | $.workspaces.41 | Unknown property: title, waveId, dependencies, role, allowedFiles, forbiddenFiles, instructions, acceptanceCriteria, validation, reports, rollback |

## By Issue Code

### E_INVALID_TYPE (180 issues)

| Path | Message | Unknown Keys |
| --- | --- | --- |
| $.intent.goal | Invalid input: expected string, received undefined | - |
| $.intent.successCriteria | Invalid input: expected array, received undefined | - |
| $.intent.outOfScope | Invalid input: expected array, received undefined | - |
| $.authority.specification | Invalid input: expected string, received undefined | - |
| $.authority.executionState.mode | Invalid input: expected string, received undefined | - |
| $.authority.executionState.maxParallelWorkspaces | Invalid input: expected number, received undefined | - |
| $.authority.completion.requiresAcceptanceCriteria | Invalid input: expected boolean, received undefined | - |
| $.authority.completion.requiresValidationEvidence | Invalid input: expected boolean, received undefined | - |
| $.authority.completion.requiresReport | Invalid input: expected boolean, received undefined | - |
| $.authority.completion.requiresRollbackPlan | Invalid input: expected boolean, received undefined | - |
| $.authority.completion.requiresFinalVerdict | Invalid input: expected boolean, received undefined | - |
| $.enforcementRegistry.rules | Invalid input: expected array, received undefined | - |
| $.enforcementRegistry.policies | Invalid input: expected array, received undefined | - |
| $.security.selfModificationFirewall | Invalid input: expected object, received undefined | - |
| $.security.dataExfiltrationGuard | Invalid input: expected object, received undefined | - |
| $.security.secretProtection | Invalid input: expected object, received undefined | - |
| $.evidence.types | Invalid input: expected array, received undefined | - |
| $.brief.summary | Invalid input: expected string, received undefined | - |
| $.brief.keyChanges | Invalid input: expected array, received undefined | - |
| $.brief.risks | Invalid input: expected array, received undefined | - |
| ... | (160 more) | ... |

### E_UNKNOWN_PROPERTY (67 issues)

| Path | Message | Unknown Keys |
| --- | --- | --- |
| $.intent | Unknown property: executionClass, safetyLevel, executionMode, parallelism, targetPromotionMode, p45ImplementationAllowed, humanReviewRecommended | executionClass, safetyLevel, executionMode, parallelism, targetPromotionMode, p45ImplementationAllowed, humanReviewRecommended |
| $.authority.executionState | Unknown property: owner, workersMayMutateState, stateTransitionRequiresGate | owner, workersMayMutateState, stateTransitionRequiresGate |
| $.authority.completion | Unknown property: workerSelfReportIsClaimOnly, completionGate, evidenceLedgerRequired, missingEvidenceBlocksCompletion, staleAttemptVerdictIgnored | workerSelfReportIsClaimOnly, completionGate, evidenceLedgerRequired, missingEvidenceBlocksCompletion, staleAttemptVerdictIgnored |
| $.authority | Unknown property: repositoryMutation, reports | repositoryMutation, reports |
| $.enforcementRegistry | Unknown property: mechanisms | mechanisms |
| $.security | Unknown property: schemaValidationRequired, lockRequiredForExecution, canonicalJsonHashRequired, signatureRequired, signatureAlgorithm, hardStops, forbiddenFiles | schemaValidationRequired, lockRequiredForExecution, canonicalJsonHashRequired, signatureRequired, signatureAlgorithm, hardStops, forbiddenFiles |
| $.commands | Unknown property: defaultMode, shellDefault, exactAllowedCommands, commandClasses, runtimeCommandGrant, hardDeniedCommands, validationEvidenceRules | defaultMode, shellDefault, exactAllowedCommands, commandClasses, runtimeCommandGrant, hardDeniedCommands, validationEvidenceRules |
| $.validation | Unknown property: finalRequired, watchModeForbidden, noTestsFoundIsFailure, commandEvidenceRequired, forbiddenPatterns, finalValidationCommandRefs, discoveryCommandsMayNotSatisfyFinalValidation | finalRequired, watchModeForbidden, noTestsFoundIsFailure, commandEvidenceRequired, forbiddenPatterns, finalValidationCommandRefs, discoveryCommandsMayNotSatisfyFinalValidation |
| $.evidence | Unknown property: ledgerRequired, confidenceEnum, requiredEvidenceTypes, evidenceItemRequiredFields, hashWhenAvailable | ledgerRequired, confidenceEnum, requiredEvidenceTypes, evidenceItemRequiredFields, hashWhenAvailable |
| $.brief | Unknown property: mission, hardRequirements, antiPatterns, operatorNotes | mission, hardRequirements, antiPatterns, operatorNotes |
| $.locking | Unknown property: lockVersion, lockFile, lockRequired, workerMustEchoPlanLockHash, workerMustEchoWorkspaceLockHash, hashes, lifecycle, mutationRules | lockVersion, lockFile, lockRequired, workerMustEchoPlanLockHash, workerMustEchoWorkspaceLockHash, hashes, lifecycle, mutationRules |
| $.migration | Unknown property: from, strategy, adapterRequired, legacyFieldsMapped | from, strategy, adapterRequired, legacyFieldsMapped |
| $.p45Bridge | Unknown property: implementationAllowed, allowedArtifactPaths, forbiddenRuntimePaths, artifactExports | implementationAllowed, allowedArtifactPaths, forbiddenRuntimePaths, artifactExports |
| $.reports | Unknown property: protocol, version, required, artifactDirectory, stableIdsRequired, commandEvidenceRequired, rollbackPlanRequiredForMutation | protocol, version, required, artifactDirectory, stableIdsRequired, commandEvidenceRequired, rollbackPlanRequiredForMutation |
| $.waves.0 | Unknown property: workspaceIds, batchSize, gate | workspaceIds, batchSize, gate |
| $.waves.1 | Unknown property: workspaceIds, batchSize, gate | workspaceIds, batchSize, gate |
| $.waves.2 | Unknown property: workspaceIds, batchSize, gate | workspaceIds, batchSize, gate |
| $.waves.3 | Unknown property: workspaceIds, batchSize, gate | workspaceIds, batchSize, gate |
| $.waves.4 | Unknown property: workspaceIds, batchSize, gate | workspaceIds, batchSize, gate |
| $.waves.5 | Unknown property: workspaceIds, batchSize, gate | workspaceIds, batchSize, gate |
| ... | (47 more) | ... |

### E_INVALID_VALUE (4 issues)

| Path | Message | Unknown Keys |
| --- | --- | --- |
| $.commands.policy | Invalid option: expected one of "strict"|"moderate"|"permissive" | - |
| $.evidence.captureMode | Invalid option: expected one of "automatic"|"manual"|"hybrid" | - |
| $.locking.hashAlgorithm | Invalid option: expected one of "sha256"|"sha512" | - |
| $.reports.format | Invalid option: expected one of "markdown"|"json"|"html" | - |

## First 20 Diagnostics (full details)

### Issue #0

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.intent.goal
- Message: Invalid input: expected string, received undefined
- Zod Code: invalid_type
- Expected: string
- Section: intent
- Parent: $.intent

### Issue #1

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.intent.successCriteria
- Message: Invalid input: expected array, received undefined
- Zod Code: invalid_type
- Expected: array
- Section: intent
- Parent: $.intent

### Issue #2

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.intent.outOfScope
- Message: Invalid input: expected array, received undefined
- Zod Code: invalid_type
- Expected: array
- Section: intent
- Parent: $.intent

### Issue #3

- Code: E_UNKNOWN_PROPERTY
- Severity: error
- Path: $.intent
- Message: Unknown property: executionClass, safetyLevel, executionMode, parallelism, targetPromotionMode, p45ImplementationAllowed, humanReviewRecommended
- Zod Code: unrecognized_keys
- Unknown Keys: executionClass, safetyLevel, executionMode, parallelism, targetPromotionMode, p45ImplementationAllowed, humanReviewRecommended
- Section: intent
- Parent: $

### Issue #4

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.specification
- Message: Invalid input: expected string, received undefined
- Zod Code: invalid_type
- Expected: string
- Section: authority
- Parent: $.authority

### Issue #5

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.executionState.mode
- Message: Invalid input: expected string, received undefined
- Zod Code: invalid_type
- Expected: string
- Section: authority
- Parent: $.authority.executionState

### Issue #6

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.executionState.maxParallelWorkspaces
- Message: Invalid input: expected number, received undefined
- Zod Code: invalid_type
- Expected: number
- Section: authority
- Parent: $.authority.executionState

### Issue #7

- Code: E_UNKNOWN_PROPERTY
- Severity: error
- Path: $.authority.executionState
- Message: Unknown property: owner, workersMayMutateState, stateTransitionRequiresGate
- Zod Code: unrecognized_keys
- Unknown Keys: owner, workersMayMutateState, stateTransitionRequiresGate
- Section: authority
- Parent: $.authority

### Issue #8

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.completion.requiresAcceptanceCriteria
- Message: Invalid input: expected boolean, received undefined
- Zod Code: invalid_type
- Expected: boolean
- Section: authority
- Parent: $.authority.completion

### Issue #9

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.completion.requiresValidationEvidence
- Message: Invalid input: expected boolean, received undefined
- Zod Code: invalid_type
- Expected: boolean
- Section: authority
- Parent: $.authority.completion

### Issue #10

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.completion.requiresReport
- Message: Invalid input: expected boolean, received undefined
- Zod Code: invalid_type
- Expected: boolean
- Section: authority
- Parent: $.authority.completion

### Issue #11

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.completion.requiresRollbackPlan
- Message: Invalid input: expected boolean, received undefined
- Zod Code: invalid_type
- Expected: boolean
- Section: authority
- Parent: $.authority.completion

### Issue #12

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.authority.completion.requiresFinalVerdict
- Message: Invalid input: expected boolean, received undefined
- Zod Code: invalid_type
- Expected: boolean
- Section: authority
- Parent: $.authority.completion

### Issue #13

- Code: E_UNKNOWN_PROPERTY
- Severity: error
- Path: $.authority.completion
- Message: Unknown property: workerSelfReportIsClaimOnly, completionGate, evidenceLedgerRequired, missingEvidenceBlocksCompletion, staleAttemptVerdictIgnored
- Zod Code: unrecognized_keys
- Unknown Keys: workerSelfReportIsClaimOnly, completionGate, evidenceLedgerRequired, missingEvidenceBlocksCompletion, staleAttemptVerdictIgnored
- Section: authority
- Parent: $.authority

### Issue #14

- Code: E_UNKNOWN_PROPERTY
- Severity: error
- Path: $.authority
- Message: Unknown property: repositoryMutation, reports
- Zod Code: unrecognized_keys
- Unknown Keys: repositoryMutation, reports
- Section: authority
- Parent: $

### Issue #15

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.enforcementRegistry.rules
- Message: Invalid input: expected array, received undefined
- Zod Code: invalid_type
- Expected: array
- Section: enforcementRegistry
- Parent: $.enforcementRegistry

### Issue #16

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.enforcementRegistry.policies
- Message: Invalid input: expected array, received undefined
- Zod Code: invalid_type
- Expected: array
- Section: enforcementRegistry
- Parent: $.enforcementRegistry

### Issue #17

- Code: E_UNKNOWN_PROPERTY
- Severity: error
- Path: $.enforcementRegistry
- Message: Unknown property: mechanisms
- Zod Code: unrecognized_keys
- Unknown Keys: mechanisms
- Section: enforcementRegistry
- Parent: $

### Issue #18

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.security.selfModificationFirewall
- Message: Invalid input: expected object, received undefined
- Zod Code: invalid_type
- Expected: object
- Section: security
- Parent: $.security

### Issue #19

- Code: E_INVALID_TYPE
- Severity: error
- Path: $.security.dataExfiltrationGuard
- Message: Invalid input: expected object, received undefined
- Zod Code: invalid_type
- Expected: object
- Section: security
- Parent: $.security

