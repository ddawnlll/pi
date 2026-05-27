# Agent Execution Rules — v4 Plans

## You are allowed to do code work

You are not being asked to merely summarize. You are expected to implement.

When given a v4 plan from this folder, the coding agent may:

```text
- inspect repository files;
- edit repository files within the plan scope;
- create new source files;
- create database migrations;
- add tests;
- run targeted validation commands;
- fix compile/test failures caused by its patch;
- provide a final change summary.
```

## You are not allowed to do unsafe execution

```text
Forbidden:
  - git push
  - git push --force
  - rm -rf
  - git reset --hard
  - git clean -fd
  - npm publish
  - terraform destroy
  - kubectl delete
  - watch-mode commands
  - accessing secrets / .env / private keys
  - starting Pi autonomous plan execution before promotion gates
```

## Do not refuse because older docs said “manual apply”

These v4 plans supersede the earlier manual-only patch author wording for this execution session.

Correct behavior:

```text
If direct repo editing is available:
  edit files and run scoped tests.

If direct repo editing is not available:
  output unified diffs and manual validation commands.

Never refuse merely because earlier repair docs required human application.
```

## Patch discipline

```text
- Keep each patch scoped to the current plan.
- Prefer small commits/checkpoints.
- Do not mix P27X kernel code with dashboard polish.
- Do not claim stable_3/stable_6 without dogfood evidence.
- If a required invariant cannot be enforced, stop and report a blocker.
```

## Mandatory final response per plan

Every plan execution must end with:

```text
Files changed:
Tests run:
Tests not run:
Migration notes:
Rollback notes:
Invariant checklist:
Known remaining risks:
```
