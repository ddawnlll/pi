import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, Pause, ArrowDown, Sparkles, Cpu } from "lucide-react";
import type { JournalEvent, WorkerInfo } from "../types";
import {
	useLiveLogTerminal,
	LOG_CHANNELS,
	CHANNEL_LABELS,
	CHANNEL_COLORS,
	type LogChannel,
	type LogEntry,
} from "../hooks/useLiveLogTerminal";

// ─── tokens ──────────────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Log line renderer ────────────────────────────────────────────────────────

/** Renders a single log entry with channel-appropriate styling and fade-in animation. */
function LogLine({ entry, index }: { entry: LogEntry; index: number }) {
	const colors = CHANNEL_COLORS[entry.channel];
	const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

	// Animate new entries with a staggered fade-in for the last 50 entries
	const isRecent = index < 50;

	return (
		<div
			className={`flex items-start gap-2 px-3 py-0.5 hover:bg-stone-50 dark:hover:bg-[#222] group transition-colors ${
				isRecent ? "animate-log-fade-in" : ""
			}`}
			style={isRecent ? { animationDelay: `${Math.min((index % 20) * 15, 300)}ms` } : undefined}
		>
			<span className="shrink-0 text-[10px] font-mono text-stone-400 dark:text-stone-500 w-16 select-none">
				{time}
			</span>
			<span
				className={`shrink-0 px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wide ${colors.text} ${colors.bg}`}
			>
				{entry.channel}
			</span>
			<span className="flex-1 text-xs font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap break-words leading-relaxed">
				{entry.text}
			</span>
		</div>
	);
}

// ─── Worker tab ───────────────────────────────────────────────────────────────

