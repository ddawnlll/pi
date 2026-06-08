# Project State Snapshot + Incremental Projector — Vision v2

**Document:** `vision.md`  
**Status:** Design vision / implementation-ready architecture draft  
**Owner:** Pi coding-agent architecture  
**Target package:** `packages/coding-agent`  
**Primary goal:** Reduce repeated repository-discovery and file-read token cost while preserving correctness under tool, bash, git, IDE, and external filesystem mutations.

---

## 0. Executive Summary

The original idea was a `/snapshot` command that pre-caches Smart Read output for source files. That is useful, but too narrow.

The better design is a **Project State Snapshot Layer**: a repo-local state model that captures low-volatility project facts once, reuses them across reads and discovery commands, and incrementally updates itself as the project changes.

The final mental model is:

```text
Project State = Baseline Snapshot + Event Overlay + Watcher/Reconcile + Read-Time Verification
```

This means:

1. `/snapshot` creates a **baseline checkpoint** of the project.
2. Pi tool events update state precisely when Pi performs known mutations.
3. Filesystem watcher events detect changes caused by unknown bash commands, IDE saves, git operations, or external terminals.
4. A reconcile scanner converts watcher hints into verified file diffs.
5. Read-time verification remains the final authority before any cache is trusted.

The most important safety rule:

```text
Cache is advisory. Filesystem is authority.
```

This design is not merely a Smart Read optimization. It is a **repo state memory layer** for Pi.

---

## 1. Why This Exists

Pi repeatedly spends tokens and time rediscovering facts that are already known or slow-changing:

- `ls` output for the same directories.
- `rg --files` output for the same repo.
- repeated `cat package.json`, `tsconfig.json`, config discovery.
- repeated large `read` calls for source files.
- repeated Smart Read outline generation.
- repeated `git status --short`.
- repeated search results and file tree dumps.
- repeated path discovery before edits.
- repeated test command selection.

The current agent often pays this cost again even when the repo has not changed.

The snapshot layer should make these queries cheap:

```text
What files exist?
Where is this module?
What are package scripts?
Is this file unchanged?
Can Smart Read reuse an outline?
What changed since last action?
Which cache entries are stale?
```

The layer must not make Pi less correct. A stale cache answer is worse than no cache.

---

## 2. Existing Pi Context

This design fits the existing Pi architecture. The repo already contains relevant pieces:

- `tools/read.ts` for file reads.
- `tools/write.ts`, `tools/edit.ts`, `tools/edit-diff.ts` for mutations.
- `tools/bash.ts` and command policy logic for shell execution.
- `file-mutation-queue.ts` for mutation serialization.
- `event-bus.ts` for event propagation.
- `telemetry.ts` and execution visibility events.
- `retrieval/local-repo-index.ts` and `retrieval/retrieval-service.ts`.
- `repo-graph/repo-symbol-graph.ts` and repo graph builder.
- Smart Read disk cache code.
- state stores and runtime session concepts.
- validation lock / shell utilities for command execution containment.

The snapshot layer should use these boundaries. It should not become a separate hidden filesystem abstraction that bypasses the tools.

---

## 3. Design Goals

### 3.1 Token Reduction

Reduce repeated input/output tokens from:

- Smart Read / file reads.
- `ls`, `find`, `rg --files`.
- package/config reads.
- git status summaries.
- repeated search output.
- repeated source-to-test discovery.

### 3.2 Correctness Under Mutation

The cache must remain safe when files change through:

- Pi write/edit tools.
- Bash commands.
- unknown scripts.
- IDE saves.
- git checkout / reset / merge.
- external terminal edits.
- package manager operations.
- generated files.

### 3.3 Fast Snapshot Warmup

`/snapshot` should process source files in parallel with bounded concurrency.

It must support:

- progress updates.
- per-file failure isolation.
- resume after interruption.
- skip unchanged cached files.
- force rebuild.

### 3.4 Incremental Updates

After snapshot, Pi should not rebuild the whole project state after every change.

Instead:

```text
file edit → update only that file + affected caches
file create/delete → update tree + file manifest + affected command caches
package.json edit → update package state
git checkout → mark broad state unknown and reconcile
```

### 3.5 External Change Awareness

Unknown changes must be watched.

A filesystem watcher should detect changes not emitted by Pi tools. Because watchers are not perfectly reliable, the watcher is advisory and must be paired with reconcile scanning and read-time verification.

### 3.6 Minimal V1, Strong Foundations

V1 should focus on correctness infrastructure:

- snapshot service
- file tree
- file manifest
- Smart Read warm cache
- package/config snapshot
- git state summary
- safe `ls` / `rg --files` query cache
- event journal
- event projector
- watcher + reconcile
- dirty/stale/unknown validity
- compact query rendering
- read-time verification

V2 can add deeper symbol/import/test maps.

---

## 4. Non-Goals

