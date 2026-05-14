/**
 * IntegrationQueuePanel — Dashboard component showing integration queue status.
 *
 * Workspace 6.5.E — Integration queue and merge conflict visibility.
 *
 * AC1: Queue shows blocked reason and validation status
 * AC2: Conflict entries open handoff panel
 * AC4: Conflict is distinct from ordinary failed workspace
 */

import { useState, useCallback } from "react";
import {
	AlertTriangle,
	CheckCircle,
	Clock,
	Layers,
	XCircle,
	RefreshCw,
	GitMerge,
	AlertOctagon,
	X,
	GitBranch,
	Cpu,
	Zap,
	Timer,
	BarChart3,
	TrendingUp,
	Pause,
	Play,
	RotateCcw,
	Trash2,
	ListOrdered,
	History,
} from "lucide-react";
import {
	useIntegrationQueueStatus,
	useQueueMetrics,
	useQueueControl,
	useAuditLog,
	type MergeConflictInfo,
	type QueueEntryInfo,
	type QueueMetrics,
	type AuditEntryInfo,
} from "../hooks/useScaleStatus";
import { MergeConflictPanel, type MergeConflictData, type ConflictedFile } from "./MergeConflictPanel";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Status icon map ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
	queued: {
		icon: <Clock size={14} />,
		label: "Queued",
		color: "text-stone-500 dark:text-stone-400",
	},
	merging: {
		icon: <GitMerge size={14} />,
		label: "Merging",
		color: "text-blue-600 dark:text-blue-400",
	},
	validating: {
		icon: <RefreshCw size={14} />,
		label: "Validating",
		color: "text-amber-600 dark:text-amber-400",
	},
	merged: {
		icon: <CheckCircle size={14} />,
		label: "Merged",
		color: "text-emerald-600 dark:text-emerald-400",
	},
	failed: {
		icon: <XCircle size={14} />,
		label: "Failed",
		color: "text-red-600 dark:text-red-400",
	},
	blocked: {
		icon: <AlertOctagon size={14} />,
		label: "Blocked",
		color: "text-red-600 dark:text-red-400",
	},
	conflict: {
		icon: <AlertTriangle size={14} />,
		label: "Conflict",
		color: "text-amber-600 dark:text-amber-400",
	},
};

const DEFAULT_STATUS = {
	icon: <Clock size={14} />,
	label: "Unknown",
	color: MUT,
};

function getStatusConfig(status: string) {
	return STATUS_CONFIG[status] ?? DEFAULT_STATUS;
}

// ─── Entry row component ───────────────────────────────────────────────────

interface QueueEntryRowProps {
	entry: QueueEntryInfo;
	onConflictClick?: (workspaceId: string) => void;
	onRetry?: (workspaceId: string) => void;
	onRequeue?: (workspaceId: string) => void;
	isPending?: boolean;
}

