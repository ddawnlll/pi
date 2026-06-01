/**
 * MissionControlHero — Execution overview hero state machine (P42.04).
 *
 * Shows current plan state with appropriate tone, risk level, metrics,
 * and recommended next actions. Covers all states:
 *   loading, onTrack, blocked, stalled, failed, paused, complete,
 *   stopped, timeCritical, error
 *
 * Raw events are hidden behind a debug expand control.
 */

import { useState } from "react";
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Loader2,
	PauseCircle,
	Play,
	StopCircle,
	XCircle,
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	Terminal,
} from "lucide-react";
import type { PlanExecutionStatus, JournalEvent } from "../../types";

// ─── Hero state types ──────────────────────────────────────────────────────

export type HeroState =
	| "loading"
	| "onTrack"
	| "blocked"
	| "stalled"
	| "failed"
	| "paused"
	| "complete"
	| "stopped"
	| "timeCritical"
	| "error";

export interface HeroActions {
	onPause?: () => void;
	onResume?: () => void;
	onStop?: () => void;
	onOpenBottleneck?: () => void;
	onSendDirective?: () => void;
	onViewEvidence?: () => void;
}

export interface MissionControlHeroProps {
	/** Current hero state */
	state: HeroState;
	/** Plan status from API */
	planStatus?: PlanExecutionStatus;
	/** Active worker count */
	activeWorkerCount?: number;
	/** Blocked worker count */
	blockedWorkerCount?: number;
	/** Completed worker count */
	completeWorkerCount?: number;
	/** Total worker count */
	totalWorkerCount?: number;
	/** Estimated time remaining in minutes */
	estimatedTimeRemaining?: number;
	/** Last heartbeat timestamp */
	lastHeartbeat?: number;
	/** Whether there are active escalations */
	hasActiveEscalations?: boolean;
	/** Whether the hero is in a debug/expanded mode showing raw events */
	/** Raw events for debug view */
	rawEvents?: JournalEvent[];
	/** Progress percentage (0-100) */
	progressPercent?: number;
	/** Human-readable progress description */
	progressLabel?: string;
	/** Error message for error state */
	errorMessage?: string;
	/** Stalled workspace IDs */
	stalledWorkspaceIds?: string[];
	/** Actions */
	actions?: HeroActions;
	/** Additional class name */
	className?: string;
}

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── State configs ─────────────────────────────────────────────────────────

interface StateConfig {
	icon: React.ElementType;
	title: string;
	description: string;
	tone: "neutral" | "warning" | "danger" | "success" | "info";
	accentColor: string;
	accentBg: string;
	showProgress: boolean;
	showActions: boolean;
}

function getStateConfig(state: HeroState): StateConfig {
	switch (state) {
		case "loading":
			return {
				icon: Loader2,
				title: "Loading execution data...",
				description: "Fetching current plan execution state",
				tone: "info",
				accentColor: "text-blue-600 dark:text-blue-400",
				accentBg: "bg-blue-50 dark:bg-blue-950/30",
				showProgress: false,
				showActions: false,
			};
		case "onTrack":
			return {
				icon: Activity,
				title: "Execution on track",
				description: "All workspaces progressing normally",
				tone: "success",
				accentColor: "text-emerald-600 dark:text-emerald-400",
				accentBg: "bg-emerald-50 dark:bg-emerald-950/30",
				showProgress: true,
				showActions: true,
			};
		case "blocked":
			return {
				icon: AlertTriangle,
				title: "Workspaces blocked",
				description: "One or more workspaces are blocked and need attention",
				tone: "warning",
				accentColor: "text-amber-600 dark:text-amber-400",
				accentBg: "bg-amber-50 dark:bg-amber-950/30",
				showProgress: true,
				showActions: true,
			};
		case "stalled":
			return {
				icon: Clock,
				title: "Workspaces stalled",
				description: "One or more workspaces have stopped responding",
				tone: "warning",
				accentColor: "text-orange-600 dark:text-orange-400",
				accentBg: "bg-orange-50 dark:bg-orange-950/30",
				showProgress: true,
				showActions: true,
			};
		case "failed":
			return {
				icon: XCircle,
				title: "Execution failed",
				description: "Plan execution encountered a failure",
				tone: "danger",
				accentColor: "text-red-600 dark:text-red-400",
				accentBg: "bg-red-50 dark:bg-red-950/30",
				showProgress: true,
				showActions: true,
			};
		case "paused":
			return {
				icon: PauseCircle,
				title: "Execution paused",
				description: "Plan execution has been paused by user or system",
				tone: "info",
				accentColor: "text-blue-600 dark:text-blue-400",
				accentBg: "bg-blue-50 dark:bg-blue-950/30",
				showProgress: false,
				showActions: true,
			};
		case "complete":
			return {
				icon: CheckCircle2,
				title: "Execution complete",
				description: "All workspaces completed successfully",
				tone: "success",
				accentColor: "text-emerald-600 dark:text-emerald-400",
				accentBg: "bg-emerald-50 dark:bg-emerald-950/30",
				showProgress: true,
				showActions: false,
			};
		case "stopped":
			return {
				icon: StopCircle,
				title: "Execution stopped",
				description: "Plan execution was stopped by user",
				tone: "neutral",
				accentColor: "text-stone-600 dark:text-stone-400",
				accentBg: "bg-stone-50 dark:bg-stone-950/30",
				showProgress: false,
				showActions: false,
			};
		case "timeCritical":
			return {
				icon: AlertTriangle,
				title: "Running over budget",
				description: "Estimated time remaining exceeds configured budget",
				tone: "danger",
				accentColor: "text-red-600 dark:text-red-400",
				accentBg: "bg-red-50 dark:bg-red-950/30",
				showProgress: true,
				showActions: true,
			};
		case "error":
			return {
				icon: XCircle,
				title: "Connection error",
				description: "Unable to fetch execution data. Check connection and try again.",
				tone: "danger",
				accentColor: "text-red-600 dark:text-red-400",
				accentBg: "bg-red-50 dark:bg-red-950/30",
				showProgress: false,
				showActions: false,
			};
	}
}

