/**
 * WorkspaceDetailCommandHistory — Command history section (P42.06).
 *
 * Displays all commands executed by the workspace with exit codes and timestamps.
 */

import { Terminal, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import type { CommandHistoryEntry } from "../../hooks/useCommandHistory";

// ─── Style tokens ──────────────────────────────────────────────────────────


// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function durationMs(startedAt: number, finishedAt: number): string {
  const ms = finishedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkspaceDetailCommandHistoryProps {
  commands: CommandHistoryEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
}

export function WorkspaceDetailCommandHistory({
  commands,
  isLoading,
  error,
}: WorkspaceDetailCommandHistoryProps) {
  // ── Loading state ──
  if (isLoading) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 flex items-center gap-2 text-xs ${MUT}`}>
        <Loader2 size={12} className="animate-spin" />
        Loading command history...
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs text-red-500`}>
        Failed to load command history.
      </div>
    );
  }

  // ── Empty state ──
  if (!commands || commands.length === 0) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs ${MUT}`}>
        No commands executed yet.
      </div>
    );
  }

  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
        <div className="flex items-center gap-2">
          <Terminal size={13} className={MUT} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
            Command History
          </span>
        </div>
        <span className={`text-xs tabular-nums ${MUT}`}>
          {commands.length} command{commands.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Body */}
      <div className="divide-y ${BORD}">
        {commands.map((cmd, i) => (
          <div key={i} className="p-3 space-y-1.5 text-xs hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors">
            {/* Command line */}
            <div className="flex items-start gap-2">
              <div className="shrink-0 mt-0.5">
                {cmd.exitCode === 0 ? (
                  <CheckCircle size={11} className="text-emerald-400" />
                ) : cmd.exitCode !== null ? (
                  <XCircle size={11} className="text-red-400" />
                ) : (
                  <div className="w-[11px] h-[11px] rounded-full border border-stone-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <code className={`block text-xs font-mono ${TXT} break-all leading-relaxed`}>
                  {cmd.command}
                </code>
                {cmd.isTargetCommand && (
                  <span className="inline-block mt-0.5 px-1 py-px rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                    TARGET
                  </span>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="flex items-center gap-2 pl-5">
              <span className={`text-xs ${MUT}`}>{formatTimestamp(cmd.startedAt)}</span>
              <span className={`text-xs ${MUT}`}>
                {durationMs(cmd.startedAt, cmd.finishedAt)}
              </span>
              {cmd.exitCode !== null && (
                <span
                  className={`text-xs font-medium tabular-nums ${
                    cmd.exitCode === 0 ? "text-emerald-500" : "text-red-500"
                  }`}
                >
                  exit {cmd.exitCode}
                </span>
              )}
              {cmd.cwd && (
                <span className={`text-xs ${MUT} truncate max-w-[160px]`} title={cmd.cwd}>
                  {cmd.cwd}
                </span>
              )}
            </div>

            {/* Output summary */}
            {cmd.outputSummary && (
              <details className="pl-5">
                <summary className={`text-xs ${MUT} cursor-pointer hover:text-stone-600 dark:hover:text-stone-300`}>
                  Output summary
                </summary>
                <pre className={`mt-1 p-2 rounded bg-stone-50 dark:bg-[#1A1A1A] text-xs font-mono ${TXT} whitespace-pre-wrap break-all max-h-32 overflow-y-auto`}>
                  {cmd.outputSummary}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
