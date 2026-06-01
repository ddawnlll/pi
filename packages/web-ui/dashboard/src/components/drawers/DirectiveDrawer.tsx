/**
 * DirectiveDrawer — P42.10 Contextual Human Directive Drawer
 *
 * Shows current directives for a workspace and allows sending new ones.
 * Opens on-demand from escalation cards or workspace detail.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, Send, MessageSquare, User, Clock,
  AlertCircle, CheckCircle, XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-700 dark:text-stone-300";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const INPUT = "bg-stone-50 dark:bg-[#161616]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Directive {
  id: string;
  workspaceId: string;
  message: string;
  status: "pending" | "acknowledged" | "applied" | "rejected" | "expired";
  createdAt: string;
  respondedAt?: string;
  response?: string;
}

export interface DirectiveDrawerProps {
  /** Project ID. */
  projectId: string | null;
  /** Plan execution ID. */
  planExecId: string | null;
  /** Workspace ID to scope directives to. */
  workspaceId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: Directive["status"]) {
  switch (status) {
    case "pending":
      return (
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
          pending
        </span>
      );
    case "acknowledged":
      return (
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
          ack
        </span>
      );
    case "applied":
      return (
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
          applied
        </span>
      );
    case "rejected":
      return (
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
          rejected
        </span>
      );
    case "expired":
      return (
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 ${MUT}`}>
          expired
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DirectiveDrawer({ projectId, planExecId, workspaceId }: DirectiveDrawerProps) {
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Fetch ──
  const fetchDirectives = useCallback(() => {
    if (!planExecId || !workspaceId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const url = projectId
      ? `/api/projects/${encodeURIComponent(projectId)}/human/directives/${encodeURIComponent(planExecId)}/${encodeURIComponent(workspaceId)}`
      : `/api/human/directives/${encodeURIComponent(planExecId)}/${encodeURIComponent(workspaceId)}`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setDirectives(data.directives ?? data.entries ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load directives");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [projectId, planExecId, workspaceId]);

  useEffect(() => {
    fetchDirectives();
  }, [fetchDirectives]);

  // ── Send ──
  const handleSend = useCallback(async () => {
    if (!message.trim() || !planExecId || !workspaceId || sending) return;

    setSending(true);
    setSendError(null);

    try {
      const url = `/api/human/directive`;
      const body = JSON.stringify({
        projectId,
        planExecutionId: planExecId,
        workspaceId,
        message: message.trim(),
        kind: "human_directive",
      });

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      const data = await r.json();
      if (!data.success) {
        setSendError(data.error ?? "Failed to send directive");
      } else {
        setMessage("");
        // Refresh
        fetchDirectives();
      }
    } catch (err) {
      setSendError(String(err));
    } finally {
      setSending(false);
    }
  }, [message, projectId, planExecId, workspaceId, sending, fetchDirectives]);

  // ── Render ──

  if (!workspaceId) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs">
        <MessageSquare size={16} strokeWidth={1.2} className={MUT} />
        <span className={MUT}>Select a workspace to view directives</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-xs justify-center">
        <Loader2 size={14} className="animate-spin text-stone-400" />
        <span className={MUT}>Loading directives...</span>
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

  return (
    <div className="flex flex-col h-full">
      {/* Directives list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {directives.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs">
            <MessageSquare size={16} strokeWidth={1.2} className={MUT} />
            <span className={MUT}>No directives yet</span>
            <span className={`text-[10px] ${MUT}`}>
              Send a directive to guide this workspace.
            </span>
          </div>
        ) : (
          directives.map((d) => (
            <div
              key={d.id}
              className={`px-3 py-2.5 border-b ${BORD} last:border-b-0`}
            >
              <div className="flex items-center gap-2 mb-1">
                <User size={11} className="text-blue-500 dark:text-blue-400 shrink-0" />
                <span className={`text-[10px] font-semibold uppercase ${MUT}`}>Human Directive</span>
                <span className="ml-auto">{statusBadge(d.status)}</span>
              </div>
              <div className={`text-xs ${TXT} whitespace-pre-wrap`}>
                {d.message}
              </div>
              <div className={`flex items-center gap-2 mt-1 text-[9px] ${MUT}`}>
                <Clock size={9} />
                <span>{new Date(d.createdAt).toLocaleString()}</span>
                {d.respondedAt && (
                  <>
                    <span>· response: {new Date(d.respondedAt).toLocaleString()}</span>
                  </>
                )}
              </div>
              {d.response && (
                <div className={`mt-1 text-xs ${MUT} italic`}>
                  "{d.response}"
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Send input */}
      <div className={`shrink-0 border-t ${BORD} p-3`}>
        {sendError && (
          <div className="flex items-center gap-1 text-red-600 dark:text-red-400 text-[10px] mb-2">
            <XCircle size={10} />
            {sendError}
          </div>
        )}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a directive for this workspace..."
          rows={3}
          className={`w-full px-3 py-2 rounded-lg text-xs border ${BORD} ${INPUT} ${TXT} placeholder:text-stone-400 dark:placeholder:text-stone-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className={`text-[9px] ${MUT}`}>⌘+Enter to send</span>
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              message.trim() && !sending
                ? `${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-blue-900/40`
                : `${MUT} cursor-not-allowed`
            }`}
          >
            {sending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Send size={11} />
            )}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