V1 should not attempt to fully solve:

- complete TypeScript semantic indexing.
- perfect import graph resolution.
- perfect source-to-test mapping.
- complete bash semantic analysis.
- caching arbitrary command output.
- replacing validation runs with cached results.
- trusting watcher events as truth.
- trusting mtime alone.
- caching secrets or environment output.
- making generated/vendor directories first-class snapshot targets.

---

## 5. Core Mental Model

### 5.1 Four Sources of Truthiness

```text
1. Filesystem
   The only final authority.

2. Snapshot baseline
   A compact checkpoint of known project state.

3. Event overlay
   Incremental changes emitted by Pi tools and watcher/reconcile.

4. Read-time verification
   Last-mile validation before cached data is used.
```

### 5.2 Validity States

Every state segment can be:

```ts
type SnapshotValidity =
  | "valid"
  | "dirty"
  | "stale"
  | "unknown";
```

Meaning:

| State | Meaning | Cache behavior |
|---|---|---|
| `valid` | Known current relative to filesystem metadata/hash | Use cache |
| `dirty` | Probably changed; can be verified cheaply | Stat/hash before use |
| `stale` | Known outdated | Rebuild before use |
| `unknown` | Could be broadly wrong | Reconcile or fallback to filesystem |

### 5.3 Safety Rule

```text
valid cache hit is allowed only if dependency metadata still matches.
dirty cache hit requires verification.
stale cache hit is denied.
unknown cache hit is denied unless a forced fallback path verifies it.
```

---

## 6. High-Level Architecture

```text
                   ┌────────────────────────────┐
                   │        /snapshot            │
                   │ ProjectStateSnapshotService │
                   └─────────────┬──────────────┘
                                 │ baseline
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         ProjectStateStore                           │
│ manifest / files / tree / commands / packages / git / dirty state   │
└─────────────────────────────────────────────────────────────────────┘
          ▲                         ▲                         ▲
          │                         │                         │
          │ precise events          │ advisory events          │ verified reads
          │                         │                         │
┌─────────┴────────────┐   ┌────────┴──────────┐   ┌─────────┴───────────┐
│ Tool Event Emitters  │   │ ProjectStateWatcher│   │ ProjectStateQuerySvc │
│ read/write/edit/bash │   │ fs events/debounce │   │ read/ls/rg/cache API │
└─────────┬────────────┘   └────────┬──────────┘   └─────────┬───────────┘
          │                         │                         │
          ▼                         ▼                         ▼
┌───────────────────┐     ┌────────────────────┐    ┌────────────────────┐
│ Event Journal      │     │ Reconcile Scanner  │    │ Read-Time Verifier │
│ ordered append log │     │ stat/hash diffs    │    │ stat→hash cascade  │
└─────────┬─────────┘     └─────────┬──────────┘    └────────────────────┘
          │                         │
          └──────────────┬──────────┘
                         ▼
              ┌───────────────────────┐
              │ ProjectStateProjector  │
              │ ordered/idempotent apply│
              └───────────────────────┘
```

---

## 7. Component Overview

### 7.1 ProjectStateSnapshotService

Creates baseline state.

Responsibilities:

- discover files.
- apply ignore/exclude rules.
- compute file metadata.
- compute content hashes for eligible files.
- warm Smart Read outlines.
- build directory tree index.
- build package/config summary.
- build git state summary.
- initialize command cache metadata.
- write snapshot state atomically.
- support progress, resume, and partial failure reporting.

### 7.2 ProjectStateStore

Persistence layer for project state.

Responsibilities:

- read/write state segments.
- enforce atomic writes.
- expose validity metadata.
- keep repo-local state separate from global content-addressed caches.
- maintain last applied event sequence.
- maintain schema version.
- avoid corrupting state under concurrent processes.

### 7.3 ProjectStateEventJournal

Append-only ordered event log.

Responsibilities:

- accept tool, watcher, reconcile, and git/package events.
- assign monotonic sequence numbers.
- fsync/atomic append.
- support replay.
- support compaction/rotation.
- support idempotency by event id.

### 7.4 ProjectStateProjector

Applies event journal entries to store.

Responsibilities:

- consume events in sequence order.
- update only affected state segments.
- mark invalidated command caches.
- update file/tree/package/git validity.
- be idempotent.
- recover from interrupted projection.
- never assume ambiguous events are safe.

### 7.5 ProjectStateWatcher

Detects external filesystem changes.

Responsibilities:

- watch project root.
- ignore excluded directories.
- debounce event batches.
- collect advisory fs changes.
- flush changes after unknown commands.
- trigger reconcile scanner.
- never be treated as final authority.

### 7.6 ProjectStateReconcileScanner

Turns advisory changes into verified diffs.

Responsibilities:

- stat/hash changed candidates.
- compare against manifest.
- detect create/change/delete.
- scan parent directories for rename/delete ambiguity.
- perform bounded tree scan when command is unknown/global.
- generate verified events for projector.