// ─── Worker indicator ──────────────────────────────────────────────────────

function WorkerDots({
	active,
	blocked,
	complete,
	total,
}: {
	active: number;
	blocked: number;
	complete: number;
	total: number;
}) {
	const remaining = total - active - blocked - complete;
	return (
		<div className="flex items-center gap-1.5">
			{Array.from({ length: active }).map((_, i) => (
				<span
					key={`active-${i}`}
					className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
					title={`${active} active`}
				/>
			))}
			{Array.from({ length: blocked }).map((_, i) => (
				<span
					key={`blocked-${i}`}
					className="w-2 h-2 rounded-full bg-amber-500"
					title={`${blocked} blocked`}
				/>
			))}
			{Array.from({ length: complete }).map((_, i) => (
				<span
					key={`complete-${i}`}
					className="w-2 h-2 rounded-full bg-emerald-300 dark:bg-emerald-700"
					title={`${complete} complete`}
				/>
			))}
			{Array.from({ length: Math.max(0, remaining) }).map((_, i) => (
				<span
					key={`pending-${i}`}
					className="w-2 h-2 rounded-full bg-stone-200 dark:bg-stone-700"
					title={`${remaining} pending`}
				/>
			))}
		</div>
	);
}

// ─── Component ─────────────────────────────────────────────────────────────

