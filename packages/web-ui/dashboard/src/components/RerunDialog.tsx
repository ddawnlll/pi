/**
 * RerunDialog — Confirmation dialog for restarting a stopped or failed plan.
 *
 * Shows a DAG summary of all workspaces and their statuses, then lets the
 * user confirm the restart. On confirm, calls the rerun API which creates
 * a brand new execution with the original plan file.
 */

import { X, RefreshCw, AlertTriangle, CheckCircle, Clock, OctagonX } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { PlanExecutionDetail } from "../types";

interface RerunDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	executionDetail: PlanExecutionDetail | null;
	loading: boolean;
}

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

function statusIcon(stage: string) {
	switch (stage) {
		case "complete":
			return <CheckCircle size={14} className="text-emerald-500 shrink-0" />;
		case "active":
			return <RefreshCw size={14} className="text-blue-500 animate-spin shrink-0" />;
		case "failed":
			return <OctagonX size={14} className="text-red-500 shrink-0" />;
		case "blocked":
			return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
		default:
			return <Clock size={14} className="text-stone-400 shrink-0" />;
	}
}

export function RerunDialog({ isOpen, onClose, onConfirm, executionDetail, loading }: RerunDialogProps) {
	const failedCount = executionDetail?.workspaces?.filter((w) => w.stage === "failed").length ?? 0;
	const completeCount = executionDetail?.workspaces?.filter((w) => w.stage === "complete").length ?? 0;
	const totalCount = executionDetail?.workspaces?.length ?? 0;
	const pendingCount = executionDetail?.workspaces?.filter((w) => w.stage === "pending").length ?? 0;
	const blockedCount = executionDetail?.workspaces?.filter((w) => w.stage === "blocked").length ?? 0;

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={onClose}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.1 }}
						className={`${SURF} border ${BORD} rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col`}
						onClick={(e) => e.stopPropagation()}
					>
						{/* header */}
						<div className="flex items-center justify-between mb-4 shrink-0">
							<h2 className={`text-lg font-semibold ${TXT}`}>Restart Plan</h2>
							<button onClick={onClose} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300`}>
								<X size={16} />
							</button>
						</div>

						{/* plan info */}
						{executionDetail && (
							<div className="mb-4">
								<p className={`text-sm font-medium ${TXT}`}>{executionDetail.title}</p>
								<p className={`text-xs ${MUT} mt-0.5`}>
									Status: <span className="font-medium text-stone-600 dark:text-stone-400 capitalize">{executionDetail.status}</span>
									{executionDetail.completedAt && (
										<>
											<span className="mx-1.5">&middot;</span>
											Completed: {new Date(executionDetail.completedAt).toLocaleTimeString()}
										</>
									)}
								</p>
							</div>
						)}

						{/* summary stats */}
						<div className={`flex items-center gap-3 mb-4 p-3 rounded-lg border ${BORD} bg-stone-50 dark:bg-stone-800/30`}>
							<div className="flex-1 text-center">
								<p className={`text-lg font-semibold ${TXT}`}>{totalCount}</p>
								<p className={`text-[10px] uppercase tracking-wider ${MUT}`}>Total</p>
							</div>
							<div className="w-px h-8 bg-stone-200 dark:bg-stone-700" />
							<div className="flex-1 text-center">
								<p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{completeCount}</p>
								<p className="text-[10px] uppercase tracking-wider text-emerald-600/60 dark:text-emerald-400/60">Complete</p>
							</div>
							<div className="w-px h-8 bg-stone-200 dark:bg-stone-700" />
							<div className="flex-1 text-center">
								<p className="text-lg font-semibold text-red-600 dark:text-red-400">{failedCount}</p>
								<p className="text-[10px] uppercase tracking-wider text-red-600/60 dark:text-red-400/60">Failed</p>
							</div>
						</div>

						{/* DAG: workspace list */}
						<div className="flex-1 min-h-0 overflow-y-auto mb-4">
							<p className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2`}>
								Workspace DAG
							</p>
							<div className="space-y-1">
								{executionDetail?.workspaces?.map((ws) => (
									<div key={ws.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${BORD} ${TXT} text-xs`}>
										{statusIcon(ws.stage)}
										<span className="font-medium">{ws.id}</span>
										{ws.error && (
											<span className="text-red-500 truncate ml-1 max-w-[180px]" title={ws.error}>
												{ws.error}
											</span>
										)}
										<div className="flex-1" />
										<span className={`text-[10px] uppercase ${MUT}`}>{ws.stage}</span>
									</div>
								))}
							</div>
						</div>

						{/* warning for in-flight */}
						{(blockedCount > 0 || pendingCount > 0) && (
							<div className={`flex items-start gap-2 mb-4 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/15`}>
								<AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
								<p className="text-xs text-amber-700 dark:text-amber-300">
									{pendingCount} workspace(s) that never started and {blockedCount} blocked workspace(s) will be reset and retried.
								</p>
							</div>
						)}

						{/* actions */}
						<div className="flex items-center gap-2 justify-end shrink-0">
							<button
								onClick={onClose}
								className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors`}
							>
								Cancel
							</button>
							<button
								onClick={onConfirm}
								disabled={loading}
								className={`px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
								{loading ? "Restarting..." : "Restart"}
							</button>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
