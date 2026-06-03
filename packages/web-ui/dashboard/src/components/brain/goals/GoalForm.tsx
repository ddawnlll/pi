import React, { useState } from "react";

interface GoalFormProps {
	onSubmit: (data: { title: string; description?: string; priority?: string; milestones?: string[] }) => Promise<void>;
	onCancel: () => void;
	loading: boolean;
}

export function GoalForm({ onSubmit, onCancel, loading }: GoalFormProps) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [priority, setPriority] = useState("normal");
	const [milestonesStr, setMilestonesStr] = useState("");

	const handleSubmit = () => {
		if (!title.trim()) return;
		const milestones = milestonesStr
			.split("\n")
			.map((m) => m.trim())
			.filter(Boolean);
		onSubmit({ title: title.trim(), description: description.trim() || undefined, priority, milestones });
	};

	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 p-5 w-full max-w-md shadow-xl space-y-3">
				<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">Add Goal</h3>
				<div>
					<label className="text-xs font-medium text-stone-500 block mb-1">Title *</label>
					<input
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Goal title"
						className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label className="text-xs font-medium text-stone-500 block mb-1">Description</label>
					<textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={3}
						placeholder="Goal description"
						className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label className="text-xs font-medium text-stone-500 block mb-1">Priority</label>
					<select
						value={priority}
						onChange={(e) => setPriority(e.target.value)}
						className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						<option value="critical">Critical</option>
						<option value="high">High</option>
						<option value="normal">Normal</option>
						<option value="low">Low</option>
					</select>
				</div>
				<div>
					<label className="text-xs font-medium text-stone-500 block mb-1">Milestones (one per line)</label>
					<textarea
						value={milestonesStr}
						onChange={(e) => setMilestonesStr(e.target.value)}
						rows={4}
						placeholder="Implement feature X&#10;Write tests&#10;Deploy to staging"
						className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>
				<div className="flex justify-end gap-2 pt-2">
					<button onClick={onCancel} disabled={loading}
						className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 disabled:opacity-50">
						Cancel
					</button>
					<button onClick={handleSubmit} disabled={loading || !title.trim()}
						className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
						{loading ? "Creating..." : "Create"}
					</button>
				</div>
			</div>
		</div>
	);
}
