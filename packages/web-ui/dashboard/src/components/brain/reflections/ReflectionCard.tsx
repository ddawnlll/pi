import React from "react";
import type { ReflectionReport } from "../../../types-brain";

interface ReflectionCardProps {
	reflection: ReflectionReport;
	onClick: () => void;
}

export function ReflectionCard({ reflection, onClick }: ReflectionCardProps) {
	const date = new Date(reflection.timestamp).toLocaleDateString();

	return (
		<button
			onClick={onClick}
			className="w-full text-left border border-stone-200 dark:border-stone-700 rounded-lg p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-smooth card-hover space-y-2"
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-stone-500 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">
						{reflection.phase}
					</span>
					<span className="text-xs text-stone-400">{date}</span>
				</div>
			</div>
			<h4 className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
				{reflection.planTitle}
			</h4>
			<p className="text-xs text-stone-500 line-clamp-2">{reflection.summary}</p>

			<div className="flex items-center gap-3 text-xs text-stone-400">
				{reflection.worked.length > 0 && (
					<span className="flex items-center gap-1">
						<span className="text-emerald-500">&#10003;</span>
						{reflection.worked.length} worked
					</span>
				)}
				{reflection.failed.length > 0 && (
					<span className="flex items-center gap-1">
						<span className="text-red-500">&#10007;</span>
						{reflection.failed.length} failed
					</span>
				)}
				{reflection.memoryProposals > 0 && (
					<span>{reflection.memoryProposals} memory proposals</span>
				)}
				{reflection.suggestions > 0 && (
					<span>{reflection.suggestions} suggestions</span>
				)}
			</div>
		</button>
	);
}
