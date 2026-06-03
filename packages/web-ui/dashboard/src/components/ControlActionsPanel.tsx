/**
 * ControlActionsPanel — Minimal panel for workspace-level control actions (P41.11).
 *
 * Provides buttons for workspace intervention:
 * - Stop, Pause, Cancel, Retry
 * Also shows a summary of available control actions from context.
 *
 * Acceptance Criteria:
 * - Shows workspace intervention controls
 * - Supports loading and action-in-progress states
 * - Consumes the intervention API
 * - Minimal footprint
 */

import { useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../tokens";
import {
	AlertCircle,
	CheckCircle,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	Square,
	StopCircle,
	XCircle,
} from "lucide-react";
import { useInterveneWorkspace } from "../hooks/useHumanDirectives";

// ─── Style tokens ──────────────────────────────────────────────────────────

const ERR_TXT = "text-red-600 dark:text-red-400";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const GOOD_BG = "bg-emerald-50 dark:bg-emerald-900/20";

// ─── Action definitions ────────────────────────────────────────────────────

interface ActionDef {
	key: "stop" | "pause" | "cancel" | "retry";
	label: string;
	icon: typeof StopCircle;
	color: string;
	bg: string;
	confirm?: string;
}

const ACTIONS: ActionDef[] = [
	{
		key: "stop",
		label: "Stop",
		icon: Square,
		color: ERR_TXT,
		bg: ERR_BG,
		confirm: "Stop workspace?",
	},
	{
		key: "pause",
		label: "Pause",
		icon: Pause,
		color: WARN_TXT,
		bg: WARN_BG,
		confirm: "Pause workspace?",
	},
	{
		key: "cancel",
		label: "Cancel",
		icon: XCircle,
		color: ERR_TXT,
		bg: ERR_BG,
		confirm: "Cancel workspace?",
	},
	{
		key: "retry",
		label: "Retry",
		icon: RefreshCw,
		color: ACC_TXT,
		bg: ACC_BG,
		confirm: "Retry workspace?",
	},
];

// ─── Component ─────────────────────────────────────────────────────────────

interface ControlActionsPanelProps {
	/** Plan execution ID */
	planExecId: string | null;
	/** Workspace ID */
	workspaceId: string | null;
	/** Current stage of the workspace (affects which actions are available) */
	workspaceStage?: string;
	/** Optional class name */
	className?: string;
}

/**
 * Minimal Control Actions panel.
 *
 * Shows workspace-level intervention controls (stop, pause, cancel, retry)
 * and provides an optional reason input before executing.
 */
export function ControlActionsPanel({
	planExecId,
	workspaceId,
	workspaceStage,
	className = "",
}: ControlActionsPanelProps) {
	const interveneMutation = useInterveneWorkspace();
	const [pendingAction, setPendingAction] = useState<string | null>(null);
	const [reason, setReason] = useState("");

	const isTerminal = workspaceStage === "complete" || workspaceStage === "failed";

	const handleAction = (action: ActionDef) => {
		if (!planExecId || !workspaceId) return;
		if (pendingAction === action.key) {
			// Second click = confirm
			interveneMutation.mutate({
				planExecutionId: planExecId,
				workspaceId,
				action: action.key,
				reason: reason.trim() || undefined,
			});
			setPendingAction(null);
			setReason("");
		} else {
			setPendingAction(action.key);
		}
	};

	const cancelPending = () => {
		setPendingAction(null);
		setReason("");
	};

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className}`}>
			{/* Header */}
			<div className={`flex items-center justify-between px-3 py-2 border-b ${BORD}`}>
				<div className="flex items-center gap-2">
					<StopCircle size={13} className={ACC_TXT} />
					<span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
						Control Actions
					</span>
				</div>
			</div>

			<div className="p-3 space-y-2.5">
				{/* Action buttons */}
				<div className="grid grid-cols-2 gap-1.5">
					{ACTIONS.map((action) => {
						const isPending = pendingAction === action.key;
						const Icon = action.icon;

						return (
							<button
								key={action.key}
								onClick={() => handleAction(action)}
								disabled={interveneMutation.isPending || isTerminal}
								className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition-colors ${
									isPending
										? `${action.bg} ${action.color} border-current`
										: `${BORD} ${MUT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`
								} disabled:opacity-40 disabled:cursor-not-allowed`}
								title={action.confirm}
							>
								<Icon size={14} />
								<span className="text-xs font-medium">
									{isPending ? "Confirm?" : action.label}
								</span>
							</button>
						);
					})}
				</div>

				{/* Cancel pending */}
				{pendingAction && (
					<button
						onClick={cancelPending}
						className={`text-xs ${MUT} hover:text-stone-600 dark:hover:text-stone-300 underline`}
					>
						Cancel
					</button>
				)}

				{/* Reason input */}
				{pendingAction && (
					<textarea
						placeholder="Reason for action (optional)..."
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						className={`w-full text-xs px-2 py-1.5 rounded border ${BORD} bg-transparent ${TXT} placeholder:text-stone-400 resize-none`}
						rows={2}
					/>
				)}

				{/* In-progress mutation */}
				{interveneMutation.isPending && (
					<div className={`flex items-center gap-2 text-xs ${MUT}`}>
						<Loader2 size={12} className="animate-spin" />
						Executing action...
					</div>
				)}

				{/* Success */}
				{interveneMutation.isSuccess && interveneMutation.data?.success && (
					<div className={`flex items-center gap-2 text-xs ${GOOD_TXT}`}>
						<CheckCircle size={12} />
						Action executed successfully
					</div>
				)}

				{/* Error */}
				{interveneMutation.isError && (
					<div className={`flex items-center gap-2 text-xs ${ERR_TXT}`}>
						<AlertCircle size={12} />
						{interveneMutation.error?.message ?? "Failed to execute action"}
					</div>
				)}

				{/* Server error */}
				{interveneMutation.data?.success === false && (
					<div className={`flex items-center gap-2 text-xs ${ERR_TXT}`}>
						<AlertCircle size={12} />
						{interveneMutation.data.error ?? "Action rejected"}
					</div>
				)}
			</div>
		</div>
	);
}
