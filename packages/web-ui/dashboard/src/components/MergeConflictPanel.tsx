/**
 * MergeConflictPanel - Dashboard component for merge conflict handoff panel.
 *
 * P2 Workstream 6.D: Displays when a workspace merge has a git conflict.
 * Shows: conflicted files, conflict diff, resolution steps, resume action.
 */

import { useState } from "react";

/**
 * A single conflicted file within a merge conflict.
 */
export interface ConflictedFile {
  /** File path relative to workspace root */
  filePath: string;
  /** Git status of the file (e.g., "both modified", "deleted by us") */
  conflictType: string;
  /** Whether this file still contains conflict markers */
  hasConflictMarkers: boolean;
}

/**
 * Merge conflict handoff data for the dashboard panel.
 */
export interface MergeConflictData {
  /** Workspace ID that caused the conflict */
  workspaceId: string;
  /** Commit hash being merged */
  commitHash: string;
  /** Merge conflict status */
  status: "unresolved" | "resolved" | "resume_complete" | "resume_failed";
  /** Timestamp when conflict was detected */
  detectedAt: number;
  /** Timestamp when conflict was resolved */
  resolvedAt?: number;
  /** List of conflicted files */
  conflictedFiles: ConflictedFile[];
  /** Full git diff of conflicted area */
  conflictDiff: string;
  /** Git status output at conflict time */
  gitStatusOutput: string;
  /** Human-readable description */
  description: string;
  /** Suggested manual resolution steps */
  suggestedResolutionSteps: string[];
  /** Error message from git */
  gitErrorMessage?: string;
  /** Resolution notes (if any) */
  resolutionNotes?: string;
  /** Resume error message (if resume failed) */
  resumeError?: string;
}

/**
 * Props for the MergeConflictPanel component.
 */
export interface MergeConflictPanelProps {
  /** Merge conflict data to display */
  conflict: MergeConflictData;
  /** Callback when user confirms conflict has been resolved manually */
  onResolved?: (artifactPath: string, notes?: string) => void;
  /** Callback when user wants to retry the integration after resolution */
  onRetry?: (workspaceId: string) => void;
  /** Callback when user wants to abort the merge */
  onAbort?: () => void;
  /** Path to the conflict artifact file (for onResolved callback) */
  artifactPath?: string;
}

/**
 * Format a timestamp for display.
 */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Display a panel showing merge conflict handoff information.
 *
 * Shows:
 * - The blocked workspace and commit
 * - A list of conflicted files with their conflict types
 * - The full git diff of the conflicted area
 * - Suggested manual resolution steps
 * - Actions: mark resolved, retry integration, abort merge
 */
