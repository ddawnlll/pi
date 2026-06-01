/**
 * HumanDirectivePanel — Minimal panel for issuing and viewing human directives (P41.10).
 *
 * Shows active human directives for a workspace and provides a form
 * to issue new directives with configurable severity.
 *
 * Acceptance Criteria:
 * - Shows active directives from the API
 * - Supports loading, empty, error, and data-present states
 * - Allows user to issue a new directive with severity level
 * - Minimal footprint
 */

import { useState } from "react";
import {
	AlertCircle,
	ChevronDown,
	ChevronRight,
	Loader2,
	Send,
	MessageSquare,
} from "lucide-react";

// ─── We import from the hooks file ──────────────────────────────────────────

import {
	useHumanDirectives,
	useIssueDirective,
} from "../hooks/useHumanDirectives";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const ERR_TXT = "text-red-600 dark:text-red-400";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";

// ─── Severity config ───────────────────────────────────────────────────────

const SEVERITIES = [
	{ value: "low" as const, color: "text-stone-500", bg: "bg-stone-100 dark:bg-stone-800" },
	{ value: "medium" as const, color: ACC_TXT, bg: ACC_BG },
	{ value: "high" as const, color: WARN_TXT, bg: "bg-amber-50 dark:bg-amber-900/20" },
	{ value: "blocking" as const, color: ERR_TXT, bg: "bg-red-50 dark:bg-red-900/20" },
];

// ─── Component ─────────────────────────────────────────────────────────────

interface HumanDirectivePanelProps {
	/** Plan execution ID */
	planExecId: string | null;
	/** Workspace ID */
	workspaceId: string | null;
	/** Optional class name */
	className?: string;
}

/**
 * Minimal Human Directive panel.
 *
 * Shows active human directives and allows issuing new ones.
 */
export function HumanDirectivePanel({
	planExecId,
	workspaceId,
	className = "",
}: HumanDirectivePanelProps) {
	const { data: directives, isLoading, error } = useHumanDirectives(planExecId, workspaceId);
	const issueMutation = useIssueDirective();

	const [directiveText, setDirectiveText] = useState("");
	const [severity, setSeverity] = useState<"low" | "medium" | "high" | "blocking">("medium");
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	const toggleExpand = (id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const handleIssue = () => {
		if (!planExecId || !workspaceId || !directiveText.trim()) return;
		issueMutation.mutate({
			planExecutionId: planExecId,
			workspaceId,
			directive: directiveText.trim(),
			severity,
		});
		setDirectiveText("");
	};

	// ── Loading state ───────────────────────────────────────────────
	if (isLoading) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 ${className}`}>
				<div className={`flex items-center gap-2 text-xs ${MUT}`}>
					<Loader2 size={12} className="animate-spin" />
					Loading directives...
				</div>
			</div>
		);
	}

	// ── Error state ────────────────────────────────────────────────
	if (error) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 ${className}`}>
				<div className={`flex items-center gap-2 text-xs ${ERR_TXT}`}>
					<AlertCircle size={12} />
					Failed to load directives
				</div>
			</div>
		);
	}

	const hasDirectives = directives && directives.length > 0;

	// Find severity meta for display
	const severityMeta = (s: string) =>
		SEVERITIES.find((se) => se.value === s) ?? SEVERITIES[1];

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className}`}>
			{/* Header */}
			<div className={`flex items-center justify-between px-3 py-2 border-b ${BORD}`}>
				<div className="flex items-center gap-2">
					<MessageSquare size={13} className={ACC_TXT} />
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Human Directives
					</span>
					{hasDirectives && (
						<span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${ACC_BG} ${ACC_TXT}`}>
							{directives!.length}
						</span>
					)}
				</div>
			</div>

			<div className="p-3 space-y-2.5">
				{/* Issue new directive form */}
				<div className="space-y-1.5">
					<textarea
						placeholder="Issue a directive to this workspace..."
						value={directiveText}
						onChange={(e) => setDirectiveText(e.target.value)}
						className={`w-full text-[11px] px-2 py-1.5 rounded border ${BORD} bg-transparent ${TXT} placeholder:text-stone-400 resize-none`}
						rows={2}
						disabled={issueMutation.isPending}
					/>
					<div className="flex items-center gap-2">
						{/* Severity selector */}
						<div className="flex gap-0.5">
							{SEVERITIES.map((s) => (
								<button
									key={s.value}
									onClick={() => setSeverity(s.value)}
									className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
										severity === s.value
											? `${s.color} ${s.bg}`
											: `${MUT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
									}`}
								>
									{s.value}
								</button>
							))}
						</div>
						<button
							onClick={handleIssue}
							disabled={!directiveText.trim() || issueMutation.isPending}
							className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium transition-colors ${
								directiveText.trim()
									? `${ACC_BG} ${ACC_TXT} hover:opacity-80`
									: `${MUT} cursor-not-allowed`
							}`}
						>
							{issueMutation.isPending ? (
								<Loader2 size={10} className="animate-spin" />
							) : (
								<Send size={10} />
							)}
							{issueMutation.isPending ? "Sending..." : "Send"}
						</button>
					</div>
					{issueMutation.isError && (
						<p className={`text-[10px] ${ERR_TXT}`}>
							Failed to issue directive: {issueMutation.error?.message ?? "Unknown error"}
						</p>
					)}
					{issueMutation.data?.success === false && (
						<p className={`text-[10px] ${ERR_TXT}`}>
							{issueMutation.data.error ?? "Failed to issue directive"}
						</p>
					)}
				</div>

				{/* Existing directives */}
				{hasDirectives ? (
					<div className="space-y-1">
						<p className={`text-[10px] font-medium ${MUT} uppercase tracking-wider`}>
							Active Directives
						</p>
						{directives!.map((d) => {
							const meta = severityMeta(d.severity);
							return (
								<div
									key={d.id}
									className={`rounded border ${BORD} overflow-hidden`}
								>
									<button
										onClick={() => toggleExpand(d.id)}
										className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-left`}
									>
										{expandedIds.has(d.id) ? (
											<ChevronDown size={10} className={`shrink-0 ${MUT}`} />
										) : (
											<ChevronRight size={10} className={`shrink-0 ${MUT}`} />
										)}
										<span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${meta.color} ${meta.bg}`}>
											{d.severity}
										</span>
										<span className="flex-1 truncate text-[11px]">{d.directive}</span>
										<span className={`text-[10px] ${MUT} shrink-0`}>
											{d.acknowledged ? "Acknowledged" : "Pending"}
										</span>
									</button>
									{expandedIds.has(d.id) && (
										<div className={`px-2.5 pb-2 text-[10px] ${MUT} space-y-0.5`}>
											<p>ID: {d.id.slice(0, 8)}...</p>
											<p>
												Issued: {new Date(d.issuedAt).toLocaleString()}
											</p>
											<p>Status: {d.acknowledged ? "Acknowledged by worker" : "Awaiting acknowledgment"}</p>
										</div>
									)}
								</div>
							);
						})}
					</div>
				) : (
					<div className={`flex items-center gap-2 text-xs ${MUT} py-1}`}>
						<MessageSquare size={12} className={MUT} />
						<span>No active directives</span>
					</div>
				)}
			</div>
		</div>
	);
}
