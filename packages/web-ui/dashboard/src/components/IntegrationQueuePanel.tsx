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
} from "lucide-react";
import { useIntegrationQueueStatus, type MergeConflictInfo, type QueueEntryInfo } from "../hooks/useScaleStatus";
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
}

function QueueEntryRow({ entry, onConflictClick }: QueueEntryRowProps) {
	const cfg = getStatusConfig(entry.status);
	const time = entry.processedAt
		? new Date(entry.processedAt).toLocaleTimeString()
		: new Date(entry.queuedAt).toLocaleTimeString();

	const isConflict = entry.status === "conflict";
	const isBlocked = entry.status === "blocked";
	const clickable = isConflict && !!onConflictClick;

	return (
		<button
			onClick={clickable ? () => onConflictClick(entry.workspaceId) : undefined}
			className={`w-full text-left flex items-start gap-2.5 py-2 px-2 rounded transition-colors
				bg-stone-50 dark:bg-stone-800/50 border border-[#E8E6E1] dark:border-[#333]
				${clickable ? "cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20" : "cursor-default"}
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
				{isConflict && clickable && (
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
			</div>
		</button>
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

			{/* Entry list */}
			{entries.length > 0 && (
				<div className="space-y-1.5 max-h-64 overflow-y-auto">
					{entries.map((entry) => (
						<QueueEntryRow
							key={entry.workspaceId}
							entry={entry}
							onConflictClick={handleConflictClick}
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

			{/* Help text */}
			<p className={`text-[10px] leading-tight ${MUT}`}>
				The integration queue processes workspace changes serially.
				Conflicts and validation failures block further processing until resolved.
				<strong> Scale mode</strong> requires the integration queue to be enabled.
			</p>

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
