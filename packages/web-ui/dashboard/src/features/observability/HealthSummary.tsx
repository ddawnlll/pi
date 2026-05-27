/**
 * HealthSummary — Health status summary panel for the Local Observability Cockpit (25.H).
 *
 * Displays the overall system health based on provided summary/stats data.
 * Supports loading, empty, error, and data-present states.
 *
 * Acceptance Criteria:
 * 1. Shows overall health status (Healthy/Degraded/Unhealthy/Unknown) based on error rate.
 * 2. Displays error count and error rate from provided stats.
 * 3. Shows event throughput from provided summary.
 * 4. Lists top error sources from stats.
 * 5. Supports loading, empty, error, and data states.
 */

import { useMemo } from "react";
import {
	Activity,
	AlertCircle,
	CheckCircle2,
	Clock,
	Loader2,
	XCircle,
} from "lucide-react";
import type { EventStatistics, TelemetryDashboardSummary } from "../../types-observability";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const ERR_TXT = "text-red-600 dark:text-red-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const GOOD_BG = "bg-emerald-50 dark:bg-emerald-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const GOOD_BORD = "border-emerald-200 dark:border-emerald-800";
const WARN_BORD = "border-amber-200 dark:border-amber-800";
const ERR_BORD = "border-red-200 dark:border-red-800";
const INFO_BG = "bg-blue-50 dark:bg-blue-900/20";
const INFO_TXT = "text-blue-600 dark:text-blue-400";

// ─── Health status type ───────────────────────────────────────────────────────

export type HealthStatus = "ok" | "degraded" | "error" | "unknown";

// ─── HealthBadge component ────────────────────────────────────────────────────

interface HealthBadgeProps {
	status: HealthStatus;
	reason?: string;
}

