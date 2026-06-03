/**
 * WorkspacePreview — Compact workspace card grid (P42.04).
 *
 * Shows a grid of compact workspace cards for the execution overview.
 * Each card shows workspace id, status, phase, and retry count.
 * Click navigates to workspace detail route.
 */

import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	Loader2,
	RefreshCw,
	XCircle,
	ArrowRight,
} from "lucide-react";

// ─── Style tokens ──────────────────────────────────────────────────────────

const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspacePreviewData {
	id: string;
	stage: string;
	attempts: number;
	error: string | null;
	startedAt: number | null;
	completedAt: number | null;
	lastActivityAt?: number;
	lastActivitySource?: string;
}

export interface WorkspacePreviewProps {
	/** List of workspaces to display */
	workspaces: WorkspacePreviewData[];
	/** Maximum number of workspaces to show before "View all" */
	maxVisible?: number;
	/** Callback when a workspace is clicked */
	onWorkspaceClick?: (workspaceId: string) => void;
	/** Callback to navigate to full workspace board */
	onViewAll?: () => void;
	/** Loading state */
	loading?: boolean;
	/** Additional class name */
	className?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function stageIcon(stage: string) {
	switch (stage) {
		case "running":
		case "active":
			return <Loader2 size={12} className="animate-spin text-blue-500 shrink-0" />;
		case "complete":
		case "completed":
			return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />;
		case "failed":
			return <XCircle size={12} className="text-red-500 shrink-0" />;
		case "blocked":
			return <AlertTriangle size={12} className="text-amber-500 shrink-0" />;
		case "pending":
		case "ready":
			return <Clock size={12} className="text-stone-400 shrink-0" />;
		default:
			return <Clock size={12} className="text-stone-400 shrink-0" />;
	}
}

function stageColor(stage: string): string {
	switch (stage) {
		case "running":
		case "active":
			return "border-l-blue-400";
		case "complete":
		case "completed":
			return "border-l-emerald-400";
		case "failed":
			return "border-l-red-400";
		case "blocked":
			return "border-l-amber-400";
		case "pending":
		case "ready":
			return "border-l-stone-300 dark:border-l-stone-600";
		default:
			return "border-l-stone-300 dark:border-l-stone-600";
	}
}

function stageLabel(stage: string): string {
	return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function shortWsId(id: string): string {
	if (id.length <= 16) return id;
	return `${id.slice(0, 8)}..${id.slice(-4)}`;
}

function relativeTime(ts: number | null): string {
	if (!ts) return "";
	const diff = Date.now() - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Card ──────────────────────────────────────────────────────────────────

function WorkspaceCard({
	workspace,
	onClick,
}: {
	workspace: WorkspacePreviewData;
	onClick?: (id: string) => void;
}) {
	return (
		<button
			onClick={() => onClick?.(workspace.id)}
			className={`group flex items-center gap-2.5 p-2.5 rounded-lg border ${BORD} ${SURF} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors text-left w-full border-l-2 ${stageColor(workspace.stage)}`}
			aria-label={`Workspace ${shortWsId(workspace.id)}, ${stageLabel(workspace.stage)}`}
		>
			{stageIcon(workspace.stage)}

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className={`text-xs font-medium ${TXT} truncate`}>
						{shortWsId(workspace.id)}
					</span>
					<span className={`text-xs font-medium px-1 py-0.5 rounded ${
						workspace.stage === "running" || workspace.stage === "active"
							? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
							: workspace.stage === "failed"
								? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
								: workspace.stage === "blocked"
									? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
									: workspace.stage === "complete" || workspace.stage === "completed"
										? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
										: `bg-stone-100 dark:bg-stone-800 ${TXT_MUTED}`
					}`}>
						{stageLabel(workspace.stage)}
					</span>
				</div>

				<div className="flex items-center gap-2 mt-0.5">
					{workspace.attempts > 1 && (
						<span className="flex items-center gap-0.5 text-xs text-amber-500">
							<RefreshCw size={9} />
							{workspace.attempts}
						</span>
					)}
					{workspace.lastActivityAt && (
						<span className={`text-xs ${TXT_MUTED}`}>
							{relativeTime(workspace.lastActivityAt)}
						</span>
					)}
					{workspace.error && (
						<span className="text-xs text-red-500 truncate max-w-[120px]">
							{workspace.error}
						</span>
					)}
				</div>
			</div>

			<ArrowRight size={11} className={`shrink-0 ${TXT_MUTED} opacity-0 group-hover:opacity-100 transition-opacity`} />
		</button>
	);
}

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspacePreview({
	workspaces,
	maxVisible = 6,
	onWorkspaceClick,
	onViewAll,
	loading = false,
	className = "",
}: WorkspacePreviewProps) {
	if (loading) {
		return (
			<div className={`space-y-2 ${className}`} role="status" aria-label="Loading workspaces">
				{[...Array(3)].map((_, i) => (
					<div
						key={i}
						className={`h-14 rounded-lg border ${BORD} ${SURF} animate-pulse`}
					/>
				))}
			</div>
		);
	}

	if (workspaces.length === 0) {
		return (
			<div className={`flex items-center justify-center py-6 ${className}`}>
				<p className={`text-xs ${TXT_MUTED}`}>No workspaces yet</p>
			</div>
		);
	}

	const visible = workspaces.slice(0, maxVisible);
	const remaining = workspaces.length - maxVisible;

	return (
		<div className={className}>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{visible.map((ws) => (
					<WorkspaceCard
						key={ws.id}
						workspace={ws}
						onClick={onWorkspaceClick}
					/>
				))}
			</div>
			{(remaining > 0 || onViewAll) && (
				<div className="mt-2 text-center">
					<button
						onClick={onViewAll}
						className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
						aria-label="View all workspaces"
					>
						{remaining > 0
							? `View all ${workspaces.length} workspaces (${remaining} more)`
							: "View all workspaces"}
						<ArrowRight size={10} />
					</button>
				</div>
			)}
		</div>
	);
}
