/**
 * WorkerP6LifecycleTab — P6 lifecycle view for a worker workspace.
 *
 * Displays the lifecycle state and execution pipeline of a worker
 * within the P6 parallel execution framework. Does NOT include
 * queue or conflict data.
 */

import type { WorkerInfo, WorkspaceSummary } from "../types";

interface WorkerP6LifecycleTabProps {
  worker: WorkerInfo;
  workspace?: WorkspaceSummary;
}

export function WorkerP6LifecycleTab({ worker, workspace }: WorkerP6LifecycleTabProps) {
  const now = Date.now();
  const isTerminal = workspace?.stage === "complete" || workspace?.stage === "failed";

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

  // Derive lifecycle pipeline stages from worker/workspace state
  const lifecycleStages: Array<{
    id: string;
    label: string;
    status: "pending" | "active" | "complete" | "skipped" | "failed";
  }> = [
    { id: "queued", label: "Queued", status: "complete" },
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
      status: worker.stage === "complete"
        ? "complete"
        : worker.stage === "failed"
          ? "skipped"
          : "pending",
    },
    {
      id: "merging",
      label: "Merging",
      status: worker.stage === "complete"
        ? "complete"
        : worker.stage === "failed"
          ? "skipped"
          : "pending",
    },
    {
      id: "complete",
      label: "Complete",
      status: worker.stage === "complete"
        ? "complete"
        : worker.stage === "failed"
          ? "failed"
          : "pending",
    },
  ];

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
    </div>
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
