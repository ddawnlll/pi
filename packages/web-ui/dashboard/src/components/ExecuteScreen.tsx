/**
 * ExecuteScreen — Step 4 of the plan upload wizard.
 *
 * Shows execution progress for all plans with workspace-level detail,
 * and a live transcript panel showing the agent's real-time thoughts.
 */

import React, { useMemo, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	CheckCircle2,
	XCircle,
	Clock,
	Loader2,
	Brain,
	Terminal,
	AlertTriangle,
	FileText,
	Layers,
	GitMerge,
	ArrowRight,
} from "lucide-react";
import { useExecutionStats } from "../hooks/useExecutionStats";
import { usePlanWorkspaces } from "../hooks/usePlanWorkspaces";
import { usePlanTranscript } from "../hooks/usePlanTranscript";
import type { WorkerTranscriptEvent, BatchPlanResult, WorkspaceSummary } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileExecutionState {
	fileName: string;
	status: "queued" | "running" | "completed" | "failed";
	executionId?: string;
	error?: string;
	/** Whether this file runs sequentially (after previous) */
	isSequential?: boolean;
	/** Batch plan from validation (for DAG visualization) */
	batchPlan?: BatchPlanResult;
}

interface ExecuteScreenProps {
	/** Execution states for each file */
	executions: FileExecutionState[];
	/** Project ID for stats polling */
	projectId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: FileExecutionState["status"] }) {
	switch (status) {
		case "running":
			return <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />;
		case "completed":
			return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
		case "failed":
			return <XCircle size={14} className="text-red-400 shrink-0" />;
		case "queued":
			return <Clock size={14} className="text-gray-500 shrink-0" />;
	}
}

function StatusLabel({ status }: { status: FileExecutionState["status"] }) {
	switch (status) {
		case "running":
			return <span className="text-[10px] text-blue-400 font-medium">running...</span>;
		case "completed":
			return <span className="text-[10px] text-emerald-400 font-medium">completed</span>;
		case "failed":
			return <span className="text-[10px] text-red-400 font-medium">failed</span>;
		case "queued":
			return <span className="text-[10px] text-gray-500">queued</span>;
	}
}

// ---------------------------------------------------------------------------
// Workspace progress bar
// ---------------------------------------------------------------------------

