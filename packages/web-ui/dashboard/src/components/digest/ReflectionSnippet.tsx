import React from "react";
import { Lightbulb, RotateCw } from "lucide-react";
import type { ReflectionReport } from "../../types-brain";

interface ReflectionSnippetProps {
	reflections: ReflectionReport[] | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	maxItems?: number;
}

function formatTimeAgo(timestamp: string): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMin = Math.floor(diffMs / 60000);

	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;

	const diffHrs = Math.floor(diffMin / 60);
	if (diffHrs < 24) return `${diffHrs}h ago`;

	const diffDays = Math.floor(diffHrs / 24);
	if (diffDays < 7) return `${diffDays}d ago`;

	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

function ReflectionItem({ reflection }: { reflection: ReflectionReport }) {
	const workedCount = reflection.worked?.length ?? 0;
	const failedCount = reflection.failed?.length ?? 0;

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-3 space-y-1.5 hover:border-stone-300 dark:hover:border-stone-600 transition-colors">
			<div className="flex items-start justify-between gap-2">
				<h3 className="text-xs font-medium text-stone-800 dark:text-stone-200 leading-snug truncate flex-1">
					{reflection.planTitle || `Reflection ${reflection.planExecId?.slice(0, 8)}`}
				</h3>
				<span className="shrink-0 text-xs text-stone-400">
					{formatTimeAgo(reflection.timestamp)}
				</span>
			</div>
			<p className="text-xs text-stone-400 dark:text-stone-500 line-clamp-2">
				{reflection.summary}
			</p>
			<div className="flex items-center gap-3 text-xs text-stone-400">
				{workedCount > 0 && (
					<span className="text-emerald-500">
						{workedCount} worked
					</span>
				)}
				{failedCount > 0 && (
					<span className="text-red-400">
						{failedCount} failed
					</span>
				)}
				{reflection.memoriesCreated > 0 && (
					<span>
						{reflection.memoriesCreated} memories
					</span>
				)}
				<span className="ml-auto">
					{reflection.memoryProposals} proposals
				</span>
			</div>
		</div>
	);
}

export function ReflectionSnippet({
	reflections,
	loading,
	error,
	onRefresh,
	maxItems = 2,
}: ReflectionSnippetProps) {
	if (loading && !reflections) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 2 }).map((_, i) => (
					<div key={i} className="animate-pulse rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-2">
						<div className="h-3 w-2/3 bg-stone-200 dark:bg-stone-700 rounded" />
						<div className="h-2 w-full bg-stone-100 dark:bg-stone-800 rounded" />
						<div className="h-2 w-1/3 bg-stone-100 dark:bg-stone-800 rounded" />
					</div>
				))}
			</div>
		);
	}

	if (error && !reflections) {
		return (
			<div className="text-xs text-red-400 dark:text-red-500 px-3 py-2 text-center">
				Failed to load reflections
			</div>
		);
	}

	const items = (reflections ?? []).slice(0, maxItems);

	if (items.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-6 text-center">
				<Lightbulb size={20} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600 mb-2" />
				<p className="text-xs text-stone-400 dark:text-stone-500">No reflections yet</p>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs text-stone-400 dark:text-stone-500">
					{reflections?.length ?? 0} total reflections
				</span>
				<button
					onClick={onRefresh}
					className="p-0.5 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
					title="Refresh"
				>
					<RotateCw size={10} strokeWidth={1.5} />
				</button>
			</div>
			{items.map((reflection) => (
				<ReflectionItem key={reflection.planExecId} reflection={reflection} />
			))}
		</div>
	);
}
