/**
 * DigestQuickActions — 24.K
 *
 * Displays quick action buttons for digest items (signals, observations,
 * proposals). Each action has loading, success, and error states.
 *
 * Usage:
 *   <DigestQuickActions
 *     itemType="signal"
 *     itemId="abc-123"
 *     itemTitle="Critical memory pressure"
 *     onAction={() => console.log("done")}
 *   />
 *
 * States handled:
 * - idle: Default state showing action button(s)
 * - loading: Action in progress with spinner
 * - success: Action completed with checkmark (auto-clears after 2s)
 * - error: Action failed with error message and retry button
 */

import React, { useCallback } from "react";
import { CheckCircle, Loader2, AlertCircle, EyeOff, BellOff, ThumbsUp } from "lucide-react";
import { useDigestActions } from "../../hooks/useDigestActions";
import type { ActionState } from "../../hooks/useDigestActions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DigestItemType = "signal" | "observation" | "proposal";

export interface DigestQuickActionsProps {
	/** The type of digest item. */
	itemType: DigestItemType;
	/** The unique ID of the item. */
	itemId: string;
	/** Human-readable title (for error messages). */
	itemTitle?: string;
	/** Callback fired after a successful action. */
	onAction?: (action: string, itemId: string) => void;
	/** Optional size variant. */
	size?: "sm" | "md";
	/** If true, the component is disabled (e.g., item already resolved). */
	disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Action button config
// ---------------------------------------------------------------------------

interface ActionConfig {
	type: string;
	label: string;
	icon: React.ReactNode;
	iconLoading: React.ReactNode;
	iconSuccess: React.ReactNode;
	iconError: React.ReactNode;
	actionFn: (id: string) => Promise<boolean>;
	successLabel: string;
	errorLabel: string;
}

// ---------------------------------------------------------------------------
// Sub-component: ActionButton
// ---------------------------------------------------------------------------

function ActionButton({
	config,
	itemId,
	status,
	onAction,
	disabled,
	size,
}: {
	config: ActionConfig;
	itemId: string;
	status: { state: ActionState; error: string | null };
	onAction?: (action: string, itemId: string) => void;
	disabled?: boolean;
	size: "sm" | "md";
}) {
	const isSmall = size === "sm";
	const btnSize = isSmall ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs";
	const iconSize = isSmall ? 12 : 14;

	const handleClick = useCallback(async () => {
		const success = await config.actionFn(itemId);
		if (success) {
			onAction?.(config.type, itemId);
		}
	}, [config, itemId, onAction]);

	// ── Success state ────────────────────────────────────────────────────
	if (status.state === "success") {
		return (
			<span
				className={`inline-flex items-center gap-1 ${btnSize} rounded-full text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 font-medium`}
			>
				{config.iconSuccess}
				<span>{config.successLabel}</span>
			</span>
		);
	}

	// ── Error state ──────────────────────────────────────────────────────
	if (status.state === "error") {
		return (
			<div className="flex items-center gap-1.5">
				<span
					className="inline-flex items-center gap-1 text-[9px] text-red-500"
					title={status.error ?? config.errorLabel}
				>
					{config.iconError}
					<span className="truncate max-w-[100px]">{status.error ?? config.errorLabel}</span>
				</span>
				<button
					type="button"
					onClick={handleClick}
					className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-medium"
				>
					Retry
				</button>
			</div>
		);
	}

	// ── Idle / Loading state ────────────────────────────────────────────
	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={status.state === "loading" || disabled}
			className={`inline-flex items-center gap-1 ${btnSize} rounded-full border transition-colors font-medium ${
				disabled
					? "border-stone-200 dark:border-stone-700 text-stone-300 dark:text-stone-600 cursor-not-allowed"
					: "border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:border-stone-400 dark:hover:border-stone-500 active:bg-stone-200 dark:active:bg-stone-700"
			} disabled:opacity-40 disabled:cursor-not-allowed`}
			title={config.label}
			aria-label={config.label}
		>
			{status.state === "loading" ? config.iconLoading : config.icon}
			<span>{status.state === "loading" ? "Working..." : config.label}</span>
		</button>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DigestQuickActions({
	itemType,
	itemId,
	itemTitle,
	onAction,
	size = "sm",
	disabled = false,
}: DigestQuickActionsProps) {
	const { resolveSignal, dismissObservation, acknowledgeProposal, getActionStatus } =
		useDigestActions();

	const status = getActionStatus(itemId);
	const isSmall = size === "sm";
	const iconSize = isSmall ? 12 : 14;

	// Build the action config based on item type
	const actionConfig = getActionConfig(
		itemType,
		itemId,
		itemTitle,
		resolveSignal,
		dismissObservation,
		acknowledgeProposal,
		iconSize,
	);

	if (!actionConfig) {
		// Unknown item type — render nothing
		return null;
	}

	return (
		<div className="flex items-center gap-1.5">
			<ActionButton
				config={actionConfig}
				itemId={itemId}
				status={status}
				onAction={onAction}
				disabled={disabled}
				size={size}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getActionConfig(
	itemType: DigestItemType,
	_itemId: string,
	_itemTitle: string | undefined,
	resolveSignal: (signalId: string) => Promise<boolean>,
	dismissObservation: (observationId: string) => Promise<boolean>,
	acknowledgeProposal: (proposalId: string) => Promise<boolean>,
	iconSize: number,
): ActionConfig | null {
	switch (itemType) {
		case "signal":
			return {
				type: "resolve_signal",
				label: "Resolve",
				icon: <CheckCircle size={iconSize} strokeWidth={1.5} />,
				iconLoading: <Loader2 size={iconSize} className="animate-spin" strokeWidth={1.5} />,
				iconSuccess: <CheckCircle size={iconSize} strokeWidth={2} />,
				iconError: <AlertCircle size={iconSize} strokeWidth={1.5} />,
				actionFn: resolveSignal,
				successLabel: "Resolved",
				errorLabel: "Failed to resolve",
			};
		case "observation":
			return {
				type: "dismiss_observation",
				label: "Dismiss",
				icon: <EyeOff size={iconSize} strokeWidth={1.5} />,
				iconLoading: <Loader2 size={iconSize} className="animate-spin" strokeWidth={1.5} />,
				iconSuccess: <CheckCircle size={iconSize} strokeWidth={2} />,
				iconError: <AlertCircle size={iconSize} strokeWidth={1.5} />,
				actionFn: dismissObservation,
				successLabel: "Dismissed",
				errorLabel: "Failed to dismiss",
			};
		case "proposal":
			return {
				type: "acknowledge_proposal",
				label: "Acknowledge",
				icon: <ThumbsUp size={iconSize} strokeWidth={1.5} />,
				iconLoading: <Loader2 size={iconSize} className="animate-spin" strokeWidth={1.5} />,
				iconSuccess: <CheckCircle size={iconSize} strokeWidth={2} />,
				iconError: <AlertCircle size={iconSize} strokeWidth={1.5} />,
				actionFn: acknowledgeProposal,
				successLabel: "Acknowledged",
				errorLabel: "Failed to acknowledge",
			};
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

/**
 * Renders a skeleton placeholder for DigestQuickActions during loading.
 */
export function DigestQuickActionsSkeleton({ size = "sm" }: { size?: "sm" | "md" }) {
	const isSmall = size === "sm";
	return (
		<div className="flex items-center gap-1.5">
			<div
				className={`rounded-full bg-stone-200 dark:bg-stone-700 animate-pulse ${
					isSmall ? "h-5 w-20" : "h-7 w-24"
				}`}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

/**
 * Renders a no-actions-available state for items that have no applicable
 * quick actions.
 */
export function DigestQuickActionsEmpty({ size = "sm" }: { size?: "sm" | "md" }) {
	const isSmall = size === "sm";
	return (
		<div className="flex items-center gap-1.5">
			<span
				className={`inline-flex items-center gap-1 ${
					isSmall ? "px-2 py-0.5 text-[9px]" : "px-3 py-1 text-[10px]"
				} rounded-full text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-800/50 italic`}
			>
				<BellOff size={isSmall ? 10 : 12} strokeWidth={1.2} />
				No actions available
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

/**
 * Renders a quick-action-specific error display with retry capability.
 */
export function DigestQuickActionsError({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div className="flex items-center gap-1.5 text-[10px] text-red-500">
			<AlertCircle size={12} strokeWidth={1.5} />
			<span className="truncate max-w-[140px]">{message}</span>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-medium"
				>
					Retry
				</button>
			)}
		</div>
	);
}
