import React, { useState } from "react";
import type { MemoryRecord } from "../../../types-brain";

interface MemoryEditFormProps {
	memory: MemoryRecord | null;
	onSubmit: (data: { title: string; content: string; tags: string[] }) => Promise<void>;
	onCancel: () => void;
	loading: boolean;
}

export function MemoryEditForm({ memory, onSubmit, onCancel, loading }: MemoryEditFormProps) {
	const [title, setTitle] = useState(memory?.title ?? "");
	const [content, setContent] = useState(memory?.content ?? "");
	const [tagsInput, setTagsInput] = useState(memory?.tags.join(", ") ?? "");

	if (!memory) return null;

	const handleSubmit = () => {
		const tags = tagsInput
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		onSubmit({ title, content, tags });
	};

	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 p-5 w-full max-w-md shadow-xl space-y-3">
				<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">Edit Memory</h3>
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
					<label className="text-xs font-medium text-stone-500 block mb-1">Content</label>
					<textarea
						value={content}
						onChange={(e) => setContent(e.target.value)}
						rows={6}
						className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label className="text-xs font-medium text-stone-500 block mb-1">Tags (comma-separated)</label>
					<input
						type="text"
						value={tagsInput}
						onChange={(e) => setTagsInput(e.target.value)}
						placeholder="retry, hotspot, p14"
						className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>
				<div className="flex justify-end gap-2 pt-2">
					<button onClick={onCancel} disabled={loading} className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 disabled:opacity-50">
						Cancel
					</button>
					<button onClick={handleSubmit} disabled={loading} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
						{loading ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}
