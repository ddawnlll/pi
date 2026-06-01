/**
 * CurrentBottleneckSummary — Compact bottleneck summary card (P42.04).
 *
 * Shows the current bottleneck in execution, including which workspace
 * is blocked and what's blocking it. Hides when no bottleneck is detected.
 */

import { AlertTriangle, ArrowRight, BarChart3, GitBranch } from "lucide-react";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BottleneckData {
	/** Workspace ID that is the bottleneck */
	workspaceId: string;
	/** Human-readable description of the bottleneck */
	description: string;
	/** Type of bottleneck */
	type: "dependency" | "resource" | "stuck" | "retry_exhausted" | "other";
	/** Workspace IDs blocked by this bottleneck */
	blockedWorkspaceIds?: string[];
	/** Suggested resolution */
	suggestion?: string;
	/** Timestamp when bottleneck was detected */
	detectedAt: number;
}

export interface CurrentBottleneckSummaryProps {
	/** Current bottleneck, or undefined if none */
	bottleneck?: BottleneckData;
	/** Loading state */
	loading?: boolean;
	/** Whether there are no bottlenecks (show "all clear") */
	allClear?: boolean;
	/** Callback to navigate to workspace detail */
	onViewBottleneck?: (workspaceId: string) => void;
	/** Additional class name */
	className?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function typeLabel(type: BottleneckData["type"]): string {
	switch (type) {
		case "dependency": return "Dependency Blocked";
		case "resource": return "Resource Constrained";
		case "stuck": return "Stalled";
		case "retry_exhausted": return "Retries Exhausted";
		case "other": return "Blocked";
	}
}

function typeColor(type: BottleneckData["type"]): string {
	switch (type) {
		case "dependency":
			return "text-amber-600 dark:text-amber-400";
		case "resource":
			return "text-orange-600 dark:text-orange-400";
		case "stuck":
			return "text-red-600 dark:text-red-400";
		case "retry_exhausted":
			return "text-red-600 dark:text-red-400";
		case "other":
			return "text-stone-600 dark:text-stone-400";
	}
}

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function CurrentBottleneckSummary({
	bottleneck,
	loading = false,
	allClear = false,
	onViewBottleneck,
	className = "",
}: CurrentBottleneckSummaryProps) {
	if (loading) {
		return (
			<div
				className={`rounded-lg border ${BORD} ${SURF} p-4 ${className}`}
				role="status"
				aria-label="Loading bottleneck"
			>
				<div className="space-y-2">
					<div className="h-4 w-32 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
					<div className="h-3 w-full bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
				</div>
			</div>
		);
	}

	if (allClear) {
		return (
			<div
				className={`rounded-lg border ${BORD} ${SURF} p-3 flex items-center gap-2 ${className}`}
				role="status"
			>
				<BarChart3 size={14} className="text-emerald-500 shrink-0" />
				<p className={`text-xs ${TXT_MUTED}`}>No current bottlenecks</p>
			</div>
		);
	}

	if (!bottleneck) {
		return null;
	}

	return (
		<div
			className={`rounded-lg border ${BORD} ${SURF} overflow-hidden ${className}`}
			role="region"
			aria-label="Current bottleneck"
		>
			{/* Header */}
			<div className={`flex items-center gap-1.5 px-3 py-1.5 border-b ${BORD} bg-amber-50 dark:bg-amber-950/20`}>
				<AlertTriangle size={11} className="text-amber-500" />
				<span className="text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
					Bottleneck
				</span>
			</div>

			{/* Content */}
			<div className="p-3">
				<div className="flex items-start gap-2.5">
					<GitBranch size={14} className={`shrink-0 mt-0.5 ${typeColor(bottleneck.type)}`} />
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className={`text-[10px] font-medium ${typeColor(bottleneck.type)}`}>
								{typeLabel(bottleneck.type)}
							</span>
							<span className={`text-[9px] font-mono ${TXT_MUTED}`}>
								{bottleneck.workspaceId.length > 12
									? `${bottleneck.workspaceId.slice(0, 8)}..`
									: bottleneck.workspaceId}
							</span>
							<span className={`text-[9px] ${TXT_MUTED}`}>
								{relativeTime(bottleneck.detectedAt)}
							</span>
						</div>
						<p className={`text-xs ${TXT} mt-0.5`}>{bottleneck.description}</p>

						{bottleneck.blockedWorkspaceIds && bottleneck.blockedWorkspaceIds.length > 0 && (
							<div className="flex items-center gap-1 mt-1.5">
								<span className={`text-[9px] ${TXT_MUTED}`}>Blocks:</span>
								<div className="flex flex-wrap gap-1">
									{bottleneck.blockedWorkspaceIds.map((id) => (
										<span
											key={id}
											className="text-[9px] font-mono px-1 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
										>
											{id.length > 10 ? `${id.slice(0, 6)}..` : id}
										</span>
									))}
								</div>
							</div>
						)}

						{bottleneck.suggestion && (
							<p className={`text-[10px] ${TXT_MUTED} mt-1.5 italic`}>
								Suggestion: {bottleneck.suggestion}
							</p>
						)}

						{onViewBottleneck && (
							<button
								onClick={() => onViewBottleneck(bottleneck.workspaceId)}
								className="inline-flex items-center gap-1 mt-2 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
							>
								View workspace
								<ArrowRight size={10} />
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
