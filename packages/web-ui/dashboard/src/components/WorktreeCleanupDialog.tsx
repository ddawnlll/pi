/**
 * WorktreeCleanupDialog — Confirmation dialog for bulk worktree cleanup.
 *
 * Workspace 6.5.D — Worktree status and cleanup review.
 *
 * Acceptance criteria:
 * - Bulk cleanup requires confirmation
 * - Dialog lists affected worktrees
 * - Dirty/main/bare/locked/active worktrees cannot be removed (shown as excluded)
 */

import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
	AlertTriangle,
	CheckCircle,
	Lock,
	ShieldBan,
	ShieldX,
	Trash2,
	XCircle,
} from "lucide-react";
import type { WorktreeInfo } from "../hooks/useScaleStatus";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Determine why a worktree cannot be pruned, or null if it is safe. */
export function getWorktreeBlockReason(
	wt: WorktreeInfo,
	activeQueueIds: Set<string>,
	workspaceRoot: string,
): string | null {
	if (wt.path === workspaceRoot || wt.path.endsWith("/.git")) return "Main working tree — cannot be removed";
	if (wt.bare) return "Bare worktree — cannot be removed";
	if (wt.dirty) return "Has uncommitted changes — remove manually";
	if (wt.locked) return "Locked — unlock before removing";
	const nameLower = wt.name.toLowerCase();
	if (nameLower === "main" || nameLower === "master" || nameLower === "primary") return "Protected branch — cannot be removed";
	if (wt.name.startsWith(".")) return "Hidden worktree — cannot be removed";
	if (activeQueueIds.has(wt.name)) return "Active in integration queue — cannot be removed";
	return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorktreeCleanupDialogProps {
	/** Whether the dialog is visible. */
	isOpen: boolean;
	/** Callback to close the dialog without cleaning. */
	onClose: () => void;
	/** Callback to confirm cleanup. */
	onConfirm: () => Promise<void>;
	/** Full list of worktrees. */
	worktrees: WorktreeInfo[];
	/** Active workspace IDs in the integration queue. */
	activeQueueIds: string[];
	/** Workspace root path (to identify the main worktree). */
	workspaceRoot: string;
	/** Whether a cleanup operation is currently in progress. */
	isCleaning?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

export function WorktreeCleanupDialog({
	isOpen,
	onClose,
	onConfirm,
	worktrees,
	activeQueueIds,
	workspaceRoot,
	isCleaning = false,
}: WorktreeCleanupDialogProps) {
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const activeSet = useMemo(() => new Set(activeQueueIds), [activeQueueIds]);

	const { safeToRemove, excluded } = useMemo(() => {
		const safe: { wt: WorktreeInfo }[] = [];
		const excl: { wt: WorktreeInfo; reason: string }[] = [];
		for (const wt of worktrees) {
			const reason = getWorktreeBlockReason(wt, activeSet, workspaceRoot);
			if (reason) {
				excl.push({ wt, reason });
			} else {
				safe.push({ wt });
			}
		}
		return { safeToRemove: safe, excluded: excl };
	}, [worktrees, activeSet, workspaceRoot]);

	const handleConfirm = async () => {
		setError(null);
		try {
			await onConfirm();
			setDone(true);
		} catch (err) {
			setError(String(err));
		}
	};

	const handleClose = () => {
		setDone(false);
		setError(null);
		onClose();
	};

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={handleClose}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.1 }}
						className={`${SURF} border ${BORD} rounded-lg shadow-xl p-5 min-w-[420px] max-w-lg max-h-[80vh] flex flex-col`}
						onClick={(e) => e.stopPropagation()}
					>
						{/* Header */}
						<div className="flex items-center gap-2 mb-4">
							<Trash2 size={16} className={ACC_TXT} />
							<h2 className={`text-sm font-semibold ${TXT}`}>Clean Up Worktrees</h2>
						</div>

						{done ? (
							// ── Success state ──
							<div className="space-y-3">
								<div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/10 rounded px-3 py-2.5">
									<CheckCircle size={16} className="text-emerald-500 shrink-0" />
									<p className="text-xs text-emerald-700 dark:text-emerald-300">
										Cleanup completed successfully.
									</p>
								</div>
								<button
									type="button"
									onClick={handleClose}
									className="w-full px-3 py-2 text-xs rounded bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 border border-[#E8E6E1] dark:border-[#444] transition-colors"
								>
									Close
								</button>
							</div>
						) : (
							// ── Normal state ──
							<>
								<p className={`text-xs mb-3 ${MUT}`}>
									Review the list below before pruning clean, non-active worktrees.
									This action cannot be undone.
								</p>

								<div className="flex-1 overflow-auto space-y-3 min-h-0">
									{/* Safe to remove */}
									{safeToRemove.length > 0 && (
										<div>
											<h3 className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1.5`}>
												Will be removed ({safeToRemove.length})
											</h3>
											<div className="space-y-1">
												{safeToRemove.map(({ wt }) => (
													<div
														key={wt.path}
														className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded
															bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30"
													>
														<div className="min-w-0 flex-1">
															<span className={`text-xs font-medium ${TXT}`}>{wt.name}</span>
															{wt.branch && (
																<span className={`text-[10px] ml-2 ${MUT}`}>{wt.branch}</span>
															)}
															<p className={`text-[10px] truncate font-mono ${MUT}`}>{wt.path}</p>
														</div>
														<CheckCircle size={12} className="text-emerald-500 shrink-0" />
													</div>
												))}
											</div>
										</div>
									)}

									{/* Excluded */}
									{excluded.length > 0 && (
										<div>
											<h3 className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1.5`}>
												Excluded ({excluded.length})
											</h3>
											<div className="space-y-1">
												{excluded.map(({ wt, reason }) => (
													<div
														key={wt.path}
														className="flex items-start gap-2 px-2.5 py-1.5 rounded
															bg-stone-50 dark:bg-stone-800/30 border border-[#E8E6E1] dark:border-[#333]"
													>
														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-1.5">
																<span className={`text-xs font-medium ${TXT}`}>{wt.name}</span>
																{wt.locked && <Lock size={10} className="text-amber-500" />}
															</div>
															<p className={`text-[10px] ${MUT}`}>{reason}</p>
														</div>
														{wt.dirty ? (
															<XCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
														) : wt.locked && !wt.dirty ? (
															<Lock size={12} className="text-amber-500 shrink-0 mt-0.5" />
														) : (
															<ShieldBan size={12} className="text-stone-400 shrink-0 mt-0.5" />
														)}
													</div>
												))}
											</div>
										</div>
									)}

									{/* No worktrees */}
									{safeToRemove.length === 0 && excluded.length === 0 && (
										<div className="flex items-center gap-2 px-2.5 py-3">
											<AlertTriangle size={14} className="text-amber-500" />
											<p className={`text-xs ${MUT}`}>No worktrees found.</p>
										</div>
									)}
								</div>

								{/* Error */}
								{error && (
									<div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/10 rounded px-2.5 py-1.5 mt-2">
										<ShieldX size={12} className="text-red-500 shrink-0" />
										<p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
									</div>
								)}

								{/* Actions */}
								<div className="flex gap-2 justify-end mt-3 pt-3 border-t border-[#E8E6E1] dark:border-[#333]">
									<button
										type="button"
										onClick={handleClose}
										disabled={isCleaning}
										className="px-3 py-1.5 text-xs rounded bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 border border-[#E8E6E1] dark:border-[#444] transition-colors disabled:opacity-50"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleConfirm}
										disabled={safeToRemove.length === 0 || isCleaning}
										className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium
											bg-red-600 hover:bg-red-500 text-white border border-red-600
											transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{isCleaning ? (
											<>
												<Trash2 size={12} className="animate-pulse" />
												Cleaning...
											</>
										) : (
											<>
												<Trash2 size={12} />
												Remove {safeToRemove.length} worktree{safeToRemove.length !== 1 ? "s" : ""}
											</>
										)}
									</button>
								</div>
							</>
						)}
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
