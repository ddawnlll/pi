/**
 * EditFailureHandoff - Dashboard component for edit failure handoff panel.
 *
 * P4.5 Workstream 4.5.D: Shows when Pi gets stuck editing the same file.
 * Displays: current diff, failed edit attempts, restore option,
 * continue after manual fix option, and retry with different edit mode.
 */

import { useState } from "react";
import { DiffViewer } from "./DiffViewer";

/**
 * Failed edit attempt summary for display.
 */
export interface FailedEditAttempt {
  /** Attempt type (full_write, targeted_edit, etc.) */
  attemptType: string;
  /** Failure type (truncation, exact_match_failed, etc.) */
  failureType: string;
  /** Error message from the tool */
  errorMessage?: string;
}

/**
 * Edit failure handoff payload for display.
 */
export interface EditFailureHandoffData {
  /** File path that caused the handoff */
  filePath: string;
  /** Selected edit mode at time of handoff */
  selectedEditMode: string;
  /** List of failed strategy attempts */
  failedStrategyList: FailedEditAttempt[];
  /** Last tool error */
  lastToolError?: string;
  /** Pre-edit snapshot path */
  preEditSnapshotPath?: string;
  /** Current unified diff */
  currentDiff: string;
  /** Attempted patch summary */
  attemptedPatchSummary: string;
  /** Suggested manual fix steps */
  suggestedManualFixSteps: string[];
  /** Suggested resume instruction */
  suggestedResumeInstruction: string;
}

/**
 * Props for the EditFailureHandoff component.
 */
export interface EditFailureHandoffProps {
  /** Handoff payload data */
  handoff: EditFailureHandoffData;
  /** Callback when user wants to restore pre-edit snapshot */
  onRestore?: (snapshotPath: string) => void;
  /** Callback when user wants to continue after manual fix */
  onResume?: () => void;
  /** Callback when user wants to retry with a different edit mode */
  onRetryWithMode?: (mode: string) => void;
  /** Available edit modes for retry */
  availableModes?: string[];
}

/**
 * Display a panel showing edit failure handoff information.
 *
 * Shows:
 * - The blocked file and the edit mode that was in use
 * - A list of failed edit attempts with failure types
 * - Current diff of the file
 * - Suggested manual fix steps
 * - Actions: restore snapshot, resume, retry with different mode
 */
export function EditFailureHandoffPanel({
  handoff,
  onRestore,
  onResume,
  onRetryWithMode,
  availableModes = ["token_saving", "hybrid", "speed"],
}: EditFailureHandoffProps) {
  const [showDiff, setShowDiff] = useState(false);

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="inline-block w-3 h-3 bg-amber-500 rounded-full shrink-0" />
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Edit Failure Handoff
        </h3>
      </div>

      {/* File and mode info */}
      <div className="text-xs space-y-1">
        <div className="flex">
          <span className="text-amber-700 dark:text-amber-400 w-24 shrink-0">File:</span>
          <span className="font-mono text-amber-900 dark:text-amber-200 break-all">{handoff.filePath}</span>
        </div>
        <div className="flex">
          <span className="text-amber-700 dark:text-amber-400 w-24 shrink-0">Edit mode:</span>
          <span className="text-amber-900 dark:text-amber-200">{handoff.selectedEditMode}</span>
        </div>
        <div className="flex">
          <span className="text-amber-700 dark:text-amber-400 w-24 shrink-0">Failures:</span>
          <span className="text-amber-900 dark:text-amber-200">{handoff.failedStrategyList.length}</span>
        </div>
      </div>

      {/* Failed attempts list */}
      {handoff.failedStrategyList.length > 0 && (
        <div className="bg-white dark:bg-[#1A1A1A] rounded border border-amber-200 dark:border-amber-900 p-2">
          <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Failed Attempts:</h4>
          <ul className="space-y-1">
            {handoff.failedStrategyList.map((attempt, i) => (
              <li key={i} className="text-xs text-stone-700 dark:text-stone-300">
                <span className="font-medium">{attempt.attemptType.replace(/_/g, " ")}</span>
                <span className="text-amber-600 dark:text-amber-400 ml-1">
                  ({attempt.failureType.replace(/_/g, " ")})
                </span>
                {attempt.errorMessage && (
                  <span className="block text-stone-500 dark:text-stone-500 truncate ml-2">
                    {attempt.errorMessage}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Last tool error */}
      {handoff.lastToolError && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2">
          <span className="text-xs font-semibold text-red-700 dark:text-red-400">Last error: </span>
          <span className="text-xs text-red-800 dark:text-red-300">{handoff.lastToolError}</span>
        </div>
      )}

      {/* Current diff toggle */}
      {handoff.currentDiff && (
        <div>
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showDiff ? "Hide diff" : "Show current diff"}
          </button>
          {showDiff && (
            <div className="mt-2 bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded p-2 max-h-48 overflow-y-auto">
              <pre className="text-xs font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap">
                {handoff.currentDiff}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Suggested manual fix steps */}
      {handoff.suggestedManualFixSteps.length > 0 && (
        <div className="bg-white dark:bg-[#1A1A1A] rounded border border-amber-200 dark:border-amber-900 p-2">
          <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Suggested Fix Steps:</h4>
          <ol className="list-decimal list-inside space-y-1">
            {handoff.suggestedManualFixSteps.map((step, i) => (
              <li key={i} className="text-xs text-stone-700 dark:text-stone-300">{step}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Resume instruction */}
      <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/40 rounded p-2">
        <span className="font-semibold">Resume: </span>{handoff.suggestedResumeInstruction}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-2">
        {handoff.preEditSnapshotPath && onRestore && (
          <button
            onClick={() => onRestore(handoff.preEditSnapshotPath!)}
            className="px-3 py-1.5 text-xs font-medium rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-600 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
          >
            Restore snapshot
          </button>
        )}
        {onResume && (
          <button
            onClick={onResume}
            className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
          >
            Continue after manual fix
          </button>
        )}
        {onRetryWithMode && (
          <select
            onChange={(e) => onRetryWithMode(e.target.value)}
            className="px-3 py-1.5 text-xs rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800"
            defaultValue=""
          >
            <option value="" disabled>Retry with mode...</option>
            {availableModes.map((mode) => (
              <option key={mode} value={mode}>{mode.replace(/_/g, " ")}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