### 7.7 ProjectStateQueryService

Answers read/discovery queries from state.

Responsibilities:

- provide cached `ls`, `rg --files`, package scripts, git status.
- enforce response budget.
- render compact summaries by default.
- paginate large outputs.
- verify dirty state before returning cache.
- fallback to real filesystem when needed.

### 7.8 Read-Time Verifier

Final correctness check.

Responsibilities:

- compare current stat with manifest.
- if stat differs, compute content hash.
- if hash matches, refresh metadata and use cache.
- if hash differs, mark stale and rebuild/fallback.
- catch missed watcher/tool events.

### 7.9 Bash Command Classifier

Classifies bash command state effects.

Responsibilities:

- identify read-only commands.
- identify local path mutations.
- identify tree mutations.
- identify package/git mutations.
- identify unknown/global mutations.
- identify dangerous destructive commands.
- open mutation windows for unknown commands.
- choose reconcile aggressiveness.

---

## 8. Storage Layout

Repo-local project state:

```text
.pi/project-state/
  manifest.json
  files.json
  tree.json
  packages.json
  git.json
  commands.json
  dirty.json
  event-journal.ndjson
  event-journal.lock
  projector.lock
  snapshot-runs/
    <snapshotRunId>.json
  archives/
    event-journal.0001.ndjson.gz
```

Global content-addressed cache:

```text
~/.pi/cache/
  smart-read/
    <contentHash>.json
  command-output/
    <commandHash>.json
```

Repo-local state is path-aware. Global cache is content-addressed.

---

## 9. Snapshot Manifest

`manifest.json`:

```ts
interface ProjectStateManifest {
  schemaVersion: number;
  snapshotId: string;
  rootDir: string;
  normalizedRootHash: string;
  createdAt: string;
  updatedAt: string;
  headSha?: string;
  branch?: string;
  treeHash: string;
  fileCount: number;
  sourceFileCount: number;
  lastAppliedSequence: number;
  lastCompactedSequence?: number;
  validity: {
    tree: SnapshotValidity;
    files: SnapshotValidity;
    packages: SnapshotValidity;
    git: SnapshotValidity;
    commands: SnapshotValidity;
    smartRead: SnapshotValidity;
  };
}
```

---

## 10. File Manifest

`files.json`:

```ts
interface ProjectFileEntry {
  path: string;
  ext: string;
  language?: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash?: string;
  lineCount?: number;
  isSource: boolean;
  isTest: boolean;
  isConfig: boolean;
  isGenerated: boolean;
  isIgnored: boolean;
  smartReadCacheKey?: string;
  smartReadStatus?: "missing" | "warm" | "stale" | "unsupported" | "failed";
  lastVerifiedAt?: string;
  lastChangedSequence?: number;
}
```

The `contentHash` is authoritative for content cache identity.

`mtimeMs` and `sizeBytes` are fast prechecks, not final proof.

---

## 11. Tree Index

`tree.json`:

```ts
interface ProjectTreeIndex {
  rootDir: string;
  treeHash: string;
  directories: Record<string, DirectoryEntry>;
}

interface DirectoryEntry {
  path: string;
  childDirs: string[];
  files: string[];
  fileCount: number;
  sourceFileCount: number;
  totalBytes: number;
  lastChangedSequence?: number;
  lsCacheKey?: string;
}
```

Used by:

- cached `ls`.
- compact directory summaries.
- `rg --files`.
- tree invalidation after create/delete/move.
- snapshot status.

---

## 12. Smart Read Cache Integration

Smart Read should become one layer inside project state.

On snapshot:

```text
for each eligible source file:
  stat
  hash
  if global smart-read cache exists by contentHash:
    mark warm
  else:
    generate compact/outline representation
    write ~/.pi/cache/smart-read/<contentHash>.json
    update files.json entry
```

On read:

```text
read request(path)
  → lookup files.json entry
  → if missing: normal read path
  → stat path
  → if size+mtime match and smartRead warm: use cache
  → else hash path
      → if hash == manifest contentHash: refresh metadata, use cache
      → else mark stale, rebuild smart read or fallback
```

This handles:

- IDE save with watcher event.
- missed watcher event.
- mtime changed but content identical.
- file changed externally.
- file moved and content reused.

---

## 13. Package / Config Snapshot

`packages.json`:

```ts
interface PackageState {
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  workspaceRoot?: string;
  packageFiles: Record<string, PackageEntry>;
  lockfiles: string[];
  testFrameworkHints: string[];
  configFiles: string[];
  validity: SnapshotValidity;
}

interface PackageEntry {
  path: string;
  name?: string;
  scripts: Record<string, string>;
  dependenciesHash?: string;
  devDependenciesHash?: string;
  packageHash: string;
}
```

Invalidation:

