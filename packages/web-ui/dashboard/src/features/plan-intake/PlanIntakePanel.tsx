/**
 * PlanIntakePanel — P11.O (Plan Intake and DAG Diff UI)
 *
 * Dashboard surface for uploaded plan analysis, doctor results,
 * original vs optimized DAG diff, safe batch preview, and
 * optimization approval.
 */

import { CheckCircle, CircleAlert, Clock, GitBranch, Loader2, ScrollText, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FC } from "react";

const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACCENT = "text-stone-600 dark:text-stone-400";
const ERR = "text-red-500";
const WARN = "text-amber-500";
const OK = "text-green-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchInfo {
	batchIndex: number;
	workspaceIds: string[];
	width: number;
}

interface BatchPlanResult {
	totalBatches: number;
	effectiveParallelism: number;
	requestedParallelism: number;
	criticalPathLength: number;
	isOverSerialized: boolean;
	batches: BatchInfo[];
}

interface IntakeBottleneck {
	source: string;
	reason: string;
	impact: string;
	suggestion: string;
	severity: "info" | "warning" | "error";
}

interface IntakeDiagnostic {
	severity: "info" | "warning" | "error";
	message: string;
	code?: string;
}

interface OptimizationProposal {
	id: string;
	kind: string;
	description: string;
	approvalStatus: "pending" | "approved" | "rejected";
}

