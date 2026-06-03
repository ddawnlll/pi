import React from "react";
import { Database, RotateCw } from "lucide-react";
import type { MemoryRecord } from "../../types-brain";

interface ProjectMemorySnippetProps {
	memories: MemoryRecord[] | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	maxItems?: number;
}

const TYPE_LABELS: Record<string, string> = {
	failure_memory: "Failure",
	success_memory: "Success",
	user_preference_memory: "Preference",
	workflow_memory: "Workflow",
	observation_memory: "Observation",
	context_memory: "Context",
};

const TYPE_COLORS: Record<string, string> = {
	failure_memory: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
	success_memory: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
	user_preference_memory: "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
	workflow_memory: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
	observation_memory: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800",
	context_memory: "text-stone-600 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/30 border-stone-200 dark:border-stone-700",
};

function MemoryItem({ memory }: { memory: MemoryRecord }) {
	const typeLabel = TYPE_LABELS[memory.type] ?? memory.type;
	const typeColor = TYPE_COLORS[memory.type] ?? TYPE_COLORS.context_memory;

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-3 space-y-1.5 hover:border-stone-300 dark:hover:border-stone-600 transition-colors">
			<div className="flex items-start justify-between gap-2">
				<h3 className="text-xs font-medium text-stone-800 dark:text-stone-200 leading-snug truncate">
					{memory.title}
				</h3>
				<span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded border ${typeColor}`}>
					{typeLabel}
				</span>
			</div>
			<p className="text-xs text-stone-400 dark:text-stone-500 line-clamp-2">
				{memory.content}
			</p>
			<div className="flex items-center gap-2 text-xs text-stone-400">
				{memory.tags.length > 0 && (
					<div className="flex items-center gap-1 flex-wrap">
						{memory.tags.slice(0, 3).map((tag) => (
							<span key={tag} className="px-1 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-400">
								{tag}
							</span>
						))}
					</div>
				)}
				<span className="ml-auto">
					{Math.round(memory.confidence * 100)}% confidence
				</span>
			</div>
		</div>
	);
}

export function ProjectMemorySnippet({
	memories,
	loading,
	error,
	onRefresh,
	maxItems = 3,
}: ProjectMemorySnippetProps) {
	if (loading && !memories) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 2 }).map((_, i) => (
					<div key={i} className="animate-pulse rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-2">
						<div className="h-3 w-3/4 bg-stone-200 dark:bg-stone-700 rounded" />
						<div className="h-2 w-full bg-stone-100 dark:bg-stone-800 rounded" />
						<div className="h-2 w-1/2 bg-stone-100 dark:bg-stone-800 rounded" />
					</div>
				))}
			</div>
		);
	}

	if (error && !memories) {
		return (
			<div className="text-xs text-red-400 dark:text-red-500 px-3 py-2 text-center">
				Failed to load memories
			</div>
		);
	}

	const items = (memories ?? []).slice(0, maxItems);

	if (items.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-6 text-center">
				<Database size={20} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600 mb-2" />
				<p className="text-xs text-stone-400 dark:text-stone-500">No memories yet</p>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs text-stone-400 dark:text-stone-500">
					{memories?.length ?? 0} total memories
				</span>
				<button
					onClick={onRefresh}
					className="p-0.5 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
					title="Refresh"
				>
					<RotateCw size={10} strokeWidth={1.5} />
				</button>
			</div>
			{items.map((memory) => (
				<MemoryItem key={memory.id} memory={memory} />
			))}
		</div>
	);
}
