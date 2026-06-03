/**
 * NextActionCard — Recommended next action card (P42.04).
 *
 * Shows a suggested next action for the user when one is actionable.
 * Hides when no action is recommended (empty state).
 */

import { ArrowRight, Lightbulb, Sparkles } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";

// ─── Style tokens ──────────────────────────────────────────────────────────

const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NextAction {
	/** Unique action ID */
	id: string;
	/** Action title (short imperative) */
	title: string;
	/** Action description */
	description: string;
	/** Priority */
	priority: "high" | "medium" | "low";
	/** Callback when action is taken */
	onAction: () => void;
	/** Optional action label (default: "Take Action") */
	actionLabel?: string;
	/** Optional workspace ID this action relates to */
	workspaceId?: string;
}

export interface NextActionCardProps {
	/** Current recommended action, or undefined if none */
	action?: NextAction;
	/** Loading state */
	loading?: boolean;
	/** Additional class name */
	className?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function priorityColor(priority: NextAction["priority"]): string {
	switch (priority) {
		case "high":
			return "text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30";
		case "medium":
			return "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30";
		case "low":
			return "text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30";
	}
}

function priorityLabel(priority: NextAction["priority"]): string {
	switch (priority) {
		case "high":
			return "High Priority";
		case "medium":
			return "Medium Priority";
		case "low":
			return "Suggestion";
	}
}

// ─── Component ─────────────────────────────────────────────────────────────

export function NextActionCard({
	action,
	loading = false,
	className = "",
}: NextActionCardProps) {
	if (loading) {
		return (
			<div
				className={`rounded-lg border ${BORD} ${SURF} p-4 ${className}`}
				role="status"
				aria-label="Loading next action"
			>
				<div className="space-y-2">
					<div className="h-4 w-24 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
					<div className="h-3 w-48 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
					<div className="h-8 w-28 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
				</div>
			</div>
		);
	}

	if (!action) {
		return null;
	}

	return (
		<div
			className={`rounded-lg border ${priorityColor(action.priority)} p-3 ${className}`}
			role="region"
			aria-label="Recommended next action"
		>
			<div className="flex items-start gap-2.5">
				<div className="mt-0.5">
					<Lightbulb size={14} className={action.priority === "high" ? "text-red-500" : "text-amber-500"} />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className={`text-xs font-semibold uppercase tracking-wider ${action.priority === "high" ? "text-red-600 dark:text-red-400" : action.priority === "medium" ? "text-amber-600 dark:text-amber-400" : "text-blue-700 dark:text-blue-300"}`}>
							{priorityLabel(action.priority)}
						</span>
						{action.workspaceId && (
							<span className={`text-xs font-mono ${TXT_MUTED}`}>
								{action.workspaceId.length > 12
									? `${action.workspaceId.slice(0, 8)}..`
									: action.workspaceId}
							</span>
						)}
					</div>
					<h4 className={`text-sm font-medium ${TXT} mt-0.5`}>{action.title}</h4>
					<p className={`text-xs ${TXT_MUTED} mt-0.5 line-clamp-2`}>{action.description}</p>
					<button
						onClick={action.onAction}
						className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
					>
						<Sparkles size={11} />
						{action.actionLabel ?? "Take Action"}
						<ArrowRight size={11} />
					</button>
				</div>
			</div>
		</div>
	);
}