- `package.json` change → package entry stale.
- lockfile change → dependency state stale.
- `tsconfig`/vite/eslint config change → config snapshot stale.
- package manager operation → package state dirty/unknown unless paths verified.

---

## 14. Git State Snapshot

`git.json`:

```ts
interface GitStateSummary {
  isGitRepo: boolean;
  branch?: string;
  headSha?: string;
  statusPorcelain?: string;
  dirtyFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
  lastCheckedAt: string;
  validity: SnapshotValidity;
}
```

Rules:

- `git status --short` can be cached with short TTL or event invalidation.
- branch switch / checkout / reset / merge marks broad state unknown.
- `.git/HEAD` watcher change marks git state dirty.
- git operations should open a mutation window unless classified as read-only.

Submodules, sparse checkouts, and worktree layouts should be treated conservatively in V1:

```text
detected advanced git layout → git state summary allowed, but broad cache reuse must verify paths.
```

---

## 15. Command Cache

V1 supports only safe, deterministic, filesystem-derived commands:

- `ls`
- `find` with safe file listing semantics
- `rg --files`
- package scripts summary
- compact git status

No arbitrary command output cache in V1.

### 15.1 Command Cache Entry

```ts
interface CommandCacheEntry {
  commandId: string;
  commandClass: "ls" | "rg_files" | "find_files" | "package_scripts" | "git_status";
  cwd: string;
  argsHash: string;
  dependency: {
    treeHash?: string;
    directoryPath?: string;
    directoryLastChangedSequence?: number;
    packageHash?: string;
    gitHeadSha?: string;
    gitStatusHash?: string;
  };
  createdAt: string;
  validity: SnapshotValidity;
  outputSummary: unknown;
  fullOutputPath?: string;
}
```

### 15.2 Query Rendering Budget

Cache hits must still be compact.

A 5,000-file `rg --files` cache hit should not dump 5,000 paths into context by default.

```ts
interface QueryRenderOptions {
  mode?: "compact" | "summary" | "full";
  maxItems?: number;
  maxTokens?: number;
  cursor?: string;
}
```

Defaults:

| Query | Default mode | Budget |
|---|---|---|
| `ls` | compact | 100 entries |
| `rg --files` | summary | top directories + first 120 relevant paths |
| `find` | paginated | cursor required for full traversal |
| package scripts | full | safe small output |
| git status | compact | changed files + counts |

Example:

```text
Snapshot query hit: rg --files
Files: 5,243 total
Showing 120 most relevant files.

Top directories:
- packages/coding-agent/src/core: 211 files
- packages/coding-agent/src/brain: 98 files
- packages/web-server/src: 42 files

Use cursor abc123 for next page.
```

---

## 16. Event Journal

Events are appended with a monotonic sequence.

```ts
interface ProjectStateEventEnvelope {
  eventId: string;
  sequence: number;
  timestamp: string;
  sessionId: string;
  planExecutionId?: string;
  workspaceId?: string;
  toolCallId?: string;
  cwd: string;
  source:
    | "read_tool"
    | "write_tool"
    | "edit_tool"
    | "bash_tool"
    | "watcher"
    | "reconcile"
    | "snapshot"
    | "git_detector"
    | "external";
  event: ProjectStateEvent;
}
```

### 16.1 Event Types

```ts
type ProjectStateEvent =
  | { type: "snapshot_started"; snapshotRunId: string; rootDir: string }
  | { type: "snapshot_completed"; snapshotRunId: string; rootDir: string; treeHash: string }
  | { type: "file_written"; path: string; oldHash?: string; newHash?: string }
  | { type: "file_edited"; path: string; oldHash?: string; newHash?: string }
  | { type: "file_touched"; path: string }
  | { type: "file_deleted"; path: string; oldHash?: string }
  | { type: "file_moved"; from: string; to: string; oldHash?: string; newHash?: string }
  | { type: "directory_created"; path: string }
  | { type: "directory_deleted"; path: string }
  | { type: "package_manifest_changed"; path: string }
  | { type: "config_file_changed"; path: string }
  | { type: "git_head_changed"; oldHead?: string; newHead?: string }
  | { type: "git_worktree_changed" }
  | { type: "command_started"; command: string; classification: CommandStateEffect }
  | { type: "command_completed"; command: string; exitCode: number; classification: CommandStateEffect }
  | { type: "mutation_window_opened"; windowId: string; reason: string }
  | { type: "mutation_window_closed"; windowId: string; reason: string }
  | { type: "fs_change_batch"; batchId: string; changes: ProjectStateFsChange[] }
  | { type: "state_marked_dirty"; reason: string; scope: string[] }
  | { type: "state_marked_unknown"; reason: string; scope: string[] };
```

---

## 17. Event Ordering and Locking

Timestamps are not enough. Event ordering must be explicit.

### 17.1 Append Lock

`event-journal.lock`:

