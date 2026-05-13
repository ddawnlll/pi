/**
 * EditStrategyWarnings - Dashboard component showing edit strategy warnings and handoff state.
 *
 * P4.5 Workstream 4.5.E: Shows edit strategy mode, blocked rewrites,
 * truncation warnings, and handoff state in the WorkerDetail panel.
 */

import { useState } from "react";
import type { EditFailureHandoffData } from "./EditFailureHandoff";

/**
 * Edit strategy warning summary for a workspace.
 */
export interface EditStrategyWarningData {
  /** Current edit strategy mode */
  editMode: string;
  /** Number of blocked rewrites */
  blockedRewrites: number;
  /** Number of truncation events */
  truncationEvents: number;
  /** Number of exact-match failures */
  exactMatchFailures: number;
  /** Whether handoff has been triggered */
  handoffTriggered: boolean;
  /** Handoff payload (if triggered) */
  handoffPayload?: EditFailureHandoffData;
  /** Files that have failed edits */
  failedFiles: string[];
}

/**
 * Props for the EditStrategyWarnings component.
 */
export interface EditStrategyWarningsProps {
  /** Warning data */
  data: EditStrategyWarningData;
  /** Callback when user wants to restore pre-edit snapshot */
  onRestore?: (snapshotPath: string) => void;
  /** Callback when user wants to continue after manual fix */
  onResume?: () => void;
  /** Callback when user wants to retry with a different edit mode */
  onRetryWithMode?: (mode: string) => void;
}

/**
 * Display edit strategy warnings and handoff state.
 *
 * Shows:
 * - Current edit mode
 * - Blocked rewrites count
 * - Truncation/exact-match failure warnings
 * - Handoff state with recovery options
 */
export function EditStrategyWarnings({
  data,
  onRestore,
  onResume,
  onRetryWithMode,
}: EditStrategyWarningsProps) {
  const hasWarnings = data.blockedRewrites > 0 || data.truncationEvents > 0 || data.exactMatchFailures > 0;
  const hasFailures = data.failedFiles.length > 0;

  if (!hasWarnings && !hasFailures && !data.handoffTriggered) {
    return (
      <div className="pt-2">
        <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
          <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full" />
          <span>Edit strategy: {data.editMode.replace(/_/g, " ")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-2">
      {/* Edit mode indicator */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`inline-block w-2 h-2 rounded-full ${
          data.handoffTriggered ? "bg-amber-500" : "bg-emerald-500"
        }`} />
        <span className="text-stone-600 dark:text-stone-400">
          Edit strategy: {data.editMode.replace(/_/g, " ")}
        </span>
      </div>

      {/* Warning counts */}
      {hasWarnings && (
        <div className="flex flex-wrap gap-2">
          {data.blockedRewrites > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              {data.blockedRewrites} blocked rewrite{data.blockedRewrites > 1 ? "s" : ""}
            </span>
          )}
          {data.truncationEvents > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
              {data.truncationEvents} truncation{data.truncationEvents > 1 ? "s" : ""}
            </span>
          )}
          {data.exactMatchFailures > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
              {data.exactMatchFailures} exact-match failure{data.exactMatchFailures > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Failed files */}
      {hasFailures && (
        <div className="text-xs">
          <span className="text-stone-500 dark:text-stone-500">Files with failed edits: </span>
          <span className="font-mono text-amber-700 dark:text-amber-400">
            {data.failedFiles.join(", ")}
          </span>
        </div>
      )}

      {/* Handoff state */}
      {data.handoffTriggered && data.handoffPayload && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded p-2 text-xs">
          <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1">
            Blocked: Manual intervention required
          </div>
          <div className="text-stone-600 dark:text-stone-400">
            File: <span className="font-mono">{data.handoffPayload.filePath}</span>
          </div>
          <div className="text-stone-600 dark:text-stone-400">
            Mode: {data.handoffPayload.selectedEditMode.replace(/_/g, " ")}
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {data.handoffPayload.preEditSnapshotPath && onRestore && (
              <button
                onClick={() => onRestore(data.handoffPayload!.preEditSnapshotPath!)}
                className="px-2 py-1 text-[10px] rounded bg-stone-100 dark:bg-stone-800 border border-stone-300 dark:border-stone-600 hover:bg-stone-200 dark:hover:bg-stone-700"
              >
                Restore snapshot
              </button>
            )}
            {onResume && (
              <button
                onClick={onResume}
                className="px-2 py-1 text-[10px] rounded bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200"
              >
                Continue after fix
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
