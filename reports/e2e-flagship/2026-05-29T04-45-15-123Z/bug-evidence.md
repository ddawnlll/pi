# Bug Evidence Report

Generated: 2026-05-29T04:45:29.324Z
Total bugs found: 4

## Summary by Severity
- Critical: 0
- High: 4
- Medium: 0
- Low: 0

## Summary by Category
- scheduler: 4

---

## Bug #1: Scheduler violation: orphan — V5.00 was started at 1780029915212 but never completed

- **ID:** `885fc262526a`
- **Severity:** HIGH
- **Category:** scheduler
- **Detected:** 2026-05-29T04:45:29.324Z
- **Run:** 2026-05-29T04-45-15-123Z

### Description
The scheduler made an incorrect decision during plan execution. This may cause data corruption, deadlocks, or incorrect results.

### Observed
```
V5.00 was started at 1780029915212 but never completed
```

### Expected
```
Every launched workspace completes or fails
```

### Evidence
- **Violation type:** `orphan` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_
- **Message:** `V5.00 was started at 1780029915212 but never completed` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_

### Affected Workspaces
- `V5.00`

### Related Files
- `packages/coding-agent/src/core/workspace-scheduler.ts`
- `packages/coding-agent/src/core/autonomous-executor.ts`

### Reproduction
```
Run the plan with the same configuration. The scheduler will make the same decision. Check artifacts at /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-decisions.ndjson.
```

---

## Bug #2: Scheduler violation: orphan — V5.00 was started at 1780029915263 but never completed

- **ID:** `885fc262526a`
- **Severity:** HIGH
- **Category:** scheduler
- **Detected:** 2026-05-29T04:45:29.324Z
- **Run:** 2026-05-29T04-45-15-123Z

### Description
The scheduler made an incorrect decision during plan execution. This may cause data corruption, deadlocks, or incorrect results.

### Observed
```
V5.00 was started at 1780029915263 but never completed
```

### Expected
```
Every launched workspace completes or fails
```

### Evidence
- **Violation type:** `orphan` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_
- **Message:** `V5.00 was started at 1780029915263 but never completed` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_

### Affected Workspaces
- `V5.00`

### Related Files
- `packages/coding-agent/src/core/workspace-scheduler.ts`
- `packages/coding-agent/src/core/autonomous-executor.ts`

### Reproduction
```
Run the plan with the same configuration. The scheduler will make the same decision. Check artifacts at /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-decisions.ndjson.
```

---

## Bug #3: Scheduler violation: orphan — V5.00 was started at 1780029915313 but never completed

- **ID:** `885fc262526a`
- **Severity:** HIGH
- **Category:** scheduler
- **Detected:** 2026-05-29T04:45:29.324Z
- **Run:** 2026-05-29T04-45-15-123Z

### Description
The scheduler made an incorrect decision during plan execution. This may cause data corruption, deadlocks, or incorrect results.

### Observed
```
V5.00 was started at 1780029915313 but never completed
```

### Expected
```
Every launched workspace completes or fails
```

### Evidence
- **Violation type:** `orphan` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_
- **Message:** `V5.00 was started at 1780029915313 but never completed` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_

### Affected Workspaces
- `V5.00`

### Related Files
- `packages/coding-agent/src/core/workspace-scheduler.ts`
- `packages/coding-agent/src/core/autonomous-executor.ts`

### Reproduction
```
Run the plan with the same configuration. The scheduler will make the same decision. Check artifacts at /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-decisions.ndjson.
```

---

## Bug #4: Scheduler violation: duplicate_launch — V5.00 was launched 3 times

- **ID:** `420d0b35e1f2`
- **Severity:** HIGH
- **Category:** scheduler
- **Detected:** 2026-05-29T04:45:29.324Z
- **Run:** 2026-05-29T04-45-15-123Z

### Description
The scheduler made an incorrect decision during plan execution. This may cause data corruption, deadlocks, or incorrect results.

### Observed
```
V5.00 was launched 3 times
```

### Expected
```
Each workspace is launched exactly once per attempt
```

### Evidence
- **Violation type:** `duplicate_launch` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_
- **Message:** `V5.00 was launched 3 times` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_
- **Detail:** `{"launchCount":3}` _(source: /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-correctness.json)_

### Affected Workspaces
- `V5.00`

### Related Files
- `packages/coding-agent/src/core/workspace-scheduler.ts`
- `packages/coding-agent/src/core/autonomous-executor.ts`

### Reproduction
```
Run the plan with the same configuration. The scheduler will make the same decision. Check artifacts at /home/erfolg/src/pi/reports/e2e-flagship/2026-05-29T04-45-15-123Z/scheduler-decisions.ndjson.
```