```text
append event:
  acquire journal lock
  read last sequence
  assign sequence + 1
  append ndjson line
  fsync
  release lock
```

### 17.2 Projector Lock

`projector.lock`:

```text
apply events:
  acquire projector lock
  read lastAppliedSequence
  read unapplied events ordered by sequence
  apply idempotently
  write updated state atomically
  update lastAppliedSequence
  release lock
```

### 17.3 Idempotency

Projector must skip:

```text
eventId already applied
sequence <= lastAppliedSequence
event with stale expected hash that no longer matches current state
```

If causal mismatch occurs:

```text
mark affected state dirty/unknown
defer to reconcile/read-time verification
```

---

## 18. Projector Invalidation Rules

### 18.1 File Edited/Written

```text
update files[path]
mark smartRead[path] stale unless newHash has global cache
invalidate rg/grep caches conservatively
keep tree valid if no create/delete
```

### 18.2 File Created

```text
add file entry
update parent directory
update treeHash
invalidate parent ls cache
invalidate rg --files cache
mark Smart Read missing/warm depending on contentHash
```

### 18.3 File Deleted

```text
remove file entry
update parent directory
update treeHash
invalidate parent ls cache
invalidate rg --files cache
remove path-specific smart read status
```

### 18.4 File Moved

```text
remove old path
add new path
preserve contentHash if known
invalidate old parent ls
invalidate new parent ls
invalidate rg --files
```

### 18.5 Package Manifest Changed

```text
mark package state stale
invalidate package scripts cache
if workspace config changed, mark project config dirty
```

### 18.6 Git Head Changed

```text
mark git state dirty/unknown
mark tree/files dirty unless reconcile confirms same files
invalidate command caches depending on tree/head
```

### 18.7 Unknown Global Mutation

```text
mark tree dirty or unknown
mark command cache stale
open mutation window
run watcher flush + bounded reconcile
```

---

## 19. Bash Command Classifier

The classifier is critical. A false positive only reduces cache benefit. A false negative can serve stale state.

Therefore:

```text
When unsure, classify as unknown mutation.
```

### 19.1 State Effects

```ts
type CommandStateEffect =
  | "no_state_change"
  | "path_local_mutation"
  | "tree_mutation"
  | "package_state_mutation"
  | "git_state_mutation"
  | "unknown_global_mutation"
  | "dangerous_destructive_mutation";
```

### 19.2 Examples

| Command | Effect | Action |
|---|---|---|
| `pwd` | no_state_change | no projector action |
| `ls src` | no_state_change | may use query cache |
| `rg --files` | no_state_change | may use query cache |
| `cat package.json` | no_state_change | may use package snapshot |
| `touch src/a.ts` | path_local_mutation | verify file path |
| `mkdir src/x` | tree_mutation | update tree |
| `mv src/a.ts src/b.ts` | tree_mutation | moved event |
| `rm src/a.ts` | tree_mutation | deleted event |
| `echo x > src/a.ts` | path_local_mutation | written event |
| `sed -i ... src/a.ts` | path_local_mutation | edited event |
| `npm install` | package_state_mutation | package state dirty |
| `git checkout main` | git_state_mutation | mutation window + broad reconcile |
| `python scripts/generate.py` | unknown_global_mutation | mutation window |
| `node scripts/build.js` | unknown_global_mutation | mutation window |
| `find . -delete` | dangerous_destructive_mutation | mark broad unknown / escalate |

### 19.3 Shell Operators

If command contains:

- `>`
- `>>`
- `2>`
- heredoc
- `&&`
- `||`
- `;`
- command substitution
- `xargs`
- `tee`
- `sed -i`
- `perl -pi`

then classification must be conservative.

### 19.4 Classifier Output

```ts
interface CommandClassification {
  effect: CommandStateEffect;
  confidence: "high" | "medium" | "low";
  affectedPaths?: string[];
  requiresMutationWindow: boolean;
  requiresReconcile: "none" | "path" | "parent_dirs" | "bounded_tree" | "full_tree";
  reason: string;
}
```

---

## 20. Unknown Mutation Handling

Unknown mutation is not an error. It is expected.

Examples:

```bash
python scripts/generate.py
npm run build
node tools/codegen.js
git checkout main
```

Flow:

```text
1. classify command as unknown/global/git/package mutation
2. open mutation window
3. mark relevant state dirty/unknown
4. run command
5. watcher collects filesystem changes
6. command completes
7. flush watcher events
8. reconcile changed paths / bounded tree
9. emit verified events
10. projector applies verified events
11. close mutation window
```

During open mutation window:

```text
tree = dirty/unknown
files = verify_before_use
command cache = denied or verify_required
Smart Read = allowed only after read-time verification
```

---

## 21. ProjectStateWatcher

Watcher detects changes outside Pi tool events.

### 21.1 Watcher Contract