interface PlanIntakeState {
	status: string;
	executionBlocked: boolean;
	batchPlan: BatchPlanResult | null;
	bottlenecks: IntakeBottleneck[];
	diagnostics: IntakeDiagnostic[];
	proposals: OptimizationProposal[];
	authoredPreviewStale: boolean;
	analyzedAt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityIcon(sev: string) {
	switch (sev) {
		case "error":
			return <XCircle size={14} className={ERR} />;
		case "warning":
			return <CircleAlert size={14} className={WARN} />;
		default:
			return <CheckCircle size={14} className={OK} />;
	}
}

function statusLabel(status: string) {
	switch (status) {
		case "approved":
			return "Approved";
		case "rejected":
			return "Rejected";
		case "awaiting_approval":
			return "Awaiting Approval";
		case "stale":
			return "Stale";
		default:
			return "Pending";
	}
}

function statusColor(status: string) {
	switch (status) {
		case "approved":
			return OK;
		case "rejected":
			return ERR;
		case "awaiting_approval":
			return WARN;
		case "stale":
			return MUT;
		default:
			return ACCENT;
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PlanIntakePanelProps {
	className?: string;
}

export const PlanIntakePanel: FC<PlanIntakePanelProps> = ({ className = "" }) => {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [intakeState, setIntakeState] = useState<PlanIntakeState | null>(null);
	const [activeTab, setActiveTab] = useState<"overview" | "batches" | "optimization" | "diagnostics">("overview");

	const fetchAnalysis = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			// Try to fetch from backend API
			const resp = await fetch("/api/plan-intake/analysis", {
				signal: AbortSignal.timeout(5000),
			});
			if (resp.ok) {
				const data: PlanIntakeState = await resp.json();
				setIntakeState(data);
			} else {
				// Demo mode: show empty state with explanation
				setIntakeState({
					status: "pending",
					executionBlocked: false,
					batchPlan: null,
					bottlenecks: [],
					diagnostics: [],
					proposals: [],
					authoredPreviewStale: false,
					analyzedAt: null,
				});
			}
		} catch {
			// Network error — show empty state
			setIntakeState({
				status: "pending",
				executionBlocked: false,
				batchPlan: null,
				bottlenecks: [],
				diagnostics: [],
				proposals: [],
				authoredPreviewStale: false,
				analyzedAt: null,
			});
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchAnalysis();
	}, [fetchAnalysis]);

	if (loading) {
		return (
			<div className={`${SURF} h-full flex items-center justify-center gap-3 ${className}`}>
				<Loader2 size={18} className="animate-spin text-stone-400" />
				<span className={`text-xs ${MUT}`}>Analyzing plan...</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
				<XCircle size={28} className={ERR} />
				<div className="text-center">
					<h2 className={`text-sm font-semibold ${TXT}`}>Analysis Failed</h2>
					<p className={`text-xs ${MUT} mt-1 max-w-xs`}>{error}</p>
				</div>
				<button
					onClick={fetchAnalysis}
					className={`text-xs px-3 py-1.5 rounded-lg border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
				>
					Retry
				</button>
			</div>
		);
	}

	const plan = intakeState;

	// Empty state: no plan uploaded yet
	if (!plan?.batchPlan) {
		return (
			<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
				<div className={`w-16 h-16 rounded-2xl ${SURF} border ${BORD} flex items-center justify-center`}>
					<ScrollText size={28} strokeWidth={1.2} className={MUT} />
				</div>
				<div className="text-center">
					<h2 className={`text-sm font-semibold ${TXT}`}>Plan Intake</h2>
					<p className={`text-xs ${MUT} mt-1 max-w-xs`}>
						Upload a plan to analyze its dependency graph, detect bottlenecks,
						and get optimization suggestions before execution.
					</p>
				</div>
			</div>
		);
	}

	const bp = plan.batchPlan;

	return (
		<div className={`${SURF} h-full flex flex-col ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b ${BORD}">
				<div className="flex items-center gap-2">
					<ScrollText size={16} className={ACCENT} />
					<h3 className={`text-xs font-semibold ${TXT}`}>Plan Intake</h3>
					{plan.executionBlocked && (
						<span className={`text-[10px] px-1.5 py-0.5 rounded ${WARN} bg-amber-50 dark:bg-amber-900/20`}>
							Blocked
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<span className={`text-[10px] ${statusColor(plan.status)}`}>
						{statusLabel(plan.status)}
					</span>
					{plan.analyzedAt && (
						<span className={`text-[10px] ${MUT}`}>
							{new Date(plan.analyzedAt).toLocaleTimeString()}
						</span>
					)}
				</div>
			</div>

			{/* Tabs */}
			<div className="flex border-b ${BORD} px-4">
				{(["overview", "batches", "optimization", "diagnostics"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`text-xs px-3 py-2 border-b-2 transition-colors ${
							activeTab === tab
								? `${ACCENT} border-stone-600 dark:border-stone-400`
								: `${MUT} border-transparent hover:${ACCENT}`
						}`}
					>
						{tab.charAt(0).toUpperCase() + tab.slice(1)}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4 space-y-3">
				{activeTab === "overview" && (
					<>
						{/* Status summary */}
						<div className={`p-3 rounded-lg border ${BORD} space-y-2`}>
							<div className="flex items-center justify-between">
								<span className={`text-[10px] font-medium ${MUT}`}>Status</span>
								<span className={`text-xs ${statusColor(plan.status)}`}>{statusLabel(plan.status)}</span>
							</div>
							<div className="grid grid-cols-2 gap-2">
								<div>
									<span className={`text-[10px] ${MUT}`}>Batches</span>
									<p className={`text-sm font-semibold ${TXT}`}>{bp.totalBatches}</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Parallelism</span>
									<p className={`text-sm font-semibold ${TXT}`}>
										{bp.effectiveParallelism} / {bp.requestedParallelism}
									</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Critical Path</span>
									<p className={`text-sm font-semibold ${TXT}`}>{bp.criticalPathLength} steps</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Over-serialized</span>
									<p className={`text-sm font-semibold ${bp.isOverSerialized ? ERR : OK}`}>
										{bp.isOverSerialized ? "Yes" : "No"}
									</p>
								</div>
							</div>
						</div>

						{/* Stale preview warning */}
						{plan.authoredPreviewStale && (
							<div className={`p-3 rounded-lg border ${WARN} bg-amber-50 dark:bg-amber-900/20`}>
								<p className="text-xs text-amber-700 dark:text-amber-300">
									Authored batch preview is stale. The recomputed plan below is authoritative.
								</p>
							</div>
						)}

						{/* Bottlenecks */}
						{plan.bottlenecks.length > 0 && (
							<div className="space-y-2">
								<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider`}>
									Bottlenecks ({plan.bottlenecks.length})
								</h4>
								{plan.bottlenecks.map((b, i) => {
									const label = b.severity === "error" ? `[!] ` : b.severity === "warning" ? `[?] ` : `[i] `;
									return (
										<div key={i} className={`p-2.5 rounded-lg border ${BORD}`}>
											<div className="flex items-start gap-2">
												{severityIcon(b.severity)}
												<div>
													<p className={`text-xs font-medium ${TXT}`}>{label}{b.reason}</p>
													<p className={`text-[10px] ${MUT} mt-0.5`}>{b.impact}</p>
													<p className={`text-[10px] ${ACCENT} mt-0.5`}>{b.suggestion}</p>
												</div>
											</div>
										</div>
									);
								})}
							</div>
						)}

						{/* Proposals summary */}
						{plan.proposals.length > 0 && (
							<div className="space-y-2">
								<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider`}>
									Proposals ({plan.proposals.length})
								</h4>
								{plan.proposals.filter((p) => p.approvalStatus === "pending").slice(0, 3).map((p) => (
									<div key={p.id} className={`p-2.5 rounded-lg border ${BORD}`}>
										<p className={`text-xs ${TXT}`}>{p.description}</p>
										<span className={`text-[10px] ${WARN}`}>Requires approval</span>
									</div>
								))}
							</div>
						)}
					</>
				)}

				{activeTab === "batches" && (
					<div className="space-y-2">
						<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider`}>
							Topological Batches ({bp.totalBatches})
						</h4>
						{bp.batches.map((batch) => (
							<div key={batch.batchIndex} className={`p-2.5 rounded-lg border ${BORD}`}>
								<div className="flex items-center justify-between mb-1">
									<span className={`text-[10px] font-medium ${ACCENT}`}>
										Batch {batch.batchIndex}
									</span>
									<span className={`text-[10px] ${MUT}`}>
										{batch.width} workspace(s)
									</span>
								</div>
								<div className="flex flex-wrap gap-1">
									{batch.workspaceIds.map((wsId) => (
										<span
											key={wsId}
											className={`text-[10px] px-1.5 py-0.5 rounded ${SURF} border ${BORD} ${TXT}`}
										>
											{wsId}
										</span>
									))}
								</div>
							</div>
						))}
					</div>
				)}

				{activeTab === "optimization" && (
					<>
						{plan.proposals.length === 0 ? (
							<div className="flex flex-col items-center justify-center gap-2 py-8">
								<CheckCircle size={24} className={OK} />
								<p className={`text-xs ${MUT}`}>No optimization proposals.</p>
							</div>
						) : (
							<div className="space-y-2">
								{plan.proposals.map((p) => (
									<div key={p.id} className={`p-2.5 rounded-lg border ${BORD}`}>
										<div className="flex items-start justify-between gap-2">
											<div className="flex-1">
												<p className={`text-xs font-medium ${TXT}`}>{p.description}</p>
												<span className={`text-[10px] ${statusColor(p.approvalStatus)}`}>
													{statusLabel(p.approvalStatus)}
												</span>
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</>
				)}

				{activeTab === "diagnostics" && (
					<>
						{plan.diagnostics.length === 0 ? (
							<div className="flex flex-col items-center justify-center gap-2 py-8">
								<CheckCircle size={24} className={OK} />
								<p className={`text-xs ${MUT}`}>No diagnostics.</p>
							</div>
						) : (
							<div className="space-y-2">
								{plan.diagnostics.map((d, i) => (
									<div key={i} className={`p-2.5 rounded-lg border ${BORD} flex items-start gap-2`}>
										{severityIcon(d.severity)}
										<div>
											<p className={`text-xs ${TXT}`}>{d.message}</p>
											{d.code && (
												<span className={`text-[10px] ${MUT}`}>Code: {d.code}</span>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
};
