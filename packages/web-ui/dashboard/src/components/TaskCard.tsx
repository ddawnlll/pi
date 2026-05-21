/**
 * TaskCard — compact task summary for the task list view.
 *
 * Shows status badge, phase progress dots, aggregate tokens,
 * and origin type in a single card.
 */

import React from "react";
import {
	ChevronRight,
	CheckCircle2,
	XCircle,
	Clock,
	AlertTriangle,
	Loader2,
	Ban,
	Layers,
	UserCheck,
	ShieldAlert,
} from "lucide-react";
import type { MultiPhaseTask } from "../types";
import { TaskAggregatesBar } from "./TaskAggregatesBar";

interface TaskCardProps {
	task: MultiPhaseTask;
	onClick: (taskId: string) => void;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
	draft: { icon: Clock, color: "text-gray-500", label: "Draft" },
	validating: { icon: Loader2, color: "text-blue-400", label: "Validating" },
	validation_failed: { icon: XCircle, color: "text-red-400", label: "Validation Failed" },
	approval_required: { icon: UserCheck, color: "text-purple-400", label: "Approval Required" },
	approved: { icon: CheckCircle2, color: "text-emerald-400", label: "Approved" },
	queued: { icon: Clock, color: "text-gray-400", label: "Queued" },
	blocked: { icon: Ban, color: "text-amber-400", label: "Blocked" },
	running: { icon: Loader2, color: "text-blue-400", label: "Running" },
	paused: { icon: Clock, color: "text-yellow-400", label: "Paused" },
	complete: { icon: CheckCircle2, color: "text-emerald-400", label: "Complete" },
	failed: { icon: XCircle, color: "text-red-400", label: "Failed" },
	cancelled: { icon: XCircle, color: "text-gray-500", label: "Cancelled" },
	reflecting: { icon: Loader2, color: "text-purple-400", label: "Reflecting" },
	reflected: { icon: CheckCircle2, color: "text-purple-400", label: "Reflected" },
};

function PhaseDots({ phases }: { phases: MultiPhaseTask["phases"] }) {
	return (
		<div className="flex items-center gap-1">
			{phases.map((p) => {
				let cls = "bg-gray-700";
				if (p.status === "complete") cls = "bg-emerald-600";
				else if (p.status === "running") cls = "bg-blue-500 ring-1 ring-blue-400";
				else if (p.status === "failed") cls = "bg-red-600";
				else if (p.status === "blocked") cls = "bg-amber-600";
				return (
					<span
						key={p.id}
						className={`inline-block w-2 h-2 rounded-full ${cls}`}
						title={`${p.id}: ${p.status}`}
					/>
				);
			})}
		</div>
	);
}

export function TaskCard({ task, onClick }: TaskCardProps) {
	const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.draft;
	const Icon = cfg.icon;

	return (
		<div
			className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-700 bg-gray-900/40 hover:bg-gray-800/60 cursor-pointer transition-colors group"
			onClick={() => onClick(task.id)}
		>
			{/* Status icon */}
			<Icon size={16} className={`${cfg.color} shrink-0 ${task.status === "running" || task.status === "validating" ? "animate-spin" : ""}`} />

			{/* Title + meta */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<p className="text-sm text-gray-200 font-medium truncate">{task.title}</p>
					<span className={`text-[9px] font-semibold uppercase tracking-wider ${cfg.color}`}>
						{cfg.label}
					</span>
				</div>

				{/* Phase dots + compact aggregates */}
				<div className="flex items-center gap-3 mt-1">
					<PhaseDots phases={task.phases} />
					<span className="text-[10px] text-gray-600">|</span>
					<span className="text-[10px] text-gray-500 tabular-nums">
						{task.aggregate.totalTokensIn > 0
							? `${(task.aggregate.totalTokensIn / 1000).toFixed(1)}K tokens`
							: "No tokens yet"}
					</span>
				</div>
			</div>

			{/* Chevron */}
			<ChevronRight size={14} className="text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
		</div>
	);
}
