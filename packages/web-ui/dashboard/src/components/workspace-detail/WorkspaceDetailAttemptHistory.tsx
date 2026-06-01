/**
 * WorkspaceDetailAttemptHistory — Attempt history section (P42.06).
 *
 * Displays attempt history for the workspace including error info per attempt.
 */

import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Loader2 } from "lucide-react";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AttemptEntry {
  attemptNumber: number;
  stage: string;
  startedAt?: string;
  completedAt?: string;
  error?: string | null;
}

interface WorkspaceDetailAttemptHistoryProps {
  attempts: AttemptEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTime(tsStr: string | undefined): string {
  if (!tsStr) return "—";
  return new Date(tsStr).toLocaleString();
}

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

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspaceDetailAttemptHistory({
  attempts,
  isLoading,
  error,
}: WorkspaceDetailAttemptHistoryProps) {
  // ── Loading state ──
  if (isLoading) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 flex items-center gap-2 text-xs ${MUT}`}>
        <Loader2 size={12} className="animate-spin" />
        Loading attempt history...
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs text-red-500`}>
        Failed to load attempt history.
      </div>
    );
  }

  // ── Empty state ──
  if (!attempts || attempts.length === 0) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs ${MUT}`}>
        No attempt history available.
      </div>
    );
  }

  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
        <div className="flex items-center gap-2">
          <RefreshCw size={13} className={MUT} />
          <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
            Attempt History
          </span>
        </div>
        <span className={`text-[10px] tabular-nums ${MUT}`}>
          {attempts.length} attempt{attempts.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Body */}
      <div className="divide-y ${BORD}">
        {attempts.map((attempt) => (
          <div
            key={attempt.attemptNumber}
            className="p-3 space-y-1.5 text-xs hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors"
          >
            {/* Attempt header */}
            <div className="flex items-center gap-2">
              <div className="shrink-0">
                {attempt.stage === "complete" ? (
                  <CheckCircle size={12} className="text-emerald-400" />
                ) : attempt.stage === "failed" ? (
                  <XCircle size={12} className="text-red-400" />
                ) : attempt.stage === "blocked" ? (
                  <AlertTriangle size={12} className="text-amber-400" />
                ) : (
                  <RefreshCw size={12} className={`${MUT} animate-spin`} />
                )}
              </div>
              <span className={`${TXT} font-medium`}>
                Attempt #{attempt.attemptNumber}
              </span>
              <span className={`text-[9px] font-medium px-1 py-px rounded ${stageBadgeClass(attempt.stage)}`}>
                {attempt.stage}
              </span>
            </div>

            {/* Timestamps */}
            <div className="flex items-center gap-2 pl-5">
              <span className={`text-[9px] ${MUT}`}>
                Started: {formatTime(attempt.startedAt)}
              </span>
              <span className={`text-[9px] ${MUT}`}>
                Completed: {formatTime(attempt.completedAt)}
              </span>
            </div>

            {/* Error */}
            {attempt.error && (
              <div className="pl-5 flex items-start gap-1.5">
                <AlertTriangle size={10} className="mt-0.5 shrink-0 text-red-400" />
                <span className="text-[9px] text-red-600 dark:text-red-400 break-all">
                  {attempt.error}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
