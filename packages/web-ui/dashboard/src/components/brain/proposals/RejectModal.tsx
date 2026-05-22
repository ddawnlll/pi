import React, { useState } from "react";

interface RejectModalProps {
	onConfirm: (reason?: string) => Promise<void>;
	onCancel: () => void;
	loading: boolean;
}

export function RejectModal({ onConfirm, onCancel, loading }: RejectModalProps) {
	const [reason, setReason] = useState("");

	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 p-5 w-full max-w-sm shadow-xl">
				<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200 mb-3">
					Reject Proposal
				</h3>
				<textarea
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder="Reason for rejection (optional)"
					className="w-full h-20 px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 placeholder-stone-400 resize-none focus:outline-none focus:ring-1 focus:ring-red-500 mb-4"
				/>
				<div className="flex justify-end gap-2">
					<button
						onClick={onCancel}
						disabled={loading}
						className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						onClick={() => onConfirm(reason || undefined)}
						disabled={loading}
						className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
					>
						{loading ? "Rejecting..." : "Reject"}
					</button>
				</div>
			</div>
		</div>
	);
}
