/**
 * ProposalDetailPanel — Detailed view of a single proposal (P8.G).
 *
 * Shows the full evidence bundle, audit trail, and approval status.
 * Read-only — no mutation controls (AC2 compliance).
 *
 * Acceptance Criteria:
 * - Displays proposal evidence and status (AC1)
 * - Makes approval requirements clear (AC3)
 */

import { useMemo } from "react";
import type { ProposalResponse } from "../types";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatJSON(obj: unknown): string {
	try {
		return JSON.stringify(obj, null, 2);
	} catch {
		return String(obj);
	}
}

/** Safe access to nested evidence fields. */
function getEvidenceField(
	evidence: ProposalResponse["evidence"],
	path: string[],
): unknown {
	let current: unknown = evidence;
	for (const key of path) {
		if (current && typeof current === "object" && key in current) {
			current = (current as Record<string, unknown>)[key];
		} else {
			return undefined;
		}
	}
	return current;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
	const cfg: Record<string, { label: string; color: string; bg: string }> = {
		pending: {
			label: "Pending Review",
			color: "text-amber-700 dark:text-amber-300",
			bg: "bg-amber-100 dark:bg-amber-900/40",
		},
		approved: {
			label: "Approved",
			color: "text-emerald-700 dark:text-emerald-300",
			bg: "bg-emerald-100 dark:bg-emerald-900/40",
		},
		rejected: {
			label: "Rejected",
			color: "text-red-700 dark:text-red-300",
			bg: "bg-red-100 dark:bg-red-900/40",
		},
	};

	const c = cfg[status] ?? cfg.pending;

	return (
		<span
			className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full ${c.color} ${c.bg}`}
		>
			<span
				className={`w-1.5 h-1.5 rounded-full ${
					status === "pending"
						? "bg-amber-500"
						: status === "approved"
							? "bg-emerald-500"
							: "bg-red-500"
				}`}
			/>
			{c.label}
		</span>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mb-4">
			<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2 px-4`}>
				{title}
			</h4>
			{children}
		</div>
	);
}

