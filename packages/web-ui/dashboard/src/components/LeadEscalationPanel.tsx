/**
 * LeadEscalationPanel — Minimal panel for viewing and resolving Lead Agent escalations (P41.09).
 *
 * Shows active escalations for a workspace and provides the ability
 * to resolve them by choosing an option.
 *
 * Acceptance Criteria:
 * - Shows active escalations from the API
 * - Supports loading, empty, error, and data-present states
 * - Allows user to resolve an escalation by selecting an option
 * - Minimal footprint
 */

import { useState } from "react";
import {
	AlertTriangle,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Loader2,
	RefreshCw,
	Send,
	XCircle,
} from "lucide-react";
import { useEscalations, useResolveEscalation } from "../hooks/useEscalations";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ERR_TXT = "text-red-600 dark:text-red-400";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const GOOD_BG = "bg-emerald-50 dark:bg-emerald-900/20";

// ─── Component ─────────────────────────────────────────────────────────────

interface LeadEscalationPanelProps {
	/** Plan execution ID */
	planExecId: string | null;
	/** Workspace ID */
	workspaceId: string | null;
	/** Optional class name */
	className?: string;
}

/**
 * Minimal Lead Escalation panel.
 *
 * Shows active escalations for a workspace and allows the user to
 * resolve them by choosing from the available options.
 */
export function LeadEscalationPanel({
	planExecId,
	workspaceId,
	className = "",
}: LeadEscalationPanelProps) {
	const { data: escalations, isLoading, error, refetch } = useEscalations(planExecId, workspaceId);
	const resolveMutation = useResolveEscalation();
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [userResponse, setUserResponse] = useState("");

	const handleResolve = (esc: EscalationFromData, optionId: string) => {
		if (!planExecId || !workspaceId) return;
		resolveMutation.mutate({
			escalationId: esc.escalationId,
			planExecutionId: planExecId,
			workspaceId,
			chosenOptionId: optionId,
			userResponse: userResponse.trim() || undefined,
		});
		setUserResponse("");
	};

	// ── Loading state ───────────────────────────────────────────────
	if (isLoading) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 ${className}`}>
				<div className={`flex items-center gap-2 text-xs ${MUT}`}>
					<Loader2 size={12} className="animate-spin" />
					Loading escalations...
				</div>
			</div>
		);
	}

	// ── Error state ────────────────────────────────────────────────
	if (error) {
		return (
			<div className={`${SURF} rounded-lg border ${ERR_BG} ${BORD} p-3 ${className}`}>
				<div className={`flex items-center gap-2 text-xs ${ERR_TXT}`}>
					<AlertTriangle size={12} />
					Failed to load escalations
				</div>
			</div>
		);
	}

	const activeEscalations = escalations?.filter((e) => e.status === "awaiting_user") ?? [];
	const resolvedEscalations = escalations?.filter((e) => e.status !== "awaiting_user") ?? [];

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className}`}>
			{/* Header */}
			<div className={`flex items-center justify-between px-3 py-2 border-b ${BORD}`}>
				<div className="flex items-center gap-2">
					<AlertTriangle size={13} className={
						activeEscalations.length > 0 ? WARN_TXT : GOOD_TXT
					} />
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Lead Agent Escalations
					</span>
					{activeEscalations.length > 0 && (
						<span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${WARN_BG} ${WARN_TXT}`}>
							{activeEscalations.length} active
						</span>
					)}
				</div>
				<button
					onClick={() => refetch()}
					className={`text-[10px] p-1 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
					title="Refresh"
				>
					<RefreshCw size={12} />
				</button>
			</div>

			{/* Content */}
			<div className="p-3 space-y-2">
				{/* Empty state */}
				{(!escalations || escalations.length === 0) && (
					<div className={`flex items-center gap-2 text-xs ${MUT} py-2`}>
						<CheckCircle size={12} className={GOOD_TXT} />
						<span>No escalations</span>
					</div>
				)}

				{/* Active escalations */}
				{activeEscalations.map((esc) => (
					<div
						key={esc.escalationId}
						className={`rounded-lg border ${BORD} overflow-hidden`}
					>
						{/* Escalation header */}
						<button
							onClick={() => setExpandedId(expandedId === esc.escalationId ? null : esc.escalationId)}
							className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-left`}
						>
							{expandedId === esc.escalationId ? (
								<ChevronDown size={12} className={`shrink-0 ${MUT}`} />
							) : (
								<ChevronRight size={12} className={`shrink-0 ${MUT}`} />
							)}
							<AlertTriangle size={12} className={`shrink-0 ${WARN_TXT}`} />
							<span className="flex-1 truncate">{esc.reason}</span>
							<span className={`text-[10px] ${MUT}`}>
								{new Date(esc.issuedAt).toLocaleTimeString()}
							</span>
						</button>

						{/* Expanded: options */}
						{expandedId === esc.escalationId && (
							<div className="px-3 pb-3 space-y-2">
								{esc.options.map((opt) => (
									<button
										key={opt.id}
										onClick={() => handleResolve(esc, opt.id)}
										disabled={resolveMutation.isPending}
										className={`w-full flex items-start gap-2 px-3 py-2 rounded text-xs border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50 text-left transition-colors`}
									>
										<Send size={12} className={`mt-0.5 shrink-0 ${ACC_TXT}`} />
										<div className="min-w-0 flex-1">
											<p className="font-medium">{opt.label}</p>
											{opt.description && (
												<p className={`text-[10px] ${MUT} mt-0.5`}>{opt.description}</p>
											)}
										</div>
									</button>
								))}

								{/* Optional user response */}
								<div className="pt-1">
									<textarea
										placeholder="Optional response..."
										value={userResponse}
										onChange={(e) => setUserResponse(e.target.value)}
										className={`w-full text-[10px] px-2 py-1.5 rounded border ${BORD} bg-transparent ${TXT} placeholder:text-stone-400 resize-none`}
										rows={2}
									/>
								</div>

								{resolveMutation.isPending && (
									<div className={`flex items-center gap-2 text-xs ${MUT} py-1}`}>
										<Loader2 size={12} className="animate-spin" />
										Resolving...
									</div>
								)}
							</div>
						)}
					</div>
				))}

				{/* Resolved escalations */}
				{resolvedEscalations.length > 0 && (
					<details className="group">
						<summary className={`text-[10px] ${MUT} cursor-pointer hover:text-stone-600 dark:hover:text-stone-300`}>
							{resolvedEscalations.length} resolved escalation{resolvedEscalations.length !== 1 ? "s" : ""}
						</summary>
						<div className="mt-1 space-y-1">
							{resolvedEscalations.map((esc) => (
								<div key={esc.escalationId} className={`flex items-center gap-2 text-[10px] ${MUT} px-2 py-1`}>
									<CheckCircle size={10} className={`shrink-0 ${GOOD_TXT}`} />
									<span className="flex-1 truncate">{esc.reason}</span>
									<span>{esc.chosenOptionId ?? "resolved"}</span>
								</div>
							))}
						</div>
					</details>
				)}
			</div>
		</div>
	);
}

// ─── Workaround for TS inference ──────────────────────────────────────────

type EscalationFromData = NonNullable<ReturnType<typeof useEscalations>["data"]>[number];