/** A single worker tab in the worker switcher strip. */
function WorkerTab({
	worker,
	isSelected,
	lineCount,
	onClick,
}: {
	worker: WorkerInfo;
	isSelected: boolean;
	lineCount: number;
	onClick: () => void;
}) {
	const stageColors: Record<string, string> = {
		active: "border-emerald-500 dark:border-emerald-400",
		pending: "border-stone-300 dark:border-stone-600",
		blocked: "border-amber-500 dark:border-amber-400",
		complete: "border-blue-500 dark:border-blue-400",
		failed: "border-red-500 dark:border-red-400",
	};
	const dotColors: Record<string, string> = {
		active: "bg-emerald-500 dark:bg-emerald-400",
		pending: "bg-stone-300 dark:bg-stone-600",
		blocked: "bg-amber-500 dark:bg-amber-400",
		complete: "bg-blue-500 dark:bg-blue-400",
		failed: "bg-red-500 dark:bg-red-400",
	};

	const borderClass = stageColors[worker.stage] ?? stageColors.pending;
	const dotClass = dotColors[worker.stage] ?? dotColors.pending;

	return (
		<button
			onClick={onClick}
			className={`relative flex items-center gap-2 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
				isSelected
					? `${borderClass} ${TXT} bg-stone-50 dark:bg-[#1A1A1A]`
					: `border-transparent ${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-[#222]`
			}`}
			title={`Worker: ${worker.id} (${worker.stage})`}
		>
			<span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
			<span className="truncate max-w-[120px]">{worker.id}</span>
			{lineCount > 0 && (
				<span className="text-[9px] text-stone-400 dark:text-stone-500 tabular-nums">
					{lineCount > 999 ? `${Math.floor(lineCount / 1000)}k` : lineCount}
				</span>
			)}
		</button>
	);
}

// ─── Channel filter pill ──────────────────────────────────────────────────────

function ChannelPill({
	channel,
	isActive,
	onClick,
}: {
	channel: LogChannel;
	isActive: boolean;
	onClick: () => void;
}) {
	const colors = CHANNEL_COLORS[channel];
	return (
		<button
			onClick={onClick}
			className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${
				isActive
					? `${colors.bg} ${colors.text} ring-1 ring-current/20`
					: `bg-stone-100 dark:bg-[#2A2A2A] text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-[#333]`
			}`}
		>
			{CHANNEL_LABELS[channel]}
		</button>
	);
}

// ─── LiveLogTerminal component ────────────────────────────────────────────────

interface LiveLogTerminalProps {
	/** Workers to show in the tab switcher. */
	workers: WorkerInfo[];
	/** Real journal events from SSE plan events stream. */
	planEvents?: JournalEvent[];
	/** Optional class name for outer container. */
	className?: string;
}

/**
 * Dashboard live log terminal with worker switching, channel filtering,
 * auto-scroll with pause, and capped log entries for performance.
 *
 * Acceptance criteria covered:
 * - Dashboard shows live logs for active workspace
 * - User can switch between active workers
 * - Logs show stdout/stderr/test/tool/action/errors channels
 * - Auto-scroll can be paused
 * - UI remains responsive with capped logs
 */
export function LiveLogTerminal({ workers, planEvents, className }: LiveLogTerminalProps) {
	const {
		filteredLogs,
		activeChannel,
		setActiveChannel,
		selectedWorkerId,
		setSelectedWorkerId,
		autoScroll,
		setAutoScroll,
		logCounts,
	} = useLiveLogTerminal(workers, planEvents);

	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const userScrolledUpRef = useRef(false);

	// Detect user manual scroll-up: if >40px from bottom, user scrolled up
	const handleScroll = useCallback(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const { scrollTop, scrollHeight, clientHeight } = el;
		const isNearBottom = scrollHeight - scrollTop - clientHeight <= 40;

		// If user scrolls near bottom, re-enable auto-scroll
		if (isNearBottom && !autoScroll) {
			setAutoScroll(true);
		} else if (!isNearBottom && autoScroll) {
			setAutoScroll(false);
		}
		userScrolledUpRef.current = !isNearBottom;
	}, [autoScroll, setAutoScroll]);

	// Auto-scroll to bottom when new lines arrive (if auto-scroll is on)
	useEffect(() => {
		if (autoScroll && scrollContainerRef.current) {
			scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
		}
	}, [filteredLogs.length, autoScroll]);

	// Scroll to bottom on worker switch
	useEffect(() => {
		if (scrollContainerRef.current) {
			scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
		}
	}, [selectedWorkerId]);

	const selectedWorker = workers.find(w => w.id === selectedWorkerId);

	return (
		<div className={`flex flex-col h-full ${SURF} border ${BORD} rounded-lg overflow-hidden ${className ?? ""}`}>
			{/* ── Header ── */}
			<div className={`shrink-0 flex items-center justify-between px-3 h-9 border-b ${BORD} bg-stone-50 dark:bg-[#1A1A1A]`}>
				<div className="flex items-center gap-2">
					<Terminal size={13} strokeWidth={1.8} className={MUT} />
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Live Logs
					</span>
					{selectedWorkerId && (
						<span className="text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">
							{filteredLogs.length} line{filteredLogs.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					{/* Auto-scroll toggle */}
					<button
						onClick={() => {
							const next = !autoScroll;
							setAutoScroll(next);
							if (next && scrollContainerRef.current) {
								scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
							}
						}}
						className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded font-medium transition-colors ${
							autoScroll
								? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
								: "bg-stone-100 dark:bg-[#333] text-stone-500 dark:text-stone-400"
						}`}
						title={autoScroll ? "Auto-scroll enabled — click to pause" : "Auto-scroll paused — click to resume"}
					>
						{autoScroll ? <ArrowDown size={10} /> : <Pause size={10} />}
						{autoScroll ? "Auto" : "Paused"}
					</button>
				</div>
			</div>

			{/* ── Worker switcher tabs ── */}
			<div className={`shrink-0 flex items-center border-b ${BORD} overflow-x-auto`}>
				{workers.map(worker => (
					<WorkerTab
						key={worker.id}
						worker={worker}
						isSelected={worker.id === selectedWorkerId}
						lineCount={logCounts[worker.id] ?? 0}
						onClick={() => setSelectedWorkerId(worker.id)}
					/>
				))}
				{workers.length === 0 && (
					<span className={`px-3 py-1.5 text-xs ${MUT}`}>No workers</span>
				)}
			</div>

			{/* ── Channel filter pills ── */}
			<div className={`shrink-0 flex items-center gap-1 px-3 py-1.5 border-b ${BORD} bg-stone-50/50 dark:bg-[#1A1A1A]/50`}>
				<button
					onClick={() => setActiveChannel(null)}
					className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${
						activeChannel === null
							? "bg-stone-200 dark:bg-[#444] text-stone-800 dark:text-stone-200"
							: "bg-stone-100 dark:bg-[#2A2A2A] text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-[#333]"
					}`}
				>
					All
				</button>
				{LOG_CHANNELS.map(channel => (
					<ChannelPill
						key={channel}
						channel={channel}
						isActive={activeChannel === channel}
						onClick={() =>
							setActiveChannel(activeChannel === channel ? null : channel)
						}
					/>
				))}
			</div>

			{/* ── Scrollable log content ── */}
			<div
				ref={scrollContainerRef}
				onScroll={handleScroll}
				className="flex-1 min-h-0 overflow-y-auto bg-[#0D0D0D] dark:bg-[#0A0A0A]"
			>
				{!selectedWorkerId && (
					<div className="flex items-center justify-center h-full text-stone-500 dark:text-stone-600 text-xs">
						Select a worker to view logs
					</div>
				)}
				{selectedWorkerId && filteredLogs.length === 0 && (
					<div className="flex items-center justify-center h-full text-stone-500 dark:text-stone-600 text-xs italic">
						No logs for {selectedWorkerId}
						{activeChannel ? ` on ${activeChannel} channel` : ""} yet...
					</div>
				)}
				{filteredLogs.map((entry, i) => (
					<LogLine key={entry.id} entry={entry} index={i} />
				))}
			</div>

			{/* ── Scroll-to-bottom FAB when paused ── */}
			{!autoScroll && selectedWorkerId && filteredLogs.length > 0 && (
				<div className="relative">
					<button
						onClick={() => {
							setAutoScroll(true);
							if (scrollContainerRef.current) {
								scrollContainerRef.current.scrollTop =
									scrollContainerRef.current.scrollHeight;
							}
						}}
						className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-blue-600 text-white text-[10px] font-medium shadow-lg hover:bg-blue-500 transition-colors z-10"
					>
						<ArrowDown size={10} /> Resume auto-scroll
					</button>
				</div>
			)}

			{/* ── Footer status bar ── */}
			{selectedWorkerId && (
				<div className={`shrink-0 flex items-center justify-between px-3 py-1 h-7 border-t ${BORD} bg-stone-50 dark:bg-[#1A1A1A] text-[9px] ${MUT}`}>
					<span className="flex items-center gap-1.5">
						{selectedWorker?.stage === "active" && (
							<>
								<Cpu size={9} className="text-emerald-500 animate-spin-slow shrink-0" />
								<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
							</>
						)}
						{selectedWorker?.stage === "blocked" && (
							<span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
						)}
						{selectedWorker?.stage === "failed" && (
							<span className="w-1.5 h-1.5 rounded-full bg-red-500" />
						)}
						{selectedWorker?.stage === "complete" && (
							<>
								<Sparkles size={9} className="text-blue-500 shrink-0" />
								<span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
							</>
						)}
						{selectedWorker?.stage === "pending" && (
							<span className="w-1.5 h-1.5 rounded-full bg-stone-300 dark:bg-stone-600" />
						)}
						<span>
							{selectedWorkerId} &middot; {selectedWorker?.stage ?? "unknown"}
							{selectedWorker?.stage === "active" && (
								<span className="ml-1.5 inline-flex items-center gap-[2px]">
									<span className="w-1 h-1 rounded-full bg-emerald-400 animate-thinking-dot-1" />
									<span className="w-1 h-1 rounded-full bg-emerald-400 animate-thinking-dot-2" />
									<span className="w-1 h-1 rounded-full bg-emerald-400 animate-thinking-dot-3" />
								</span>
							)}
						</span>
					</span>
					<span className="tabular-nums">
						{filteredLogs.length} / {logCounts[selectedWorkerId] ?? 0} lines
						{activeChannel ? ` [${activeChannel}]` : ""}
					</span>
				</div>
			)}
		</div>
	);
}