export function HealthBadge({ status, reason }: HealthBadgeProps) {
	const config: Record<HealthStatus, { bg: string; txt: string; bord: string; label: string; dot: string }> = {
		ok: { bg: GOOD_BG, txt: GOOD_TXT, bord: GOOD_BORD, label: "Healthy", dot: "bg-emerald-400" },
		degraded: { bg: WARN_BG, txt: WARN_TXT, bord: WARN_BORD, label: "Degraded", dot: "bg-amber-400" },
		error: { bg: ERR_BG, txt: ERR_TXT, bord: ERR_BORD, label: "Unhealthy", dot: "bg-red-500" },
		unknown: { bg: INFO_BG, txt: INFO_TXT, bord: "border-blue-200 dark:border-blue-800", label: "Unknown", dot: "bg-stone-400" },
	};

	const meta = config[status] ?? config.unknown;

	return (
		<div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold ${meta.bg} ${meta.txt} ${meta.bord} border`}>
			<span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
			{meta.label}
			{reason && <span className="text-[10px] opacity-75 ml-1">({reason})</span>}
		</div>
	);
}

// ─── HealthSummary component ──────────────────────────────────────────────────

interface HealthSummaryProps {
	className?: string;
	summary?: TelemetryDashboardSummary | null;
	stats?: EventStatistics | null;
	loading?: boolean;
	error?: string | null;
}

export function HealthSummary({ className = "", summary, stats, loading = false, error = null }: HealthSummaryProps) {
	// ── Compute health status ─────────────────────────────────────

	const healthStatus: HealthStatus = useMemo(() => {
		if (loading) return "unknown";
		if (error) return "error";
		if (!stats && !summary) return "unknown";
		const errorRate = stats?.errorRate;
		const errorCount = stats?.errorCount ?? 0;
		if (errorRate != null && errorRate >= 0.2) return "error";
		if (errorRate != null && errorRate >= 0.05) return "degraded";
		if (errorCount > 20) return "degraded";
		if (errorCount > 0) return "degraded";
		return "ok";
	}, [loading, error, stats, summary]);

	const healthy = healthStatus === "ok";
	const statusLabel = healthStatus === "ok" ? "Healthy"
		: healthStatus === "degraded" ? "Degraded"
		: healthStatus === "error" ? "Unhealthy"
		: "Unknown";

	return (
		<div className={`${SURF} rounded-lg border ${BORD} p-4 ${className}`}>
			{/* Title */}
			<div className="flex items-center justify-between mb-3">
				<h3 className={`text-sm font-semibold ${TXT}`}>System Health</h3>
				{loading ? (
					<div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold ${INFO_BG} ${INFO_TXT} border border-blue-200 dark:border-blue-800`}>
						<Loader2 size={11} className="animate-spin" />
						Checking...
					</div>
				) : error ? (
					<HealthBadge status="error" reason="Fetch failed" />
				) : stats || summary ? (
					<HealthBadge status={healthStatus} />
				) : (
					<HealthBadge status="unknown" />
				)}
			</div>

			{/* Loading state */}
			{loading && !stats && !summary && (
				<div className="flex flex-col items-center justify-center gap-2 py-4">
					<Loader2 size={20} className="animate-spin text-stone-400" />
					<p className={`text-sm ${MUT}`}>Loading health data...</p>
				</div>
			)}

			{/* Error state */}
			{error && !loading && (
				<div className={`flex flex-col items-center justify-center gap-2 py-4 ${ERR_TXT}`}>
					<AlertCircle size={20} />
					<p className="text-sm">{error}</p>
				</div>
			)}

			{/* Empty state */}
			{!loading && !error && !stats && !summary && (
				<div className="flex flex-col items-center justify-center gap-2 py-4">
					<Activity size={20} className="text-stone-300 dark:text-stone-600" />
					<p className={`text-sm ${MUT}`}>No health data available</p>
					<p className={`text-xs ${MUT} text-center max-w-sm`}>
						Telemetry events are collected during plan execution. Upload and run a plan to populate the observability dashboard and compute health status.
					</p>
				</div>
			)}

			{/* Data state */}
			{!loading && !error && (stats || summary) && (
				<div className="space-y-3">
					{/* Quick stats */}
					<div className="grid grid-cols-2 gap-2">
						<div className={`rounded-md p-2 border ${BORD}`}>
							<div className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>Total Events</div>
							<div className={`text-base font-semibold ${TXT}`}>
								{(summary?.totalEvents ?? stats?.totalCount ?? 0).toLocaleString()}
							</div>
						</div>
						<div className={`rounded-md p-2 border ${BORD}`}>
							<div className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>Errors</div>
							<div className={`text-base font-semibold ${(stats?.errorCount ?? 0) > 0 ? ERR_TXT : GOOD_TXT}`}>
								{stats?.errorCount?.toLocaleString() ?? "\u2014"}
								{stats?.errorRate != null && (
									<span className={`text-[11px] ${MUT} ml-1`}>({(stats.errorRate * 100).toFixed(1)}%)</span>
								)}
							</div>
						</div>
					</div>

					{/* Duration and throughput */}
					{healthy && stats && (
						<div className={`flex items-center gap-2 text-xs ${MUT}`}>
							<CheckCircle2 size={12} className={GOOD_TXT} />
							<span className={GOOD_TXT}>All systems operational</span>
						</div>
					)}

					{/* Top error sources */}
					{!healthy && stats && Object.keys(stats.bySource).length > 0 && (
						<div>
							<h4 className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>Top Sources</h4>
							<div className="space-y-0.5">
								{Object.entries(stats.bySource)
									.sort(([, a], [, b]) => (b as number) - (a as number))
									.slice(0, 5)
									.map(([source, count]) => (
										<div key={source} className="flex items-center justify-between text-xs">
											<span className={`${TXT} truncate flex-1 min-w-0`} title={source}>{source}</span>
											<span className={`font-mono ${MUT} ml-2`}>{count as number}</span>
										</div>
									))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
