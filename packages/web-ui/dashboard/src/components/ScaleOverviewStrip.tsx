/**
 * ScaleOverviewStrip — Dashboard top-level scale status overview.
 *
 * Workspace 6.5.A — Scale dashboard information architecture.
 *
 * AC1: Scale cockpit section exists
 * AC2: Worktree, integration queue, conflict, and readiness panels are visible together
 *
 * Shows compact aggregate metrics: worktree count, integration queue depth,
 * active conflicts, and scale readiness.
 */

import {
  GitBranch,
  Layers,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Cpu,
} from "lucide-react";
import { useWorktreeStatus, useIntegrationQueueStatus, useScaleModeReadiness } from "../hooks/useScaleStatus";

// ─── Style constants ──────────────────────────────────────────────────────────

const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-800 dark:text-stone-200";
const BORD = "border-[#E8E6E1] dark:border-[#333]";

// ─── Metric badge ───────────────────────────────────────────────────────────

interface MetricBadgeProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: "ok" | "warn" | "err" | "none";
}

function MetricBadge({ icon, label, value, accent = "none" }: MetricBadgeProps) {
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
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${accentBg[accent]} border ${BORD} min-w-0`}
    >
      <span className={`shrink-0 ${accentColors[accent]}`}>{icon}</span>
      <div className="min-w-0">
        <p className={`text-lg font-bold tabular-nums leading-tight ${accentColors[accent]}`}>
          {value}
        </p>
        <p className={`text-[9px] uppercase tracking-wider font-semibold ${MUT} leading-tight`}>
          {label}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

interface ScaleOverviewStripProps {
  /** Optional class name. */
  className?: string;
}

/**
 * ScaleOverviewStrip component.
 *
 * Displays aggregate scale status metrics in a compact horizontal strip.
 */
export function ScaleOverviewStrip({ className }: ScaleOverviewStripProps) {
  const { data: worktreeData, isLoading: wtLoading } = useWorktreeStatus();
  const { data: queueData, isLoading: qLoading } = useIntegrationQueueStatus();
  const { data: readiness, isLoading: rLoading } = useScaleModeReadiness();

  const isLoading = wtLoading || qLoading || rLoading;

  const worktreeCount = worktreeData?.total ?? 0;
  const queueTotal = queueData?.totalEntries ?? 0;
  const conflictCount = queueData?.mergeConflicts?.length ?? 0;
  const issueCount = queueData
    ? (queueData.counts.failed + queueData.counts.blocked + queueData.counts.conflict)
    : 0;

  const ready = readiness?.ready ?? false;
  const workerCount = readiness?.requestedWorkers ?? 3;
  const isScaleEnabled = readiness?.experimentalModeEnabled ?? false;

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-3 text-xs ${MUT} ${className ?? ""}`}>
        <RefreshCw size={12} className="animate-spin" />
        Loading scale status...
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 overflow-x-auto py-1.5 px-1 ${className ?? ""}`}>
      <MetricBadge
        icon={<Cpu size={16} />}
        label={isScaleEnabled ? "Workers (scale)" : "Workers"}
        value={workerCount}
        accent={ready ? "ok" : "warn"}
      />
      <MetricBadge
        icon={<GitBranch size={16} />}
        label="Worktrees"
        value={worktreeCount}
      />
      <MetricBadge
        icon={<Layers size={16} />}
        label="Queue"
        value={queueTotal}
        accent={issueCount > 0 ? "err" : "none"}
      />
      <MetricBadge
        icon={<AlertTriangle size={16} />}
        label="Issues"
        value={issueCount}
        accent={issueCount > 0 ? "warn" : "ok"}
      />
      <MetricBadge
        icon={
          conflictCount > 0
            ? <AlertTriangle size={16} />
            : <CheckCircle size={16} />
        }
        label="Conflicts"
        value={conflictCount}
        accent={conflictCount > 0 ? "err" : "ok"}
      />
      <MetricBadge
        icon={
          ready
            ? <CheckCircle size={16} />
            : <AlertTriangle size={16} />
        }
        label="Scale ready"
        value={ready ? "Ready" : "Blocked"}
        accent={ready ? "ok" : "err"}
      />
    </div>
  );
}
