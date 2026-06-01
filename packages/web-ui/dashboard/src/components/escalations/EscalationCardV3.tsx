/**
 * EscalationCardV3 — Enhanced escalation card (P42.09).
 *
 * Shows a single escalation with full context:
 * - Workspace ID and severity
 * - Root cause (whatHappened / whyStuck)
 * - Impact summary
 * - Evidence references
 * - Retry budget (from Lead Agent diagnosis if available)
 * - Lead Agent diagnosis
 * - Recommended actions
 * - State: awaiting_user / user_responded / resolved / expired
 *
 * Integrates with RecommendedActionsPanel, EscalationEvidenceList,
 * and HumanDirectiveInput for full resolution workflows.
 *
 * Acceptance Criteria:
 * - Shows all required fields per the V3 spec
 * - Handles all escalation states
 * - Wires resolution through execution-service
 * - Displays evidence and log references
 */

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Hash,
  Info,
  RotateCw,
  XCircle,
} from "lucide-react";
import { EscalationEvidenceList } from "./EscalationEvidenceList";
import { RecommendedActionsPanel } from "./RecommendedActionsPanel";
import { HumanDirectiveInput } from "./HumanDirectiveInput";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { LeadEscalationView } from "@earendil-works/pi-execution-core";

export type { LeadEscalationView };

