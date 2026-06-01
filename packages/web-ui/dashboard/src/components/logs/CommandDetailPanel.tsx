/**
 * CommandDetailPanel — Detail panel for a selected command (P42.08).
 *
 * Shows:
 * - Header: command name, workspace, duration, exit code
 * - Metadata: is target command, matched validation
 * - stdout section (when available)
 * - stderr section (when available)
 * - Links to related views
 */

import { X, Clock, Target, Terminal, AlertTriangle } from "lucide-react";
import type { CommandTimelineEntry } from "../../hooks/useCommandTimeline";

// ─── tokens ──────────────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(startedAt: number, finishedAt: number): string {
	const ms = finishedAt - startedAt;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return `${mins}m${secs}s`;
}

function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface CommandDetailPanelProps {
	entry: CommandTimelineEntry;
	onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandDetailPanel({ entry, onClose }: CommandDetailPanelProps) {
	const isRunning = entry.exitCode === null;
	const isSuccess = entry.exitCode === 0;
	const isFailed = entry.exitCode !== null && entry.exitCode !== 0;

	const statusColor = isRunning
		? "text-blue-500 dark:text-blue-400"
		: isSuccess
			? "text-emerald-500 dark:text-emerald-400"
			: "text-red-500 dark:text-red-400";

	const duration = formatDuration(entry.startedAt, entry.finishedAt);

	return (
		<div className={`flex flex-col ${SURF} border-b ${BORD}`}>
			{/* ── Header ── */}
			<div className={`flex items-center justify-between px-3 py-2 border-b ${BORD} bg-stone-50 dark:bg-[#1A1A1A]`}>
				<div className="flex items-center gap-2 min-w-0">
					<Terminal size={12} className={`shrink-0 ${MUT}`} />
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Command Detail
					</span>
				</div>
				<button
					onClick={onClose}
					className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300`}
				>
					<X size={12} />
				</button>
			</div>

			{/* ── Command Info ── */}
			<div className="px-3 py-2 space-y-1.5">
				{/* Command name */}
				<div>
					<span className={`text-[9px] uppercase tracking-wider ${MUT}`}>Command</span>
					<p className={`text-xs font-mono ${TXT} break-all`}>{entry.command}</p>
				</div>

				{/* Metadata row */}
				<div className="flex gap-4 flex-wrap">
					<div>
						<span className={`text-[9px] uppercase tracking-wider ${MUT}`}>Workspace</span>
						<p className={`text-xs font-mono ${TXT}`}>{entry.workspaceId}</p>
					</div>
					<div>
						<span className={`text-[9px] uppercase tracking-wider ${MUT}`}>CWD</span>
						<p className={`text-xs font-mono ${TXT} truncate max-w-[200px]`}>{entry.cwd}</p>
					</div>
					<div>
						<span className={`text-[9px] uppercase tracking-wider ${MUT}`}>Exit Code</span>
						<p className={`text-xs font-mono ${statusColor}`}>
							{isRunning ? "\u2014" : entry.exitCode}
						</p>
					</div>
					<div>
						<span className={`text-[9px] uppercase tracking-wider ${MUT}`}>Duration</span>
						<p className={`text-xs font-mono ${MUT}`}>{duration}</p>
					</div>
				</div>

				{/* Timestamps */}
				<div className="flex gap-4 flex-wrap">
					<div>
						<span className={`text-[9px] uppercase tracking-wider ${MUT}`}>Started</span>
						<p className={`text-xs font-mono ${MUT}`}>{formatTimestamp(entry.startedAt)}</p>
					</div>
					<div>
						<span className={`text-[9px] uppercase tracking-wider ${MUT}`}>Finished</span>
						<p className={`text-xs font-mono ${MUT}`}>{isRunning ? "\u2014" : formatTimestamp(entry.finishedAt)}</p>
					</div>
				</div>

				{/* Target command badge */}
				{entry.isTargetCommand && (
					<div className={`flex items-center gap-1.5 text-xs ${MUT}`}>
						<Target size={10} className="text-purple-500" />
						<span className="text-purple-600 dark:text-purple-400 font-medium">Target command</span>
					</div>
				)}
			</div>

			{/* ── Output Summary ── */}
			{entry.outputSummary && (
				<div className="px-3 py-2 border-t border-stone-100 dark:border-[#2A2A2A]">
					<span className={`text-[9px] uppercase tracking-wider ${MUT} block mb-1`}>
						Output Summary
					</span>
					<p className={`text-[10px] font-mono ${TXT} whitespace-pre-wrap break-words max-h-32 overflow-y-auto`}>
						{entry.outputSummary}
					</p>
				</div>
			)}

			{/* ── Stdout / Stderr placeholders ── */}
			{isFailed && (
				<div className={`px-3 py-2 border-t ${BORD} flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400`}>
					<AlertTriangle size={10} />
					<span>Full stdout/stderr available via raw log view. Toggle "Raw output" to inspect.</span>
				</div>
			)}

			{/* ── Footer links ── */}
			<div className={`px-3 py-2 border-t ${BORD} flex gap-3`}>
				<button className={`text-[10px] text-blue-600 dark:text-blue-400 hover:underline`}>
					View in workspace detail &rarr;
				</button>
			</div>
		</div>
	);
}
