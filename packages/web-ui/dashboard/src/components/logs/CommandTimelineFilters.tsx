/**
 * CommandTimelineFilters — Filter bar for the command timeline (P42.08).
 *
 * Filters:
 * - Workspace dropdown
 * - Command name text search
 * - Status dropdown (All, Done, Failed, Running)
 * - Target commands only toggle
 * - Show raw output toggle
 */

import { Search, Filter } from "lucide-react";
import type { WorkerInfo } from "../../types";

// ─── tokens ──────────────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CommandStatus = "all" | "done" | "failed" | "running";

export interface CommandTimelineFiltersState {
	workspaceId: string | null; // null = all
	commandName: string;
	status: CommandStatus;
	targetCommandsOnly: boolean;
	showRawOutput: boolean;
}

export const DEFAULT_FILTERS: CommandTimelineFiltersState = {
	workspaceId: null,
	commandName: "",
	status: "all",
	targetCommandsOnly: false,
	showRawOutput: false,
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface CommandTimelineFiltersProps {
	filters: CommandTimelineFiltersState;
	onFiltersChange: (filters: CommandTimelineFiltersState) => void;
	workers: WorkerInfo[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandTimelineFilters({
	filters,
	onFiltersChange,
	workers,
}: CommandTimelineFiltersProps) {
	const update = (patch: Partial<CommandTimelineFiltersState>) => {
		onFiltersChange({ ...filters, ...patch });
	};

	return (
		<div className={`shrink-0 flex items-center gap-2 px-3 py-1.5 border-b ${BORD} bg-stone-50/50 dark:bg-[#1A1A1A]/50 flex-wrap`}>
			{/* Workspace filter */}
			<select
				value={filters.workspaceId ?? ""}
				onChange={(e) => update({ workspaceId: e.target.value || null })}
				className={`text-[10px] rounded px-2 py-1 ${SURF} border ${BORD} ${TXT} focus:outline-none focus:ring-1 focus:ring-blue-400`}
			>
				<option value="">All workspaces</option>
				{workers.map((w) => (
					<option key={w.id} value={w.id}>
						{w.id} ({w.stage})
					</option>
				))}
			</select>

			{/* Command name search */}
			<div className={`relative flex items-center`}>
				<Search size={10} className={`absolute left-2 ${MUT}`} />
				<input
					type="text"
					value={filters.commandName}
					onChange={(e) => update({ commandName: e.target.value })}
					placeholder="Search commands..."
					className={`text-[10px] rounded pl-6 pr-2 py-1 w-36 ${SURF} border ${BORD} ${TXT} placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-blue-400`}
				/>
			</div>

			{/* Status filter */}
			<select
				value={filters.status}
				onChange={(e) => update({ status: e.target.value as CommandStatus })}
				className={`text-[10px] rounded px-2 py-1 ${SURF} border ${BORD} ${TXT} focus:outline-none focus:ring-1 focus:ring-blue-400`}
			>
				<option value="all">All status</option>
				<option value="done">Done (exit 0)</option>
				<option value="failed">Failed (exit &gt; 0)</option>
				<option value="running">Running</option>
			</select>

			{/* Target commands only toggle */}
			<label className={`flex items-center gap-1.5 text-[10px] ${MUT} cursor-pointer select-none`}>
				<input
					type="checkbox"
					checked={filters.targetCommandsOnly}
					onChange={(e) => update({ targetCommandsOnly: e.target.checked })}
					className="w-3 h-3 rounded border-stone-300 dark:border-stone-600 text-blue-600 focus:ring-blue-400"
				/>
				Target commands only
			</label>

			<div className="flex-1" />

			{/* Show raw output toggle */}
			<label className={`flex items-center gap-1.5 text-[10px] ${MUT} cursor-pointer select-none`}>
				<Filter size={10} />
				<input
					type="checkbox"
					checked={filters.showRawOutput}
					onChange={(e) => update({ showRawOutput: e.target.checked })}
					className="w-3 h-3 rounded border-stone-300 dark:border-stone-600 text-blue-600 focus:ring-blue-400"
				/>
				Raw output
			</label>
		</div>
	);
}
