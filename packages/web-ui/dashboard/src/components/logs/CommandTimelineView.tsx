/**
 * CommandTimelineView — Default Logs view showing a command timeline (P42.08).
 *
 * Default view is command timeline. Raw terminal is available behind a toggle.
 *
 * Features:
 * - Commands grouped by workspace
 * - Duration and exit code visible
 * - Command detail panel expandable on click
 * - Filters: workspace, command name, status, target commands only
 * - Raw output toggle to switch to raw terminal mode
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { Terminal, ListFilter } from "lucide-react";
import type { WorkerInfo, JournalEvent } from "../../types";
import { useCommandTimeline, type CommandTimelineEntry } from "../../hooks/useCommandTimeline";
import { LiveLogTerminal } from "../LiveLogTerminal";
import { CommandRow } from "./CommandRow";
import { CommandDetailPanel } from "./CommandDetailPanel";
import {
	CommandTimelineFilters,
	DEFAULT_FILTERS,
	type CommandTimelineFiltersState,
} from "./CommandTimelineFilters";

// ─── tokens ──────────────────────────────────────────────────────────────────


// ─── Props ───────────────────────────────────────────────────────────────────

interface CommandTimelineViewProps {
	/** Project ID */
	projectId: string | null;
	/** Plan execution ID */
	planExecId: string | null;
	/** Workers to derive workspace IDs and for the raw output view */
	workers: WorkerInfo[];
	/** Plan events for the raw output view */
	planEvents?: JournalEvent[];
	/** Optional class name */
	className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandTimelineView({
	projectId,
	planExecId,
	workers,
	planEvents,
	className,
}: CommandTimelineViewProps) {
	const workspaceIds = useMemo(() => workers.map((w) => w.id), [workers]);

	const { commands, isLoading, isError } = useCommandTimeline(
		projectId,
		planExecId,
		workspaceIds,
		workers.length > 0 && !!projectId && !!planExecId,
	);

	const [filters, setFilters] = useState<CommandTimelineFiltersState>(DEFAULT_FILTERS);
	const [selectedCommand, setSelectedCommand] = useState<CommandTimelineEntry | null>(null);

	const scrollContainerRef = useRef<HTMLDivElement>(null);

	// Reset selected command when filters change
	useEffect(() => {
		setSelectedCommand(null);
	}, [filters.workspaceId, filters.commandName, filters.status, filters.targetCommandsOnly]);

	// Apply filters to commands
	const filteredCommands = useMemo(() => {
		let result = commands;

		// Workspace filter
		if (filters.workspaceId) {
			result = result.filter((c) => c.workspaceId === filters.workspaceId);
		}

		// Command name filter (partial match)
		if (filters.commandName.trim()) {
			const query = filters.commandName.trim().toLowerCase();
			result = result.filter((c) => c.command.toLowerCase().includes(query));
		}

		// Status filter
		if (filters.status === "done") {
			result = result.filter((c) => c.exitCode === 0);
		} else if (filters.status === "failed") {
			result = result.filter((c) => c.exitCode !== null && c.exitCode !== 0);
		} else if (filters.status === "running") {
			result = result.filter((c) => c.exitCode === null);
		}

		// Target commands only
		if (filters.targetCommandsOnly) {
			result = result.filter((c) => c.isTargetCommand === true);
		}

		return result;
	}, [commands, filters]);

	// ── Raw output mode ──
	if (filters.showRawOutput) {
		return (
			<div className={`flex flex-col h-full ${SURF} border ${BORD} rounded-lg overflow-hidden ${className ?? ""}`}>
				{/* Header with toggle */}
				<div className={`shrink-0 flex items-center justify-between px-3 h-9 border-b ${BORD} bg-stone-50 dark:bg-[#1A1A1A]`}>
					<div className="flex items-center gap-2">
						<Terminal size={13} strokeWidth={1.8} className={MUT} />
						<span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
							Raw Output
						</span>
					</div>
					<button
						onClick={() => setFilters({ ...filters, showRawOutput: false })}
						className={`flex items-center gap-1 px-2 py-1 text-xs rounded font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors`}
					>
						<ListFilter size={10} />
						Timeline
					</button>
				</div>
				<div className="flex-1 min-h-0">
					<LiveLogTerminal workers={workers} planEvents={planEvents} className="h-full border-0 rounded-none" />
				</div>
			</div>
		);
	}

	// ── Timeline view (default) ──
	return (
		<div className={`flex flex-col h-full ${SURF} border ${BORD} rounded-lg overflow-hidden ${className ?? ""}`}>
			{/* ── Header ── */}
			<div className={`shrink-0 flex items-center justify-between px-3 h-9 border-b ${BORD} bg-stone-50 dark:bg-[#1A1A1A]`}>
				<div className="flex items-center gap-2">
					<ListFilter size={13} strokeWidth={1.8} className={MUT} />
					<span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
						Command Timeline
					</span>
					{!isLoading && (
						<span className={`text-xs ${MUT} tabular-nums`}>
							{filteredCommands.length} command{filteredCommands.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					<button
						onClick={() => setFilters({ ...filters, showRawOutput: true })}
						className={`flex items-center gap-1 px-2 py-1 text-xs rounded font-medium bg-stone-100 dark:bg-[#333] text-stone-400 dark:text-stone-500 hover:bg-stone-200 dark:hover:bg-[#444] transition-colors`}
						title="Switch to raw output view"
					>
						<Terminal size={10} />
						Raw
					</button>
				</div>
			</div>

			{/* ── Column headers ── */}
			<div className={`shrink-0 flex items-center gap-2 px-3 py-1 border-b ${BORD} bg-stone-50/30 dark:bg-[#1A1A1A]/30`}>
				<span className="w-3 shrink-0" />
				<span className={`shrink-0 w-20 text-xs font-semibold uppercase tracking-wider ${MUT}`}>
					Workspace
				</span>
				<span className={`flex-1 text-xs font-semibold uppercase tracking-wider ${MUT}`}>
					Command
				</span>
				<span className={`shrink-0 w-14 text-right text-xs font-semibold uppercase tracking-wider ${MUT}`}>
					Duration
				</span>
				<span className={`shrink-0 w-14 text-right text-xs font-semibold uppercase tracking-wider ${MUT}`}>
					Exit
				</span>
				<span className="w-3 shrink-0" />
			</div>

			{/* ── Filters ── */}
			<CommandTimelineFilters
				filters={filters}
				onFiltersChange={setFilters}
				workers={workers}
			/>

			{/* ── Scrollable command list ── */}
			<div
				ref={scrollContainerRef}
				className="flex-1 min-h-0 overflow-y-auto"
			>
				{/* Loading state */}
				{isLoading && workers.length > 0 && (
					<div className={`flex items-center justify-center h-20 ${MUT} text-xs`}>
						Loading command history...
					</div>
				)}

				{/* Error state */}
				{isError && (
					<div className={`flex items-center justify-center h-20 text-red-500 text-xs`}>
						Failed to load command history
					</div>
				)}

				{/* Empty state */}
				{!isLoading && !isError && workers.length === 0 && (
					<div className={`flex items-center justify-center h-20 ${MUT} text-xs`}>
						No workers running
					</div>
				)}

				{/* No commands state */}
				{!isLoading && !isError && workers.length > 0 && filteredCommands.length === 0 && commands.length === 0 && (
					<div className={`flex items-center justify-center h-20 ${MUT} text-xs italic`}>
						No commands executed yet
					</div>
				)}

				{/* Filtered empty state */}
				{!isLoading && !isError && workers.length > 0 && filteredCommands.length === 0 && commands.length > 0 && (
					<div className={`flex items-center justify-center h-20 ${MUT} text-xs italic`}>
						No commands match the current filters
					</div>
				)}

				{/* Command list (grouped by workspace) */}
				{filteredCommands.length > 0 && (
					<>
						{/* Group commands by workspace and render with headers */}
						{(() => {
							const grouped = new Map<string, CommandTimelineEntry[]>();
							for (const cmd of filteredCommands) {
								const group = grouped.get(cmd.workspaceId) ?? [];
								group.push(cmd);
								grouped.set(cmd.workspaceId, group);
							}

							const rows: React.ReactNode[] = [];
							for (const [wsId, cmds] of grouped) {
								// Workspace group header
								const worker = workers.find((w) => w.id === wsId);
								const stageColors: Record<string, string> = {
									active: "text-emerald-600 dark:text-emerald-400",
									pending: "text-stone-400 dark:text-stone-500",
									blocked: "text-amber-600 dark:text-amber-400",
									complete: "text-blue-700 dark:text-blue-300",
									failed: "text-red-600 dark:text-red-400",
								};
								const stageColor = stageColors[worker?.stage ?? ""] ?? MUT;

								rows.push(
									<div
										key={`group-${wsId}`}
										className={`flex items-center gap-1.5 px-3 py-1 border-b ${BORD} bg-stone-50 dark:bg-[#1A1A1A]`}
									>
										<span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stageColor.replace("text-", "bg-")}`} />
										<span className={`text-xs font-semibold uppercase tracking-wider ${MUT}`}>
											{wsId}
										</span>
										<span className={`text-xs ${stageColor}`}>
											({worker?.stage ?? "unknown"})
										</span>
										<span className={`text-xs ${MUT}`}>
											{cmds.length} command{cmds.length !== 1 ? "s" : ""}
										</span>
									</div>,
								);

								// Command rows
								for (const cmd of cmds) {
									const isSelected = selectedCommand?.command === cmd.command &&
										selectedCommand?.workspaceId === cmd.workspaceId &&
										selectedCommand?.startedAt === cmd.startedAt;

									rows.push(
										<CommandRow
											key={`${cmd.workspaceId}-${cmd.command}-${cmd.startedAt}`}
											entry={cmd}
											isSelected={isSelected}
											onClick={() => setSelectedCommand(isSelected ? null : cmd)}
										/>,
									);

									// Detail panel for selected command
									if (isSelected) {
										rows.push(
											<CommandDetailPanel
												key={`detail-${cmd.workspaceId}-${cmd.command}-${cmd.startedAt}`}
												entry={cmd}
												onClose={() => setSelectedCommand(null)}
											/>,
										);
									}
								}
							}

							return rows;
						})()}
					</>
				)}
			</div>

			{/* ── Footer status bar ── */}
			{workers.length > 0 && (
				<div className={`shrink-0 flex items-center justify-between px-3 py-1 h-7 border-t ${BORD} bg-stone-50 dark:bg-[#1A1A1A] text-xs ${MUT}`}>
					<span>
						{workers.length} worker{workers.length !== 1 ? "s" : ""}
						{!isLoading && ` · ${commands.length} total command${commands.length !== 1 ? "s" : ""}`}
					</span>
					<span>
						{filters.showRawOutput ? "Raw output" : "Timeline"}
						{filters.targetCommandsOnly ? " · Target only" : ""}
						{filters.workspaceId ? ` · ${filters.workspaceId}` : ""}
					</span>
				</div>
			)}
		</div>
	);
}