function QueueEntryRow({ entry, onConflictClick, onRetry, onRequeue, isPending }: QueueEntryRowProps) {
	const cfg = getStatusConfig(entry.status);
	const time = entry.processedAt
		? new Date(entry.processedAt).toLocaleTimeString()
		: new Date(entry.queuedAt).toLocaleTimeString();

	const isConflict = entry.status === "conflict";
	const isBlocked = entry.status === "blocked";
	const isFailed = entry.status === "failed";
	const isMerged = entry.status === "merged";
	const clickable = isConflict && !!onConflictClick;

	const canRetry = (isBlocked || isFailed || isConflict) && !!onRetry;
	const canRequeue = isMerged && !!onRequeue;

	return (
		<div
			className={`w-full text-left flex items-start gap-2.5 py-2 px-2 rounded
				bg-stone-50 dark:bg-stone-800/50 border border-[#E8E6E1] dark:border-[#333]
				${clickable ? "cursor-pointer" : "cursor-default"}
				${isConflict ? "border-l-2 border-l-amber-400 dark:border-l-amber-600" : ""}
			`}
		>
			<div className={`mt-0.5 shrink-0 ${cfg.color}`}>{cfg.icon}</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className={`text-xs font-medium ${TXT}`}>{entry.workspaceId}</span>
					<span className={`text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
					<span className={`text-[9px] ${MUT}`}>{time}</span>
				</div>
				{/* Commit hash */}
				<p className={`text-[10px] font-mono ${MUT}`}>
					{entry.commitHash.slice(0, 8)}
				</p>
				{/* Blocked reason */}
				{isBlocked && entry.error && (
					<p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
						Blocked: {entry.error}
					</p>
				)}
				{/* Error (non-blocked) */}
				{!isBlocked && entry.error && (
					<p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">
						{entry.error}
					</p>
				)}
				{/* Conflict files */}
				{entry.conflictFiles && entry.conflictFiles.length > 0 && (
					<div className="mt-1">
						<p className="text-[9px] font-medium text-amber-600 dark:text-amber-400">
							Conflicted files:
						</p>
						<ul className="text-[9px] font-mono text-amber-600 dark:text-amber-400 list-disc list-inside">
							{entry.conflictFiles.map((f) => (
								<li key={f}>{f}</li>
							))}
						</ul>
					</div>
				)}
				{/* Click hint for conflict entries */}
				{isConflict && clickable && !canRetry && (
					<p className="text-[9px] text-amber-500 dark:text-amber-500 mt-0.5 italic">
						Click to open handoff panel
					</p>
				)}
				{/* Validation status */}
				{entry.validationPassed !== null && (
					<p className={`text-[10px] mt-0.5 ${entry.validationPassed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
						Validation: {entry.validationPassed ? "PASSED" : "FAILED"}
					</p>
				)}
				{/* Action buttons */}
				{(canRetry || canRequeue) && (
					<div className="flex gap-1 mt-1.5">
						{canRetry && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onRetry!(entry.workspaceId);
								}}
								disabled={isPending}
								className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium
									bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300
									hover:bg-blue-100 dark:hover:bg-blue-900/30
									disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<RotateCcw size={8} />
								Retry
							</button>
						)}
						{canRequeue && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onRequeue!(entry.workspaceId);
								}}
								disabled={isPending}
								className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium
									bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300
									hover:bg-stone-200 dark:hover:bg-stone-700
									disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<RotateCcw size={8} />
								Requeue
							</button>
						)}
					</div>
				)}
			</div>
			{/* Clickable overlay for conflict entries */}
			{clickable && (
				<button
					onClick={() => onConflictClick!(entry.workspaceId)}
					className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium
						bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400
						hover:bg-amber-100 dark:hover:bg-amber-900/30"
				>
					View
				</button>
			)}
		</div>
	);
}

// ─── Summary stat component ────────────────────────────────────────────────

interface StatProps {
	label: string;
	value: number;
	color?: string;
}

function Stat({ label, value, color }: StatProps) {
	return (
		<div className="text-center">
			<p className={`text-base font-bold tabular-nums ${color ?? TXT}`}>{value}</p>
			<p className={`text-[9px] uppercase tracking-wider mt-0.5 ${MUT}`}>{label}</p>
		</div>
	);
}

// ─── Mini metric component (for DAG/timing display) ──────────────────────

interface MiniMetricProps {
	icon: React.ReactNode;
	label: string;
	value: string;
	sublabel?: string;
	accent?: "ok" | "warn" | "none";
}

function MiniMetric({ icon, label, value, sublabel, accent = "none" }: MiniMetricProps) {
	const accentColors: Record<string, string> = {
		ok: "text-emerald-600 dark:text-emerald-400",
		warn: "text-amber-600 dark:text-amber-400",
		none: TXT,
	};
	const accentBg: Record<string, string> = {
		ok: "bg-emerald-50 dark:bg-emerald-900/10",
		warn: "bg-amber-50 dark:bg-amber-900/10",
		none: "bg-stone-50 dark:bg-stone-800/30",
	};

	return (
		<div
			className={`flex items-center gap-1.5 px-2 py-1.5 rounded border border-[#E8E6E1] dark:border-[#333] ${accentBg[accent]}`}
		>
			<span className={`shrink-0 ${accentColors[accent]}`}>{icon}</span>
			<div className="min-w-0">
				<p className={`text-xs font-bold tabular-nums leading-tight ${accentColors[accent]}`}>{value}</p>
				<p className={`text-[9px] leading-tight ${MUT}`}>{label}</p>
				{sublabel && (
					<p className={`text-[8px] leading-tight ${MUT} opacity-70`}>{sublabel}</p>
				)}
			</div>
		</div>
	);
}

