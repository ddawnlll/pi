/**
 * WorkerP6LifecycleTab — P6 lifecycle view for a worker workspace.
 *
 * Displays the lifecycle state and execution pipeline of a worker
 * within the P6 parallel execution framework, including queue,
 * integration, merge conflict, and quarantine/cleanup status.
 */

import { useState, useCallback } from "react";
import type { WorkerInfo, WorkspaceSummary } from "../types";
import { useWorkerQueueEntry, useQuarantineState, type MergeConflictInfo, type QueueEntryInfo } from "../hooks/useScaleStatus";
import { MergeConflictPanel, type MergeConflictData, type ConflictedFile } from "./MergeConflictPanel";

interface WorkerP6LifecycleTabProps {
  worker: WorkerInfo;
  workspace?: WorkspaceSummary;
  planExecId: string | null;
}

export function WorkerP6LifecycleTab({ worker, workspace, planExecId }: WorkerP6LifecycleTabProps) {
  const now = Date.now();
  const isTerminal = workspace?.stage === "complete" || workspace?.stage === "failed";

  // Fetch queue entry for this workspace
  const { data: queueEntry, isLoading: queueLoading } = useWorkerQueueEntry(worker.id, isTerminal || worker.stage === "active" || worker.stage === "blocked");
  const { data: quarantineState } = useQuarantineState(
    worker.stage === "failed" ? worker.id : null,
    worker.stage === "failed",
  );

  const formatTs = (ts: number | null | undefined): string => {
    if (ts == null) return "--";
    return new Date(ts).toLocaleString();
  };

  const calcDuration = (start: number | null | undefined, end: number | null | undefined): string => {
    if (start == null) return "--";
    const endTs = end ?? now;
    const ms = endTs - start;
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  // Determine workspace-level integration status flags
  const queueStatus = queueEntry?.entry?.status ?? null;
  const isQueued = queueStatus === "queued";
  const isMerging = queueStatus === "merging";
  const isValidating = queueStatus === "validating";
  const isMerged = queueStatus === "merged";
  const isQueueFailed = queueStatus === "failed";
  const isBlocked = queueStatus === "blocked";
  const isConflict = queueStatus === "conflict";

  // A completed workspace is considered integrated if it passed through the queue
  const isIntegrated = workspace?.stage === "complete" && (isMerged || (queueEntry?.found && !isQueueFailed));
  const isQuarantined = quarantineState?.inQuarantine ?? false;
  const hasCleanup = quarantineState?.cleanupPerformed ?? false;

  // Derive lifecycle pipeline stages from worker/workspace state
  const lifecycleStages: Array<{
    id: string;
    label: string;
    status: "pending" | "active" | "complete" | "skipped" | "failed";
  }> = [
    { id: "queued", label: "Queued", status: isQueued ? "active" : queueEntry?.found ? "complete" : "pending" },
    { id: "provisioning", label: "Provisioning", status: "complete" },
    {
      id: "executing",
      label: "Executing",
      status: worker.stage === "active"
        ? "active"
        : isTerminal
          ? "complete"
          : "pending",
    },
    {
      id: "validating",
      label: "Validating",
      status: isValidating
        ? "active"
        : worker.stage === "complete"
          ? "complete"
          : worker.stage === "failed"
            ? "skipped"
            : "pending",
    },
    {
      id: "merging",
      label: "Merging",
      status: isMerging
        ? "active"
        : isConflict
          ? "failed"
          : isMerged || isIntegrated
            ? "complete"
            : worker.stage === "failed" ? "skipped" : "pending",
    },
    {
      id: "complete",
      label: "Complete",
      status: isMerged || isIntegrated
        ? "complete"
        : worker.stage === "complete" && !isIntegrated
          ? "active"
          : worker.stage === "failed"
            ? "failed"
            : "pending",
    },
  ];

  // ── Handoff panel state ──────────────────────────────────────────────
  const [selectedConflict, setSelectedConflict] = useState<MergeConflictInfo | null>(null);

  const openConflictHandoff = useCallback(
    (conflict: MergeConflictInfo, entry: QueueEntryInfo) => {
      setSelectedConflict(conflict);
    },
    [],
  );

  const convertToMergeConflictData = useCallback(
    (info: MergeConflictInfo, queueEntry: QueueEntryInfo): MergeConflictData => ({
      workspaceId: info.workspaceId,
      commitHash: queueEntry.commitHash,
      status: "unresolved",
      detectedAt: info.timestamp,
      conflictedFiles: info.conflictedFiles.map(
        (f): ConflictedFile => ({
          filePath: f,
          conflictType: "both modified",
          hasConflictMarkers: true,
        }),
      ),
      conflictDiff: info.diff,
      gitStatusOutput: "",
      description: `Merge conflict detected in workspace "${info.workspaceId}" during integration.`,
      suggestedResolutionSteps: [
        "Open each conflicted file and resolve conflict markers",
        "Stage resolved files: git add <file>",
        "Complete the merge: git merge --continue",
      ],
    }),
    [],
  );

  return (
    <div className="pt-3 text-xs space-y-4">
      {/* Lifecycle Pipeline */}
      <div>
        <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-3">
          P6 Lifecycle Pipeline
        </h3>
        <div className="flex items-center gap-1">
          {lifecycleStages.map((stage, i) => (
            <div key={stage.id} className="flex items-center gap-1 flex-1">
              <div
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-medium ${
                  stage.status === "complete"
                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                    : stage.status === "active"
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400 dark:ring-blue-500"
                      : stage.status === "failed"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                        : "bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500"
                }`}
              >
                {stage.status === "complete" && (
                  <span className="text-emerald-600 dark:text-emerald-400">&#10003;</span>
                )}
                {stage.status === "active" && (
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                )}
                {stage.status === "failed" && (
                  <span className="text-red-600 dark:text-red-400">&#10007;</span>
                )}
                {stage.status === "pending" && (
                  <span className="w-2 h-2 rounded-full border border-stone-300 dark:border-stone-600" />
                )}
                {stage.status === "skipped" && (
                  <span className="text-stone-400 dark:text-stone-500">&mdash;</span>
                )}
                {stage.label}
              </div>
              {i < lifecycleStages.length - 1 && (
                <div
                  className={`h-px flex-1 ${
                    stage.status === "complete"
                      ? "bg-emerald-300 dark:bg-emerald-700"
                      : "bg-stone-200 dark:bg-stone-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Queue / Integration Status */}
      <div>
        <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">
          Queue & Integration
        </h3>
        <div className="space-y-2">
          {/* Loading state */}
          {queueLoading && (
            <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500">
              <span className="w-3 h-3 border-2 border-stone-400 dark:border-stone-500 border-t-transparent rounded-full animate-spin" />
              Checking integration queue...
            </div>
          )}

          {/* Not found in queue (common for non-scale workspaces) */}
          {!queueLoading && queueEntry && !queueEntry.found && (
            <div className="text-stone-400 dark:text-stone-500 italic text-[10px]">
              Workspace not found in the integration queue.
            </div>
          )}

          {/* Queue entry details */}
          {queueEntry?.found && queueEntry.entry && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <QueueStatusBadge status={queueEntry.entry.status} />
                <span className="text-stone-500 dark:text-stone-400 text-[10px]">
                  Queued at: {formatTs(queueEntry.entry.queuedAt)}
                </span>
              </div>
              {queueEntry.entry.commitHash && (
                <div className="flex">
                  <span className="text-stone-400 dark:text-stone-500 w-16 shrink-0">Commit:</span>
                  <span className="font-mono text-stone-600 dark:text-stone-400 text-[10px]">
                    {queueEntry.entry.commitHash.slice(0, 12)}
                  </span>
                </div>
              )}
              {queueEntry.entry.processedAt && (
                <div className="flex">
                  <span className="text-stone-400 dark:text-stone-500 w-16 shrink-0">Processed:</span>
                  <span className="text-stone-600 dark:text-stone-400 text-[10px]">
                    {formatTs(queueEntry.entry.processedAt)}
                  </span>
                </div>
              )}
              {queueEntry.entry.validationPassed !== null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-stone-400 dark:text-stone-500">Validation:</span>
                  <span className={queueEntry.entry.validationPassed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {queueEntry.entry.validationPassed ? "PASSED" : "FAILED"}
                  </span>
                </div>
              )}
              {queueEntry.entry.error && (
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2 rounded border border-red-200 dark:border-red-900 whitespace-pre-wrap break-words">
                  {queueEntry.entry.error}
                </div>
              )}
            </div>
          )}

          {/* Integrated badge for completed workspaces that went through the queue */}
          {isIntegrated && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded px-2.5 py-2">
              <span className="text-emerald-600 dark:text-emerald-400 text-sm">&#10003;</span>
              <div>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Integrated</span>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                  Workspace changes have been merged into the main branch.
                </p>
              </div>
            </div>
          )}

          {/* Merged badge (queue-level merged status) */}
          {isMerged && !isIntegrated && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded px-2.5 py-2">
              <span className="text-emerald-600 dark:text-emerald-400 text-sm">&#10003;</span>
              <div>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Merged</span>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                  Integration queue reports this workspace as merged.
                </p>
              </div>
            </div>
          )}

          {/* Conflict entry (clickable handoff) */}
          {isConflict && queueEntry?.mergeConflict && (
            <div>
              <button
                onClick={() => openConflictHandoff(queueEntry.mergeConflict!, queueEntry.entry!)}
                className="w-full text-left bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded px-2.5 py-2 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="inline-block w-2 h-2 bg-amber-500 rounded-full shrink-0" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Merge Conflict</span>
                  <span className="text-[9px] text-amber-500 dark:text-amber-500 italic ml-auto">
                    Click to open handoff panel
                  </span>
                </div>
                {queueEntry.mergeConflict.conflictedFiles.length > 0 && (
                  <ul className="mt-1 text-[10px] font-mono text-amber-600 dark:text-amber-400 list-disc list-inside">
                    {queueEntry.mergeConflict.conflictedFiles.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </button>
            </div>
          )}

          {/* Blocked entry */}
          {isBlocked && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-2.5 py-2">
              <span className="inline-block w-2 h-2 bg-red-500 rounded-full shrink-0 mt-1" />
              <div>
                <span className="text-xs font-semibold text-red-700 dark:text-red-400">Blocked in Queue</span>
                {queueEntry?.entry?.error && (
                  <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{queueEntry.entry.error}</p>
                )}
              </div>
            </div>
          )}

          {/* Queue-level failed */}
          {isQueueFailed && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-2.5 py-2">
              <span className="inline-block w-2 h-2 bg-red-500 rounded-full shrink-0 mt-1" />
              <div>
                <span className="text-xs font-semibold text-red-700 dark:text-red-400">Integration Failed</span>
                {queueEntry?.entry?.error && (
                  <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{queueEntry.entry.error}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quarantine / Cleanup (for failed workspaces) */}
      {worker.stage === "failed" && quarantineState != null && (
        <div>
          <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">
            Quarantine & Cleanup
          </h3>
          <div className="space-y-1.5">
            {/* Quarantine status */}
            <div className={`flex items-center gap-2 px-2.5 py-2 rounded border ${
              isQuarantined
                ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                : "bg-stone-50 dark:bg-stone-800/50 border-[#E8E6E1] dark:border-[#333]"
            }`}>
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                isQuarantined ? "bg-amber-500" : "bg-emerald-500"
              }`} />
              <div>
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  {isQuarantined ? "In Quarantine" : "Not Quarantined"}
                </span>
                {quarantineState!.reason && (
                  <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">{quarantineState!.reason}</p>
                )}
              </div>
            </div>

            {/* Cleanup performed */}
            {hasCleanup && (
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded px-2.5 py-2">
                <span className="text-emerald-600 dark:text-emerald-400 text-sm">&#10003;</span>
                <div>
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Cleanup Performed</span>
                  {quarantineState!.cleanedAt && (
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      Cleaned at: {formatTs(quarantineState!.cleanedAt)}
                    </p>
                  )}
                  {quarantineState!.cleanupDetails && (
                    <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">{quarantineState!.cleanupDetails}</p>
                  )}
                </div>
              </div>
            )}

            {/* Cleanup pending */}
            {quarantineState!.cleanupPending && !hasCleanup && (
              <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded px-2.5 py-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shrink-0" />
                <span className="text-xs text-blue-700 dark:text-blue-300">Cleanup pending...</span>
              </div>
            )}

            {/* Cleanup error */}
            {quarantineState!.cleanupError && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2 rounded border border-red-200 dark:border-red-900 whitespace-pre-wrap break-words">
                Cleanup error: {quarantineState!.cleanupError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Worker Details */}
      <div>
        <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">
          Worker Details
        </h3>
        <div className="space-y-1 text-stone-500 dark:text-stone-400">
          <Row label="Stage" value={worker.stage} />
          <Row label="Attempt" value={String(worker.attempt)} />
          <Row label="Retries" value={String(worker.retries)} />
          <Row label="Started" value={formatTs(workspace?.startedAt)} />
          <Row label="Completed" value={formatTs(workspace?.completedAt)} />
          {workspace?.startedAt && (
            <Row
              label="Duration"
              value={calcDuration(workspace.startedAt, workspace.completedAt)}
            />
          )}
          {worker.snapshotPath && <Row label="Snapshot" value={worker.snapshotPath} />}
          {worker.reportPath && <Row label="Report" value={worker.reportPath} />}
        </div>
      </div>

      {/* Lifecycle Roles */}
      <div>
        <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">
          Lifecycle Roles
        </h3>
        <div className="space-y-1.5 text-stone-500 dark:text-stone-400">
          <p className="text-[10px] text-stone-400 dark:text-stone-500">
            Each attempt in the P6 pipeline passes through the following roles:
          </p>
          <div className="flex items-center gap-2">
            <RoleBadge role="worker" />
            <span className="text-stone-600 dark:text-stone-300">
              Primary executor &mdash; the main agent loop
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RoleBadge role="flash" />
            <span className="text-stone-600 dark:text-stone-300">
              Fast pass &mdash; expedited execution for quick patches
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RoleBadge role="reviewer" />
            <span className="text-stone-600 dark:text-stone-300">
              Reviewer &mdash; validates completion quality
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RoleBadge role="final" />
            <span className="text-stone-600 dark:text-stone-300">
              Final &mdash; last-resort attempt before failure
            </span>
          </div>
        </div>
      </div>

      {/* Error state */}
      {worker.error && (
        <div>
          <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
            Failure
          </h3>
          <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 p-2 rounded border border-red-200 dark:border-red-900 whitespace-pre-wrap break-words">
            {worker.error}
          </div>
        </div>
      )}

      {/* ── Merge conflict handoff overlay ── */}
      {selectedConflict && queueEntry?.entry ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setSelectedConflict(null)}
        >
          <div
            className="relative max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedConflict(null)}
              className="absolute top-2 right-2 z-10 flex items-center justify-center h-6 w-6 rounded-full bg-white dark:bg-[#2A2A2A] border border-[#E8E6E1] dark:border-[#333] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#333] shadow-sm"
              aria-label="Close handoff panel"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
            <MergeConflictPanel
              conflict={convertToMergeConflictData(selectedConflict, queueEntry.entry)}
              onResolved={() => setSelectedConflict(null)}
              onRetry={() => setSelectedConflict(null)}
              onAbort={() => setSelectedConflict(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Queue Status Badge ──────────────────────────────────────────────────────

const QUEUE_STATUS_COLORS: Record<string, string> = {
  queued: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
  merging: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  validating: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  merged: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  blocked: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  conflict: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
};

function QueueStatusBadge({ status }: { status: string }) {
  const colorClass = QUEUE_STATUS_COLORS[status] ?? "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${colorClass}`}>
      {status}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="text-stone-400 dark:text-stone-500 w-20 shrink-0">{label}:</span>
      <span className="text-stone-700 dark:text-stone-300 truncate">{value}</span>
    </div>
  );
}

function RoleBadge({ role }: { role: "worker" | "flash" | "reviewer" | "final" }) {
  const colors: Record<string, string> = {
    worker: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
    flash: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
    reviewer: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    final: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
        colors[role] ?? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
      }`}
    >
      {role}
    </span>
  );
}
