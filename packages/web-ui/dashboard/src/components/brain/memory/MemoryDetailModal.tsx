import React from "react";
import type { MemoryRecord } from "../../../types-brain";

interface MemoryDetailModalProps {
	memory: MemoryRecord;
	onClose: () => void;
	onEdit: () => void;
	onReject: () => void;
	onActivate: () => void;
}

export function MemoryDetailModal({ memory, onClose, onEdit, onReject, onActivate }: MemoryDetailModalProps) {
	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-700 shrink-0">
					<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">
						{memory.title}
					</h3>
					<button onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
						✕
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
					<div className="flex items-center gap-2">
						<span className="px-1.5 py-0.5 text-xs rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500">
							{memory.type.replace(/_/g, " ")}
						</span>
						<span className="text-xs text-stone-400">
							Confidence: {Math.round(memory.confidence * 100)}%
						</span>
					</div>

					<p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed whitespace-pre-wrap">
						{memory.content}
					</p>

					{memory.tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{memory.tags.map((tag) => (
								<span key={tag} className="px-1.5 py-0.5 text-xs rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300">
									#{tag}
								</span>
							))}
						</div>
					)}

					{memory.provenance && (
						<div className="text-xs text-stone-400 space-y-0.5">
							{memory.provenance.planExecId && <p>Plan: {memory.provenance.planExecId.slice(0, 12)}</p>}
							{memory.provenance.workspaceId && <p>Workspace: {memory.provenance.workspaceId}</p>}
						</div>
					)}

					<div className="text-xs text-stone-400">
						Created: {new Date(memory.createdAt).toLocaleString()}
					</div>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2 px-5 py-3 border-t border-stone-100 dark:border-stone-700 shrink-0">
					<button
						onClick={onEdit}
						className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
					>
						Edit
					</button>
					{memory.lifecycle !== "active" && (
						<button
							onClick={onActivate}
							className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
						>
							Activate
						</button>
					)}
					{memory.lifecycle !== "rejected" && (
						<button
							onClick={onReject}
							className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
						>
							Reject
						</button>
					)}
					<div className="flex-1" />
					<button
						onClick={onClose}
						className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
