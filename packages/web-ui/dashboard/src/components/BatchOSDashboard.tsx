/**
 * BatchOSDashboard — Batch Operating System dashboard view.
 *
 * Workspace P7.C — Batch OS dashboard.
 *
 * Acceptance Criteria:
 * 1. Dashboard distinguishes DAG parallelism from safe effective parallelism.
 * 2. Dashboard displays planner suggestions as advisory.
 * 3. Dashboard controls do not directly mutate execution state.
 *
 * This component provides an operating-system-style overview of batch
 * execution, showing:
 * - DAG parallelism (max independent branches in the dependency graph)
 *   vs safe effective parallelism (min of DAG width and worker cap)
 * - Queue metrics: critical path length, serialized tail, utilization
 * - Planner/optimizer suggestions displayed as advisory only
 * - Controls that issue commands through the API without directly
 *   mutating execution state
 */

import { useCallback, useState } from "react";
import {
  Cpu,
  Layers,
  GitBranch,
  ArrowRight,
  ArrowLeftRight,
  Timer,
  Clock,
  Activity,
  Play,
  Pause,
  Square,
  Lightbulb,
  AlertTriangle,
  Info,
  RefreshCw,
  BarChart3,
  ListOrdered,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { useQueueMetrics, useIntegrationQueueStatus, useScaleModeReadiness } from "../hooks/useScaleStatus";
import type { OptimizerSuggestion } from "../hooks/useScaleStatus";
import { BatchExplorer } from "./BatchExplorer";
import type { BatchPlanExplorerData } from "../hooks/useBatchPlan";
import type { WorkspaceSummary } from "../types";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Format milliseconds to a human-readable duration string. */
function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

/** Format a percentage value (0-1 scale). */
function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────

/** A single stat display card. */
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: "ok" | "warn" | "err" | "none";
}

function StatCard({ icon, label, value, sublabel, accent = "none" }: StatCardProps) {
  const accentColors: Record<string, string> = {
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    err: "text-red-600 dark:text-red-400",
    none: TXT,
  };
  const accentBg: Record<string, string> = {
    ok: "bg-emerald-50 dark:bg-emerald-900/15",
    warn: "bg-amber-50 dark:bg-amber-900/15",
    err: "bg-red-50 dark:bg-red-900/15",
    none: "bg-stone-50 dark:bg-stone-800/50",
  };

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${BORD} ${accentBg[accent]}`}>
      <span className={`mt-0.5 shrink-0 ${accentColors[accent]}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-lg font-bold tabular-nums leading-tight ${accentColors[accent]}`}>{value}</p>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} leading-tight mt-0.5`}>{label}</p>
        {sublabel && (
          <p className={`text-[9px] leading-tight mt-0.5 ${MUT}`}>{sublabel}</p>
        )}
      </div>
    </div>
  );
}

/** Parallelism comparison bar — visually shows DAG vs safe effective vs actual. */
interface ParallelismBarProps {
  dagWidth: number;
  safeRunnable: number;
  actualUtilization: number;
  workerCap: number;
}

function ParallelismBar({ dagWidth, safeRunnable, actualUtilization, workerCap }: ParallelismBarProps) {
  const maxScale = Math.max(dagWidth, workerCap, 1);

  return (
    <div className="space-y-2">
      {/* DAG parallelism */}
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-semibold w-28 shrink-0 text-right ${MUT}`}>DAG parallelism</span>
        <div className="flex-1 h-5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden relative">
          <div
            className="h-full bg-blue-400 dark:bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${(dagWidth / maxScale) * 100}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-stone-800 dark:text-stone-200 tabular-nums">
            {dagWidth}
          </span>
        </div>
      </div>

      {/* Safe effective parallelism */}
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-semibold w-28 shrink-0 text-right ${MUT}`}>Safe effective</span>
        <div className="flex-1 h-5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden relative">
          <div
            className="h-full bg-emerald-400 dark:bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${(safeRunnable / maxScale) * 100}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-stone-800 dark:text-stone-200 tabular-nums">
            {safeRunnable}
          </span>
        </div>
      </div>

      {/* Actual utilization */}
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-semibold w-28 shrink-0 text-right ${MUT}`}>Actual active</span>
        <div className="flex-1 h-5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden relative">
          <div
            className="h-full bg-amber-400 dark:bg-amber-500 rounded-full transition-all duration-500"
            style={{ width: `${(actualUtilization / maxScale) * 100}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-stone-800 dark:text-stone-200 tabular-nums">
            {actualUtilization}
          </span>
        </div>
      </div>

      {/* Worker cap */}
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-semibold w-28 shrink-0 text-right ${MUT}`}>Worker cap</span>
        <div className="flex-1 h-5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden relative">
          <div
            className="h-full bg-purple-300 dark:bg-purple-600 rounded-full transition-all duration-500"
            style={{ width: `${(workerCap / maxScale) * 100}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-stone-800 dark:text-stone-200 tabular-nums">
            {workerCap}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 pt-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 dark:bg-blue-500" />
          <span className={`text-[9px] ${MUT}`}>DAG parallelism</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 dark:bg-emerald-500" />
          <span className={`text-[9px] ${MUT}`}>Safe effective</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 dark:bg-amber-500" />
          <span className={`text-[9px] ${MUT}`}>Actual active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-purple-300 dark:bg-purple-600" />
          <span className={`text-[9px] ${MUT}`}>Worker cap</span>
        </div>
      </div>
    </div>
  );
}