```ts
interface ProjectStateWatcher {
  start(rootDir: string): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  flush(reason: FsChangeFlushReason): Promise<ProjectStateFsChangeBatch>;
}
```

### 21.2 Change Types

```ts
type ProjectStateFsChange =
  | { type: "fs_file_created"; path: string }
  | { type: "fs_file_changed"; path: string }
  | { type: "fs_file_deleted"; path: string }
  | { type: "fs_directory_created"; path: string }
  | { type: "fs_directory_deleted"; path: string }
  | { type: "fs_unknown_change"; path: string };
```

### 21.3 Watcher Rules

- Exclude ignored directories.
- Debounce rapid changes.
- Batch events.
- Treat rename as possibly delete+create.
- Never trust watcher event as final proof.
- If watcher overflows or errors, mark broad state dirty/unknown.
- If watcher is unavailable, system still works through read-time verification and periodic reconcile.

---

## 22. Reconcile Scanner

Watcher says “something changed.” Reconcile scanner determines what changed.

### 22.1 Reconcile Levels

```ts
type ReconcileLevel =
  | "path"
  | "parent_dirs"
  | "bounded_tree"
  | "full_tree";
```

### 22.2 Algorithm

```text
input: candidate paths from watcher/classifier
for each path:
  stat current path
  compare with files.json
  if missing before + exists now → file_created
  if existed before + missing now → file_deleted
  if size/mtime changed → hash
    if hash changed → file_edited/file_written
    else refresh metadata
scan parent directories for missing/created siblings
if too many uncertain events → bounded tree metadata scan
hash only changed candidates
emit verified events
```

### 22.3 Bounded Tree Scan

For unknown commands, do not immediately rebuild Smart Read for every file.

Instead:

```text
walk tree metadata
compare path + size + mtime
hash only candidates that differ
emit create/delete/change events
only rebuild Smart Read lazily or during refresh
```

---

## 23. Mutation Windows

Mutation windows group uncertain changes.

```ts
interface MutationWindow {
  id: string;
  source: "bash_unknown" | "git_operation" | "package_operation" | "external" | "ide";
  startedAt: string;
  completedAt?: string;
  cwd: string;
  command?: string;
  preTreeHash?: string;
  postTreeHash?: string;
  collectedWatcherEvents: number;
  status: "open" | "reconciling" | "closed" | "failed";
}
```

Use cases:

- unknown bash command.
- git checkout/reset/merge.
- package manager install.
- large IDE refactor detected.
- watcher overflow.

If mutation window fails:

```text
mark affected state unknown
force read-time verification/fallback
recommend /snapshot refresh
```

---

## 24. Read-Time Verification

This is the final correctness gate.

### 24.1 Verification Cascade

```text
1. stat file
2. compare size + mtime
3. if match → cache can be used
4. if mismatch → compute content hash
5. if hash matches → refresh metadata and use cache
6. if hash differs → mark stale and rebuild/fallback
```

### 24.2 Query Service Verification

Before returning cached query output:

```text
if dependency state valid → return compact cached output
if dirty → verify relevant paths/tree segment
if stale → rebuild query result
if unknown → reconcile or fallback to filesystem
```

---

## 25. Snapshot Command UX

### 25.1 Commands

```text
/snapshot
/snapshot <directory>
/snapshot refresh
/snapshot resume
/snapshot status
/snapshot clear
/snapshot tree
/snapshot commands
/snapshot smart-read
```

### 25.2 Options

```text
--concurrency <n>
--force
--json
--no-smart-read
--include-md
--max-files <n>
```

### 25.3 Progress

No external progress bar dependency.

Inline style:

```text
[####......] 42% 840/2000 cached=410 skipped=390 failed=4 saved≈1.2M tokens
```

Phases:

```text
discovering
hashing
warming-smart-read
building-tree
building-packages
building-git
writing-state
complete
```

### 25.4 Status Output

```text
Project snapshot: warm
Root: /home/kuzey/src/pi
Files: 2,431
Source files: 1,102
Tree cache: valid
File manifest: valid
Smart Read cache: 924/1,102 warm
Package state: valid
Git state: dirty
Command cache: 37 entries
Watcher: running
Last event sequence: 182
Last projected sequence: 182
Estimated saved: 8.4M tokens
Last updated: 4m ago
```

---

## 26. Snapshot Resume

Large repos can be interrupted.

`snapshot-runs/<id>.json`:

```ts
interface SnapshotRunState {
  snapshotRunId: string;
  rootDir: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "completed" | "failed" | "interrupted";
  phase: string;
  completedFiles: string[];
  failedFiles: Array<{ path: string; error: string }>;
  pendingFiles: string[];
  rawBytes: number;
  compactBytes: number;
  estimatedTokensSaved: number;
}
```

Rules:

- `/snapshot` detects interrupted run and can resume.
- `/snapshot resume` explicitly resumes latest run.
- completed file hashes are revalidated before reuse.
- failed files do not abort full run unless catastrophic.

