/**
 * PriorityFeed — Priority-ranked event feed (P42.04).
 *
 * Groups events into three sections:
 *   ATTENTION — high-severity events (failures, blockers, escalations)
 *   ACTIVE — running/in-progress events
 *   RECENT — recent completed events
 *
 * Raw events are hidden behind a debug expand control.
 */

import { useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Eye,
	EyeOff,
	Info,
	Loader2,
	MessageSquare,
	RefreshCw,
	Terminal,
	XCircle,
} from "lucide-react";
import type { JournalEvent } from "../../types";

// ─── Style tokens ──────────────────────────────────────────────────────────

const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PriorityFeedEvent {
	/** Unique event ID */
	id: string;
	/** Event type */
	type: string;
	/** Severity level */
	severity: "attention" | "active" | "recent";
	/** Human-readable message */
	message: string;
	/** Workspace ID if applicable */
	workspaceId?: string;
	/** Timestamp */
	timestamp: number;
	/** Raw journal event for debug view */
	rawEvent?: JournalEvent;
}

export interface PriorityFeedProps {
	/** Events sorted by priority */
	events: PriorityFeedEvent[];
	/** Callback when an event is clicked */
	onEventClick?: (event: PriorityFeedEvent) => void;
	/** Loading state */
	loading?: boolean;
	/** Additional class name */
	className?: string;
	/** Max events to show per section */
	maxPerSection?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function eventIcon(type: string, severity: string) {
	const lower = type.toLowerCase();
	if (lower.includes("fail") || lower.includes("error")) {
		return <XCircle size={12} className="text-red-500 shrink-0" />;
	}
	if (lower.includes("block") || lower.includes("escalat")) {
		return <AlertTriangle size={12} className="text-amber-500 shrink-0" />;
	}
	if (lower.includes("complete") || lower.includes("done")) {
		return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />;
	}
	if (lower.includes("run") || lower.includes("start") || lower.includes("active")) {
		return <Loader2 size={12} className="text-blue-500 animate-spin shrink-0" />;
	}
	if (lower.includes("retry")) {
		return <RefreshCw size={12} className="text-amber-500 shrink-0" />;
	}
	if (lower.includes("directive") || lower.includes("message")) {
		return <MessageSquare size={12} className="text-blue-500 shrink-0" />;
	}
	if (severity === "attention") {
		return <AlertTriangle size={12} className="text-amber-500 shrink-0" />;
	}
	if (severity === "active") {
		return <Activity size={12} className="text-blue-500 shrink-0" />;
	}
	return <Info size={12} className={TXT_MUTED} />;
}

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Section ───────────────────────────────────────────────────────────────

interface SectionProps {
	label: string;
	icon: React.ElementType;
	color: string;
	events: PriorityFeedEvent[];
	maxVisible: number;
	onEventClick?: (event: PriorityFeedEvent) => void;
	emptyMessage?: string;
}

function FeedSection({
	label,
	icon: Icon,
	color,
	events,
	maxVisible,
	onEventClick,
	emptyMessage,
}: SectionProps) {
	const [expanded, setExpanded] = useState(false);
	const visible = expanded ? events : events.slice(0, maxVisible);
	const hasMore = events.length > maxVisible;

	return (
		<div>
			<div className={`flex items-center gap-1.5 px-3 py-1.5 border-b ${BORD}`}>
				<Icon size={11} className={color} />
				<span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>
					{label}
				</span>
				<span className={`text-xs ${TXT_MUTED}`}>({events.length})</span>
			</div>

			{events.length === 0 ? (
				<div className="px-3 py-4 text-center">
					<p className={`text-xs ${TXT_MUTED}`}>{emptyMessage ?? "No events"}</p>
				</div>
			) : (
				<div className="divide-y divide-stone-50 dark:divide-stone-800">
					{visible.map((event) => (
						<button
							key={event.id}
							onClick={() => onEventClick?.(event)}
							className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors"
							aria-label={`${event.type}: ${event.message}`}
						>
							{eventIcon(event.type, event.severity)}
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5">
									<span className={`text-xs ${TXT} truncate`}>
										{event.message}
									</span>
								</div>
								<div className="flex items-center gap-2 mt-0.5">
									{event.workspaceId && (
										<span className={`text-xs font-mono ${TXT_MUTED}`}>
											{event.workspaceId.length > 12
												? `${event.workspaceId.slice(0, 8)}..`
												: event.workspaceId}
										</span>
									)}
									<span className={`text-xs ${TXT_MUTED}`}>
										{relativeTime(event.timestamp)}
									</span>
								</div>
							</div>
						</button>
					))}
				</div>
			)}

			{hasMore && (
				<button
					onClick={() => setExpanded(!expanded)}
					className={`w-full flex items-center justify-center gap-1 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 border-t ${BORD} transition-colors`}
					aria-expanded={expanded}
				>
					{expanded ? (
						<>Show less <ChevronDown size={10} /></>
					) : (
						<>Show {events.length - maxVisible} more <ChevronDown size={10} /></>
					)}
				</button>
			)}
		</div>
	);
}

// ─── Component ─────────────────────────────────────────────────────────────

export function PriorityFeed({
	events,
	onEventClick,
	loading = false,
	className = "",
	maxPerSection = 5,
}: PriorityFeedProps) {
	const [debugExpanded, setDebugExpanded] = useState(false);

	if (loading) {
		return (
			<div className={`rounded-lg border ${BORD} ${SURF} ${className}`} role="status" aria-label="Loading events">
				<div className="p-4 space-y-3">
					{[...Array(4)].map((_, i) => (
						<div key={i} className="h-8 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
					))}
				</div>
			</div>
		);
	}

	const attentionEvents = events.filter((e) => e.severity === "attention");
	const activeEvents = events.filter((e) => e.severity === "active");
	const recentEvents = events.filter((e) => e.severity === "recent");

	const rawJournalEvents = events
		.filter((e) => e.rawEvent)
		.map((e) => e.rawEvent!);

	return (
		<div className={`rounded-lg border ${BORD} ${SURF} overflow-hidden ${className}`} role="region" aria-label="Priority events" aria-live="polite">
			{events.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-8 gap-2">
					<Activity size={20} className="text-stone-300 dark:text-stone-600" />
					<p className={`text-xs ${TXT_MUTED}`}>No events yet</p>
				</div>
			) : (
				<>
					<FeedSection
						label="Attention"
						icon={AlertTriangle}
						color="text-amber-600 dark:text-amber-400"
						events={attentionEvents}
						maxVisible={maxPerSection}
						onEventClick={onEventClick}
						emptyMessage="No attention-requiring events"
					/>
					<FeedSection
						label="Active"
						icon={Activity}
						color="text-blue-700 dark:text-blue-300"
						events={activeEvents}
						maxVisible={maxPerSection}
						onEventClick={onEventClick}
						emptyMessage="No active events"
					/>
					<FeedSection
						label="Recent"
						icon={Clock}
						color={TXT_MUTED}
						events={recentEvents}
						maxVisible={maxPerSection}
						onEventClick={onEventClick}
						emptyMessage="No recent events"
					/>
				</>
			)}

			{/* Debug: raw journal events */}
			{rawJournalEvents.length > 0 && (
				<>
					<button
						onClick={() => setDebugExpanded(!debugExpanded)}
						className={`w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium ${TXT_MUTED} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] border-t ${BORD} transition-colors`}
						aria-expanded={debugExpanded}
						aria-label={debugExpanded ? "Hide raw events" : "Show raw events"}
					>
						<span className="flex items-center gap-1">
							{debugExpanded ? <EyeOff size={10} /> : <Eye size={10} />}
							{debugExpanded ? "Hide raw events" : `Show raw events (${rawJournalEvents.length})`}
						</span>
						{debugExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
					</button>

					{debugExpanded && (
						<div className="max-h-40 overflow-y-auto bg-stone-50 dark:bg-[#161616] p-2 space-y-1">
							{rawJournalEvents.map((event, i) => (
								<div
									key={i}
									className="flex items-start gap-2 text-xs font-mono text-stone-500 dark:text-stone-500"
								>
									<span className="shrink-0 text-stone-400">
										{new Date(event.timestamp).toLocaleTimeString()}
									</span>
									<span className="font-medium text-stone-600 dark:text-stone-400">
										{event.type}
									</span>
									{event.workspaceId && (
										<span className="text-stone-400">{event.workspaceId}</span>
									)}
									<Terminal size={9} className="shrink-0 mt-0.5" />
								</div>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