/** Parallelism comparison table row. */
interface ComparisonRowProps {
  label: string;
  dagValue: number;
  safeValue: number;
  icon: React.ReactNode;
}

function ComparisonRow({ label, dagValue, safeValue, icon }: ComparisonRowProps) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${BORD} ${SURF}`}>
      <span className={`shrink-0 ${ACC_TXT}`}>{icon}</span>
      <span className={`text-xs font-medium ${TXT} flex-1`}>{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums font-semibold text-blue-600 dark:text-blue-400">{dagValue}</span>
        <ArrowRight size={12} className={`${MUT}`} />
        <span className="text-xs tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{safeValue}</span>
      </div>
    </div>
  );
}

/** Planner suggestion card — advisory only, no action buttons. */
interface SuggestionCardProps {
  suggestion: OptimizerSuggestion;
}

const SUGGESTION_CONFIG: Record<string, { icon: React.ReactNode; bg: string; border: string; text: string }> = {
  info: {
    icon: <Info size={14} />,
    bg: "bg-blue-50 dark:bg-blue-900/10",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
  },
  warning: {
    icon: <AlertTriangle size={14} />,
    bg: "bg-amber-50 dark:bg-amber-900/10",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
  },
  tip: {
    icon: <Lightbulb size={14} />,
    bg: "bg-emerald-50 dark:bg-emerald-900/10",
    border: "border-emerald-200 dark:border-emerald-800",
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

function getSuggestionConfig(type: string) {
  return SUGGESTION_CONFIG[type] ?? SUGGESTION_CONFIG.info;
}

function SuggestionCard({ suggestion }: SuggestionCardProps) {
  const cfg = getSuggestionConfig(suggestion.type);

  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border ${cfg.bg} ${cfg.border}`}>
      <span className={`mt-0.5 shrink-0 ${cfg.text}`}>{cfg.icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-semibold ${TXT}`}>{suggestion.title}</p>
        <p className={`text-[10px] leading-relaxed mt-0.5 ${MUT}`}>{suggestion.message}</p>
      </div>
    </div>
  );
}

// ─── Control buttons — never directly mutate state ──────────────────────────

interface ControlButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "danger" | "ghost";
}

function ControlButton({ icon, label, onClick, disabled, variant = "ghost" }: ControlButtonProps) {
  const variantStyles: Record<string, string> = {
    primary: `${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-blue-900/30`,
    danger: "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30",
    ghost: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`,
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variantStyles[variant]}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Status indicator — passive read-only state display. */
interface StatusBadgeProps {
  status: "idle" | "running" | "paused" | "complete" | "failed" | "stopped";
}

const STATUS_STYLES: Record<string, string> = {
  idle: "text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-800/50",
  running: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/15",
  paused: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15",
  complete: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/15",
  failed: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/15",
  stopped: "text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/50",
};

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[status] ?? STATUS_STYLES.idle}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "running" ? "bg-emerald-400 animate-pulse" : ""}`} />
      {status}
    </span>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

interface BatchOSDashboardProps {
  /** Current execution status. */
  planStatus?: string;
  /** Whether the plan is in progress and controls can be used. */
  hasActiveExecution?: boolean;
  /** Callback for sending control commands. */
  onControl?: (action: "pause" | "stop" | "cancel" | "resume") => void;
  /** Workspace summaries (for mapping stages to batch positions). */
  workspaces?: WorkspaceSummary[];
  /** Batch plan data (topological batches + dependency graph). */
  batchPlan?: BatchPlanExplorerData | null;
  /** Optional callback when a workspace card is clicked in the explorer. */
  onWorkspaceClick?: (id: string) => void;
  /** Optional class name. */
  className?: string;
}

/**
 * BatchOSDashboard component.
 *
 * Displays a batch operating system overview with:
 * - DAG parallelism vs safe effective parallelism comparison
 * - Queue metrics: critical path, serialized tail, timing
 * - Planner/optimizer suggestions (advisory only)
 * - Controls that issue commands through the API
 *
 * Controls call onControl() which goes through the API — they do not
 * directly mutate execution state.
 */
export function BatchOSDashboard({
  planStatus,
  hasActiveExecution = false,
  onControl,
  workspaces = [],
  batchPlan,
  onWorkspaceClick,
  className,
}: BatchOSDashboardProps) {
  const [showBatchExplorer, setShowBatchExplorer] = useState(false);
  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useQueueMetrics();
  const { data: queueData, isLoading: queueLoading } = useIntegrationQueueStatus();
  const { data: readiness, isLoading: readinessLoading } = useScaleModeReadiness();

  const isLoading = metricsLoading || queueLoading || readinessLoading;

  const queueStatus: "idle" | "running" | "paused" = queueData?.isProcessing
    ? "running"
    : queueData?.paused
      ? "paused"
      : "idle";

  const canResume = planStatus === "paused";
  const canPause = planStatus === "running";
  const canStop = planStatus === "running" || planStatus === "paused";

  // Derived: determine currently active and next batch from workspace stages
  const activeBatchIdx = batchPlan && workspaces.length > 0
    ? (() => {
        for (const batch of batchPlan.batches) {
          if (batch.workspaceIds.some(id => workspaces.find(w => w.id === id)?.stage === "active"))
            return batch.batchIndex;
        }
        return -1;
      })()
    : -1;
  const nextBatchIdx = activeBatchIdx > 0 && batchPlan
    ? (() => {
        const sorted = [...batchPlan.batches].sort((a, b) => a.batchIndex - b.batchIndex);
        const activePos = sorted.findIndex(b => b.batchIndex === activeBatchIdx);
        for (let i = activePos + 1; i < sorted.length; i++) {
          if (sorted[i].workspaceIds.some(id => workspaces.find(w => w.id === id)?.stage === "pending"))
            return sorted[i].batchIndex;
        }
        return -1;
      })()
    : -1;

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 gap-3 ${MUT} ${className ?? ""}`}>
        <RefreshCw size={20} className="animate-spin" />
        <span className="text-xs">Loading batch OS metrics...</span>
      </div>
    );
  }

  // ── Main dashboard ──
  return (
    <div className={`overflow-y-auto ${className ?? ""}`}>
      {/* ── Header strip ── */}
      <div className={`shrink-0 flex items-center gap-3 px-4 py-3 border-b ${BORD} ${SURF}`}>
        <Cpu size={18} className={ACC_TXT} />
        <h1 className={`text-sm font-bold ${TXT}`}>Batch Operating System</h1>
        <StatusBadge status={queueStatus} />

        {/* Current / next batch indicators */}
        {activeBatchIdx > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Batch {activeBatchIdx}
          </span>
        )}
        {nextBatchIdx > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-[9px] font-semibold text-blue-700 dark:text-blue-300">
            Next: Batch {nextBatchIdx}
          </span>
        )}

        <div className="flex-1" />

        {/* Batch Explorer toggle */}
        {batchPlan && batchPlan.batches.length > 0 && (
          <ControlButton
            icon={showBatchExplorer ? <EyeOff size={12} /> : <Eye size={12} />}
            label="Explore batches"
            onClick={() => setShowBatchExplorer((o) => !o)}
            variant={showBatchExplorer ? "primary" : "ghost"}
          />
        )}

        {/* Controls — never directly mutate state, only call onControl() */}
        <div className="flex items-center gap-1">
          <ControlButton
            icon={<Play size={12} />}
            label="Resume"
            onClick={() => onControl?.("resume")}
            disabled={!canResume}
            variant="primary"
          />
          <ControlButton
            icon={<Pause size={12} />}
            label="Pause"
            onClick={() => onControl?.("pause")}
            disabled={!canPause}
          />
          <ControlButton
            icon={<Square size={12} />}
            label="Stop"
            onClick={() => onControl?.("stop")}
            disabled={!canStop}
            variant="danger"
          />
        </div>
      </div>

      {/* ── Metrics grid ── */}
      <div className="p-3 space-y-4">
        {/* Row 1: Parallelism comparison */}
        <div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3`}>
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className={ACC_TXT} />
            <h2 className={`text-xs font-semibold uppercase tracking-wider ${TXT}`}>Parallelism Analysis</h2>
            <div className="flex-1" />
            <span className={`text-[9px] ${MUT}`}>
              DAG vs safe effective vs worker cap
            </span>
          </div>

          {/* AC1: Dashboard distinguishes DAG parallelism from safe effective parallelism */}
          {metrics ? (
            <>
              {/* Comparison table */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ComparisonRow
                  label="DAG parallelism"
                  dagValue={metrics.dagWidth}
                  safeValue={metrics.safeRunnableWorkers}
                  icon={<GitBranch size={14} />}
                />
                <ComparisonRow
                  label="Worker cap"
                  dagValue={metrics.workerCap}
                  safeValue={metrics.safeRunnableWorkers}
                  icon={<Cpu size={14} />}
                />
              </div>

              {/* Visual bar comparison */}
              <ParallelismBar
                dagWidth={metrics.dagWidth}
                safeRunnable={metrics.safeRunnableWorkers}
                actualUtilization={metrics.actualUtilization}
                workerCap={metrics.workerCap}
              />

              {/* Terminology explanation */}
              <div className={`flex items-start gap-2 px-2.5 py-2 rounded bg-stone-50 dark:bg-stone-800/50 border ${BORD}`}>
                <Info size={11} className={`mt-0.5 shrink-0 ${MUT}`} />
                <div className={`text-[9px] leading-relaxed ${MUT}`}>
                  <p>
                    <strong>DAG parallelism</strong> is the maximum number of parallel branches
                    in the dependency graph — the structural limit of the plan.
                    <strong> Safe effective parallelism</strong> is <code>min(DAG width, worker cap)</code> —
                    the number of workers that can safely run without exceeding either constraint.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className={`text-xs ${MUT} py-2`}>No parallelism data available.</p>
          )}
        </div>

        {/* Batch Explorer (collapsible section) */}
        {showBatchExplorer && (
          <div className={`${SURF} rounded-lg border ${BORD} p-3`}>
            <div className="flex items-center gap-2 mb-3">
              <Eye size={16} className={ACC_TXT} />
              <h2 className={`text-xs font-semibold uppercase tracking-wider ${TXT}`}>Batch Explorer</h2>
              <span className={`text-[9px] ${MUT} ml-1`}>animated</span>
            </div>
            <BatchExplorer
              batchPlan={batchPlan ?? null}
              workspaces={workspaces}
              onWorkspaceClick={onWorkspaceClick}
            />
          </div>
        )}

        {/* Row 2: Queue metrics */}
        {metrics && (
          <div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3`}>
            <div className="flex items-center gap-2">
              <ListOrdered size={16} className={ACC_TXT} />
              <h2 className={`text-xs font-semibold uppercase tracking-wider ${TXT}`}>Queue Metrics</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard
                icon={<Activity size={14} />}
                label="Critical path"
                value={`${metrics.criticalPath}`}
                sublabel="longest serial chain"
              />
              <StatCard
                icon={<Timer size={14} />}
                label="Serialized tail"
                value={`${metrics.serializedTail}`}
                sublabel="entries behind current"
              />
              <StatCard
                icon={<Clock size={14} />}
                label="Avg wait"
                value={formatDuration(metrics.queueTiming?.avgWaitTimeMs ?? null)}
                sublabel={metrics.queueTiming ? `from ${metrics.queueTiming.totalProcessed} processed entries` : undefined}
                accent={metrics.queueTiming?.avgWaitTimeMs != null && metrics.queueTiming.avgWaitTimeMs > 30000 ? "warn" : "none"}
              />
              <StatCard
                icon={<ArrowLeftRight size={14} />}
                label="Utilization"
                value={metrics.dagWidth > 0 ? formatPct(metrics.actualUtilization / metrics.dagWidth) : "—"}
                sublabel={`${metrics.actualUtilization} of ${metrics.dagWidth} DAG active`}
                accent={metrics.dagWidth > 0 && metrics.actualUtilization < metrics.dagWidth ? "warn" : "ok"}
              />
            </div>
          </div>
        )}

        {/* Row 3: Integration Queue status */}
        {queueData && (
          <div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3`}>
            <div className="flex items-center gap-2">
              <Layers size={16} className={ACC_TXT} />
              <h2 className={`text-xs font-semibold uppercase tracking-wider ${TXT}`}>Integration Queue</h2>
              <div className="flex-1" />
              <span className={`text-[9px] ${MUT}`}>{queueData.totalEntries} entries total</span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {Object.entries(queueData.counts).map(([key, count]) => (
                <StatCard
                  key={key}
                  icon={<span className={`w-2 h-2 rounded-full ${
                    key === "queued" ? "bg-stone-400" :
                    key === "merging" ? "bg-blue-400" :
                    key === "validating" ? "bg-amber-400" :
                    key === "merged" ? "bg-emerald-400" :
                    key === "failed" ? "bg-red-400" :
                    key === "blocked" ? "bg-amber-500" :
                    key === "conflict" ? "bg-red-500" : "bg-stone-300"
                  }`} />}
                  label={key.charAt(0).toUpperCase() + key.slice(1)}
                  value={count}
                  accent={
                    key === "failed" && count > 0 ? "err" :
                    key === "conflict" && count > 0 ? "err" :
                    key === "blocked" && count > 0 ? "warn" : "none"
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Row 4: Planner suggestions — AC2: displayed as advisory */}
        <div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3`}>
          <div className="flex items-center gap-2">
            <Lightbulb size={16} className={ACC_TXT} />
            <h2 className={`text-xs font-semibold uppercase tracking-wider ${TXT}`}>Planner Suggestions</h2>
            <span className={`text-[9px] ${MUT} ml-1`}>advisory</span>
            {metrics && metrics.optimizerSuggestions.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                <Lightbulb size={10} />
                {metrics.optimizerSuggestions.length}
              </span>
            )}
          </div>

          {/* Advisory disclaimer */}
          <div className={`flex items-start gap-1.5 px-2.5 py-1.5 rounded bg-stone-50 dark:bg-stone-800/50 border ${BORD}`}>
            <Info size={11} className={`mt-0.5 shrink-0 ${MUT}`} />
            <p className={`text-[9px] leading-tight ${MUT}`}>
              <strong>Advisory only.</strong> Planner suggestions are informational and derived from
              queue metrics analysis. They are never auto-applied. Configure worker settings
              in <strong>Scale &amp; Safety</strong> settings.
            </p>
          </div>

          {/* Suggestions — AC2: no action controls on suggestions */}
          {metrics && metrics.optimizerSuggestions.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {metrics.optimizerSuggestions.map((suggestion, idx) => (
                <SuggestionCard key={`suggestion-${idx}`} suggestion={suggestion} />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-4">
              <p className={`text-xs ${MUT}`}>No planner suggestions at this time.</p>
            </div>
          )}

          {/* Summary line */}
          {metrics?.queueTiming && metrics.queueTiming.totalProcessed > 0 && (
            <p className={`text-[9px] leading-tight ${MUT} border-t border-[#E8E6E1] dark:border-[#333] pt-2`}>
              Based on {metrics.queueTiming.totalProcessed} processed queue entr{metrics.queueTiming.totalProcessed !== 1 ? "ies" : "y"}.
              Metrics refresh every 15s.
            </p>
          )}
        </div>

        {/* AC3: Dashboard controls do not directly mutate execution state */}
        <div className={`${SURF} rounded-lg border ${BORD} p-3`}>
          <div className="flex items-center gap-2">
            <Info size={14} className={ACC_TXT} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>Operating Model</span>
          </div>
          <p className={`text-[10px] leading-tight mt-1.5 ${MUT}`}>
            This dashboard provides read-only visibility into batch execution. All control actions
            (pause, resume, stop) issue commands through the API and do not directly mutate execution
            state. Planner suggestions are advisory and derived from automated analysis of queue
            metrics, DAG structure, and observed throughput patterns. Use <strong>Scale &amp; Safety</strong>
            settings to configure worker concurrency limits.
          </p>
        </div>
      </div>
    </div>
  );
}
