/**
 * WorkspaceCardV3 — Individual workspace card for the V3 workspace board (P42.05).
 *
 * Clicking the card body navigates to the workspace detail route
 * via the NavigationContext.
 */

import { ArrowRight, RefreshCw } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { useNavigation } from "../../navigation/NavigationState";
import { WorkspaceStatusBadge } from "./WorkspaceStatusBadge";
import { WorkspaceCardActions } from "./WorkspaceCardActions";

// ─── Style tokens ──────────────────────────────────────────────────────────

const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceCardV3Data {
	id: string;
	stage: string;
	attempts: number;
	error: string | null;
	startedAt: number | null;
	completedAt: number | null;
}

export interface WorkspaceCardV3Props {
	workspace: WorkspaceCardV3Data;
	onStop?: (workspaceId: string) => void;
	onRetry?: (workspaceId: string) => void;
	className?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function shortId(id: string): string {
	if (id.length <= 18) return id;
	return `${id.slice(0, 10)}..${id.slice(-4)}`;
}

function relativeTime(ts: number | null): string {
	if (!ts) return "";
	const diff = Date.now() - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Stage border color ────────────────────────────────────────────────────

function stageBorderColor(stage: string): string {
	switch (stage) {
		case "active":
			return "border-l-blue-400";
		case "complete":
			return "border-l-emerald-400";
		case "failed":
			return "border-l-red-400";
		case "blocked":
			return "border-l-amber-400";
		case "pending":
			return "border-l-stone-300 dark:border-l-stone-600";
		default:
			return "border-l-stone-300 dark:border-l-stone-600";
	}
}

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspaceCardV3({
	workspace,
	onStop,
	onRetry,
	className = "",
}: WorkspaceCardV3Props) {
	const { navigateToWorkspaceDetail } = useNavigation();

	const handleClick = () => {
		navigateToWorkspaceDetail(workspace.id);
	};

	return (
		<button
			onClick={handleClick}
			className={`group flex items-center gap-3 p-3 rounded-lg border ${BORD} ${SURF} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors text-left w-full border-l-2 ${stageBorderColor(workspace.stage)} ${className}`}
			aria-label={`Workspace ${shortId(workspace.id)}, ${workspace.stage}`}
		>
			{/* Status badge */}
			<WorkspaceStatusBadge stage={workspace.stage} />

			{/* Body */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className={`text-xs font-medium ${TXT} truncate`}>
						{shortId(workspace.id)}
					</span>
				</div>

				<div className="flex items-center gap-2 mt-1">
					{workspace.attempts > 1 && (
						<span className="flex items-center gap-0.5 text-xs text-amber-500">
							<RefreshCw size={9} />
							{workspace.attempts}
						</span>
					)}
					{workspace.startedAt && (
						<span className={`text-xs ${TXT_MUTED}`}>
							Started {relativeTime(workspace.startedAt)}
						</span>
					)}
					{workspace.completedAt && workspace.stage === "complete" && (
						<span className={`text-xs ${TXT_MUTED}`}>
							Completed {relativeTime(workspace.completedAt)}
						</span>
					)}
					{workspace.error && (
						<span
							className="text-xs text-red-500 truncate max-w-[160px]"
							title={workspace.error}
						>
							{workspace.error}
						</span>
					)}
				</div>
			</div>

			{/* Actions + Chevron */}
			<div className="flex items-center gap-1 shrink-0">
				<WorkspaceCardActions
					workspaceId={workspace.id}
					stage={workspace.stage}
					onStop={onStop}
					onRetry={onRetry}
				/>
				<ArrowRight
					size={12}
					className={`shrink-0 ${TXT_MUTED} opacity-0 group-hover:opacity-100 transition-opacity`}
				/>
			</div>
		</button>
	);
}