function KeyValue({
	label,
	value,
	mono,
}: {
	label: string;
	value: string | number | undefined | null;
	mono?: boolean;
}) {
	if (value == null) return null;
	return (
		<div className="flex items-center gap-2 px-4 py-1.5 text-xs">
			<span className={`${MUT} shrink-0 w-28`}>{label}</span>
			<span className={`${TXT} ${mono ? "font-mono text-[11px]" : ""} break-all`}>
				{String(value)}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface ProposalDetailPanelProps {
	proposal: ProposalResponse;
}

export function ProposalDetailPanel({ proposal }: ProposalDetailPanelProps) {
	const plannerOutput = proposal.evidence.plannerOutput ?? {};
	const queue = proposal.evidence.queue ?? {};
	const optimizations = proposal.evidence.optimizationProposals ?? [];

	const workspaces = useMemo(() => {
		const ws = getEvidenceField(proposal.evidence, ["queue", "workspaces"]);
		return Array.isArray(ws) ? ws : [];
	}, [proposal.evidence]);

	const predictedParallelism = useMemo(() => {
		return getEvidenceField(proposal.evidence, [
			"plannerOutput",
			"predictedParallelism",
		]) as Record<string, unknown> | undefined;
	}, [proposal.evidence]);

	const criticalPath = useMemo(() => {
		return getEvidenceField(proposal.evidence, [
			"plannerOutput",
			"criticalPath",
		]);
	}, [proposal.evidence]);

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Header */}
			<div
				className={`shrink-0 px-4 py-3 border-b ${BORD} ${SURF}`}
			>
				<div className="flex items-start justify-between gap-3 mb-2">
					<div className="min-w-0 flex-1">
						<h2 className={`text-sm font-semibold ${TXT} truncate`}>
							{proposal.title}
						</h2>
						<p className={`text-[11px] font-mono ${MUT} mt-0.5`}>
							{proposal.id}
						</p>
					</div>
					<StatusBadge status={proposal.status} />
				</div>
				<div className="flex items-center gap-3 text-[11px]">
					<span className={`${MUT}`}>
						Phase: <span className={`${TXT} font-medium`}>{proposal.phase}</span>
					</span>
					<span className={`${MUT}`}>
						Submitted:{" "}
						<span className={`${TXT} font-medium`}>
							{formatTimestamp(proposal.submittedAt)}
						</span>
					</span>
					{proposal.actionedAt && (
						<span className={`${MUT}`}>
							Actioned:{" "}
							<span className={`${TXT} font-medium`}>
								{formatTimestamp(proposal.actionedAt)}
							</span>
						</span>
					)}
				</div>
			</div>

			{/* Scrollable content */}
			<div className="flex-1 min-h-0 overflow-y-auto">
				{/* Approval Requirements Banner (AC3) */}
				{proposal.status === "pending" && (
					<div
						className={`mx-4 mt-3 mb-2 px-3 py-2.5 rounded-lg border ${BORD} bg-amber-50 dark:bg-amber-900/20`}
					>
						<p className="text-xs font-medium text-amber-800 dark:text-amber-300">
							Approval Required
						</p>
						<p className={`text-[11px] ${MUT} mt-0.5`}>
							This proposal is pending review and cannot be executed until it receives
							explicit approval. Review the evidence below and use the proposal management
							system to approve or reject this proposal.
						</p>
					</div>
				)}

				{proposal.status === "approved" && (
					<div
						className={`mx-4 mt-3 mb-2 px-3 py-2.5 rounded-lg border ${BORD} bg-emerald-50 dark:bg-emerald-900/20`}
					>
						<p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
							Approved — Ready for Execution
						</p>
						<p className={`text-[11px] ${MUT} mt-0.5`}>
							This proposal has been approved and may proceed to execution.
						</p>
					</div>
				)}

				{proposal.status === "rejected" && (
					<div
						className={`mx-4 mt-3 mb-2 px-3 py-2.5 rounded-lg border ${BORD} bg-red-50 dark:bg-red-900/20`}
					>
						<p className="text-xs font-medium text-red-800 dark:text-red-300">
							Rejected — Not Eligible for Execution
						</p>
						{proposal.rejectionReason && (
							<p className={`text-[11px] ${MUT} mt-0.5`}>
								Reason: {proposal.rejectionReason}
							</p>
						)}
					</div>
				)}

				{/* Summary */}
				<Section title="Summary">
					<div className={`mx-3 p-3 rounded-lg border ${BORD} ${SURF}`}>
						<KeyValue label="Proposal ID" value={proposal.id} mono />
						<KeyValue label="Phase" value={proposal.phase} />
						<KeyValue label="Status" value={proposal.status} />
						<KeyValue label="Workspaces" value={workspaces.length} />
						<KeyValue
							label="Parallelism"
							value={
								predictedParallelism
									? `${String(predictedParallelism.effective ?? "?")} / ${String(predictedParallelism.requested ?? "?")}`
									: undefined
							}
						/>
						<KeyValue
							label="Batches"
							value={
								predictedParallelism
									? String(predictedParallelism.totalBatches ?? "?")
									: undefined
							}
						/>
						<KeyValue
							label="Critical Path"
							value={
								Array.isArray(criticalPath)
									? `${criticalPath.length} batch(es)`
									: undefined
							}
						/>
						<KeyValue
							label="Warnings"
							value={
								Array.isArray(
									getEvidenceField(proposal.evidence, [
										"plannerOutput",
										"plannerWarnings",
									]),
								)
									? String(
											(
												getEvidenceField(proposal.evidence, [
													"plannerOutput",
													"plannerWarnings",
												]) as unknown[]
											).length,
										)
									: undefined
							}
						/>
						<KeyValue
							label="Suggestions"
							value={
								Array.isArray(
									getEvidenceField(proposal.evidence, [
										"plannerOutput",
										"plannerSuggestions",
									]),
								)
									? String(
											(
												getEvidenceField(proposal.evidence, [
													"plannerOutput",
													"plannerSuggestions",
												]) as unknown[]
											).length,
										)
									: undefined
							}
						/>
						<KeyValue
							label="Optimizations"
							value={optimizations.length > 0 ? optimizations.length : undefined}
						/>
					</div>
				</Section>

				{/* Workspace Queue (AC1 — evidence) */}
				<Section title="Workspace Queue">
					<div className={`mx-3 rounded-lg border ${BORD} overflow-hidden`}>
						{workspaces.length === 0 ? (
							<div className={`px-4 py-3 text-xs ${MUT}`}>
								No workspace data available
							</div>
						) : (
							<div className="divide-y ${BORD}">
								{(workspaces as Array<Record<string, unknown>>).map(
									(ws: Record<string, unknown>, i: number) => (
										<div key={String(ws.id ?? i)} className={`px-4 py-2 ${SURF}`}>
											<p className={`text-xs font-medium ${TXT}`}>
												{String(ws.title ?? ws.id ?? `Workspace ${i + 1}`)}
											</p>
											<div className="flex gap-3 mt-0.5">
												<span className={`text-[10px] ${MUT}`}>
													ID: {String(ws.id ?? "—")}
												</span>
												{ws.dependencies && (
													<span className={`text-[10px] ${MUT}`}>
														Deps:{" "}
														{(ws.dependencies as unknown[]).length > 0
															? (ws.dependencies as unknown[]).join(", ")
															: "none"}
													</span>
												)}
											</div>
										</div>
									),
								)}
							</div>
						)}
					</div>
				</Section>

				{/* Optimization Proposals (AC1 — evidence) */}
				{optimizations.length > 0 && (
					<Section title="Optimization Proposals">
						<div
							className={`mx-3 rounded-lg border ${BORD} divide-y ${BORD} overflow-hidden`}
						>
							{optimizations.map((opt) => (
								<div key={opt.id} className={`px-4 py-2 ${SURF}`}>
									<div className="flex items-center justify-between gap-2">
										<p className={`text-xs font-medium ${TXT}`}>
											{opt.description}
										</p>
										<span
											className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
												opt.approvalStatus === "approved"
													? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
													: opt.approvalStatus === "rejected"
														? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
														: "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
											}`}
										>
											{opt.approvalStatus}
										</span>
									</div>
									<p className={`text-[10px] ${MUT} mt-0.5`}>
										Kind: {opt.kind}
									</p>
								</div>
							))}
						</div>
					</Section>
				)}

				{/* Planner Output Raw Evidence (AC1) */}
				<Section title="Planner Output (Raw)">
					<div className={`mx-3 rounded-lg border ${BORD} overflow-hidden`}>
						<pre
							className={`px-4 py-3 text-[10px] font-mono leading-relaxed ${MUT} max-h-64 overflow-y-auto ${SURF}`}
						>
							{formatJSON(plannerOutput)}
						</pre>
					</div>
				</Section>

				{/* Audit Trail (AC3 — transparency) */}
				<Section title="Audit Trail">
					<div
						className={`mx-3 rounded-lg border ${BORD} divide-y ${BORD} overflow-hidden`}
					>
						{proposal.auditTrail.length === 0 ? (
							<div className={`px-4 py-3 text-xs ${MUT}`}>
								No audit entries
							</div>
						) : (
							proposal.auditTrail.map((entry, i) => (
								<div key={i} className={`px-4 py-2.5 ${SURF}`}>
									<div className="flex items-center gap-2">
										<span
											className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
												entry.action === "approved"
													? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
													: entry.action === "rejected"
														? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
														: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
											}`}
										>
											{entry.action}
										</span>
										<span className={`text-xs ${TXT}`}>{entry.actor}</span>
										<span className={`text-[10px] ${MUT}`}>
											{formatTimestamp(entry.timestamp)}
										</span>
									</div>
									{entry.reason && (
										<p className={`text-[10px] ${MUT} mt-1 ml-1`}>
											"{entry.reason}"
										</p>
									)}
								</div>
							))
						)}
					</div>
				</Section>

				{/* Spacer for bottom padding */}
				<div className="h-6" />
			</div>
		</div>
	);
}
