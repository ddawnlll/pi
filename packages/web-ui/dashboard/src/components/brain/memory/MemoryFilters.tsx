import React from "react";
import type { FilterState } from "../../../hooks/useMemoryRecords";

interface MemoryFiltersProps {
	filters: FilterState;
	onChange: (f: Partial<FilterState>) => void;
}

const MEMORY_TYPES = [
	{ value: "", label: "All types" },
	{ value: "failure_memory", label: "Failure" },
	{ value: "success_memory", label: "Success" },
	{ value: "user_preference_memory", label: "Preference" },
	{ value: "workflow_memory", label: "Workflow" },
	{ value: "observation_memory", label: "Observation" },
	{ value: "context_memory", label: "Context" },
];

const LIFECYCLES = [
	{ value: "", label: "All lifecycle" },
	{ value: "active", label: "Active" },
	{ value: "candidate", label: "Candidate" },
	{ value: "rejected", label: "Rejected" },
];

export function MemoryFilters({ filters, onChange }: MemoryFiltersProps) {
	return (
		<div className="flex items-center gap-2">
			<select
				value={filters.type}
				onChange={(e) => onChange({ type: e.target.value })}
				className="px-2 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
			>
				{MEMORY_TYPES.map((t) => (
					<option key={t.value} value={t.value}>{t.label}</option>
				))}
			</select>
			<select
				value={filters.lifecycle}
				onChange={(e) => onChange({ lifecycle: e.target.value })}
				className="px-2 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
			>
				{LIFECYCLES.map((l) => (
					<option key={l.value} value={l.value}>{l.label}</option>
				))}
			</select>
		</div>
	);
}
