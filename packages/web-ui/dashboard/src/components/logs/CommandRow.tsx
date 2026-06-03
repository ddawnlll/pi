/**
 * CommandRow — Single command row in the command timeline (P42.08).
 *
 * Displays:
 * - Workspace ID (truncated)
 * - Command text (truncated)
 * - Duration
 * - Exit code
 * - Status icon (color-coded)
 * - Expand chevron (when detail available)
 */

import { CheckCircle, XCircle, Loader2, ChevronRight } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import type { CommandTimelineEntry } from "../../hooks/useCommandTimeline";

// ─── tokens ──────────────────────────────────────────────────────────────────


// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(startedAt: number, finishedAt: number): string {
	const ms = finishedAt - startedAt;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return `${mins}m${secs}s`;
}

/** Truncate long strings to fit the row. */
function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return str.slice(0, max - 1) + "\u2026";
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface CommandRowProps {
	entry: CommandTimelineEntry;
	isSelected: boolean;
	onClick: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandRow({ entry, isSelected, onClick }: CommandRowProps) {
	const isRunning = entry.exitCode === null;
	const isSuccess = entry.exitCode === 0;
	const isFailed = entry.exitCode !== null && entry.exitCode !== 0;

	const duration = formatDuration(entry.startedAt, entry.finishedAt);

	const statusColor = isRunning
		? "text-blue-500 dark:text-blue-400"
		: isSuccess
			? "text-emerald-500 dark:text-emerald-400"
			: "text-red-500 dark:text-red-400";

	const rowBg = isSelected
		? "bg-blue-50 dark:bg-blue-900/20"
		: "hover:bg-stone-50 dark:hover:bg-[#222]";

	return (
		<button
			onClick={onClick}
			className={`flex items-center gap-2 px-3 py-1.5 text-xs w-full text-left transition-colors group ${rowBg} border-b ${BORD} border-transparent hover:border-stone-200 dark:hover:border-[#E8E6E1] dark:border-[#333]`}
		>
			{/* Status icon */}
			<span className={`shrink-0 ${statusColor}`}>
				{isRunning ? (
					<Loader2 size={12} className="animate-spin" />
				) : isSuccess ? (
					<CheckCircle size={12} />
				) : (
					<XCircle size={12} />
				)}
			</span>

			{/* Workspace ID */}
			<span className={`shrink-0 w-20 font-mono text-xs ${MUT} truncate`}>
				{truncate(entry.workspaceId, 10)}
			</span>

			{/* Command text */}
			<span className={`flex-1 font-mono ${TXT} truncate`}>
				{entry.command}
			</span>

			{/* Target command badge */}
			{entry.isTargetCommand && (
				<span className="shrink-0 px-1 py-px rounded text-xs font-semibold uppercase bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
					Target
				</span>
			)}

			{/* Duration */}
			<span className={`shrink-0 w-14 text-right tabular-nums text-xs ${MUT}`}>
				{duration}
			</span>

			{/* Exit code */}
			<span className={`shrink-0 w-14 text-right tabular-nums font-mono text-xs ${
				isRunning ? MUT : isSuccess ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
			}`}>
				{isRunning ? "\u2014" : `exit ${entry.exitCode}`}
			</span>

			{/* Chevron */}
			<ChevronRight size={10} className={`shrink-0 ${MUT} transition-transform ${isSelected ? "rotate-90" : ""}`} />
		</button>
	);
}
