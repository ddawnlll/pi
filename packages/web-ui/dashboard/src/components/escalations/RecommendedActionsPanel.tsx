/**
 * RecommendedActionsPanel — Shows recommended actions for an escalation (P42.09).
 *
 * Displays the available resolution options and the recommended one.
 * Each option includes a risk level and triggers resolution via
 * the execution-service-backed `/api/human/escalations/:id/resolve` endpoint.
 *
 * Acceptance Criteria:
 * - Shows available escalation options with risk levels
 * - Highlights the recommended option
 * - Resolves escalation through execution-service (via web-server endpoint)
 * - Shows loading, success, and error states
 * - Allows optional user response text
 */

import { useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { AlertTriangle, CheckCircle, Lightbulb, Loader2, Send, Zap } from "lucide-react";
import { useResolveEscalation } from "../../hooks/useEscalations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscalationOption {
  id: string;
  label: string;
  risk: string;
  description?: string;
}

export interface RecommendedActionsPanelProps {
  /** Escalation ID to resolve */
  escalationId: string;
  /** Plan execution ID */
  planExecId: string;
  /** Workspace ID */
  workspaceId: string;
  /** Available resolution options */
  options: EscalationOption[];
  /** The recommended option ID */
  recommendedOptionId?: string;
  /** Called after escalation is resolved */
  onResolved?: () => void;
  /** Optional class name */
  className?: string;
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const WARN_TXT = "text-amber-600 dark:text-amber-400";
const ERR_TXT = "text-red-600 dark:text-red-400";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";

// ---------------------------------------------------------------------------
// Risk helpers
// ---------------------------------------------------------------------------

const RISK_COLORS: Record<string, { text: string; bg: string }> = {
  low: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  medium: { text: WARN_TXT, bg: "bg-amber-50 dark:bg-amber-900/20" },
  high: { text: ERR_TXT, bg: ERR_BG },
};

function riskColor(risk: string) {
  return RISK_COLORS[risk.toLowerCase()] ?? RISK_COLORS.medium;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecommendedActionsPanel({
  escalationId,
  planExecId,
  workspaceId,
  options,
  recommendedOptionId,
  onResolved,
  className = "",
}: RecommendedActionsPanelProps) {
  const resolveMutation = useResolveEscalation();
  const [userResponse, setUserResponse] = useState("");
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);

  const handleResolve = (optionId: string) => {
    setPendingOptionId(optionId);
    resolveMutation.mutate(
      {
        escalationId,
        planExecutionId: planExecId,
        workspaceId,
        chosenOptionId: optionId,
        userResponse: userResponse.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          if (data.success) {
            setUserResponse("");
            setPendingOptionId(null);
            onResolved?.();
          }
        },
        onError: () => {
          setPendingOptionId(null);
        },
      },
    );
  };

  if (!options || options.length === 0) {
    return (
      <div className={`text-xs ${MUT} italic py-1 ${className}`}>
        No actions available
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header */}
      <div className={`flex items-center gap-1.5 ${MUT}`}>
        <Lightbulb size={11} />
        <span className="text-xs font-semibold uppercase tracking-wider">
          Recommended Actions
        </span>
      </div>

      {/* Options list */}
      <div className="space-y-1">
        {options.map((opt) => {
          const isRecommended = opt.id === recommendedOptionId;
          const isPending = pendingOptionId === opt.id;
          const rc = riskColor(opt.risk);

          return (
            <button
              key={opt.id}
              onClick={() => handleResolve(opt.id)}
              disabled={resolveMutation.isPending}
              className={`w-full flex items-start gap-2 px-2.5 py-2 rounded border text-left transition-colors ${
                isRecommended ? `${ACC_BG} border-blue-300 dark:border-blue-700` : `${BORD}`
              } ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50`}
            >
              <div className="shrink-0 mt-0.5">
                {isRecommended ? (
                  <Zap size={12} className={ACC_TXT} />
                ) : (
                  <Send size={12} className={MUT} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium">{opt.label}</span>
                  {/* Risk badge */}
                  <span
                    className={`text-xs font-semibold px-1 py-0.5 rounded ${rc.text} ${rc.bg}`}
                  >
                    {opt.risk}
                  </span>
                  {isRecommended && (
                    <span className={`text-xs font-medium ${ACC_TXT}`}>
                      Recommended
                    </span>
                  )}
                </div>
                {opt.description && (
                  <p className={`text-xs ${MUT} mt-0.5`}>{opt.description}</p>
                )}
                {/* Loading for this option */}
                {isPending && resolveMutation.isPending && (
                  <div className={`flex items-center gap-1 mt-1 text-xs ${MUT}`}>
                    <Loader2 size={10} className="animate-spin" />
                    Resolving...
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Optional user response */}
      <div>
        <textarea
          placeholder="Optional response to send with resolution..."
          value={userResponse}
          onChange={(e) => setUserResponse(e.target.value)}
          disabled={resolveMutation.isPending}
          className={`w-full text-xs px-2 py-1.5 rounded border ${BORD} bg-transparent ${TXT} placeholder:text-stone-400 resize-none`}
          rows={2}
        />
      </div>

      {/* Error state */}
      {resolveMutation.isError && (
        <div className={`flex items-center gap-1 text-xs ${ERR_TXT}`}>
          <AlertTriangle size={10} />
          {resolveMutation.error?.message ?? "Failed to resolve escalation"}
        </div>
      )}

      {/* Server error */}
      {resolveMutation.data?.success === false && (
        <div className={`flex items-center gap-1 text-xs ${ERR_TXT}`}>
          <AlertTriangle size={10} />
          {resolveMutation.data.error ?? "Resolution rejected"}
        </div>
      )}

      {/* Success */}
      {resolveMutation.data?.success === true && (
        <div className={`flex items-center gap-1 text-xs ${GOOD_TXT}`}>
          <CheckCircle size={10} />
          Escalation resolved
        </div>
      )}
    </div>
  );
}