// ─── Duration formatting helper ───────────────────────────────────────────

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

// ─── Main component ─────────────────────────────────────────────────────────

interface IntegrationQueuePanelProps {
	/** Optional class name. */
	className?: string;
}

/**
 * IntegrationQueuePanel component.
 *
 * Displays the integration queue status including:
 * - Current processing state
 * - Per-entry status (queued, merging, validating, merged, failed, blocked, conflict)
 * - Blocked reason and validation status per entry
 * - Merge conflict handoff panel on click
 * - Summary counts
 */
export function IntegrationQueuePanel({ className }: IntegrationQueuePanelProps) {
	const { data, isLoading, error } = useIntegrationQueueStatus();
	const { data: metrics, isLoading: metricsLoading } = useQueueMetrics();
	const queueControl = useQueueControl();
	const { data: auditLog } = useAuditLog();

	const entries = data?.entries ?? [];
	const counts = data?.counts ?? {
		queued: 0,
		merging: 0,
		validating: 0,
		merged: 0,
		failed: 0,
		blocked: 0,
		conflict: 0,
	};
	const mergeConflicts = data?.mergeConflicts ?? [];

	const hasIssues = counts.failed > 0 || counts.blocked > 0 || counts.conflict > 0;
	const totalIssues = counts.failed + counts.blocked + counts.conflict;

	// ── Action feedback state ──────────────────────────────────────────────
	const [actionFeedback, setActionFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
	const [showAuditLog, setShowAuditLog] = useState(false);

	const handleAction = useCallback(
		async (
			action: () => Promise<{ success: boolean; error?: string; message?: string }>,
			label: string,
		) => {
			try {
				const result = await action();
				if (result.success) {
					setActionFeedback({ type: "success", message: result.message ?? `${label} completed` });
				} else {
					setActionFeedback({ type: "error", message: result.error ?? `${label} failed` });
				}
			} catch (err) {
				setActionFeedback({ type: "error", message: `${label}: ${String(err)}` });
			}
			setTimeout(() => setActionFeedback(null), 5000);
		},
		[],
	);

	// ── Handoff panel state ────────────────────────────────────────────────
	const [selectedConflict, setSelectedConflict] = useState<MergeConflictInfo | null>(null);

	const handleConflictClick = useCallback(
		(workspaceId: string) => {
			const conflict = mergeConflicts.find((c) => c.workspaceId === workspaceId);
			if (conflict) {
				setSelectedConflict(conflict);
			}
		},
		[mergeConflicts],
	);

	const convertToMergeConflictData = useCallback(
		(info: MergeConflictInfo, queueEntry: QueueEntryInfo): MergeConflictData => ({
			workspaceId: info.workspaceId,
			commitHash: queueEntry.commitHash,
			status: "unresolved",
			detectedAt: info.timestamp,
			conflictedFiles: info.conflictedFiles.map(
				(f): ConflictedFile => ({
					filePath: f,
					conflictType: "both modified",
					hasConflictMarkers: true,
				}),
			),
			conflictDiff: info.diff,
			gitStatusOutput: "",
			description: `Merge conflict detected in workspace "${info.workspaceId}" during integration.`,
			suggestedResolutionSteps: [
				"Open each conflicted file and resolve conflict markers",
				"Stage resolved files: git add <file>",
				"Complete the merge: git merge --continue",
			],
		}),
		[],
	);

	return (
		<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3 ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Layers size={16} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>Integration Queue</h3>
					{data?.isProcessing && (
						<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-[10px] font-medium text-blue-700 dark:text-blue-300">
							<RefreshCw size={10} className="animate-spin" />
							processing
						</span>
					)}
				</div>
				{hasIssues && (
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-[10px] font-medium text-red-600 dark:text-red-400">
						<AlertTriangle size={10} />
						{totalIssues} issue{totalIssues !== 1 ? "s" : ""}
					</span>
				)}
			</div>

			{/* Current workspace */}
			{data?.currentWorkspaceId && (
				<div className="flex items-center gap-2 text-xs">
					<span className={MUT}>Current:</span>
					<span className={`font-medium ${TXT}`}>{data.currentWorkspaceId}</span>
				</div>
			)}

			{/* Loading state */}
			{isLoading && (
				<div className="flex items-center justify-center py-6">
					<RefreshCw size={16} className={`animate-spin ${MUT}`} />
				</div>
			)}

			{/* Error state */}
			{error && (
				<div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/10 rounded px-2.5 py-2">
					<AlertTriangle size={14} className="text-red-500 shrink-0" />
					<p className="text-[11px] text-red-600 dark:text-red-400">
						Failed to load integration queue: {String(error)}
					</p>
				</div>
			)}

			{/* Empty state */}
			{!isLoading && !error && entries.length === 0 && (
				<p className={`text-xs py-4 text-center ${MUT}`}>No entries in the integration queue.</p>
			)}

			{/* Summary stats */}
			{entries.length > 0 && (
				<div className="grid grid-cols-7 gap-1 px-1">
					<Stat label="Queued" value={counts.queued} />
					<Stat label="Merge" value={counts.merging} color="text-blue-600 dark:text-blue-400" />
					<Stat label="Valid" value={counts.validating} color="text-amber-600 dark:text-amber-400" />
					<Stat label="Merged" value={counts.merged} color="text-emerald-600 dark:text-emerald-400" />
					<Stat label="Failed" value={counts.failed} color="text-red-600 dark:text-red-400" />
					<Stat label="Blocked" value={counts.blocked} color="text-red-600 dark:text-red-400" />
					<Stat label="Conflict" value={counts.conflict} color="text-amber-600 dark:text-amber-400" />
				</div>
			)}

			{/* ── DAG metrics section ── */}
			{!metricsLoading && metrics && (
				<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-2 space-y-2">
					<h4 className={`text-[10px] uppercase tracking-widest font-semibold ${MUT}`}>
						Queue Metrics
					</h4>
					<div className="grid grid-cols-4 gap-1.5">
						<MiniMetric
							icon={<GitBranch size={12} />}
							label="DAG Width"
							value={String(metrics.dagWidth)}
							sublabel="Parallel branches"
						/>
						<MiniMetric
							icon={<Cpu size={12} />}
							label="Worker Cap"
							value={String(metrics.workerCap)}
							sublabel="Max configured"
						/>
						<MiniMetric
							icon={<Zap size={12} />}
							label="Safe Runnable"
							value={String(metrics.safeRunnableWorkers)}
							sublabel="min(cap, DAG)"
							accent={metrics.actualUtilization < metrics.safeRunnableWorkers ? "warn" : "ok"}
						/>
						<MiniMetric
							icon={<Layers size={12} />}
							label="Utilization"
							value={`${metrics.actualUtilization}`}
							sublabel={`of ${metrics.safeRunnableWorkers} active`}
							accent={metrics.actualUtilization === 0 ? "none" : metrics.actualUtilization < metrics.safeRunnableWorkers ? "warn" : "ok"}
						/>
					</div>

					{/* Critical path + serialized tail */}
					<div className="grid grid-cols-2 gap-1.5">
						<MiniMetric
							icon={<TrendingUp size={12} />}
							label="Critical Path"
							value={String(metrics.criticalPath)}
							sublabel={metrics.criticalPath === 1 ? "1 step to drain" : `${metrics.criticalPath} steps to drain`}
							accent={metrics.criticalPath > 5 ? "warn" : "ok"}
						/>
						<MiniMetric
							icon={<BarChart3 size={12} />}
							label="Serialized Tail"
							value={String(metrics.serializedTail)}
							sublabel={metrics.serializedTail === 1 ? "1 entry waiting" : `${metrics.serializedTail} entries waiting`}
							accent={metrics.serializedTail > 3 ? "warn" : "ok"}
						/>
					</div>

					{/* Timing metrics */}
					{metrics.queueTiming && (
						<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-2 mt-1">
							<h4 className={`text-[10px] uppercase tracking-widest font-semibold ${MUT} mb-1.5`}>
								Queue Timing
							</h4>
							<div className="grid grid-cols-3 gap-1.5">
								<MiniMetric
									icon={<Timer size={12} />}
									label="Avg Wait"
									value={metrics.queueTiming.avgWaitTimeMs != null ? formatDuration(metrics.queueTiming.avgWaitTimeMs) : "—"}
									sublabel={`from ${metrics.queueTiming.sampleSize} samples`}
								/>
								<MiniMetric
									icon={<Timer size={12} />}
									label="Avg Process"
									value={metrics.queueTiming.avgProcessTimeMs != null ? formatDuration(metrics.queueTiming.avgProcessTimeMs) : "—"}
									sublabel="per entry"
								/>
								<MiniMetric
									icon={<CheckCircle size={12} />}
									label="Processed"
									value={String(metrics.queueTiming.totalProcessed)}
									sublabel="total entries"
								/>
							</div>
						</div>
					)}
				</div>
			)}

			{/* Entry list */}
			{entries.length > 0 && (
				<div className="space-y-1.5 max-h-64 overflow-y-auto">
					{entries.map((entry) => (
						<QueueEntryRow
							key={entry.workspaceId}
							entry={entry}
							onConflictClick={handleConflictClick}
							onRetry={(wid) => handleAction(() => queueControl.retry(wid), `Retry ${wid}`)}
							onRequeue={(wid) => handleAction(() => queueControl.requeue(wid), `Requeue ${wid}`)}
							isPending={queueControl.isPending}
						/>
					))}
				</div>
			)}

			{/* Merge conflicts section */}
			{mergeConflicts.length > 0 && (
				<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-2 space-y-2">
					<h4 className={`text-[10px] uppercase tracking-widest font-semibold ${MUT}`}>
						Merge Conflicts
					</h4>
					{mergeConflicts.map((conflict) => (
						<button
							key={conflict.workspaceId}
							onClick={() => handleConflictClick(conflict.workspaceId)}
							className="w-full text-left bg-amber-50 dark:bg-amber-900/10 rounded px-2.5 py-2 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors cursor-pointer"
						>
							<div className="flex items-center gap-1.5">
								<AlertTriangle size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
								<span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
									{conflict.workspaceId}
								</span>
							</div>
							{conflict.conflictedFiles.length > 0 && (
								<ul className="mt-1 text-[10px] font-mono text-amber-600 dark:text-amber-400 list-disc list-inside">
									{conflict.conflictedFiles.map((f) => (
										<li key={f}>{f}</li>
									))}
								</ul>
							)}
							{conflict.diff && (
								<pre className="mt-1 text-[9px] font-mono text-amber-600 dark:text-amber-400 whitespace-pre-wrap max-h-16 overflow-y-auto">
									{conflict.diff.slice(0, 500)}
								</pre>
							)}
							<p className="text-[9px] text-amber-500 dark:text-amber-500 mt-0.5 italic">
								Click to open handoff panel
							</p>
						</button>
					))}
				</div>
			)}

			{/* ── Action feedback ── */}
			{actionFeedback && (
				<div
					className={`px-2.5 py-1.5 rounded text-[10px] font-medium ${
						actionFeedback.type === "success"
							? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
							: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
					}`}
				>
					{actionFeedback.type === "success" ? <CheckCircle size={10} className="inline mr-1" /> : null}
					{actionFeedback.type === "error" ? <AlertTriangle size={10} className="inline mr-1" /> : null}
					{actionFeedback.message}
				</div>
			)}

			{/* ── Help text ── */}
			<p className={`text-[10px] leading-tight ${MUT}`}>
				The integration queue processes workspace changes serially.
				Conflicts and validation failures block further processing until resolved.
				<strong> Scale mode</strong> requires the integration queue to be enabled.
			</p>

			{/* ── Queue control actions (6.6.F) ── */}
			<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-2 space-y-2">
				<div className="flex items-center justify-between">
					<h4 className={`text-[10px] uppercase tracking-widest font-semibold ${MUT}`}>
						Queue Actions
					</h4>
					<button
						onClick={() => setShowAuditLog(!showAuditLog)}
						className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
					>
						<History size={10} />
						{showAuditLog ? "Hide log" : "Audit log"}
					</button>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{/* Pause / Resume */}
					{data?.paused ? (
						<button
							onClick={() => handleAction(() => queueControl.resume(), "Resume")}
							disabled={queueControl.isPending}
							className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors
								bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300
								hover:bg-emerald-100 dark:hover:bg-emerald-900/30
								disabled:opacity-50 disabled:cursor-not-allowed`}
						>
							<Play size={10} />
							Resume
						</button>
					) : (
						<button
							onClick={() => handleAction(() => queueControl.pause(), "Pause")}
							disabled={queueControl.isPending}
							className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors
								bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300
								hover:bg-amber-100 dark:hover:bg-amber-900/30
								disabled:opacity-50 disabled:cursor-not-allowed`}
						>
							<Pause size={10} />
							Pause
						</button>
					)}

					{/* Retry / Requeue buttons visible per entry in entry rows */}
					<button
						onClick={() => handleAction(() => queueControl.clearCompleted(), "Clear completed")}
						disabled={queueControl.isPending || entries.length === 0}
						className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors
							bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300
							hover:bg-stone-200 dark:hover:bg-stone-700
							disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						<Trash2 size={10} />
						Clear Completed
					</button>

					<button
						onClick={() => handleAction(() => queueControl.reorder(), "Reorder")}
						disabled={queueControl.isPending}
						className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors
							bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300
							hover:bg-stone-200 dark:hover:bg-stone-700
							disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						<ListOrdered size={10} />
						Reorder
					</button>
				</div>
			</div>

			{/* ── Audit log section ── */}
			{showAuditLog && (
				<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-2 space-y-1.5">
					<h4 className={`text-[10px] uppercase tracking-widest font-semibold ${MUT}`}>
						Audit Log {(auditLog?.total ?? 0) > 0 ? `(${auditLog!.total})` : ""}
					</h4>
					{(!auditLog || auditLog.entries.length === 0) && (
						<p className={`text-[10px] italic ${MUT}`}>No audit events recorded yet.</p>
					)}
					{auditLog && auditLog.entries.length > 0 && (
						<div className="max-h-32 overflow-y-auto space-y-1">
							{auditLog.entries.map((event, idx) => (
								<div
									key={idx}
									className="flex items-start gap-1.5 px-1.5 py-1 rounded bg-stone-50 dark:bg-stone-800/30"
								>
									<span className="shrink-0 text-[9px] font-mono text-stone-400 dark:text-stone-500 mt-0.5">
										{new Date(event.timestamp).toLocaleTimeString()}
									</span>
									<div className="min-w-0 flex-1">
										<span className={`text-[9px] font-medium ${
											event.action === "pause" || event.action === "resume"
												? "text-amber-600 dark:text-amber-400"
												: event.action === "retry" || event.action === "requeue"
													? "text-blue-600 dark:text-blue-400"
													: "text-stone-600 dark:text-stone-400"
										}`}>
											{event.action.replace("_", " ")}
											{event.workspaceId ? `: ${event.workspaceId}` : ""}
										</span>
										<p className={`text-[8px] ${MUT} leading-tight`}>{event.details}</p>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* ── Merge conflict handoff overlay ── */}
			{selectedConflict ? (() => {
				const queueEntry = entries.find(
					(e) => e.workspaceId === selectedConflict.workspaceId,
				);
				if (!queueEntry) return null;
				const conflictData = convertToMergeConflictData(
					selectedConflict,
					queueEntry,
				);
				return (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => setSelectedConflict(null)}
					>
						<div
							className="relative max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
							onClick={(e) => e.stopPropagation()}
						>
							<button
								onClick={() => setSelectedConflict(null)}
								className="absolute top-2 right-2 z-10 flex items-center justify-center h-6 w-6 rounded-full bg-white dark:bg-[#2A2A2A] border border-[#E8E6E1] dark:border-[#333] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#333] shadow-sm"
								aria-label="Close handoff panel"
							>
								<X size={12} />
							</button>
							<MergeConflictPanel
								conflict={conflictData}
								onResolved={() => setSelectedConflict(null)}
								onRetry={() => setSelectedConflict(null)}
								onAbort={() => setSelectedConflict(null)}
							/>
						</div>
					</div>
				);
			})() : null}
		</div>
	);
}
