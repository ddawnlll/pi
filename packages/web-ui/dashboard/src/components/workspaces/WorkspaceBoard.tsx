/**
 * WorkspaceBoard — V3 Workspace Board (P42.05).
 *
 * Main workspace overview board that groups workspaces by status:
 * - Attention / Blocked
 * - Running
 * - Ready
 * - Completed
 * - Failed
 *
 * Each workspace card body navigates to the workspace detail route.
 */

import { Loader2, Layers } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { WorkspaceGroup, type WorkspaceGroupId } from "./WorkspaceGroup";
import type { WorkspaceCardV3Data } from "./WorkspaceCardV3";

// ─── Style tokens ──────────────────────────────────────────────────────────


// ─── Group order ───────────────────────────────────────────────────────────

const GROUP_ORDER: WorkspaceGroupId[] = [
	"blocked",
	"running",
	"ready",
	"completed",
	"failed",
];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceBoardProps {
	/** Workspaces to display */
	workspaces: WorkspaceCardV3Data[];
	/** Loading state */
	loading?: boolean;
	/** Called when stop is requested on a workspace */
	onStop?: (workspaceId: string) => void;
	/** Called when retry is requested on a workspace */
	onRetry?: (workspaceId: string) => void;
	/** Additional class name */
	className?: string;
}

// ─── Grouping helper ───────────────────────────────────────────────────────

function groupWorkspaces(
	workspaces: WorkspaceCardV3Data[],
): Record<WorkspaceGroupId, WorkspaceCardV3Data[]> {
	const groups: Record<WorkspaceGroupId, WorkspaceCardV3Data[]> = {
		blocked: [],
		running: [],
		ready: [],
		completed: [],
		failed: [],
	};

	for (const ws of workspaces) {
		switch (ws.stage) {
			case "blocked":
				groups.blocked.push(ws);
				break;
			case "active":
				groups.running.push(ws);
				break;
			case "pending":
				groups.ready.push(ws);
				break;
			case "complete":
				groups.completed.push(ws);
				break;
			case "failed":
				groups.failed.push(ws);
				break;
			// Default: put unknown stages in ready
			default:
				groups.ready.push(ws);
				break;
		}
	}

	return groups;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspaceBoard({
	workspaces,
	loading = false,
	onStop,
	onRetry,
	className = "",
}: WorkspaceBoardProps) {
	if (loading) {
		return (
			<div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
				<Loader2 size={20} className="animate-spin text-blue-400" />
				<p className={`text-xs ${MUT}`}>Loading workspaces...</p>
			</div>
		);
	}

	if (workspaces.length === 0) {
		return (
			<div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
				<Layers size={24} className="text-stone-300 dark:text-stone-600" />
				<p className={`text-xs ${MUT}`}>No workspaces yet</p>
				<p className={`text-xs ${MUT}`}>
					Workspaces will appear here as the plan executes.
				</p>
			</div>
		);
	}

	const groups = groupWorkspaces(workspaces);

	return (
		<div className={`space-y-5 ${className}`}>
			{GROUP_ORDER.map((groupId) => {
				const groupWorkspaces = groups[groupId];
				return (
					<WorkspaceGroup
						key={groupId}
						groupId={groupId}
						workspaces={groupWorkspaces}
						onStop={onStop}
						onRetry={onRetry}
					/>
				);
			})}
		</div>
	);
}
