/**
 * OrchestratorHealthPanel — Displays orchestrator daemon health, scan schedules,
 * budgets, rate limits, and control actions (P11.N).
 *
 * P11.N AC1: Renders orchestrator health and scan schedules from backend data.
 * P11.N AC2: Actions are disabled or marked pending when policy requires approval.
 * P11.N AC4: Loading, error, and stale states are implemented.
 */

import { useCallback, useState } from "react";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Cpu,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	Shield,
	Terminal,
	XCircle,
} from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge";
import type {
	OrchestratorBudget,
	OrchestratorHealth,
	OrchestratorHealthLevel,
	OrchestratorScan,
	OrchestratorStatus,
} from "../../types";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.floor((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

function formatTimestamp(ts: number | null): string {
	if (ts === null) return "—";
	const d = new Date(ts);
	const now = Date.now();
	const diff = now - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function healthIcon(level: OrchestratorHealthLevel) {
	switch (level) {
		case "healthy":
			return { Icon: CheckCircle2, color: "text-emerald-500" };
		case "degraded":
			return { Icon: AlertTriangle, color: "text-amber-500" };
		case "unhealthy":
			return { Icon: XCircle, color: "text-red-500" };
		default:
			return { Icon: AlertCircle, color: "text-stone-400" };
	}
}

function statusColor(status: OrchestratorStatus): string {
	switch (status) {
		case "running":
			return "text-emerald-600 dark:text-emerald-400";
		case "paused":
			return "text-amber-600 dark:text-amber-400";
		case "stopped":
			return "text-red-600 dark:text-red-400";
		case "error":
			return "text-red-600 dark:text-red-400";
		case "starting":
			return "text-blue-600 dark:text-blue-400";
		default:
			return "text-stone-400";
	}
}

function scanKindIcon(kind: string) {
	switch (kind) {
		case "repo_scan":
			return Activity;
		case "run_history":
			return Clock;
		case "queue_scan":
			return Terminal;
		case "dashboard_metrics":
			return Activity;
		case "proposal_refresh":
			return RefreshCw;
		default:
			return Activity;
	}
}

// ---------------------------------------------------------------------------
// Budget bar component
// ---------------------------------------------------------------------------

function BudgetBar({
	consumed,
	limit,
	label,
}: {
	consumed: number;
	limit: number;
	label: string;
}) {
	const pct = limit > 0 ? Math.min((consumed / limit) * 100, 100) : 0;
	const barColor =
		pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex items-center justify-between text-[10px]">
				<span className={MUT}>{label}</span>
				<span className={`font-mono tabular-nums ${TXT}`}>
					{consumed.toLocaleString()} / {limit.toLocaleString()}
				</span>
			</div>
			<div className="h-1.5 bg-stone-100 dark:bg-[#333] rounded-full overflow-hidden">
				<div
					className={`h-full rounded-full transition-all duration-500 ${barColor}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Scan row component
// ---------------------------------------------------------------------------

function ScanRow({ scan }: { scan: OrchestratorScan }) {
	const Icon = scanKindIcon(scan.kind);
	const isBackingOff =
		scan.backoffUntil !== null && scan.backoffUntil > Date.now();

	return (
		<div
			className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
				scan.skipped || isBackingOff
					? "bg-amber-50/50 dark:bg-amber-950/10"
					: BG
			}`}
		>
			{/* Icon */}
			<div
				className={`flex items-center justify-center w-7 h-7 rounded-lg ${
					scan.skipped
						? "bg-amber-100 dark:bg-amber-900/30"
						: isBackingOff
							? "bg-red-100 dark:bg-red-900/30"
							: "bg-stone-100 dark:bg-[#2A2A2A]"
				}`}
			>
				<Icon
					size={13}
					strokeWidth={1.8}
					className={
						scan.skipped
							? "text-amber-500"
							: isBackingOff
								? "text-red-500"
								: MUT
					}
				/>
			</div>

			{/* Details */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className={`text-xs font-medium ${TXT}`}>{scan.label}</span>
					{scan.skipped && (
						<span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
							Skipped
						</span>
					)}
					{isBackingOff && (
						<span className="text-[9px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full border border-red-200 dark:border-red-800">
							Backoff
						</span>
					)}
				</div>
				<div className={`flex items-center gap-3 mt-0.5 text-[10px] ${MUT}`}>
					<span>Last: {formatTimestamp(scan.lastScanAt)}</span>
					<span>Next: {formatTimestamp(scan.nextScanAt)}</span>
					{scan.lastDurationMs !== null && (
						<span>
							Duration: {formatDuration(scan.lastDurationMs)}
						</span>
					)}
				</div>
				{scan.skippedReason && (
					<p className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5">
						{scan.skippedReason}
					</p>
				)}
				{scan.failureCount > 0 && (
					<p className="text-[9px] text-red-500 mt-0.5">
						{scan.failureCount} failure{scan.failureCount !== 1 ? "s" : ""}
					</p>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface OrchestratorHealthPanelProps {
	/** Orchestrator health data, or null/undefined if loading. */
	health: OrchestratorHealth | null | undefined;
	/** Whether data is currently being fetched. */
	isLoading: boolean;
	/** Error from fetch, if any. */
	error: Error | null;
	/** Timestamp when data was fetched (for stale detection). */
	fetchedAt?: number | null;
	/** Callback to refetch data. */
	onRefresh?: () => void;
	/** Callback for pause action. Returns a promise that resolves to the action response. */
	onPause?: (reason?: string) => Promise<unknown>;
	/** Callback for resume action. */
	onResume?: (reason?: string) => Promise<unknown>;
	/** Callback for requesting a scan. */
	onRequestScan?: (scanKind?: string) => Promise<unknown>;
	/** Whether an action is currently pending. */
	isActionPending?: boolean;
	className?: string;
}

/**
 * OrchestratorHealthPanel — Shows orchestrator daemon status, scan schedules,
 * budgets, and control actions.
 *
 * Acceptance criteria:
 * - AC1: Renders orchestrator health and scan schedules from backend data.
 * - AC2: Actions are disabled or marked pending when policy requires approval.
 * - AC4: Loading, error, and stale states are implemented.
 */
export function OrchestratorHealthPanel({
	health,
	isLoading,
	error,
	fetchedAt,
	onRefresh,
	onPause,
	onResume,
	onRequestScan,
	isActionPending = false,
	className = "",
}: OrchestratorHealthPanelProps) {
	const [actionReason, setActionReason] = useState("");
	const [showConfirmPause, setShowConfirmPause] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const actionPending = isActionPending;

	// Stale detection: data older than 60 seconds is stale
	const isStale =
		fetchedAt != null && Date.now() - fetchedAt > 60_000;

	const handlePause = useCallback(async () => {
		if (!onPause) return;
		setActionError(null);
		try {
			const result = (await onPause(
				actionReason || undefined,
			)) as { success?: boolean; error?: string };
			if (result && !result.success) {
				setActionError(result.error ?? "Pause action failed");
			} else {
				setShowConfirmPause(false);
				setActionReason("");
			}
		} catch (err) {
			setActionError(String(err));
		}
	}, [onPause, actionReason]);

	const handleResume = useCallback(async () => {
		if (!onResume) return;
		setActionError(null);
		try {
			const result = (await onResume(
				actionReason || undefined,
			)) as { success?: boolean; error?: string };
			if (result && !result.success) {
				setActionError(result.error ?? "Resume action failed");
			}
		} catch (err) {
			setActionError(String(err));
		}
	}, [onResume, actionReason]);

	const handleRequestScan = useCallback(
		async (scanKind?: string) => {
			if (!onRequestScan) return;
			setActionError(null);
			try {
				const result = (await onRequestScan(scanKind)) as {
					success?: boolean;
					error?: string;
				};
				if (result && !result.success) {
					setActionError(result.error ?? "Request scan failed");
				}
			} catch (err) {
				setActionError(String(err));
			}
		},
		[onRequestScan],
	);

	// Loading state
	if (isLoading && !health) {
		return (
			<div
				className={`flex items-center justify-center h-full ${BG} ${className}`}
			>
				<div className={`flex items-center gap-2.5 ${MUT} text-sm`}>
					<Loader2 size={16} className="animate-spin" />{" "}
					Loading orchestrator health...
				</div>
			</div>
		);
	}

	// Error state
	if (error && !health) {
		return (
			<div
				className={`flex items-center justify-center h-full ${BG} ${className}`}
			>
				<div className="flex flex-col items-center gap-3 text-sm text-red-600 dark:text-red-400">
					<AlertCircle size={24} strokeWidth={1.5} />
					<p>Failed to load orchestrator health</p>
					<p className={`text-xs ${MUT}`}>{String(error)}</p>
					{onRefresh && (
						<button
							onClick={onRefresh}
							className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
						>
							<RefreshCw size={12} /> Retry
						</button>
					)}
				</div>
			</div>
		);
	}

	if (!health) {
		return (
			<div
				className={`flex items-center justify-center h-full ${BG} ${className}`}
			>
				<div className="flex flex-col items-center gap-3 text-sm text-stone-400 dark:text-stone-500">
					<Cpu size={24} strokeWidth={1.5} />
					<p>No orchestrator health data</p>
					<p className="text-xs">
						The orchestrator daemon may not be running.
					</p>
					{onRefresh && (
						<button
							onClick={onRefresh}
							className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
						>
							<RefreshCw size={12} /> Retry
						</button>
					)}
				</div>
			</div>
		);
	}

	const healthMeta = healthIcon(health.health);
	const paused = health.paused;

	return (
		<div
			className={`flex flex-col h-full overflow-y-auto ${BG} ${className}`}
		>
			{/* Header with health + status */}
			<div
				className={`shrink-0 ${SURF} border-b ${BORD} px-4 py-3 space-y-3`}
			>
				{/* Health summary row */}
				<div className="flex items-center gap-3">
					<div
						className={`flex items-center justify-center w-10 h-10 rounded-xl ${
							health.health === "healthy"
								? "bg-emerald-50 dark:bg-emerald-900/20"
								: health.health === "degraded"
									? "bg-amber-50 dark:bg-amber-900/20"
									: "bg-red-50 dark:bg-red-900/20"
						}`}
					>
						<healthMeta.Icon
							size={20}
							strokeWidth={1.8}
							className={healthMeta.color}
						/>
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<h3 className={`text-sm font-semibold ${TXT}`}>
								Orchestrator
							</h3>
							<StatusBadge status={health.status} />
						</div>
						<div className={`flex items-center gap-3 mt-0.5 text-[10px] ${MUT}`}>
							<span>
								Health:{" "}
								<span
									className={`font-medium ${
										health.health === "healthy"
											? "text-emerald-600"
											: health.health === "degraded"
												? "text-amber-600"
												: "text-red-600"
									}`}
								>
									{health.health}
								</span>
							</span>
							<span>
								Uptime:{" "}
								<span className={`font-medium ${TXT}`}>
									{formatDuration(health.uptimeMs)}
								</span>
							</span>
							<span>
								Heartbeat:{" "}
								<span className={`font-medium ${TXT}`}>
									{formatTimestamp(health.lastHeartbeatAt)}
								</span>
							</span>
						</div>
					</div>

					{/* Stale badge */}
					{isStale && (
						<span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full border border-amber-200 dark:border-amber-800 shrink-0">
							Stale data
						</span>
					)}

					{/* Refresh button */}
					{onRefresh && (
						<button
							onClick={onRefresh}
							className={`flex items-center justify-center h-8 w-8 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] shrink-0`}
							title="Refresh"
						>
							<RefreshCw size={13} strokeWidth={1.8} />
						</button>
					)}
				</div>

				{/* Action buttons */}
				<div className="flex items-center gap-2">
					{/* Pause / Resume */}
					{paused ? (
						<button
							onClick={() => {
								setShowConfirmPause(true);
								handleResume();
							}}
							disabled={actionPending}
							className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors
								text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 
								border border-emerald-200 dark:border-emerald-800
								hover:bg-emerald-100 dark:hover:bg-emerald-900/50
								disabled:opacity-50 disabled:cursor-not-allowed`}
						>
							{actionPending ? (
								<Loader2 size={12} className="animate-spin" />
							) : (
								<Play size={12} />
							)}
							Resume
						</button>
					) : (
						<button
							onClick={() => setShowConfirmPause(true)}
							disabled={actionPending}
							className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors
								text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 
								border border-amber-200 dark:border-amber-800
								hover:bg-amber-100 dark:hover:bg-amber-900/50
								disabled:opacity-50 disabled:cursor-not-allowed`}
						>
							{actionPending ? (
								<Loader2 size={12} className="animate-spin" />
							) : (
								<Pause size={12} />
							)}
							Pause
						</button>
					)}

					{/* Request scan */}
					<button
						onClick={() => handleRequestScan(undefined)}
						disabled={actionPending}
						className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors
							text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 
							border border-blue-200 dark:border-blue-800
							hover:bg-blue-100 dark:hover:bg-blue-900/50
							disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						{actionPending ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							<RefreshCw size={12} />
						)}
						Request scan
					</button>

					{/* Scan kind shortcut buttons */}
					{health.scans.slice(0, 3).map((scan) => (
						<button
							key={scan.kind}
							onClick={() => handleRequestScan(scan.kind)}
							disabled={actionPending}
							className={`flex items-center gap-1 h-7 px-2 rounded text-[10px] font-medium transition-colors
								${MUT} hover:text-stone-700 dark:hover:text-stone-300 
								hover:bg-stone-100 dark:hover:bg-[#2A2A2A]
								border ${BORD}
								disabled:opacity-50 disabled:cursor-not-allowed`}
						>
							{scan.label.split(" ")[0]}
						</button>
					))}
				</div>

				{/* Action error */}
				{actionError && (
					<div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded border border-red-200 dark:border-red-900">
						<AlertCircle size={10} />
						{actionError}
					</div>
				)}

				{/* Pause confirmation */}
				{showConfirmPause && !paused && (
					<div
						className={`border ${BORD} rounded-lg p-3 space-y-2 ${BG}`}
					>
						<p className={`text-xs font-medium ${TXT}`}>
							Pause orchestrator?
						</p>
						<input
							type="text"
							value={actionReason}
							onChange={(e) => setActionReason(e.target.value)}
							placeholder="Reason for pausing (optional)"
							className={`w-full h-8 px-2.5 text-xs rounded-lg border ${BORD} ${SURF} ${TXT} placeholder:text-stone-400 outline-none focus:border-blue-400`}
						/>
						<div className="flex items-center gap-2">
							<button
								onClick={handlePause}
								disabled={actionPending}
								className={`flex items-center gap-1 h-7 px-3 rounded text-[10px] font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50`}
							>
								{actionPending ? (
									<Loader2 size={10} className="animate-spin" />
								) : (
									<Pause size={10} />
								)}
								Confirm Pause
							</button>
							<button
								onClick={() => {
									setShowConfirmPause(false);
									setActionReason("");
								}}
								disabled={actionPending}
								className={`h-7 px-3 rounded text-[10px] font-medium ${MUT} hover:text-stone-700 dark:hover:text-stone-300 border ${BORD}`}
							>
								Cancel
							</button>
						</div>
					</div>
				)}
			</div>

			{/* Recent errors */}
			{health.recentErrors.length > 0 && (
				<div
					className={`shrink-0 border-b ${BORD} px-4 py-2 space-y-1 bg-red-50/30 dark:bg-red-950/10`}
				>
					<div className="flex items-center gap-1.5 text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-widest">
						<AlertCircle size={10} />
						Recent errors ({health.recentErrors.length})
					</div>
					{health.recentErrors.map((err, i) => (
						<div
							key={i}
							className="text-[10px] text-red-600 dark:text-red-400 font-mono px-2 py-1 bg-red-50 dark:bg-red-950/20 rounded"
						>
							{err}
						</div>
					))}
				</div>
			)}

			{/* Scan schedules */}
			<div className={`shrink-0 border-b ${BORD} px-4 py-3`}>
				<div className="flex items-center gap-1.5 mb-2">
					<Clock size={12} strokeWidth={1.8} className={MUT} />
					<span
						className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}
					>
						Scan Schedules
					</span>
				</div>
				<div className="space-y-1.5">
					{health.scans.map((scan) => (
						<ScanRow key={scan.kind} scan={scan} />
					))}
					{health.scans.length === 0 && (
						<p className={`text-xs ${MUT} italic`}>
							No scan schedules configured
						</p>
					)}
				</div>
			</div>

			{/* Budget / Rate limits */}
			{health.budget && (
				<div className={`${SURF} px-4 py-3 space-y-2`}>
					<div className="flex items-center gap-1.5 mb-2">
						<Shield size={12} strokeWidth={1.8} className={MUT} />
						<span
							className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}
						>
							Budget & Rate Limits
						</span>
					</div>

					<BudgetBar
						consumed={health.budget.consumedTokens}
						limit={health.budget.tokenLimit}
						label="Tokens"
					/>
					<BudgetBar
						consumed={health.budget.consumedCalls}
						limit={health.budget.callLimit}
						label="API Calls"
					/>
					<p className={`text-[9px] ${MUT} mt-1`}>
						Window resets{" "}
						{formatTimestamp(health.budget.windowResetAt)}
					</p>
				</div>
			)}
		</div>
	);
}