export interface EscalationCardV3Props {
  /** The escalation data from the read model / API */
  escalation: LeadEscalationView;
  /** Plan execution ID */
  planExecId: string;
  /** Called after escalation is resolved */
  onResolved?: () => void;
  /** Optional class name */
  className?: string;
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const ERR_TXT = "text-red-600 dark:text-red-400";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const GOOD_BG = "bg-emerald-50 dark:bg-emerald-900/20";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_META: Record<string, { label: string; icon: typeof CheckCircle; text: string; bg: string }> = {
  awaiting_user: { label: "Awaiting user", icon: AlertTriangle, text: WARN_TXT, bg: WARN_BG },
  user_responded: { label: "User responded", icon: CheckCircle, text: ACC_TXT, bg: ACC_BG },
  resolved: { label: "Resolved", icon: CheckCircle, text: GOOD_TXT, bg: GOOD_BG },
  expired: { label: "Expired", icon: XCircle, text: MUT, bg: "bg-stone-50 dark:bg-[#2A2A2A]" },
};

const SEV_META: Record<string, { text: string; bg: string }> = {
  low: { text: "text-stone-500", bg: "bg-stone-100 dark:bg-stone-800" },
  medium: { text: ACC_TXT, bg: ACC_BG },
  high: { text: WARN_TXT, bg: WARN_BG },
  blocking: { text: ERR_TXT, bg: ERR_BG },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EscalationCardV3({
  escalation,
  planExecId,
  onResolved,
  className = "",
}: EscalationCardV3Props) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_META[escalation.status] ?? STATUS_META.awaiting_user;
  const sev = SEV_META[escalation.severity] ?? SEV_META.medium;
  const StatusIcon = status.icon;

  const isResolved = escalation.status === "resolved" || escalation.status === "expired";
  const isAwaitingUser = escalation.status === "awaiting_user";

  return (
    <div className={`rounded-lg border ${BORD} overflow-hidden ${SURF} ${className}`}>
      {/* ── Header ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-left transition-colors`}
      >
        {/* Expand toggle */}
        {expanded ? (
          <ChevronDown size={12} className={`shrink-0 ${MUT}`} />
        ) : (
          <ChevronRight size={12} className={`shrink-0 ${MUT}`} />
        )}

        {/* Status icon */}
        <StatusIcon size={12} className={`shrink-0 ${status.text}`} />

        {/* Severity badge */}
        <span
          className={`text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 ${sev.text} ${sev.bg}`}
        >
          {escalation.severity}
        </span>

        {/* Title */}
        <span className="flex-1 truncate font-medium">
          {escalation.title || escalation.summary || escalation.workspaceId}
        </span>

        {/* Workspace ID */}
        <span className={`text-[10px] font-mono ${MUT} shrink-0 hidden sm:inline`}>
          {escalation.workspaceId.slice(0, 8)}
        </span>

        {/* Timestamp */}
        <span className={`text-[10px] ${MUT} shrink-0`}>
          {formatTime(escalation.createdAt)}
        </span>

        {/* Status badge */}
        <span
          className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${status.text} ${status.bg}`}
        >
          {status.label}
        </span>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-stone-100 dark:border-[#2A2A2A] pt-3">
          {/* Summary section */}
          <div className={`text-xs ${TXT} space-y-1`}>
            {escalation.summary && (
              <p className="font-medium">{escalation.summary}</p>
            )}
          </div>

          {/* What happened */}
          {escalation.whatHappened && (
            <div className={`p-2 rounded border ${BORD} space-y-0.5`}>
              <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>
                <Info size={10} />
                What Happened
              </div>
              <p className={`text-[11px] ${TXT}`}>{escalation.whatHappened}</p>
            </div>
          )}

          {/* Why stuck */}
          {escalation.whyStuck && (
            <div className={`p-2 rounded border ${BORD} space-y-0.5`}>
              <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>
                <AlertTriangle size={10} />
                Why Stuck
              </div>
              <p className={`text-[11px] ${TXT}`}>{escalation.whyStuck}</p>
            </div>
          )}

          {/* Impact */}
          <div className={`flex items-center gap-1.5 text-[10px] ${MUT}`}>
            <Hash size={10} />
            <span className="font-semibold uppercase tracking-wider">Impact</span>
            <span className={`${TXT}`}>
              Workspace {escalation.workspaceId.slice(0, 8)} — {escalation.severity} severity
            </span>
          </div>

          {/* Evidence section */}
          {(escalation.evidenceRefs?.length > 0 || escalation.logsToInspect?.length > 0) && (
            <div className={`p-2 rounded border ${BORD}`}>
              <EscalationEvidenceList
                evidenceRefs={escalation.evidenceRefs}
                logsToInspect={escalation.logsToInspect}
                planExecId={planExecId}
                workspaceId={escalation.workspaceId}
              />
            </div>
          )}

          {/* Lead Agent diagnosis (retry budget info) */}
          <div className={`p-2 rounded border ${ACC_BG} border-blue-200 dark:border-blue-800 space-y-0.5`}>
            <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${ACC_TXT}`}>
              <RotateCw size={10} />
              Lead Agent Diagnosis
            </div>
            <p className={`text-[11px] ${TXT}`}>
              {escalation.summary || "No diagnosis available"}
            </p>
          </div>

          {/* Recommended actions (only if awaiting user) */}
          {isAwaitingUser && escalation.options?.length > 0 && (
            <div className={`p-2 rounded border ${BORD}`}>
              <RecommendedActionsPanel
                escalationId={escalation.escalationId}
                planExecId={planExecId}
                workspaceId={escalation.workspaceId}
                options={escalation.options}
                recommendedOptionId={escalation.recommendedOptionId}
                onResolved={onResolved}
              />
            </div>
          )}

          {/* Human directive input (always available) */}
          {isAwaitingUser && (
            <div className={`p-2 rounded border ${BORD}`}>
              <HumanDirectiveInput
                planExecId={planExecId}
                workspaceId={escalation.workspaceId}
              />
            </div>
          )}

          {/* Resolved details */}
          {expanded && escalation.userChoice && (
            <div className={`flex items-center gap-1.5 text-[10px] ${GOOD_TXT}`}>
              <CheckCircle size={10} />
              Resolved: {escalation.userChoice}
              {escalation.userResponse && (
                <span className={`${MUT}`}>&mdash; &ldquo;{escalation.userResponse}&rdquo;</span>
              )}
            </div>
          )}

          {/* Timestamps */}
          <div className={`flex items-center gap-3 text-[10px] ${MUT}`}>
            <span className="flex items-center gap-1">
              <Clock size={10} />
              Created: {formatTime(escalation.createdAt)}
            </span>
            {escalation.resolvedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle size={10} />
                Resolved: {formatTime(escalation.resolvedAt)}
              </span>
            )}
          </div>

          {/* ID reference */}
          <div className={`flex items-center gap-1 text-[9px] ${MUT}`}>
            <Hash size={9} />
            <code className="font-mono">{escalation.escalationId.slice(0, 12)}...</code>
          </div>
        </div>
      )}
    </div>
  );
}
