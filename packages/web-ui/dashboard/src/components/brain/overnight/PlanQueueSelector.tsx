import React from "react";

interface PlanQueueSelectorProps {
	plans: { id: string; label: string }[];
	selected: string[];
	onToggle: (id: string) => void;
}

export function PlanQueueSelector({ plans, selected, onToggle }: PlanQueueSelectorProps) {
	return (
		<div className="space-y-1.5">
			{plans.map((p) => (
				<label key={p.id} className="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={selected.includes(p.id)}
						onChange={() => onToggle(p.id)}
						className="rounded border-stone-300 dark:border-stone-600"
					/>
					<span className="text-xs text-stone-600 dark:text-stone-300">{p.label}</span>
				</label>
			))}
		</div>
	);
}