export function MergeConflictPanel({
  conflict,
  onResolved,
  onRetry,
  onAbort,
  artifactPath,
}: MergeConflictPanelProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [showNotesInput, setShowNotesInput] = useState(false);

  const isResolved = conflict.status === "resolved" || conflict.status === "resume_complete";
  const isComplete = conflict.status === "resume_complete";
  const hasFailed = conflict.status === "resume_failed";

  return (
    <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="inline-block w-3 h-3 bg-red-500 rounded-full shrink-0" />
        <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">
          Merge Conflict Handoff
        </h3>
        {isResolved && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
            Resolved
          </span>
        )}
        {isComplete && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
            Resume Complete
          </span>
        )}
        {hasFailed && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
            Resume Failed
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-red-700 dark:text-red-400">
        {conflict.description}
      </p>

      {/* Workspace and commit info */}
      <div className="text-xs space-y-1">
        <div className="flex">
          <span className="text-red-700 dark:text-red-400 w-28 shrink-0">Workspace:</span>
          <span className="font-mono text-red-900 dark:text-red-200 break-all">{conflict.workspaceId}</span>
        </div>
        <div className="flex">
          <span className="text-red-700 dark:text-red-400 w-28 shrink-0">Commit:</span>
          <span className="font-mono text-red-900 dark:text-red-200">{conflict.commitHash.slice(0, 12)}</span>
        </div>
        <div className="flex">
          <span className="text-red-700 dark:text-red-400 w-28 shrink-0">Detected:</span>
          <span className="text-red-900 dark:text-red-200">{formatTimestamp(conflict.detectedAt)}</span>
        </div>
        {conflict.resolvedAt && (
          <div className="flex">
            <span className="text-red-700 dark:text-red-400 w-28 shrink-0">Resolved:</span>
            <span className="text-red-900 dark:text-red-200">{formatTimestamp(conflict.resolvedAt)}</span>
          </div>
        )}
        {conflict.resumeError && (
          <div className="flex">
            <span className="text-red-700 dark:text-red-400 w-28 shrink-0">Resume error:</span>
            <span className="text-red-900 dark:text-red-200">{conflict.resumeError}</span>
          </div>
        )}
      </div>

      {/* Conflicted files list */}
      {conflict.conflictedFiles.length > 0 && (
        <div className="bg-white dark:bg-[#1A1A1A] rounded border border-red-200 dark:border-red-900 p-2">
          <h4 className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
            Conflicted Files ({conflict.conflictedFiles.length}):
          </h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {conflict.conflictedFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                    file.hasConflictMarkers
                      ? "bg-red-500"
                      : "bg-emerald-500"
                  }`}
                />
                <span className="font-mono text-stone-700 dark:text-stone-300 truncate flex-1">
                  {file.filePath}
                </span>
                <span className="text-stone-500 dark:text-stone-500 shrink-0 text-[10px]">
                  {file.conflictType}
                </span>
                {!file.hasConflictMarkers && (
                  <span className="text-emerald-600 dark:text-emerald-400 shrink-0 text-[10px]">
                    resolved
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Git error */}
      {conflict.gitErrorMessage && (
        <div className="bg-white dark:bg-[#1A1A1A] rounded border border-red-200 dark:border-red-900 p-2">
          <span className="text-xs font-semibold text-red-700 dark:text-red-400">Git error: </span>
          <pre className="text-xs font-mono text-stone-600 dark:text-stone-400 mt-1 whitespace-pre-wrap">
            {conflict.gitErrorMessage}
          </pre>
        </div>
      )}

      {/* Conflict diff toggle */}
      {conflict.conflictDiff && (
        <div>
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showDiff ? "Hide conflict diff" : "Show conflict diff"}
          </button>
          {showDiff && (
            <div className="mt-2 bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded p-2 max-h-48 overflow-y-auto">
              <pre className="text-xs font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap">
                {conflict.conflictDiff}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Git status toggle */}
      {conflict.gitStatusOutput && (
        <div>
          <button
            onClick={() => setShowStatus(!showStatus)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showStatus ? "Hide git status" : "Show git status"}
          </button>
          {showStatus && (
            <div className="mt-2 bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded p-2 max-h-32 overflow-y-auto">
              <pre className="text-xs font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap">
                {conflict.gitStatusOutput}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Suggested resolution steps */}
      {conflict.suggestedResolutionSteps.length > 0 && (
        <div className="bg-white dark:bg-[#1A1A1A] rounded border border-red-200 dark:border-red-900 p-2">
          <h4 className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Resolution Steps:</h4>
          <div className="text-xs text-stone-700 dark:text-stone-300 whitespace-pre-wrap">
            {conflict.suggestedResolutionSteps.join("\n")}
          </div>
        </div>
      )}

      {/* Resolution notes */}
      {conflict.resolutionNotes && (
        <div className="bg-white dark:bg-[#1A1A1A] rounded border border-emerald-200 dark:border-emerald-900 p-2">
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Resolution notes: </span>
          <span className="text-xs text-stone-700 dark:text-stone-300">{conflict.resolutionNotes}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-2">
        {onAbort && !isResolved && (
          <button
            onClick={onAbort}
            className="px-3 py-1.5 text-xs font-medium rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-600 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
          >
            Abort merge
          </button>
        )}

        {onResolved && artifactPath && !isResolved && (
          <>
            {!showNotesInput ? (
              <button
                onClick={() => setShowNotesInput(true)}
                className="px-3 py-1.5 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
              >
                Mark as resolved
              </button>
            ) : (
              <div className="flex flex-col gap-2 w-full">
                <input
                  type="text"
                  placeholder="Optional resolution notes..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded border border-blue-300 dark:border-blue-800 bg-white dark:bg-[#1A1A1A] text-stone-800 dark:text-stone-200"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onResolved(artifactPath, resolutionNotes || undefined);
                      setShowNotesInput(false);
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
                  >
                    Confirm resolved
                  </button>
                  <button
                    onClick={() => {
                      setShowNotesInput(false);
                      setResolutionNotes("");
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-600 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {onRetry && (isResolved || isComplete) && (
          <button
            onClick={() => onRetry(conflict.workspaceId)}
            className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
          >
            Retry integration for {conflict.workspaceId}
          </button>
        )}
      </div>
    </div>
  );
}
