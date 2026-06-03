/**
 * WorkspaceGroup — Groups workspace cards by status category (P42.05).
 *
 * Groups: Attention/Blocked, Running, Ready, Completed, Failed.
 * Each group shows a header with count and a list of WorkspaceCardV3 cards.
 */

import { motion, AnimatePresence } from "framer-motion";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	AlertTriangle,
	Play,
	Clock,
	CheckCircle2,
	XCircle,
} from "lucide-react";
import { WorkspaceCardV3, type WorkspaceCardV3Data } from "./WorkspaceCardV3";

// ─── Style tokens ──────────────────────────────────────────────────────────


// ─── Group definitions ─────────────────────────────────────────────────────

export type WorkspaceGroupId = "blocked" | "running" | "ready" | "completed" | "failed";

interface GroupDef {
	id: WorkspaceGroupId;
	label: string;
	icon: typeof AlertTriangle;
	color: string;
	stages: string[];
}

const GROUP_DEFS: GroupDef[] = [
	{
		id: "blocked",
		label: "Attention / Blocked",
		icon: AlertTriangle,
		color: "text-amber-400",
		stages: ["blocked"],
	},
	{
		id: "running",
		label: "Running",
		icon: Play,
		color: "text-blue-400",
		stages: ["active"],
	},
	{
		id: "ready",
		label: "Ready",
		icon: Clock,
		color: "text-stone-400 dark:text-stone-500",
		stages: ["pending"],
	},
	{
		id: "completed",
		label: "Completed",
		icon: CheckCircle2,
		color: "text-emerald-400",
		stages: ["complete"],
	},
	{
		id: "failed",
		label: "Failed",
		icon: XCircle,
		color: "text-red-400",
		stages: ["failed"],
	},
];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceGroupProps {
	groupId: WorkspaceGroupId;
	workspaces: WorkspaceCardV3Data[];
	onStop?: (workspaceId: string) => void;
	onRetry?: (workspaceId: string) => void;
	className?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspaceGroup({
	groupId,
	workspaces,
	onStop,
	onRetry,
	className = "",
}: WorkspaceGroupProps) {
	const def = GROUP_DEFS.find((d) => d.id === groupId);
	if (!def) return null;

	const Icon = def.icon;

	if (workspaces.length === 0) return null;

	return (
		<div className={className}>
			{/* Group header */}
			<div className="flex items-center gap-2 mb-2 px-1">
				<Icon size={14} className={def.color} />
				<h3 className={`text-xs font-semibold uppercase tracking-wider ${MUT}`}>
					{def.label}
				</h3>
				<span className={`text-xs font-medium ${MUT}`}>
					({workspaces.length})
				</span>
			</div>

			{/* Card list */}
			<div className="space-y-1.5">
				<AnimatePresence mode="popLayout">
					{workspaces.map((ws) => (
						<motion.div
							key={ws.id}
							layout
							initial={{ opacity: 0, y: -4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 4 }}
							transition={{ duration: 0.15 }}
						>
							<WorkspaceCardV3
								workspace={ws}
								onStop={onStop}
								onRetry={onRetry}
							/>
						</motion.div>
					))}
				</AnimatePresence>
			</div>
		</div>
	);
}
