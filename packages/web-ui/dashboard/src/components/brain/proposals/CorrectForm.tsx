import React, { useState } from "react";
import type { Proposal } from "../../../types-brain";

interface CorrectFormProps {
	proposal: Proposal | null;
	onSubmit: (corrections: Record<string, unknown>) => Promise<void>;
	onCancel: () => void;
	loading: boolean;
}

export function CorrectForm({ proposal, onSubmit, onCancel, loading }: CorrectFormProps) {
	const [title, setTitle] = useState(proposal?.title ?? "");
	const [description, setDescription] = useState(proposal?.description ?? "");

	if (!proposal) return null;

	const handleSubmit = () => {
		onSubmit({ title, description });
	};

	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 p-5 w-full max-w-md shadow-xl">
				<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200 mb-3">
					Correct Proposal
				</h3>
				<div className="space-y-3">
					<div>
						<label className="text-xs font-medium text-stone-500 block mb-1">Title</label>
						<input
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
						/>
					</div>
					<div>
						<label className="text-xs font-medium text-stone-500 block mb-1">Description</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={4}
							className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
						/>
					</div>
				</div>
				<div className="flex justify-end gap-2 mt-4">
					<button
						onClick={onCancel}
						disabled={loading}
						className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						onClick={handleSubmit}
						disabled={loading}
						className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
					>
						{loading ? "Saving..." : "Submit"}
					</button>
				</div>
			</div>
		</div>
	);
}
