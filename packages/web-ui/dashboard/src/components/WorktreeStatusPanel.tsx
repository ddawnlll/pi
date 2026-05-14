/**
 * WorktreeStatusPanel — Dashboard component showing git worktree status.
 *
 * Workspace 6.J — Dashboard scale controls and integration visibility.
 *
 * AC1: User can see each workspace worktree status (branch, dirty, path).
 * AC5: Integration with scoped worktree cleanup.
 * AC6: Dashboard remains responsive via useQuery with proper polling.
 */

import { GitBranch, Trash2, RefreshCw, AlertTriangle, CheckCircle, XCircle, Lock } from "lucide-react";
import { useWorktreeCleanup, useWorktreeStatus } from "../hooks/useScaleStatus";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Status badge helper ───────────────────────────────────────────────────

interface BadgeProps {
	dirty: boolean;
	locked: boolean;
	bare: boolean;
}

function StatusBadge({ dirty, locked, bare }: BadgeProps) {
	if (bare) {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-[10px] font-medium text-stone-500 dark:text-stone-400">
				bare
			</span>
		);
	}
	if (locked) {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-[10px] font-medium text-amber-700 dark:text-amber-300">
				<Lock size={10} /> locked
			</span>
		);
	}
	if (dirty) {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-[10px] font-medium text-red-600 dark:text-red-400">
				<XCircle size={10} /> dirty
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
			<CheckCircle size={10} /> clean
		</span>
	);
}

// ─── Main component ─────────────────────────────────────────────────────────

interface WorktreeStatusPanelProps {
	/** Optional class name. */
	className?: string;
}

/**
 * WorktreeStatusPanel component.
 *
 * Displays git worktree status for all worktrees including:
 * - Branch name
 * - Clean/dirty status
 * - Locked/bare indicators
 * - Safe cleanup controls
 */
export function WorktreeStatusPanel({ className }: WorktreeStatusPanelProps) {
	const { data, isLoading, error } = useWorktreeStatus();
	const { cleanupAll, removeWorktree, isCleaning, lastResult } = useWorktreeCleanup();

	const worktrees = data?.worktrees ?? [];
	const total = data?.total ?? 0;

	return (
		<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3 ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<GitBranch size={16} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>Worktrees</h3>
					<span className={`text-[10px] ${MUT}`}>({total})</span>
				</div>
				<div className="flex items-center gap-1.5">
					{/* Cleanup button */}
					{worktrees.length > 0 && (
						<button
							type="button"
							onClick={() => cleanupAll()}
							disabled={isCleaning}
							className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium
								bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700
								text-stone-600 dark:text-stone-300 border border-[#E8E6E1] dark:border-[#444]
								disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							{isCleaning ? <RefreshCw size={10} className="animate-spin" /> : <Trash2 size={10} />}
							{isCleaning ? "Cleaning..." : "Prune Safe"}
						</button>
					)}
				</div>
			</div>

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
						Failed to load worktree status: {String(error)}
					</p>
				</div>
			)}

			{/* Cleanup result */}
			{lastResult && !isCleaning && "removed" in lastResult && lastResult.removed > 0 && (
				<div className="bg-emerald-50 dark:bg-emerald-900/10 rounded px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
					Removed {lastResult.removed} worktree(s): {lastResult.removedNames.join(", ")}
				</div>
			)}

			{/* Empty state */}
			{!isLoading && !error && worktrees.length === 0 && (
				<p className={`text-xs py-4 text-center ${MUT}`}>No worktrees found.</p>
			)}

			{/* Worktree list */}
			{worktrees.length > 0 && (
				<div className="space-y-1.5">
					{worktrees.map((wt) => (
						<div
							key={wt.path}
							className="flex items-center justify-between gap-2 px-2.5 py-2 rounded
								bg-stone-50 dark:bg-stone-800/50 border border-[#E8E6E1] dark:border-[#333]"
						>
							<div className="min-w-0 flex-1">
								{/* Name and branch */}
								<div className="flex items-center gap-2">
									<span className={`text-xs font-medium truncate ${TXT}`}>{wt.name}</span>
									{wt.branch && (
										<span className={`text-[10px] truncate ${MUT}`}>
											{wt.branch}
										</span>
									)}
								</div>
								{/* Path */}
								<p className={`text-[10px] truncate mt-0.5 font-mono ${MUT}`}>{wt.path}</p>
							</div>

							{/* Status badges and actions */}
							<div className="flex items-center gap-2 shrink-0">
								<StatusBadge dirty={wt.dirty} locked={wt.locked} bare={wt.bare} />
								{/* Individual remove */}
								{!wt.bare && !wt.dirty && wt.name !== "main" && wt.name !== "master" && (
									<button
										type="button"
										onClick={() => removeWorktree(wt.name)}
										disabled={isCleaning}
										className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20
											text-stone-400 hover:text-red-500 transition-colors
											disabled:opacity-30 disabled:cursor-not-allowed"
										title={`Remove ${wt.name}`}
									>
										<Trash2 size={12} />
									</button>
								)}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Help text */}
			<p className={`text-[10px] leading-tight ${MUT}`}>
				Git worktrees used by concurrent worker processes. Dirty worktrees
				have uncommitted changes and cannot be safely removed.{' '}
				<strong>Prune Safe</strong> removes only clean, non-active worktrees.
			</p>
		</div>
	);
}