---

## 27. Journal Compaction and Rotation

Event journal must not grow forever.

Policy:

```text
if journal size > 50MB
or lastAppliedSequence - lastCompactedSequence > 10,000
or snapshot refresh completed
then compact/archive old events
```

Archive:

```text
.pi/project-state/archives/event-journal.0001.ndjson.gz
```

Compaction must preserve:

- current state.
- lastAppliedSequence.
- enough audit metadata for debugging.

---

## 28. Ignore and Include Rules

Default included extensions:

```text
.ts .tsx .js .jsx .json .py .rs
```

Optional V1 extensions:

```text
.go .md .yaml .yml .toml
```

Hard excludes:

```text
node_modules
.git
dist
build
coverage
.next
.turbo
.venv
venv
target
.cache
.pi/project-state
.pi/smart-read-cache
```

Generated files should be detected and treated carefully:

- can appear in tree.
- usually not Smart Read warmed by default.
- may be summarized, not fully indexed.

---

## 29. Security and Privacy

Never cache:

- `.env`
- env command output.
- `printenv`
- secrets.
- credentials.
- private keys.
- OAuth tokens.
- `.npmrc` auth tokens.
- SSH material.
- command output from network calls.
- arbitrary shell output unless explicitly whitelisted.

Command cache must be whitelist-only.

State directory should be gitignored:

```text
.pi/project-state/
```

If `.pi` is not globally ignored, add explicit guidance or guardrail.

---

## 30. Failure Modes and Fallbacks

| Failure | Behavior |
|---|---|
| state file corrupted | mark unknown, rebuild segment |
| journal append fails | disable state update, continue tool safely |
| projector crash | replay from lastAppliedSequence |
| watcher unavailable | rely on read-time verification + periodic reconcile |
| watcher overflow | mark broad state dirty/unknown |
| hash failure | fallback to normal read |
| Smart Read cache missing | regenerate or normal read |
| bash classifier uncertain | unknown mutation window |
| lock timeout | skip cache update, do not block core tool forever |
| schema version mismatch | migrate or rebuild |

Core tools must continue working without snapshot.

Snapshot is an optimization, not a hard dependency.

---

## 31. Testing Strategy

### 31.1 Snapshot Service Tests

- discovers eligible files recursively.
- excludes hard ignored directories.
- writes manifest/files/tree.
- warms Smart Read cache.
- skips unchanged files.
- force rebuild regenerates.
- interrupted run can resume.
- per-file errors recorded without catastrophic failure.

### 31.2 Event Journal Tests

- assigns monotonic sequences.
- concurrent append does not duplicate sequence.
- malformed event does not corrupt journal.
- compaction preserves lastAppliedSequence.
- replay after restart works.

### 31.3 Projector Tests

- file edit marks Smart Read stale.
- file create invalidates parent `ls`.
- file delete invalidates `rg --files`.
- file move preserves content hash when possible.
- package.json change invalidates package snapshot.
- git head change marks git state dirty/unknown.
- repeated same event is idempotent.
- out-of-order application is prevented.

### 31.4 Watcher/Reconcile Tests

- external file edit marks file stale.
- external file create invalidates tree.
- external file delete invalidates tree.
- rename as delete+create still reconciles.
- watcher missed event caught by read-time verification.
- watcher overflow marks broad state dirty.
- unknown command opens mutation window and reconciles changes.

### 31.5 Query Service Tests

- `ls` uses valid tree cache.
- `ls` verifies dirty parent directory.
- `rg --files` returns compact summary by default.
- large result is paginated.
- package scripts cache invalidates after package edit.
- unknown state blocks unsafe command cache hit.
- full mode requires explicit request.

### 31.6 Bash Classifier Tests

- read-only commands classified read-only.
- redirection classified mutation.
- `sed -i` classified mutation.
- `npm install` classified package mutation.
- `git checkout` classified git mutation.
- unknown scripts classified unknown mutation.
- ambiguous chained command classified conservative.

### 31.7 Integration Tests

- `/snapshot` then repeated read gets Smart Read hit.
- `/snapshot` then external edit then read does not serve stale cache.
- `/snapshot` then unknown bash generating file updates tree after reconcile.
- `/snapshot status` reports watcher/projector/journal state.
- state survives process restart.
- lock contention does not corrupt state.

---

## 32. Rollout Plan

### Phase 1 — Store + Snapshot Baseline

Deliver:

- ProjectStateStore
- file manifest
- tree index
- snapshot command
- progress UI
- resume state
- basic status command

No command cache yet.

### Phase 2 — Smart Read Integration

Deliver:

- global content-addressed Smart Read cache linkage.
- read-time verifier.
- Smart Read cache reuse from snapshot.
- stale handling.
- token savings reporting.

### Phase 3 — Event Journal + Projector

Deliver:

