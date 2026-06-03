/**
 * WorkspaceStatusBadge — Compact status indicator for workspace cards (P42.05).
 *
 * Shows stage with appropriate icon and color coding.
 * Used by WorkspaceCardV3 in the workspace board.
 */

import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	Loader2,
	XCircle,
	Ban,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceStatusBadgeProps {
	stage: string;
	className?: string;
}

// ─── Stage config ──────────────────────────────────────────────────────────

interface StageConfig {
	icon: typeof AlertTriangle;
	color: string;
	label: string;
	pulse?: boolean;
}

function getStageConfig(stage: string): StageConfig {
	switch (stage) {
		case "active":
			return { icon: Loader2, color: "text-blue-400", label: "Running", pulse: true };
		case "pending":
			return { icon: Clock, color: "text-stone-400 dark:text-stone-500", label: "Ready" };
		case "blocked":
			return { icon: Ban, color: "text-amber-400", label: "Blocked" };
		case "complete":
			return { icon: CheckCircle2, color: "text-emerald-400", label: "Completed" };
		case "failed":
			return { icon: XCircle, color: "text-red-400", label: "Failed" };
		default:
			return { icon: Clock, color: "text-stone-400 dark:text-stone-500", label: stage };
	}
}

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspaceStatusBadge({ stage, className = "" }: WorkspaceStatusBadgeProps) {
	const { icon: Icon, color, label, pulse } = getStageConfig(stage);

	return (
		<span
			className={`inline-flex items-center gap-1 text-xs font-medium ${color} ${className}`}
		>
			<Icon size={12} className={pulse ? "animate-spin" : ""} />
			{label}
		</span>
	);
}
