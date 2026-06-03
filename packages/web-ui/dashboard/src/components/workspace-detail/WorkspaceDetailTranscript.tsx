/**
 * WorkspaceDetailTranscript — Transcript section (P42.06).
 *
 * Displays live transcript events from the worker transcript SSE stream.
 */

import { Activity, AlertTriangle, CheckCircle, Terminal, XCircle, Loader2 } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import type { WorkerTranscriptEvent } from "../../types";

// ─── Style tokens ──────────────────────────────────────────────────────────


// ─── Event type icon ───────────────────────────────────────────────────────

function eventIcon(type: string) {
  switch (type) {
    case "worker_status":
      return <Activity size={11} className="text-blue-400 shrink-0" />;
    case "worker_decision_summary":
      return <Terminal size={11} className="text-purple-400 shrink-0" />;
    case "validation":
      return <CheckCircle size={11} className="text-emerald-400 shrink-0" />;
    case "blocker":
      return <AlertTriangle size={11} className="text-amber-400 shrink-0" />;
    case "tool_call":
      return <Terminal size={11} className="text-stone-400 shrink-0" />;
    case "workspace_start":
      return <Activity size={11} className="text-emerald-400 shrink-0" />;
    case "workspace_complete":
      return <CheckCircle size={11} className="text-emerald-400 shrink-0" />;
    case "workspace_failed":
      return <XCircle size={11} className="text-red-400 shrink-0" />;
    case "workspace_blocked":
      return <AlertTriangle size={11} className="text-amber-400 shrink-0" />;
    case "retry_attempt":
      return <Activity size={11} className="text-amber-400 shrink-0" />;
    default:
      return <Activity size={11} className={MUT} />;
  }
}

function eventLabel(type: string): string {
  switch (type) {
    case "worker_status":
      return "Status";
    case "worker_decision_summary":
      return "Decision";
    case "validation":
      return "Validation";
    case "blocker":
      return "Blocker";
    case "tool_call":
      return "Tool Call";
    case "workspace_start":
      return "Start";
    case "workspace_complete":
      return "Complete";
    case "workspace_failed":
      return "Failed";
    case "workspace_blocked":
      return "Blocked";
    case "retry_attempt":
      return "Retry";
    default:
      return type;
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkspaceDetailTranscriptProps {
  events: WorkerTranscriptEvent[];
  isConnected: boolean;
  isReconnecting: boolean;
  error: string | null;
}

export function WorkspaceDetailTranscript({
  events,
  isConnected,
  isReconnecting,
  error,
}: WorkspaceDetailTranscriptProps) {
  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
        <div className="flex items-center gap-2">
          <Activity size={13} className={MUT} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
            Transcript
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isReconnecting && (
            <span className="text-xs text-amber-500 flex items-center gap-1">
              <Loader2 size={9} className="animate-spin" />
              Reconnecting
            </span>
          )}
          {isConnected && (
            <span className="text-xs text-emerald-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
          <span className={`text-xs tabular-nums ${MUT}`}>
            {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border-b ${BORD}">
          {error}
        </div>
      )}

      {/* Empty state */}
      {events.length === 0 && !error && (
        <div className={`p-3 text-xs ${MUT}`}>
          No transcript events yet. Events will appear as the workspace executes.
        </div>
      )}

      {/* Event list */}
      <div className="divide-y ${BORD} max-h-96 overflow-y-auto">
        {events.map((ev, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors">
            <div className="shrink-0 mt-0.5">{eventIcon(ev.type)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-medium uppercase tracking-wide ${MUT}`}>
                  {eventLabel(ev.type)}
                </span>
                <span className={`text-xs tabular-nums ${MUT}`}>
                  {formatTime(ev.timestamp)}
                </span>
              </div>
              <p className={`text-xs ${TXT} leading-relaxed mt-0.5`}>{ev.summary}</p>
              {ev.data && Object.keys(ev.data).length > 0 && (
                <details>
                  <summary className={`text-xs ${MUT} cursor-pointer hover:text-stone-600 dark:hover:text-stone-300 mt-0.5`}>
                    Details
                  </summary>
                  <pre className={`mt-1 p-1.5 rounded bg-stone-50 dark:bg-[#1A1A1A] text-xs font-mono ${TXT} whitespace-pre-wrap break-all overflow-x-auto`}>
                    {JSON.stringify(ev.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
