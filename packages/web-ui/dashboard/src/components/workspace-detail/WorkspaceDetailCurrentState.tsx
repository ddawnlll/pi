/**
 * WorkspaceDetailCurrentState — Current state section for WorkspaceDetailPage (P42.06).
 *
 * Displays stage, attempts, timestamps, and error info for the workspace.
 */

import { Clock, AlertTriangle, Layers, Timer } from "lucide-react";
import type { WorkerContextView } from "../../hooks/useWorkerContext";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Helpers ───────────────────────────────────────────────────────────────

function stageBadgeClass(stage: string): string {
  switch (stage) {
    case "active":
      return "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400";
    case "complete":
      return "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400";
    case "failed":
      return "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400";
    case "blocked":
      return "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400";
    case "pending":
      return "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400";
    default:
      return "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400";
  }
}

function formatTime(tsStr: string | undefined): string {
  if (!tsStr) return "—";
  return new Date(tsStr).toLocaleString();
}

function elapsedTime(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt) return "—";
  const end = completedAt ? new Date(completedAt) : new Date();
  const start = new Date(startedAt);
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return "—";

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkspaceDetailCurrentStateProps {
  context: WorkerContextView | null | undefined;
  isLoading: boolean;
}

export function WorkspaceDetailCurrentState({
  context,
  isLoading,
}: WorkspaceDetailCurrentStateProps) {
  if (isLoading) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 flex items-center gap-2 text-xs ${MUT}`}>
        <div className="w-3 h-3 border border-stone-300 border-t-blue-400 rounded-full animate-spin" />
        Loading workspace state...
      </div>
    );
  }

  if (!context) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs ${MUT}`}>
        No workspace state available.
      </div>
    );
  }

  const stage = context.stage || "unknown";

  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
        <div className="flex items-center gap-2">
          <Layers size={13} className={MUT} />
          <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
            Current State
          </span>
        </div>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${stageBadgeClass(stage)}`}>
          {stage}
        </span>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        {/* Stage + attempts */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Layers size={12} className={MUT} />
            <span className={MUT}>Attempts:</span>
            <span className={`${TXT} font-medium tabular-nums`}>{context.attempts}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={12} className={MUT} />
            <span className={MUT}>Started:</span>
            <span className={`${TXT} font-medium`}>{formatTime(context.startedAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Timer size={12} className={MUT} />
            <span className={MUT}>Elapsed:</span>
            <span className={`${TXT} font-medium`}>
              {elapsedTime(context.startedAt, context.completedAt)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={12} className={MUT} />
            <span className={MUT}>Completed:</span>
            <span className={`${TXT} font-medium`}>{formatTime(context.completedAt)}</span>
          </div>
        </div>

        {/* Error */}
        {context.error && (
          <div className="flex items-start gap-1.5 p-2 rounded bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span className="break-all">{context.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