export function MissionControlHero({
	state,
	planStatus,
	activeWorkerCount = 0,
	blockedWorkerCount = 0,
	completeWorkerCount = 0,
	totalWorkerCount = 0,
	estimatedTimeRemaining,
	lastHeartbeat,
	hasActiveEscalations = false,
	rawEvents = [],
	progressPercent = 0,
	progressLabel,
	errorMessage,
	stalledWorkspaceIds,
	actions,
	className = "",
}: MissionControlHeroProps) {
	const [debugExpanded, setDebugExpanded] = useState(false);
	const config = getStateConfig(state);
	const Icon = config.icon;

	const heartbeatAge = lastHeartbeat ? Math.floor((Date.now() - lastHeartbeat) / 1000) : null;
	const isStale = heartbeatAge !== null && heartbeatAge > 30;

	return (
		<div
			data-testid="mission-hero"
			role="region"
			aria-label="Execution overview"
			aria-live="polite"
			className={`rounded-xl border ${BORD} ${SURF} overflow-hidden ${className}`}
		>
			{/* Main hero content */}
			<div className="p-4">
				<div className="flex items-start gap-3">
					{/* Icon */}
					<div className={`p-2 rounded-lg ${config.accentBg} ${config.accentColor} shrink-0`}>
						<Icon
							size={18}
							className={state === "loading" ? "animate-spin" : ""}
						/>
					</div>

					{/* Content */}
					<div className="flex-1 min-w-0">
						{/* Title & risk */}
						<div className="flex items-center gap-2 flex-wrap">
							<h2 className={`text-sm font-semibold ${TXT}`}>{config.title}</h2>
							{hasActiveEscalations && (
								<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
									<AlertTriangle size={10} />
									Escalations
								</span>
							)}
							{isStale && (
								<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
									<Clock size={10} />
									Stale
								</span>
							)}
						</div>

						{/* Description */}
						<p className={`text-xs ${TXT_MUTED} mt-0.5`}>{config.description}</p>

						{/* Error message */}
						{state === "error" && errorMessage && (
							<p className="text-xs text-red-600 dark:text-red-400 mt-1 font-mono">
								{errorMessage}
							</p>
						)}

						{/* Stalled workspace IDs */}
						{state === "stalled" && stalledWorkspaceIds && stalledWorkspaceIds.length > 0 && (
							<p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
								Stalled: {stalledWorkspaceIds.join(", ")}
							</p>
						)}

						{/* Progress bar */}
						{config.showProgress && totalWorkerCount > 0 && (
							<div className="mt-3">
								<div className="flex items-center gap-2 mb-1">
									<WorkerDots
										active={activeWorkerCount}
										blocked={blockedWorkerCount}
										complete={completeWorkerCount}
										total={totalWorkerCount}
									/>
									<span className={`text-[10px] ${TXT_MUTED}`}>
										{progressLabel ?? `${activeWorkerCount} active · ${blockedWorkerCount} blocked · ${completeWorkerCount} complete`}
									</span>
								</div>
								{/* Progress bar */}
								<div className="w-full h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
									<div
										className={`h-full rounded-full transition-all duration-500 ${
											state === "failed" || state === "timeCritical"
												? "bg-red-500"
												: state === "blocked" || state === "stalled"
													? "bg-amber-500"
													: "bg-emerald-500"
										}`}
										style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
									/>
								</div>
								<div className="flex items-center justify-between mt-1">
									<span className={`text-[10px] ${TXT_MUTED}`}>
										{Math.round(progressPercent)}%
									</span>
									{estimatedTimeRemaining !== undefined && (
										<span className={`text-[10px] ${TXT_MUTED}`}>
											~{estimatedTimeRemaining}m remaining
										</span>
									)}
								</div>
							</div>
						)}

						{/* Heartbeat info */}
						{heartbeatAge !== null && (
							<p className={`text-[10px] mt-1 ${isStale ? "text-amber-500" : TXT_MUTED}`}>
								Last heartbeat: {heartbeatAge}s ago
							</p>
						)}
					</div>

					{/* Actions */}
					{config.showActions && actions && (
						<div className="flex items-center gap-1.5 shrink-0">
							{state === "paused" && actions.onResume && (
								<button
									onClick={actions.onResume}
									className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
									aria-label="Resume execution"
								>
									<Play size={12} />
									Resume
								</button>
							)}
							{(state === "onTrack" || state === "blocked" || state === "stalled" || state === "timeCritical") && actions.onPause && (
								<button
									onClick={actions.onPause}
									className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
									aria-label="Pause execution"
								>
									<PauseCircle size={12} />
									Pause
								</button>
							)}
							{(state === "onTrack" || state === "blocked" || state === "stalled" || state === "timeCritical" || state === "paused") && actions.onStop && (
								<button
									onClick={actions.onStop}
									className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
									aria-label="Stop execution"
								>
									<StopCircle size={12} />
									Stop
								</button>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Debug expand control */}
			{rawEvents.length > 0 && (
				<>
					<button
						onClick={() => setDebugExpanded(!debugExpanded)}
						className={`w-full flex items-center justify-between px-4 py-1.5 text-[10px] font-medium ${TXT_MUTED} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] border-t ${BORD} transition-colors`}
						aria-expanded={debugExpanded}
						aria-label={debugExpanded ? "Hide raw events" : "Show raw events"}
					>
						<span className="flex items-center gap-1">
							{debugExpanded ? <EyeOff size={11} /> : <Eye size={11} />}
							{debugExpanded ? "Hide raw events" : `Show raw events (${rawEvents.length})`}
						</span>
						{debugExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
					</button>

					{/* Raw events panel (debug) */}
					{debugExpanded && (
						<div className={`max-h-48 overflow-y-auto border-t ${BORD} bg-stone-50 dark:bg-[#161616] p-2 space-y-1`}>
							{rawEvents.map((event, i) => (
								<div
									key={`${event.timestamp}-${i}`}
									className="flex items-start gap-2 text-[10px] font-mono text-stone-500 dark:text-stone-500"
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
									<Terminal size={10} className="shrink-0 mt-0.5 text-stone-400" />
								</div>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
