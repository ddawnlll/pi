/**
 * TranscriptDrawer — P42.10 Contextual Transcript Drawer
 *
 * Shows worker transcript events for a given workspace.
 * Opens on-demand from workspace detail or worker card.
 */

import { useState, useEffect } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { Loader2, MessageSquare, User, Bot, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptEvent {
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
}

export interface TranscriptDrawerProps {
  /** Project ID. */
  projectId: string | null;
  /** Plan execution ID. */
  planExecId: string | null;
  /** Workspace ID to fetch transcript for. */
  workspaceId: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TranscriptDrawer({ projectId, planExecId, workspaceId }: TranscriptDrawerProps) {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planExecId || !workspaceId) {
      setLoading(false);
      setError("Missing execution or workspace ID.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const base = `/api/transcript/${encodeURIComponent(planExecId)}/${encodeURIComponent(workspaceId)}`;

    fetch(base)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setEvents(data.events ?? data.transcript ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load transcript");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [planExecId, workspaceId]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-xs justify-center">
        <Loader2 size={14} className="animate-spin text-stone-400" />
        <span className={MUT}>Loading transcript...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs">
        <AlertCircle size={16} className="text-stone-400" />
        <span className={MUT}>{error}</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs">
        <MessageSquare size={16} strokeWidth={1.2} className={MUT} />
        <span className={MUT}>No transcript events yet</span>
        <span className={`text-xs ${MUT}`}>
          Transcript becomes available after worker starts executing.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {events.map((ev, i) => (
        <div
          key={`${ev.timestamp ?? i}-${i}`}
          className={`px-3 py-2.5 border-b ${BORD} last:border-b-0`}
        >
          {/* Role badge */}
          <div className="flex items-center gap-2 mb-1">
            {ev.role === "user" ? (
              <User size={11} className="text-blue-500 dark:text-blue-400 shrink-0" />
            ) : ev.role === "assistant" ? (
              <Bot size={11} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
            ) : ev.role === "tool" ? (
              <MessageSquare size={11} className="text-amber-500 dark:text-amber-400 shrink-0" />
            ) : (
              <AlertCircle size={11} className={MUT} />
            )}
            <span className={`text-xs font-semibold uppercase ${MUT}`}>
              {ev.role}
            </span>
            {ev.toolName && (
              <span className={`text-xs ${MUT}`}>{ev.toolName}</span>
            )}
            {ev.timestamp && (
              <span className={`text-xs ${MUT} ml-auto`}>
                {new Date(ev.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Content */}
          {ev.content && (
            <div className={`text-xs ${TXT} whitespace-pre-wrap break-words`}>
              {ev.content.length > 500
                ? `${ev.content.slice(0, 500)}...`
                : ev.content}
            </div>
          )}

          {/* Tool output */}
          {ev.toolOutput && (
            <div className={`mt-1 text-xs font-mono ${MUT} whitespace-pre-wrap break-all bg-stone-50 dark:bg-[#161616] rounded p-2 max-h-40 overflow-y-auto`}>
              {ev.toolOutput.length > 1000
                ? `${ev.toolOutput.slice(0, 1000)}...`
                : ev.toolOutput}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
