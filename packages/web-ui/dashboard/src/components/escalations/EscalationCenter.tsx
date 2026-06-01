/**
 * EscalationCenter — Main escalation hub for P42.09.
 *
 * Aggregates all escalations for a plan execution and presents them
 * as actionable cards. Shows:
 * - Active escalations (awaiting_user)
 * - Resolved escalations
 * - Deadlock dependency visualization
 * - Summary statistics
 *
 * All mutations go through execution-service-backed web-server endpoints.
 *
 * Data sources:
 * - Escalations: GET /api/human/escalations/:planExecId/:workspaceId (per workspace)
 * - We aggregate across all workspaces for the plan view via the usePlanWorkspaces
 *   hook and iterate to find all escalations.
 *
 * For the plan-level view, we use the useEscalations hook per workspace
 * and collect them. A plan-level escalation aggregation endpoint is provided
 * via the existing worker-context and read-model routes.
 *
 * Acceptance Criteria:
 * - Shows all escalations for a plan execution
 * - Groups by status (active, resolved)
 * - Shows deadlock dependencies for blocked workspaces
 * - Each escalation card shows root cause, impact, evidence, and actions
 * - Human directive input works through execution-service
 * - Handles loading, empty, and error states
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Clock,
  Filter,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { EscalationCardV3 } from "./EscalationCardV3";
import { DeadlockDependencyPanel } from "./DeadlockDependencyPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { LeadEscalationView } from "@earendil-works/pi-execution-core";

export interface EscalationCenterProps {
  /** Plan execution ID */
  planExecId: string | null;
  /** Project ID */
  projectId?: string | null;
  /** Escalations from all workspaces in the plan */
  escalations?: LeadEscalationView[];
  /** Dependency graph nodes for deadlock detection */
  dependencyNodes?: Array<{
    id: string;
    title?: string;
    dependsOn: string[];
    batch: number;
    stage: string;
  }>;
  /** Blocked workspace IDs */
  blockedWorkspaceIds?: string[];
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: Error | null;
  /** Refetch function */
  onRefetch?: () => void;
  /** Called when an escalation is resolved */
  onEscalationResolved?: () => void;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EscalationCenter({
  planExecId,
  projectId: _projectId,
  escalations = [],
  dependencyNodes,
  blockedWorkspaceIds,
  isLoading = false,
  error = null,
  onRefetch,
  onEscalationResolved,
  className = "",
}: EscalationCenterProps) {
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "resolved">("all");
  const [showDeadlock, setShowDeadlock] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Filtered escalations ──
  const filteredEscalations = useMemo(() => {
    let result = escalations;

    // By status
    if (filterStatus === "active") {
      result = result.filter((e) => e.status === "awaiting_user" || e.status === "user_responded");
    } else if (filterStatus === "resolved") {
      result = result.filter((e) => e.status === "resolved" || e.status === "expired");
    }

    // By search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.workspaceId.toLowerCase().includes(q) ||
          (e.title && e.title.toLowerCase().includes(q)) ||
          (e.summary && e.summary.toLowerCase().includes(q)) ||
          (e.whatHappened && e.whatHappened.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [escalations, filterStatus, searchQuery]);

  // ── Counts ──
  const activeCount = escalations.filter(
    (e) => e.status === "awaiting_user" || e.status === "user_responded",
  ).length;
  const resolvedCount = escalations.filter(
    (e) => e.status === "resolved" || e.status === "expired",
  ).length;

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${className}`}>
        <div className={`flex items-center justify-center gap-3 ${MUT} py-16`}>
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading escalations...</span>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${className}`}>
        <div className={`flex flex-col items-center justify-center gap-3 ${ERR_TXT} py-16`}>
          <ShieldAlert size={24} />
          <span className="text-sm font-medium">Failed to load escalations</span>
          <span className={`text-xs ${MUT}`}>{error.message}</span>
          {onRefetch && (
            <button
              onClick={onRefetch}
              className={`inline-flex items-center gap-1 text-xs ${ACC_TXT} hover:underline`}
            >
              <RefreshCw size={12} />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (!escalations || escalations.length === 0) {
    return (
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${className}`}>
        {/* Toolbar */}
        <div
          className={`shrink-0 flex items-center justify-between px-3 py-2 border-b ${BORD} ${SURF}`}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={13} className={GOOD_TXT} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
              Escalation Center
            </span>
          </div>
          {onRefetch && (
            <button
              onClick={onRefetch}
              className={`text-[10px] p-1 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>

        <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${MUT}`}>
          <CheckCircle size={28} className={GOOD_TXT} />
          <p className="text-sm font-medium">No escalations</p>
          <p className={`text-xs ${MUT} max-w-sm text-center`}>
            All workspaces are proceeding without escalation. Escalations appear here when a workspace is blocked and needs your attention.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${className}`}>
      {/* ── Toolbar ── */}
      <div
        className={`shrink-0 flex flex-col gap-2 px-3 py-2 border-b ${BORD} ${SURF}`}
      >
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeCount > 0 ? (
              <AlertTriangle size={13} className={WARN_TXT} />
            ) : (
              <CheckCircle size={13} className={GOOD_TXT} />
            )}
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
              Escalation Center
            </span>
            {activeCount > 0 && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${WARN_BG} ${WARN_TXT}`}
              >
                {activeCount} active
              </span>
            )}
            {resolvedCount > 0 && (
              <span className={`text-[10px] ${MUT}`}>
                {resolvedCount} resolved
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onRefetch && (
              <button
                onClick={onRefetch}
                className={`text-[10px] p-1 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
                title="Refresh"
              >
                <RefreshCw size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Filter + search row */}
        <div className="flex items-center gap-2">
          {/* Status filter */}
          <div className="flex gap-0.5">
            {(["all", "active", "resolved"] as const).map((f) => {
              const counts: Record<string, number> = {
                all: escalations.length,
                active: activeCount,
                resolved: resolvedCount,
              };
              return (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className={`text-[9px] font-medium px-2 py-1 rounded transition-colors ${
                    filterStatus === f
                      ? `${ACC_BG} ${ACC_TXT}`
                      : `${MUT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  <span className="ml-1 opacity-60">({counts[f]})</span>
                </button>
              );
            })}
          </div>

          {/* Deadlock toggle */}
          <button
            onClick={() => setShowDeadlock(!showDeadlock)}
            className={`flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded transition-colors ${
              showDeadlock
                ? `${WARN_BG} ${WARN_TXT}`
                : `${MUT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
            }`}
          >
            <GitBranch size={10} />
            Deadlock
          </button>

          {/* Search */}
          <div className="ml-auto relative">
            <Search size={11} className={`absolute left-1.5 top-1/2 -translate-y-1/2 ${MUT}`} />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-32 text-[10px] pl-5 pr-2 py-1 rounded border ${BORD} bg-transparent ${TXT} placeholder:text-stone-400`}
            />
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 space-y-3">
          {/* Deadlock panel */}
          {showDeadlock && dependencyNodes && dependencyNodes.length > 0 && (
            <div className={`p-2 rounded border ${BORD}`}>
              <DeadlockDependencyPanel
                nodes={dependencyNodes}
                blockedWorkspaceIds={blockedWorkspaceIds}
              />
            </div>
          )}

          {/* Escalation cards */}
          {filteredEscalations.length > 0 ? (
            <div className="space-y-2">
              {filteredEscalations.map((esc) => (
                <EscalationCardV3
                  key={esc.escalationId}
                  escalation={esc}
                  planExecId={planExecId ?? ""}
                  onResolved={onEscalationResolved}
                />
              ))}
            </div>
          ) : (
            <div className={`flex flex-col items-center justify-center gap-2 ${MUT} py-8`}>
              <Filter size={16} />
              <p className="text-xs">No escalations match the current filter</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
