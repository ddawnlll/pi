/**
 * WorkerInbox — Worker Handoff Inbox UI (25.O).
 *
 * Displays handoff entries from the brain workers inbox. Shows
 * entry status, priority, source, target, and diagnostics.
 *
 * Acceptance Criteria:
 * - AC1: Shows pending handoff entries sorted by priority
 * - AC2: Each entry shows source, target, status, priority, and age
 * - AC3: Triage router status monitoring
 * - AC4: Trigger triage cycle, pause/resume controls
 * - AC5: Loading, empty, error, and stale states are implemented
 *
 * Dependencies:
 *   - useWorkerInbox, useTriageStatus hooks
 *   - GET /api/brain/workers/inbox endpoint
 *
 * @packageDocumentation
 */

import { useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	AlertCircle,
	ArrowRight,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Clock,
	Loader2,
	PauseCircle,
	PlayCircle,
	RefreshCw,
	RotateCcw,
	XCircle,
} from "lucide-react";
import {
	useTriageCycle,
	useTriagePause,
	useTriageReset,
	useTriageResume,
	useTriageStatus,
	useWorkerInbox,
	useWorkerInboxStats,
} from "../../hooks/useBrainWorkerInbox";
import type { HandoffEntry, TriageRouterStatus } from "../../hooks/useBrainWorkerInbox";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
	const ts = new Date(iso).getTime();
	return new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatAge(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const sec = Math.floor(ms / 1000);
	const min = Math.floor(sec / 60);
	const hr = Math.floor(min / 60);
	if (hr > 0) return `${hr}h ago`;
	if (min > 0) return `${min}m ago`;
	return `${sec}s ago`;
}

// ---------------------------------------------------------------------------
// Priority config
// ---------------------------------------------------------------------------

const PRIORITY_CONFIG = {
	critical: {
		label: "Critical",
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-50 dark:bg-red-900/30",
		border: "border-red-200 dark:border-red-800",
	},
	high: {
		label: "High",
		color: "text-orange-600 dark:text-orange-400",
		bg: "bg-orange-50 dark:bg-orange-900/30",
		border: "border-orange-200 dark:border-orange-800",
	},
	normal: {
		label: "Normal",
		color: "text-blue-700 dark:text-blue-300",
		bg: "bg-blue-50 dark:bg-blue-900/30",
		border: "border-blue-200 dark:border-blue-800",
	},
	low: {
		label: "Low",
		color: "text-stone-400 dark:text-stone-500",
		bg: "bg-stone-50 dark:bg-stone-900/30",
		border: "border-stone-200 dark:border-stone-800",
	},
} as const;

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
	pending: {
		label: "Pending",
		icon: Clock,
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-50 dark:bg-amber-900/30",
	},
	routing: {
		label: "Routing",
		icon: ArrowRight,
		color: "text-blue-700 dark:text-blue-300",
		bg: "bg-blue-50 dark:bg-blue-900/30",
	},
	dispatched: {
		label: "Dispatched",
		icon: ArrowRight,
		color: "text-indigo-600 dark:text-indigo-400",
		bg: "bg-indigo-50 dark:bg-indigo-900/30",
	},
	completed: {
		label: "Completed",
		icon: CheckCircle,
		color: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-50 dark:bg-emerald-900/30",
	},
	failed: {
		label: "Failed",
		icon: XCircle,
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-50 dark:bg-red-900/30",
	},
	cancelled: {
		label: "Cancelled",
		icon: XCircle,
		color: "text-stone-400 dark:text-stone-500",
		bg: "bg-stone-50 dark:bg-stone-900/30",
	},
} as const;

// ---------------------------------------------------------------------------
// Triage Router Status Badge
// ---------------------------------------------------------------------------

const TRIAGE_STATUS_CONFIG: Record<TriageRouterStatus, { label: string; color: string; bg: string }> = {
	idle: {
		label: "Idle",
		color: "text-stone-400 dark:text-stone-500",
		bg: "bg-stone-100 dark:bg-stone-800",
	},
	processing: {
		label: "Processing",
		color: "text-blue-700 dark:text-blue-300",
		bg: "bg-blue-100 dark:bg-blue-900/30",
	},
	cooling: {
		label: "Cooling",
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-100 dark:bg-amber-900/30",
	},
	paused: {
		label: "Paused",
		color: "text-orange-600 dark:text-orange-400",
		bg: "bg-orange-100 dark:bg-orange-900/30",
	},
	failed: {
		label: "Failed",
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-100 dark:bg-red-900/30",
	},
};

