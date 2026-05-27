# Derivation Matrix v4

## Inputs

```text
parallelism: 1..8
safetyLevel: relaxed | normal | strict
conflictRisk: none | low | medium | high
executionEnvironment.mode: trusted_local | local_sandbox | cloud_sandbox
```

## Parallelism

```text
parallelism = 1
  worktreeRequired = false unless safetyLevel=strict or conflictRisk>=medium
  integrationQueueRequired = false unless safetyLevel=strict
  validationLaneRequired = true
  GitRunnerQueueRequired = true
  admissionGateMode = normal

parallelism = 2-3
  worktreeRequired = true if conflictRisk>=medium or safetyLevel=strict
  integrationQueueRequired = true if worktreeRequired
  validationLaneRequired = true
  GitRunnerQueueRequired = true
  admissionGateMode = normal/strict depending on safetyLevel

parallelism = 4-6
  worktreeRequired = true
  integrationQueueRequired = true
  validationLaneRequired = true
  heavyValidationMax = 1
  targetedValidationMax = 3
  GitRunnerQueueRequired = true
  eventJournalRequired = true
  admissionGateMode = strict

parallelism = 7-8
  allowed only with scale_8 approval
  worktreeRequired = true
  integrationQueueRequired = true
  validationLaneRequired = true
  stable_6_stress must already pass
  explicitApprovalRequired = true
```

## Safety level

```text
relaxed
  allowed only for parallelism <= 1
  still uses ExecutionKernel invariants
  not allowed for repair/system-substrate mutation

normal
  default deadlines
  normal admission gate
  standard validation lanes

strict
  strict admission gate
  event journal required
  attempt-scoped artifacts required
  integration queue required if any mutation
  handoff required on ambiguity
```

## Conflict risk

```text
none
  worktree optional for parallelism <= 3
  integration queue optional for parallelism = 1

low
  worktree recommended for parallelism >= 2
  integration queue required for parallelism >= 4

medium
  worktree required for parallelism >= 2
  integration queue required
  writeSet drift detection required

high
  worktree required
  integration queue required
  writeSet drift block/handoff required
  same-file parallelism forbidden
```

## Execution environment

```text
trusted_local
  strong sandbox not guaranteed
  doctor warning if untrusted code
  process group kill required

local_sandbox
  CPU/memory/disk/pid quotas required
  network policy required
  env allowlist required
  worktree scoped mount required

cloud_sandbox
  all local_sandbox requirements
  egress firewall required
  ephemeral credentials required
  per-attempt container/VM required
```