- event envelope.
- monotonic sequence.
- journal lock.
- projector lock.
- tool events from write/edit.
- basic invalidation.

### Phase 4 — Bash Classifier + Unknown Mutation Windows

Deliver:

- bash command classifier v1.
- mutation window model.
- conservative unknown handling.
- package/git mutation marking.
- classifier tests.

### Phase 5 — Watcher + Reconcile

Deliver:

- ProjectStateWatcher.
- debounce/batching.
- reconcile scanner.
- external edit handling.
- watcher overflow fallback.
- read-time missed-event safety.

### Phase 6 — Query Cache + Compact Rendering

Deliver:

- cached `ls`.
- cached `rg --files`.
- package scripts query.
- compact rendering budget.
- pagination/cursors.
- query service tests.

### Phase 7 — V2 Indexes

Deliver later:

- symbol index.
- import graph.
- source-to-test map.
- grep/search dedupe.
- validation history summaries.

---

## 33. V1 Cut

The minimum valuable V1 should include:

```text
/snapshot
/snapshot status
/snapshot resume
ProjectStateStore
file manifest
tree index
Smart Read warm cache
read-time verification
event journal
projector
write/edit tool events
basic bash classifier
unknown mutation dirty marking
watcher + reconcile for external changes
compact ls / rg --files rendering
package scripts snapshot
git status summary
```

Do not include full symbol/import/test map in V1.

Those are useful, but correctness infrastructure must come first.

---

## 34. Success Metrics

### 34.1 Correctness Metrics

- zero stale Smart Read served after file content changed.
- zero stale `ls` after file create/delete.
- zero stale `rg --files` after create/delete/move.
- watcher missed events caught by read-time verification.
- unknown bash mutation reconciled or state marked unknown.
- no journal sequence duplication under concurrent events.

### 34.2 Performance Metrics

- snapshot warmup throughput: files/sec.
- Smart Read cache hit rate.
- average read token savings.
- `ls`/`rg --files` output token reduction.
- query compact render ratio.
- projector apply latency.
- watcher reconcile latency.

### 34.3 UX Metrics

- `/snapshot status` clearly explains valid/dirty/stale/unknown.
- progress updates are understandable.
- failed files listed but do not overwhelm.
- user can recover with `/snapshot resume` or `/snapshot refresh`.

---

## 35. Estimated Token Savings

For a medium-to-large repo:

| Source | Conservative per session | Confidence |
|---|---:|---|
| Smart Read repeated reads | 2–4M tokens | High |
| `ls` / `rg --files` compact rendering | 0.5–1.5M tokens | High |
| package/config repeated reads | 100–400K tokens | High |
| git status repeated summaries | 50–300K tokens | High |
| search result dedupe | 0.5–2M tokens | Medium |
| symbol lookup V2 | 0.3–1M tokens | Medium |

Defensible V1 estimate:

```text
3–6M tokens saved per long session
```

Optimistic V1+V2 estimate:

```text
6–8M tokens saved per long session
```

Savings depend heavily on:

- number of repeated reads.
- Smart Read compression ratio.
- output rendering budget.
- whether the repo remains mostly unchanged.
- how often unknown commands force reconcile.

---

## 36. Key Implementation Rules

1. Filesystem is authority.
2. Watcher is advisory.
3. Reconcile scanner is corrective.
4. Read-time verification is final.
5. Unknown command means dirty/unknown, never valid.
6. Cache hit must still respect output token budget.
7. Event order must be monotonic.
8. Projector must be idempotent.
9. Snapshot must be resumable.
10. Arbitrary command output must not be cached.
11. State corruption must degrade to safe fallback.
12. The system must never block core read/write/edit forever.

---

## 37. Open Questions

1. Should state live in `.pi/project-state` only, or also support a global repo registry?
2. Which lock library or lock-file convention should Pi standardize on?
3. Should watcher run for every interactive session, or only after `/snapshot`?
4. Should unknown mutation window block cached queries until reconcile completes?
5. What is the maximum default query output budget?
6. Should `/snapshot` auto-run when no valid state exists?
7. Should generated files be represented in tree but excluded from Smart Read by default?
8. How aggressively should git checkout trigger full refresh?
9. How much event journal history should be retained locally?
10. How should multi-worktree Pi sessions isolate state?

---

## 38. Final Vision

Pi should not repeatedly rediscover the same project structure.

It should maintain a compact, verified, live model of the repository:

```text
A snapshot gives Pi memory.
Events keep that memory updated.
Watcher catches what Pi did not do itself.
Reconcile turns hints into facts.
Read-time verification prevents stale truth.
Compact rendering converts cache hits into real token savings.
```

The design should make Pi faster and cheaper without making it reckless.

The safest summary:

```text
Project State Snapshot is not a replacement for the filesystem.
It is a cached, verified, incrementally maintained index over the filesystem.
```

That is the boundary that keeps the system correct.
