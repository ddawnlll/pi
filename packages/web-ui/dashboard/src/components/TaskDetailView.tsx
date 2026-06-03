/**
 * TaskDetailView — full task detail overview.
 *
 * Shows: header, origin, approval & policy, aggregates bar,
 * blocked reason (if blocked), phase timeline, reflection tab,
 * and live transcript panel.
 */

import React, { useState } from "react";
import {
	ArrowLeft,
	Play,
	Pause,
	Square,
	RefreshCw,
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
	Ban,
	ChevronDown,
	ChevronRight,
	AlertTriangle,
} from "lucide-react";
import type { MultiPhaseTask, PhasePlan, TimelineEvent } from "../types";
import { useTaskStats } from "../hooks/useTaskStats";
import { useTaskTimeline } from "../hooks/useTaskTimeline";
import { TaskAggregatesBar } from "./TaskAggregatesBar";
import { OriginCard } from "./OriginCard";
import { BlockedReasonPanel } from "./BlockedReasonPanel";

const API_BASE = "";

interface TaskDetailViewProps {
	task: MultiPhaseTask;
	projectId: string;
	onBack: () => void;
	onTaskUpdated?: (task: MultiPhaseTask) => void;
	onPhasePlanClick?: (planExecId: string) => void;
}

// ── Status badge helper ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
	const cfg: Record<string, { color: string; bg: string; label: string }> = {
		draft: { color: "text-stone-500 dark:text-stone-400", bg: "bg-white dark:bg-[#1E1E1E]", label: "Draft" },
		running: { color: "text-blue-300", bg: "bg-blue-900/30", label: "Running" },
		blocked: { color: "text-amber-300", bg: "bg-amber-900/30", label: "Blocked" },
		complete: { color: "text-emerald-300", bg: "bg-emerald-900/30", label: "Complete" },
		failed: { color: "text-red-300", bg: "bg-red-900/30", label: "Failed" },
		paused: { color: "text-yellow-300", bg: "bg-yellow-900/30", label: "Paused" },
		cancelled: { color: "text-stone-500 dark:text-stone-400", bg: "bg-white dark:bg-[#1E1E1E]", label: "Cancelled" },
		approval_required: { color: "text-purple-300", bg: "bg-purple-900/30", label: "Approval Required" },
		reflecting: { color: "text-purple-300", bg: "bg-purple-900/30", label: "Reflecting" },
		reflected: { color: "text-purple-300", bg: "bg-purple-900/30", label: "Reflected" },
	};
	const c = cfg[status] ?? { color: "text-stone-500 dark:text-stone-400", bg: "bg-white dark:bg-[#1E1E1E]", label: status };
	return (
		<span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${c.color} ${c.bg}`}>
			{c.label}
		</span>
	);
}

// ── Phase status icon ────────────────────────────────────────────────────

function PhaseIcon({ status }: { status: PhasePlan["status"] }) {
	switch (status) {
		case "complete":
			return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
		case "running":
			return <Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />;
		case "failed":
			return <XCircle size={14} className="text-red-400 shrink-0" />;
		case "skipped":
			return <Ban size={14} className="text-stone-400 dark:text-stone-500 shrink-0" />;
		default:
			return <Clock size={14} className="text-stone-400 dark:text-stone-500 shrink-0" />;
	}
}

// ── PhaseRow ─────────────────────────────────────────────────────────────

function PhaseRow({ phase, onPlanClick }: { phase: PhasePlan; onPlanClick?: (planExecId: string) => void }) {
	const [expanded, setExpanded] = useState(false);
	const hasDetail = phase.execution !== null;

	return (
		<div className="border border-[#E8E6E1] dark:border-[#333] rounded overflow-hidden">
			<div
				className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white dark:bg-[#1E1E1E]/40 transition-colors"
				onClick={() => hasDetail && setExpanded(!expanded)}
			>
				{hasDetail ? (
					expanded ? <ChevronDown size={12} className="text-stone-400 dark:text-stone-500 shrink-0" /> : <ChevronRight size={12} className="text-stone-400 dark:text-stone-500 shrink-0" />
				) : (
					<div className="w-3 shrink-0" />
				)}
				<PhaseIcon status={phase.status} />
				<span className="text-xs text-stone-800 dark:text-stone-200 font-medium">{phase.id}</span>
				<span className="text-xs text-stone-400 dark:text-stone-500">{phase.title}</span>
				{phase.dependsOn.length > 0 && (
					<span className="text-xs text-stone-400 dark:text-stone-500 bg-white dark:bg-[#1E1E1E] px-1.5 py-0.5 rounded border border-[#E8E6E1] dark:border-[#333]">
						after {phase.dependsOn.join(", ")}
					</span>
				)}
				{phase.status === "running" && (
					<span className="text-xs text-blue-400 font-semibold ml-auto flex items-center gap-1">
						<span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
						Running
					</span>
				)}
			</div>

			{/* Expanded detail */}
			{expanded && phase.execution && (
				<div className="px-6 pb-3 space-y-1.5 border-t border-[#E8E6E1] dark:border-[#333] pt-2">
					<div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
						<button
							onClick={(e) => { e.stopPropagation(); onPlanClick?.(phase.execution!.planExecId); }}
							className="text-blue-400 hover:text-blue-300 underline font-mono"
						>
							{phase.execution.planExecId.slice(0, 8)}...
						</button>
						<span className="text-stone-300 dark:text-stone-600">|</span>
						<span>Workspaces: {phase.execution.stats.complete}/{phase.execution.stats.total}</span>
						{phase.execution.stats.total_tokens_in !== undefined && (
							<>
								<span className="text-stone-300 dark:text-stone-600">|</span>
								<span>Tokens: {phase.execution.stats.total_tokens_in} in / {phase.execution.stats.total_tokens_out} out</span>
							</>
						)}
						{phase.execution.planExecId && phase.execution.planExecId !== "-" && (
							<button
								onClick={(e) => { e.stopPropagation(); onPlanClick?.(phase.execution!.planExecId); }}
								className="ml-auto text-xs text-blue-500 hover:text-blue-400 bg-blue-950/30 px-1.5 py-0.5 rounded border border-blue-800/50"
							>
								Open plan view
							</button>
						)}
					</div>
					{phase.execution.error && (
						<p className="text-xs text-red-400">{phase.execution.error}</p>
					)}
				</div>
			)}
		</div>
	);
}

// ── TimelineEventItem ───────────────────────────────────────────────────

function TimelineEventItem({ event }: { event: TimelineEvent }) {
	const time = new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	return (
		<div className="flex items-start gap-2 px-3 py-1.5 text-xs border-b border-[#E8E6E1] dark:border-[#333] last:border-b-0">
			<span className="text-stone-400 dark:text-stone-500 font-mono shrink-0 w-16">{time}</span>
			<span className="text-stone-700 dark:text-stone-300 capitalize break-all">{event.type.replace(/_/g, " ")}</span>
			{event.data && Object.keys(event.data).length > 0 && (
				<span className="text-stone-400 dark:text-stone-500 ml-auto truncate max-w-[200px]">
					{JSON.stringify(event.data)}
				</span>
			)}
		</div>
	);
}

// ── LiveTimelinePanel ────────────────────────────────────────────────────

function LiveTimelinePanel({ events }: { events: TimelineEvent[] }) {
	if (events.length === 0) {
		return (
			<div className="text-xs text-stone-400 dark:text-stone-500 px-3 py-2">
				No timeline events yet.
			</div>
		);
	}

	return (
		<div className="rounded border border-[#E8E6E1] dark:border-[#333] overflow-hidden max-h-[300px] overflow-y-auto">
			{events.map((e, i) => (
				<TimelineEventItem key={`${e.timestamp}-${i}`} event={e} />
			))}
		</div>
	);
}

// ── Main component ──────────────────────────────────────────────────────

export function TaskDetailView({ task: initialTask, projectId, onBack, onTaskUpdated, onPhasePlanClick }: TaskDetailViewProps) {
	const [task, setTask] = useState(initialTask);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"phases" | "timeline" | "reflection">("phases");

	const { aggregate } = useTaskStats({
		projectId,
		taskId: task.id,
		intervalMs: task.status === "running" ? 2000 : 0,
	});

	const { events } = useTaskTimeline({
		projectId,
		taskId: task.id,
		intervalMs: task.status === "running" ? 3000 : 0,
	});

	// Merge live aggregate into task for display
	const displayAggregate = aggregate ?? task.aggregate;

	// Show reflection tab only when task has reflection data
	const showReflection = task.reflection !== null;

	const performAction = async (action: string, endpoint: string) => {
		setActionLoading(action);
		try {
			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}${endpoint}`,
				{ method: "POST" },
			);
			if (res.ok) {
				const data = await res.json();
				if (data.task) {
					setTask(data.task);
					onTaskUpdated?.(data.task);
				}
			}
		} catch {
			// Ignore
		} finally {
			setActionLoading(null);
		}
	};

	return (
		<div className="space-y-4">
			{/* Back button + header */}
			<div className="flex items-center gap-3">
				<button
					onClick={onBack}
					className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-white dark:bg-[#1E1E1E] transition-colors"
				>
					<ArrowLeft size={14} className="text-stone-500 dark:text-stone-400" />
				</button>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200 truncate">{task.title}</h2>
						<StatusBadge status={task.status} />
					</div>
					{task.startedAt && (
						<p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
							Started {new Date(task.startedAt).toLocaleString()}
						</p>
					)}
				</div>

				{/* Action buttons */}
				<div className="flex items-center gap-1">
					{task.status === "draft" && (
						<button
							onClick={() => performAction("start", "/start")}
							disabled={actionLoading === "start"}
							className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
						>
							<Play size={10} />
							{actionLoading === "start" ? "Starting..." : "Start"}
						</button>
					)}
					{task.status === "running" && (
						<button
							onClick={() => performAction("pause", "/pause")}
							disabled={actionLoading === "pause"}
							className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-yellow-600 hover:bg-yellow-500 text-white disabled:opacity-50 transition-colors"
						>
							<Pause size={10} />
							Pause
						</button>
					)}
					{task.status === "paused" && (
						<button
							onClick={() => performAction("resume", "/resume")}
							disabled={actionLoading === "resume"}
							className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
						>
							<Play size={10} />
							Resume
						</button>
					)}
					{(task.status === "running" || task.status === "paused") && (
						<button
							onClick={() => performAction("cancel", "/cancel")}
							disabled={actionLoading === "cancel"}
							className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors"
						>
							<Square size={10} />
							Cancel
						</button>
					)}
				</div>
			</div>

			{/* Origin + Approval & Policy */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<OriginCard origin={task.origin} />
				<div className="flex items-start gap-3 px-3 py-2 rounded border border-[#E8E6E1] dark:border-[#333] bg-[#F7F6F3] dark:bg-[#161616]/50">
					<ShieldCheckIcon />
					<div className="min-w-0 text-xs">
						<p className="text-stone-700 dark:text-stone-300 font-medium">
							{task.approval.required ? "Approval Required" : "No Approval Required"}
						</p>
						{task.approval.status === "approved" && (
							<p className="text-emerald-400">Approved by {task.approval.approvedBy ?? "unknown"}</p>
						)}
						<p className="text-stone-400 dark:text-stone-500 mt-0.5">Policy v{task.policy.policyVersion}</p>
						<p className="text-stone-400 dark:text-stone-500">Autonomy Level {task.policy.autonomyLevel}</p>
					</div>
				</div>
			</div>

			{/* Blocked reason */}
			{task.status === "blocked" && (
				<BlockedReasonPanel
					blockedBy={undefined}
					reason="Task is blocked. Check the phase transition gate for details."
				/>
			)}

			{/* Aggregates bar */}
			<TaskAggregatesBar aggregate={displayAggregate} />

			{/* Tabs: Phases / Timeline / Reflection */}
			<div className="flex items-center gap-1 border-b border-[#E8E6E1] dark:border-[#333]">
				{(["phases", "timeline", "reflection"] as const).map((tab) => {
					if (tab === "reflection" && !showReflection) return null;
					return (
						<button
							key={tab}
							onClick={() => setActiveTab(tab)}
							className={`text-xs font-semibold uppercase tracking-wider px-3 py-1.5 border-b-2 transition-colors ${
								activeTab === tab
									? "text-blue-300 border-blue-500"
									: "text-stone-400 dark:text-stone-500 border-transparent hover:text-stone-700 dark:text-stone-300"
							}`}
						>
							{tab}
						</button>
					);
				})}
			</div>

			{/* Tab content */}
			{activeTab === "phases" && (
				<div className="space-y-1.5">
					{task.phases.map((phase) => (
						<PhaseRow key={phase.id} phase={phase} onPlanClick={onPhasePlanClick} />
					))}
				</div>
			)}

			{activeTab === "timeline" && (
				<LiveTimelinePanel events={events} />
			)}

			{activeTab === "reflection" && task.reflection && (
				<div className="space-y-2">
					<div className="px-3 py-2 rounded border border-[#E8E6E1] dark:border-[#333] bg-[#F7F6F3] dark:bg-[#161616]/50">
						<p className="text-xs text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">Achieved</p>
						<p className="text-xs text-stone-800 dark:text-stone-200">{task.reflection.achieved}</p>
					</div>
					{task.reflection.learnings.length > 0 && (
						<div className="px-3 py-2 rounded border border-[#E8E6E1] dark:border-[#333] bg-[#F7F6F3] dark:bg-[#161616]/50">
							<p className="text-xs text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">Learnings</p>
							<ul className="list-disc list-inside space-y-0.5">
								{task.reflection.learnings.map((l, i) => (
									<li key={i} className="text-xs text-stone-700 dark:text-stone-300">{l}</li>
								))}
							</ul>
						</div>
					)}
					{task.reflection.suggestedNextActions.length > 0 && (
						<div className="px-3 py-2 rounded border border-[#E8E6E1] dark:border-[#333] bg-[#F7F6F3] dark:bg-[#161616]/50">
							<p className="text-xs text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">Suggested Next Actions</p>
							<ul className="list-disc list-inside space-y-0.5">
								{task.reflection.suggestedNextActions.map((a, i) => (
									<li key={i} className="text-xs text-blue-300">{a}</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function ShieldCheckIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 shrink-0 mt-0.5">
			<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			<path d="m9 12 2 2 4-4" />
		</svg>
	);
}
