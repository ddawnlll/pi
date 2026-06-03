/**
 * WorkspaceDetailFileChanges — File changes section (P42.06).
 *
 * Displays all files modified by the workspace with change status, additions, deletions.
 */

import { FileCode, Loader2 } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import type { ChangedFileEntry } from "../../hooks/useChangedFiles";

// ─── Style tokens ──────────────────────────────────────────────────────────


// ─── Status badge helpers ──────────────────────────────────────────────────

function statusLabel(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "unmerged":
      return "U";
    default:
      return "?";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "added":
      return "text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20";
    case "modified":
      return "text-blue-400 bg-blue-50 dark:bg-blue-900/20";
    case "deleted":
      return "text-red-400 bg-red-50 dark:bg-red-900/20";
    case "renamed":
      return "text-amber-400 bg-amber-50 dark:bg-amber-900/20";
    case "copied":
      return "text-purple-400 bg-purple-50 dark:bg-purple-900/20";
    case "unmerged":
      return "text-orange-400 bg-orange-50 dark:bg-orange-900/20";
    default:
      return "text-stone-400 bg-stone-100 dark:bg-stone-800";
  }
}

function formatDiff(additions?: number, deletions?: number): string {
  const parts: string[] = [];
  if (additions != null && additions > 0) parts.push(`+${additions}`);
  if (deletions != null && deletions > 0) parts.push(`-${deletions}`);
  return parts.length > 0 ? parts.join(" ") : "";
}

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkspaceDetailFileChangesProps {
  files: ChangedFileEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
}

export function WorkspaceDetailFileChanges({
  files,
  isLoading,
  error,
}: WorkspaceDetailFileChangesProps) {
  // ── Loading state ──
  if (isLoading) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 flex items-center gap-2 text-xs ${MUT}`}>
        <Loader2 size={12} className="animate-spin" />
        Loading file changes...
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs text-red-500`}>
        Failed to load file changes.
      </div>
    );
  }

  // ── Empty state ──
  if (!files || files.length === 0) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs ${MUT}`}>
        No file changes recorded.
      </div>
    );
  }

  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
        <div className="flex items-center gap-2">
          <FileCode size={13} className={MUT} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
            File Changes
          </span>
        </div>
        <span className={`text-xs tabular-nums ${MUT}`}>
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Body */}
      <div className="divide-y ${BORD}">
        {files.map((f, i) => (
          <div
            key={`${f.path}-${i}`}
            className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors"
          >
            {/* Status badge */}
            <span
              className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${statusColor(f.status)}`}
              title={f.status}
            >
              {statusLabel(f.status)}
            </span>

            {/* Filename */}
            <span className={`font-mono ${TXT} truncate flex-1 min-w-0 text-xs`} title={f.path}>
              {f.name || f.path}
            </span>

            {/* Diff stats */}
            <span className={`shrink-0 text-xs tabular-nums ${MUT}`}>
              {formatDiff(f.additions, f.deletions)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