function WorkspaceBar({
	total,
	active,
	complete,
	failed,
	blocked,
	pending,
}: {
	total: number;
	active: number;
	complete: number;
	failed: number;
	blocked: number;
	pending: number;
}) {
	if (total === 0) return null;

	const pct = (v: number) => (v / total) * 100;

	return (
		<div className="flex items-center gap-1.5 mt-1.5">
			<div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden flex">
				{complete > 0 && (
					<div
						className="h-full bg-emerald-500 transition-all duration-500"
						style={{ width: `${pct(complete)}%` }}
					/>
				)}
				{active > 0 && (
					<div
						className="h-full bg-blue-500 transition-all duration-500"
						style={{ width: `${pct(active)}%` }}
					/>
				)}
				{failed > 0 && (
					<div
						className="h-full bg-red-500 transition-all duration-500"
						style={{ width: `${pct(failed)}%` }}
					/>
				)}
				{blocked > 0 && (
					<div
						className="h-full bg-amber-500 transition-all duration-500"
						style={{ width: `${pct(blocked)}%` }}
					/>
				)}
			</div>
			<span className="text-[9px] text-gray-500 tabular-nums shrink-0">
				{complete + failed}/{total}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Workspace progress counts as tags
// ---------------------------------------------------------------------------

function WorkspaceCounts({
	pending,
	active,
	complete,
	failed,
	blocked,
}: {
	pending: number;
	active: number;
	complete: number;
	failed: number;
	blocked: number;
}) {
	const tags: Array<{ label: string; count: number; cls: string }> = [];

	if (complete > 0) tags.push({ label: "done", count: complete, cls: "text-emerald-400 border-emerald-800 bg-emerald-900/20" });
	if (active > 0) tags.push({ label: "active", count: active, cls: "text-blue-400 border-blue-800 bg-blue-900/20" });
	if (pending > 0) tags.push({ label: "pending", count: pending, cls: "text-gray-500 border-gray-700 bg-gray-800/50" });
	if (failed > 0) tags.push({ label: "failed", count: failed, cls: "text-red-400 border-red-800 bg-red-900/20" });
	if (blocked > 0) tags.push({ label: "blocked", count: blocked, cls: "text-amber-400 border-amber-800 bg-amber-900/20" });

	if (tags.length === 0) return null;

	return (
		<div className="flex items-center gap-1 flex-wrap mt-1">
			{tags.map((t) => (
				<span
					key={t.label}
					className={`text-[9px] px-1.5 py-0.5 rounded border ${t.cls}`}
				>
					{t.count} {t.label}
				</span>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// DAG Execution View — visual batch/step progress with workspace cards
// ---------------------------------------------------------------------------

interface DagExecutionViewProps {
	batchPlan: BatchPlanResult;
	workspaces: WorkspaceSummary[];
}

/** Map workspace stages to display status. */
function wsStatus(ws: WorkspaceSummary): "pending" | "active" | "complete" | "failed" | "blocked" {
	const s = ws.stage;
	if (s === "pending" || s === "queued") return "pending";
	if (s === "active" || s === "running" || s === "executing") return "active";
	if (s === "complete" || s === "completed") return "complete";
	if (s === "failed") return "failed";
	if (s === "blocked") return "blocked";
	return "pending";
}

// Status color config
const WS_STATUS = {
	pending: { bg: "bg-gray-800", border: "border-gray-700", text: "text-gray-500", label: "pending", labelCls: "text-gray-400" },
	active: { bg: "bg-blue-900/40", border: "border-blue-600", text: "text-blue-200", label: "active", labelCls: "text-blue-300" },
	complete: { bg: "bg-emerald-900/40", border: "border-emerald-600", text: "text-emerald-200", label: "done", labelCls: "text-emerald-300" },
	failed: { bg: "bg-red-900/40", border: "border-red-600", text: "text-red-200", label: "failed", labelCls: "text-red-300" },
	blocked: { bg: "bg-amber-900/40", border: "border-amber-600", text: "text-amber-200", label: "blocked", labelCls: "text-amber-300" },
} as const;

function DagExecutionView({ batchPlan, workspaces }: DagExecutionViewProps) {
	// Build workspace lookup: id -> status
	const wsMap = useMemo(() => {
		const m = new Map<string, WorkspaceSummary>();
		for (const ws of workspaces) {
			m.set(ws.id, ws);
		}
		return m;
	}, [workspaces]);

	// Resolve workspace status for each batch
	const batchStatuses = useMemo(() => {
		return batchPlan.batches.map((batch) => {
			const items = batch.workspaceIds.map((wsId) => {
				const ws = wsMap.get(wsId);
				const status = ws ? wsStatus(ws) : "pending";
				return { wsId, status, title: ws?.id ?? wsId };
			});

			// Determine batch-level progress
			const done = items.filter((i) => i.status === "complete").length;
			const active = items.filter((i) => i.status === "active").length;
			const failed = items.filter((i) => i.status === "failed").length;
			const blocked = items.filter((i) => i.status === "blocked").length;
			const pending = items.filter((i) => i.status === "pending").length;
			const total = items.length;

			// A batch is "current" if it has active workspaces or
			// is the first batch not yet fully completed
			const isActive = active > 0;
			const isComplete = done + failed === total;

			return {
				batchIndex: batch.batchIndex,
				items,
				done,
				active,
				failed,
				blocked,
				pending,
				total,
				isActive,
				isComplete,
			};
		});
	}, [batchPlan, wsMap]);

	// Determine current batch (first non-complete with active, or first non-complete)
	const currentBatchIndex = useMemo(() => {
		const activeBatch = batchStatuses.find((b) => b.isActive);
		if (activeBatch) return activeBatch.batchIndex;
		const firstIncomplete = batchStatuses.find((b) => !b.isComplete);
		return firstIncomplete?.batchIndex ?? -1;
	}, [batchStatuses]);

	if (batchPlan.batches.length === 0) return null;

	return (
		<div className="space-y-1.5 mt-2">
			{/* Legend */}
			<div className="flex items-center gap-3 text-[8px] text-gray-500 pb-1 border-b border-gray-800 mb-1">
				<span className="font-semibold uppercase tracking-wider">Batch DAG</span>
				{batchPlan.batches.length > 1 && (
					<>
						{batchPlan.effectiveParallelism > 1 ? (
							<span>Tiered · max {batchPlan.effectiveParallelism} parallel</span>
						) : (
							<span>Sequential</span>
						)}
					</>
				)}
				<span className="ml-auto">
					{batchPlan.totalBatches} batch{batchPlan.totalBatches > 1 ? "es" : ""}
				</span>
			</div>

			{/* Batch rows */}
			{batchStatuses.map((batch) => {
				const isCurrent = batch.batchIndex === currentBatchIndex;

				// Batch progress bar color
				const batchBarColor = batch.failed > 0
					? "bg-red-500"
					: batch.isActive
						? "bg-blue-500"
						: batch.isComplete
							? "bg-emerald-500"
							: "bg-gray-700";

				const batchPct = batch.total > 0
					? ((batch.done + batch.failed) / batch.total) * 100
					: 0;

				return (
					<div
						key={batch.batchIndex}
						className={`pl-3 border-l-2 transition-colors ${
							isCurrent
								? "border-blue-500 bg-blue-900/10 rounded"
								: batch.isComplete
									? "border-emerald-700"
									: "border-gray-700"
						}`}
					>
						{/* Batch header */}
						<div className="flex items-center gap-2 py-1">
							<span
								className={`text-[10px] font-bold shrink-0 ${
									isCurrent
										? "text-blue-300"
										: batch.isComplete
											? "text-emerald-400"
											: "text-gray-500"
								}`}
							>
								Step {batch.batchIndex}
							</span>

							{/* Mini progress bar */}
							<div className="flex-1 h-1 rounded-full bg-gray-800 overflow-hidden max-w-[100px]">
								<div
									className={`h-full rounded-full transition-all duration-500 ${batchBarColor}`}
									style={{ width: `${Math.min(batchPct, 100)}%` }}
								/>
							</div>

							{/* Counts */}
							<span className="text-[9px] text-gray-500 tabular-nums">
								{batch.done + batch.failed}/{batch.total}
								{batch.active > 0 && (
									<span className="text-blue-400 ml-1">· {batch.active} active</span>
								)}
							</span>

							{isCurrent && (
								<span className="text-[8px] uppercase tracking-wider font-bold text-blue-400 ml-auto">
									Running
								</span>
							)}
						</div>

						{/* Workspace cards row */}
						{batch.items.length > 0 && (
							<div className="flex flex-wrap items-center gap-1 pb-1.5">
								{batch.items.map((item, idx) => {
									const cfg = WS_STATUS[item.status];
									return (
										<>
											{idx > 0 && batchPlan.effectiveParallelism === 1 && (
												<ArrowRight size={6} className="text-gray-700 shrink-0" />
											)}
											<span
												className={`text-[9px] px-1.5 py-0.5 rounded-sm border ${cfg.bg} ${cfg.border} ${cfg.text} ${
													item.status === "active" ? "animate-pulse" : ""
												}`}
												title={`${item.wsId} \u2014 ${cfg.label}`}
											>
												{item.wsId.length > 16
													? item.wsId.slice(0, 14) + ".."
													: item.wsId}
											</span>
										</>
									);
								})}
							</div>
						)}
					</div>
				);
			})}

			{/* Legend mini */}
			<div className="flex items-center gap-2 text-[8px] text-gray-600 pt-0.5">
				<span className="inline-block w-2 h-2 rounded bg-blue-600" />
				active
				<span className="inline-block w-2 h-2 rounded bg-emerald-600 ml-1" />
				done
				<span className="inline-block w-2 h-2 rounded bg-red-600 ml-1" />
				failed
				<span className="inline-block w-2 h-2 rounded bg-amber-600 ml-1" />
				blocked
				<span className="inline-block w-2 h-2 rounded bg-gray-700 ml-1" />
				pending
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// PlanExecutionRow — per-file execution with workspace stats
// ---------------------------------------------------------------------------

interface PlanExecutionRowProps {
	exec: FileExecutionState;
	projectId: string;
}

function PlanExecutionRow({ exec, projectId }: PlanExecutionRowProps) {
	const [expanded, setExpanded] = useState(false);

	const { stats } = useExecutionStats({
		projectId: exec.status === "running" || exec.status === "completed" ? projectId : null,
		planExecId: exec.executionId ?? null,
		intervalMs: 2000,
	});

	// Poll workspace list for DAG visualization
	const { workspaces } = usePlanWorkspaces({
		projectId: exec.status === "running" || exec.status === "completed" ? projectId : null,
		planExecId: exec.executionId ?? null,
		intervalMs: 3000,
	});

	const hasWorkspaceData = stats && stats.total > 0;
	const hasDagData = exec.batchPlan && workspaces.length > 0;

	return (
		<div
			className={`border-b border-gray-700 last:border-b-0 transition-colors ${
				exec.status === "running"
					? "bg-blue-900/20"
					: exec.status === "completed"
						? "bg-emerald-900/10"
						: exec.status === "failed"
							? "bg-red-900/10"
							: ""
			}`}
		>
			{/* ── Header row (always visible) ── */}
			<div
				className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none"
				onClick={() => (hasWorkspaceData ? setExpanded(!expanded) : undefined)}
			>
				{/* Expand indicator */}
				{hasWorkspaceData ? (
					expanded ? (
						<ChevronDown size={10} className="text-gray-500 shrink-0" />
					) : (
						<ChevronRight size={10} className="text-gray-500 shrink-0" />
					)
				) : (
					<div className="w-[10px] shrink-0" />
				)}

				{/* Status icon */}
				<StatusIcon status={exec.status} />

				{/* File name + workspace counts */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<p className="text-xs text-gray-200 truncate font-medium">
							{exec.fileName}
						</p>
						{/* Execution mode badge */}
						{exec.isSequential && (
							<span className="text-[9px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700 shrink-0">
								after prev
							</span>
						)}
					</div>
					{exec.error && (
						<p className="text-[10px] text-red-400 mt-0.5">{exec.error}</p>
					)}
					{/* Workspace progress counts (collapsed view) */}
					{hasWorkspaceData && !expanded && (
						<WorkspaceCounts
							pending={stats.pending}
							active={stats.active}
							complete={stats.complete}
							failed={stats.failed}
							blocked={stats.blocked}
						/>
					)}
					{/* Workspace mini bar (collapsed view) */}
					{hasWorkspaceData && !expanded && (
						<WorkspaceBar
							total={stats.total}
							active={stats.active}
							complete={stats.complete}
							failed={stats.failed}
							blocked={stats.blocked}
							pending={stats.pending}
						/>
					)}
				</div>

				{/* Status label */}
				<StatusLabel status={exec.status} />
			</div>

			{/* ── Expanded workspace detail ── */}
			{expanded && hasWorkspaceData && (
				<div className="px-10 pb-3 space-y-1.5">
					<div className="flex items-center gap-2 text-[10px] text-gray-500">
						<span>Total: {stats.total} workspaces</span>
						<span className="text-gray-700">|</span>
						<WorkspaceBar
							total={stats.total}
							active={stats.active}
							complete={stats.complete}
							failed={stats.failed}
							blocked={stats.blocked}
							pending={stats.pending}
						/>
					</div>
					<WorkspaceCounts
						pending={stats.pending}
						active={stats.active}
						complete={stats.complete}
						failed={stats.failed}
						blocked={stats.blocked}
					/>
					{/* Extra stats when available */}
					{stats.requestedWorkers !== undefined && (
						<div className="flex items-center gap-2 text-[9px] text-gray-600 mt-1">
							<span>Requested workers: {stats.requestedWorkers}</span>
							{stats.maxAllowedWorkers !== undefined && (
								<>
									<span className="text-gray-700">|</span>
									<span>Max allowed: {stats.maxAllowedWorkers}</span>
								</>
							)}
							{stats.safeEffectiveParallelism !== undefined && (
								<>
									<span className="text-gray-700">|</span>
									<span>Effective: {stats.safeEffectiveParallelism}</span>
								</>
							)}
						</div>
					)}
					{/* Bottleneck reasons */}
					{stats.bottleneckReasons && stats.bottleneckReasons.length > 0 && (
						<div className="mt-1 space-y-0.5">
							{stats.bottleneckReasons.map((r, i) => (
								<p key={i} className="text-[9px] text-amber-500 flex items-center gap-1">
									<AlertTriangle size={8} className="shrink-0" />
									{r}
								</p>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Event icon mapping for live transcript
// ---------------------------------------------------------------------------

function TranscriptEventIcon({ event }: { event: WorkerTranscriptEvent }) {
	const size = 12;
	switch (event.type) {
		case "worker_status":
			return <Loader2 size={size} className="animate-spin text-blue-400 shrink-0" />;
		case "worker_decision_summary":
			return <Brain size={size} className="text-purple-400 shrink-0" />;
		case "tool_call":
			return <Terminal size={size} className="text-cyan-400 shrink-0" />;
		case "validation":
			return <CheckCircle2 size={size} className="text-emerald-400 shrink-0" />;
		case "blocker":
			return <AlertTriangle size={size} className="text-amber-400 shrink-0" />;
		case "workspace_start":
			return <FileText size={size} className="text-blue-400 shrink-0" />;
		case "workspace_complete":
			return <CheckCircle2 size={size} className="text-emerald-400 shrink-0" />;
		case "workspace_failed":
			return <XCircle size={size} className="text-red-400 shrink-0" />;
		case "workspace_blocked":
			return <AlertTriangle size={size} className="text-amber-400 shrink-0" />;
		case "retry_attempt":
			return <Loader2 size={size} className="animate-spin text-orange-400 shrink-0" />;
		default:
			return <div className="w-3 h-3 shrink-0" />;
	}
}

function eventTypeLabel(type: WorkerTranscriptEvent["type"]): string {
	switch (type) {
		case "worker_status": return "status";
		case "worker_decision_summary": return "thought";
		case "tool_call": return "tool";
		case "validation": return "validation";
		case "blocker": return "blocker";
		case "workspace_start": return "start";
		case "workspace_complete": return "complete";
		case "workspace_failed": return "failed";
		case "workspace_blocked": return "blocked";
		case "retry_attempt": return "retry";
		default: return type;
	}
}

// ---------------------------------------------------------------------------
// LiveTranscriptPanel — agent thinking in real-time
// ---------------------------------------------------------------------------

interface LiveTranscriptPanelProps {
	planExecId: string | null;
}

function LiveTranscriptPanel({ planExecId }: LiveTranscriptPanelProps) {
	// Connect to the plan-level aggregated transcript endpoint
	const { events, isConnected, isReconnecting } = usePlanTranscript({
		planExecId,
	});

	const displayEvents = useMemo(() => {
		// Show last 50 events only
		return events.slice(-50);
	}, [events]);

	return (
		<div className="border border-gray-700 rounded overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 border-b border-gray-700">
				<Brain size={12} className="text-purple-400 shrink-0" />
				<span className="text-[11px] font-medium text-gray-300">
					Agent Transcript
				</span>
				{isConnected ? (
					<span className="text-[8px] text-emerald-500 uppercase tracking-wider font-semibold ml-auto">
						Live
					</span>
				) : isReconnecting ? (
					<span className="text-[8px] text-amber-500 uppercase tracking-wider font-semibold ml-auto flex items-center gap-1">
						<Loader2 size={8} className="animate-spin" />
						Reconnecting
					</span>
				) : (
					<span className="text-[8px] text-gray-600 uppercase tracking-wider font-semibold ml-auto">
						Disconnected
					</span>
				)}
			</div>

			{/* Events list */}
			{displayEvents.length > 0 ? (
				<div className="max-h-[180px] overflow-y-auto">
					{displayEvents.map((evt, i) => (
						<div
							key={`${evt.timestamp}-${i}`}
							className="flex items-start gap-2 px-3 py-1.5 border-b border-gray-800 last:border-b-0 hover:bg-gray-800/30 transition-colors"
						>
							<TranscriptEventIcon event={evt} />
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5">
									<span className="text-[9px] text-gray-600 font-mono shrink-0">
										{eventTypeLabel(evt.type)}
									</span>
									<span className="text-[9px] text-gray-500 font-mono shrink-0">
										{evt.workspaceId !== "_plan" ? evt.workspaceId : ""}
									</span>
								</div>
								<p className="text-[10px] text-gray-300 leading-relaxed mt-0.5 line-clamp-2">
									{evt.summary}
								</p>
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="flex items-center justify-center py-6 text-[10px] text-gray-600 gap-2">
					{isConnected ? (
						<>Waiting for transcript events...</>
					) : (
						<>
							<Clock size={10} className="shrink-0" />
							{planExecId ? "Connecting..." : "No active plan"}
						</>
					)}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ExecuteScreen({
	executions,
	projectId,
}: ExecuteScreenProps) {
	const completed = executions.filter((e) => e.status === "completed").length;
	const failed = executions.filter((e) => e.status === "failed").length;
	const running = executions.filter((e) => e.status === "running").length;
	const total = executions.length;
	const progress = total > 0 ? ((completed + failed) / total) * 100 : 0;
	const isAllDone = completed + failed === total;

	// Find the first running plan's executionId for live transcript
	const activeExecId = useMemo(() => {
		const runningExec = executions.find((e) => e.status === "running" && e.executionId);
		return runningExec?.executionId ?? null;
	}, [executions]);

	return (
		<div className="flex flex-col gap-4">
			{/* ── Header ── */}
			<div className="flex items-center justify-between">
				<p className="text-sm font-medium text-gray-200">
					Executing {total} plan{total !== 1 ? "s" : ""}
				</p>
			</div>

			{/* ── Progress bar ── */}
			<div className="flex flex-col gap-1">
				<div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
					<div
						className={`h-full rounded-full transition-all duration-500 ${
							failed > 0
								? "bg-red-500"
								: isAllDone
									? "bg-emerald-500"
									: "bg-blue-500"
						}`}
						style={{ width: `${Math.min(progress, 100)}%` }}
					/>
				</div>
				<div className="flex items-center justify-between text-[10px] text-gray-500">
					<span>
						{completed + failed} of {total} done
					</span>
					<span>
						{running > 0 ? `${running} running` : isAllDone ? "All done" : ""}
					</span>
				</div>
			</div>

			{/* ── Per-plan execution rows with workspace stats ── */}
			<div className="border border-gray-700 rounded overflow-hidden">
				{executions.map((exec) => (
					<PlanExecutionRow
						key={exec.fileName}
						exec={exec}
						projectId={projectId}
					/>
				))}
			</div>

			{/* ── Live Transcript ── */}
			{running > 0 && (
				<LiveTranscriptPanel planExecId={activeExecId} />
			)}

			{/* ── Completion message ── */}
			{isAllDone && (
				<div className="flex items-center gap-2 p-3 rounded-lg border border-emerald-800 bg-emerald-900/20">
					<CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
					<div>
						<p className="text-xs font-medium text-emerald-300">
							{failed > 0
								? `${completed} completed, ${failed} failed`
								: "All plans executed successfully"}
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