// ===========================================================================
// Entry Card Component
// ===========================================================================

function EntryCard({ entry }: { entry: HandoffEntry }) {
	const [expanded, setExpanded] = useState(false);
	const StatusIcon = STATUS_CONFIG[entry.status]?.icon ?? Clock;
	const statusCfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.pending;
	const prioCfg = PRIORITY_CONFIG[entry.priority] ?? PRIORITY_CONFIG.normal;

	return (
		<div className={`${SURF} border ${BORD} rounded-lg overflow-hidden`}>
			{/* Header row */}
			<button
				type="button"
				className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				{/* Expand toggle */}
				{expanded ? <ChevronDown size={16} className={MUT} /> : <ChevronRight size={16} className={MUT} />}

				{/* Priority badge */}
				<span
					className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${prioCfg.bg} ${prioCfg.color} ${prioCfg.border} border`}
				>
					{prioCfg.label}
				</span>

				{/* Status badge */}
				<span
					className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${statusCfg.bg} ${statusCfg.color}`}
				>
					<StatusIcon size={12} />
					{statusCfg.label}
				</span>

				{/* Title */}
				<span className={`flex-1 font-medium text-sm truncate ${TXT}`}>{entry.title}</span>

				{/* Target role */}
				<span className={`text-xs ${MUT} hidden sm:inline`}>
					{entry.sourceWorkerRole} &rarr; {entry.targetWorkerRole}
				</span>

				{/* Age */}
				<span className={`text-xs ${MUT} whitespace-nowrap`}>{formatAge(entry.createdAt)}</span>
			</button>

			{/* Expanded detail */}
			{expanded && (
				<div className={`px-4 pb-3 pt-1 border-t ${BORD} space-y-2`}>
					{/* Description */}
					<p className={`text-sm ${MUT}`}>{entry.description}</p>

					{/* Source / Target */}
					<div className="grid grid-cols-2 gap-2 text-xs">
						<div>
							<span className={MUT}>Source: </span>
							<span className={TXT}>
								{entry.sourceWorkerId} ({entry.sourceWorkerRole})
							</span>
						</div>
						<div>
							<span className={MUT}>Target: </span>
							<span className={TXT}>
								{entry.targetWorkerId ?? "unassigned"} ({entry.targetWorkerRole})
							</span>
						</div>
						<div>
							<span className={MUT}>Created: </span>
							<span className={TXT}>{formatTimestamp(entry.createdAt)}</span>
						</div>
						<div>
							<span className={MUT}>Updated: </span>
							<span className={TXT}>{formatTimestamp(entry.updatedAt)}</span>
						</div>
					</div>

					{/* Tags */}
					{entry.tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{entry.tags.map((tag) => (
								<span
									key={tag}
									className={`px-1.5 py-0.5 rounded text-xs font-medium ${ACC_BG} ${ACC_TXT}`}
								>
									{tag}
								</span>
							))}
						</div>
					)}

					{/* Error */}
					{entry.error && (
						<div className={`flex items-start gap-2 p-2 rounded ${BG} border ${BORD}`}>
							<AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
							<p className={`text-xs text-red-600 dark:text-red-400`}>{entry.error}</p>
						</div>
					)}

					{/* Diagnostics */}
					{entry.diagnostics.length > 0 && (
						<div className="space-y-1">
							<span className={`text-xs uppercase tracking-wider ${MUT}`}>Diagnostics</span>
							{entry.diagnostics.map((d, i) => (
								<div
									key={i}
									className={`flex items-start gap-2 p-2 rounded text-xs ${BG} border ${BORD}`}
								>
									<span className={`font-mono text-xs ${MUT} shrink-0`}>{d.stopCondition}</span>
									<span className={TXT}>{d.message}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ===========================================================================
// Triage Router Control Panel
// ===========================================================================

function TriageControlPanel() {
	const { data: statusData, isLoading: statusLoading, isError: statusError } = useTriageStatus();
	const { data: statsData } = useWorkerInboxStats();
	const triageCycle = useTriageCycle();
	const triagePause = useTriagePause();
	const triageResume = useTriageResume();
	const triageReset = useTriageReset();

	const triageStats = statusData?.stats;
	const triageConfig = statusData?.config;
	const inboxStats = statsData?.stats;

	const isPaused = triageStats?.status === "paused";
	const isFailed = triageStats?.status === "failed";

	return (
		<div className={`${SURF} border ${BORD} rounded-lg p-4 space-y-3`}>
			{/* Title */}
			<div className="flex items-center justify-between">
				<h3 className={`text-sm font-semibold ${TXT}`}>Triage Router</h3>
				{triageStats?.status && (
					<span
						className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
							TRIAGE_STATUS_CONFIG[triageStats.status]?.bg ?? ""
						} ${TRIAGE_STATUS_CONFIG[triageStats.status]?.color ?? ""}`}
					>
						{TRIAGE_STATUS_CONFIG[triageStats.status]?.label ?? triageStats.status}
					</span>
				)}
			</div>

			{/* Status details */}
			{statusLoading && (
				<div className="flex items-center gap-2 text-sm ${MUT}">
					<Loader2 size={14} className="animate-spin" />
					<span>Loading triage status...</span>
				</div>
			)}

			{statusError && (
				<div className={`flex items-center gap-2 p-2 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400`}>
					<AlertCircle size={14} />
					<span>Failed to load triage status</span>
				</div>
			)}

			{triageStats && (
				<div className="grid grid-cols-3 gap-3 text-xs">
					<div>
						<span className={MUT}>Cycles</span>
						<p className={`font-semibold ${TXT}`}>{triageStats.totalCycles}</p>
					</div>
					<div>
						<span className={MUT}>Routed</span>
						<p className={`font-semibold text-emerald-600 dark:text-emerald-400`}>{triageStats.totalEntriesRouted}</p>
					</div>
					<div>
						<span className={MUT}>Failed</span>
						<p className={`font-semibold text-red-600 dark:text-red-400`}>{triageStats.totalEntriesFailed}</p>
					</div>
					<div>
						<span className={MUT}>Skipped</span>
						<p className={`font-semibold ${TXT}`}>{triageStats.totalEntriesSkipped}</p>
					</div>
					<div>
						<span className={MUT}>Consec. Failures</span>
						<p className={`font-semibold ${triageStats.consecutiveFailures > 0 ? "text-red-600 dark:text-red-400" : TXT}`}>
							{triageStats.consecutiveFailures}
						</p>
					</div>
					<div>
						<span className={MUT}>Uptime</span>
						<p className={`font-semibold ${TXT}`}>
							{triageStats.uptimeMs > 0 ? `${Math.floor(triageStats.uptimeMs / 1000)}s` : "N/A"}
						</p>
					</div>
				</div>
			)}

			{/* Inbox stats */}
			{inboxStats && (
				<div>
					<h4 className={`text-xs font-semibold mb-1 ${MUT}`}>Inbox</h4>
					<div className="grid grid-cols-4 gap-2 text-xs">
						<div>
							<span className={MUT}>Pending</span>
							<p className={`font-semibold text-amber-600 dark:text-amber-400`}>{inboxStats.pending}</p>
						</div>
						<div>
							<span className={MUT}>Routing</span>
							<p className={`font-semibold text-blue-700 dark:text-blue-300`}>{inboxStats.routing}</p>
						</div>
						<div>
							<span className={MUT}>Dispatched</span>
							<p className={`font-semibold text-indigo-600 dark:text-indigo-400`}>{inboxStats.dispatched}</p>
						</div>
						<div>
							<span className={MUT}>Failed</span>
							<p className={`font-semibold text-red-600 dark:text-red-400`}>{inboxStats.failed}</p>
						</div>
					</div>
				</div>
			)}

			{/* Action buttons */}
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					disabled={triageCycle.isPending || isPaused || isFailed}
					onClick={() => triageCycle.mutate()}
					className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
						${isPaused || isFailed ? "opacity-50 cursor-not-allowed" : ""}
						${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-blue-800/50`}
				>
					{triageCycle.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
					Run Cycle
				</button>

				{isPaused ? (
					<button
						type="button"
						disabled={triageResume.isPending}
						onClick={() => triageResume.mutate()}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
							bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-800/50`}
					>
						{triageResume.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
						Resume
					</button>
				) : (
					<button
						type="button"
						disabled={triagePause.isPending || isFailed}
						onClick={() => triagePause.mutate({ reason: "User paused" })}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
							${isFailed ? "opacity-50 cursor-not-allowed" : ""}
							bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/50`}
					>
						{triagePause.isPending ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />}
						Pause
					</button>
				)}

				<button
					type="button"
					disabled={triageReset.isPending}
					onClick={() => triageReset.mutate()}
					className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
						${MUT} hover:bg-black/5 dark:hover:bg-white/5 border ${BORD}`}
				>
					{triageReset.isPending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
					Reset
				</button>
			</div>
		</div>
	);
}

// ===========================================================================
// Main Component
// ===========================================================================

/**
 * WorkerInbox — Worker Handoff Inbox UI.
 *
 * Displays the current handoff entries in the brain workers inbox,
 * sorted by priority and creation time. Includes triage router
 * controls for processing, pausing, and resetting.
 */
export function WorkerInbox({ limit = 50 }: { limit?: number }) {
	const [statusFilter, setStatusFilter] = useState<string>("pending");
	const [showControls, setShowControls] = useState(false);

	const { data, isLoading, isError, error } = useWorkerInbox({
		status: statusFilter as HandoffEntry["status"] | undefined,
		limit,
	});

	const entries = data?.entries ?? [];
	const total = data?.total ?? 0;

	return (
		<div className={`${BG} min-h-full p-4 space-y-4`}>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className={`text-lg font-bold ${TXT}`}>Worker Handoff Inbox</h2>
					<p className={`text-sm ${MUT}`}>
						{total} {total === 1 ? "entry" : "entries"}
						{statusFilter !== "pending" && ` (filtered: ${statusFilter})`}
					</p>
				</div>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setShowControls(!showControls)}
						className={`inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors
							${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-blue-800/50`}
					>
						{showControls ? "Hide Controls" : "Triage Controls"}
					</button>
				</div>
			</div>

			{/* Triage controls */}
			{showControls && <TriageControlPanel />}

			{/* Status filter tabs */}
			<div className="flex flex-wrap gap-1">
				{(["pending", "routing", "dispatched", "completed", "failed", "cancelled"] as const).map((s) => (
					<button
						key={s}
						type="button"
						onClick={() => setStatusFilter(s)}
						className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors
							${
								statusFilter === s
									? `${ACC_BG} ${ACC_TXT}`
									: `${MUT} hover:bg-black/5 dark:hover:bg-white/5 border ${BORD}`
							}`}
					>
						{s.charAt(0).toUpperCase() + s.slice(1)}
					</button>
				))}
			</div>

			{/* Loading state */}
			{isLoading && (
				<div className={`flex items-center justify-center py-12`}>
					<div className="flex items-center gap-2 text-sm ${MUT}">
						<Loader2 size={18} className="animate-spin" />
						<span>Loading inbox...</span>
					</div>
				</div>
			)}

			{/* Error state */}
			{isError && (
				<div className={`flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800`}>
					<AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
					<div>
						<h3 className={`font-semibold text-sm text-red-700 dark:text-red-300`}>Failed to load inbox</h3>
						<p className={`text-xs text-red-600 dark:text-red-400 mt-1`}>
							{error instanceof Error ? error.message : "Unknown error"}
						</p>
					</div>
				</div>
			)}

			{/* Empty state */}
			{!isLoading && !isError && entries.length === 0 && (
				<div className={`flex flex-col items-center justify-center py-12 ${MUT}`}>
					<InboxIcon size={32} className="mb-2 opacity-50" />
					<p className="text-sm">No {statusFilter} handoff entries</p>
					<p className="text-xs mt-1">Handoffs between brain workers will appear here</p>
				</div>
			)}

			{/* Entries list */}
			{!isLoading && !isError && entries.length > 0 && (
				<div className="space-y-2">
					{entries.map((entry) => (
						<EntryCard key={entry.id} entry={entry} />
					))}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Inbox Icon (simple inline SVG)
// ---------------------------------------------------------------------------

function InboxIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
			<path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
		</svg>
	);
}
