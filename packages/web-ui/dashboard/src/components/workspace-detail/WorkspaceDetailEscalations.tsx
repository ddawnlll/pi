/**
 * WorkspaceDetailEscalations — Escalations and Directives section (P42.06).
 *
 * Displays active escalations (awaiting user resolution) and human directives
 * for the workspace.
 */

import { AlertTriangle, CheckCircle, MessageSquare, Loader2 } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import type { EscalationEntry } from "../../hooks/useEscalations";
import type { HumanDirectiveEntry } from "../../hooks/useHumanDirectives";

// ─── Style tokens ──────────────────────────────────────────────────────────

const WARN_TXT = "text-amber-600 dark:text-amber-400";

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkspaceDetailEscalationsProps {
  escalations: EscalationEntry[] | undefined;
  directives: HumanDirectiveEntry[] | undefined;
  escalationsLoading: boolean;
  directivesLoading: boolean;
  escalationsError: unknown;
  directivesError: unknown;
  onResolveEscalation?: (escalationId: string, chosenOptionId: string) => void;
}

export function WorkspaceDetailEscalations({
  escalations,
  directives,
  escalationsLoading,
  directivesLoading,
  escalationsError,
  directivesError,
  onResolveEscalation,
}: WorkspaceDetailEscalationsProps) {
  const isLoading = escalationsLoading || directivesLoading;
  const hasError = escalationsError || directivesError;
  const hasData =
    (escalations && escalations.length > 0) ||
    (directives && directives.length > 0);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 flex items-center gap-2 text-xs ${MUT}`}>
        <Loader2 size={12} className="animate-spin" />
        Loading escalations and directives...
      </div>
    );
  }

  // ── Error state ──
  if (hasError && !hasData) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs text-red-500`}>
        Failed to load escalations or directives.
      </div>
    );
  }

  // ── Empty state ──
  if (!hasData) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs ${MUT}`}>
        No active escalations or directives.
      </div>
    );
  }

  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} className={MUT} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
            Escalations / Directives
          </span>
        </div>
        <span className={`text-xs tabular-nums ${MUT}`}>
          {(escalations?.length ?? 0) + (directives?.length ?? 0)} total
        </span>
      </div>

      {/* Body */}
      <div className="divide-y ${BORD}">
        {/* Escalations */}
        {escalations && escalations.length > 0 && (
          <div>
            <div className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${WARN_TXT} bg-amber-50/50 dark:bg-amber-900/10`}>
              Escalations ({escalations.length})
            </div>
            {escalations.map((esc) => (
              <div key={esc.escalationId} className="p-3 space-y-2 text-xs hover:bg-stone-50 dark:hover:bg-[#2A2A2A]">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <p className={`${TXT} leading-relaxed`}>{esc.reason}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${MUT}`}>{formatTime(esc.issuedAt)}</span>
                      <span
                        className={`text-xs font-medium px-1 py-px rounded ${
                          esc.status === "awaiting_user"
                            ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                            : esc.status === "resolved"
                              ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                              : "bg-stone-100 dark:bg-stone-800 text-stone-500"
                        }`}
                      >
                        {esc.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Options */}
                {esc.options && esc.options.length > 0 && esc.status === "awaiting_user" && (
                  <div className="pl-5 space-y-1">
                    <span className={`text-xs ${MUT}`}>Options:</span>
                    <div className="flex flex-wrap gap-1">
                      {esc.options.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => onResolveEscalation?.(esc.escalationId, opt.id)}
                          className="px-2 py-1 rounded text-xs font-medium border ${BORD} bg-stone-100 dark:bg-[#2A2A2A] hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          title={opt.description}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {esc.chosenOptionId && (
                  <div className="pl-5 flex items-center gap-1.5 text-xs">
                    <CheckCircle size={9} className="text-emerald-400" />
                    <span className={MUT}>Resolved with: {esc.chosenOptionId}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Directives */}
        {directives && directives.length > 0 && (
          <div>
            <div className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${ACC_TXT} bg-blue-50/50 dark:bg-blue-900/10`}>
              Directives ({directives.length})
            </div>
            {directives.map((dir) => (
              <div key={dir.id} className="p-3 space-y-1 text-xs hover:bg-stone-50 dark:hover:bg-[#2A2A2A]">
                <div className="flex items-start gap-2">
                  <MessageSquare size={12} className="mt-0.5 shrink-0 text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <p className={`${TXT} leading-relaxed`}>{dir.directive}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${MUT}`}>{formatTime(dir.issuedAt)}</span>
                      <span
                        className={`text-xs font-medium px-1 py-px rounded ${
                          dir.severity === "blocking"
                            ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                            : dir.severity === "high"
                              ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                              : "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                        }`}
                      >
                        {dir.severity}
                      </span>
                      {dir.acknowledged && (
                        <span className="text-xs text-emerald-500 flex items-center gap-0.5">
                          <CheckCircle size={8} />
                          Ack'd
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
