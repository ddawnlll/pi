import React from "react";
import type { MemoryRecord } from "../../../types-brain";

interface MemoryCardProps {
	memory: MemoryRecord;
	onClick: () => void;
}

const LIFECYCLE_STYLES: Record<string, { dot: string; label: string }> = {
	active: { dot: "bg-emerald-500", label: "Active" },
	candidate: { dot: "bg-amber-500", label: "Candidate" },
	rejected: { dot: "bg-red-500", label: "Rejected" },
};

export function MemoryCard({ memory, onClick }: MemoryCardProps) {
	const lc = LIFECYCLE_STYLES[memory.lifecycle] ?? { dot: "bg-stone-400", label: memory.lifecycle };

	return (
		<button
			onClick={onClick}
			className="w-full text-left border border-stone-200 dark:border-stone-700 rounded-lg p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors space-y-2"
		>
			{/* Header */}
			<div className="flex items-center justify-between gap-2">
				<h4 className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
					{memory.title}
				</h4>
				<div className="flex items-center gap-1.5 shrink-0">
					<span className={`w-1.5 h-1.5 rounded-full ${lc.dot}`} />
					<span className="text-xs text-stone-400">{lc.label}</span>
				</div>
			</div>

			{/* Type badge */}
			<span className="inline-block px-1.5 py-0.5 text-xs font-medium rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500">
				{memory.type.replace(/_/g, " ")}
			</span>

			{/* Confidence bar */}
			<div className="flex items-center gap-2">
				<div className="flex-1 h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
					<div
						className="h-full rounded-full bg-blue-500 transition-all"
						style={{ width: `${memory.confidence * 100}%` }}
					/>
				</div>
				<span className="text-xs font-mono text-stone-400">
					{Math.round(memory.confidence * 100)}%
				</span>
			</div>

			{/* Tags */}
			{memory.tags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{memory.tags.slice(0, 4).map((tag) => (
						<span
							key={tag}
							className="text-xs px-1.5 py-0.5 rounded-full bg-stone-50 dark:bg-stone-800 text-stone-400"
						>
							#{tag}
						</span>
					))}
					{memory.tags.length > 4 && (
						<span className="text-xs text-stone-400">+{memory.tags.length - 4}</span>
					)}
				</div>
			)}
		</button>
	);
}
