/**
 * ReviewScreen — Step 3 of the plan upload wizard.
 *
 * Three tabs: Preflight (parallelism summaries), Dep. diff (graph comparison),
 * and Approval (checklist for plans needing review).
 */

import { useState, useMemo } from "react";
import {
	AlertTriangle,
	AlertCircle,
	CheckCircle2,
	Eye,
	GitCompare,
	ShieldCheck,
	ChevronRight,
} from "lucide-react";
import type {
	ValidateWithPreviewResponse,
	DependencyGraphNode,
} from "../types";
import { GraphDiffView, type GraphDiffData } from "./PlanUploadDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelfModIssue {
	fileName: string;
	message: string;
}

interface ReviewScreenProps {
	/** All validation results keyed by filename */
	results: Map<string, ValidateWithPreviewResponse>;
	/** Approval checklist state */
	approvalChecks: Record<string, boolean>;
	/** Called when a checklist item is toggled */
	onApprovalCheckChange: (key: string, checked: boolean) => void;
	/** Whether the user has acknowledged the preflight summary */
	preflightAcknowledged: boolean;
	/** Called when preflight acknowledgment is toggled */
	onPreflightAcknowledgedChange: (v: boolean) => void;
	/** Safety override state (e.g. { "self_modification": true }) */
	safetyOverrides?: Record<string, boolean>;
	/** Called when a safety override is toggled */
	onSafetyOverride?: (key: string, approved: boolean) => void;
}

// ---------------------------------------------------------------------------
// Preflight Tab
// ---------------------------------------------------------------------------

function PreflightTab({
	results,
}: {
	results: Map<string, ValidateWithPreviewResponse>;
}) {
	const entries = useMemo(() => Array.from(results.entries()), [results]);

	const totals = useMemo(() => {
		let totalBatches = 0;
		let totalEffective = 0;
		let totalRequested = 0;
		let needsReview = 0;
		for (const [, r] of entries) {
			if (!r.success || !r.batchPlan) continue;
			totalBatches += r.batchPlan.totalBatches;
			totalEffective += r.batchPlan.effectiveParallelism;
			totalRequested += r.batchPlan.requestedParallelism;
			if (r.requiresApproval) needsReview++;
		}
		return {
			totalBatches,
			avgParallel:
				entries.length > 0
					? (totalEffective / entries.length).toFixed(1)
					: "0",
			needsReview,
		};
	}, [entries]);

	return (
		<div className="space-y-4">
			{/* Summary cards */}
			<div className="grid grid-cols-3 gap-3">
				<div className="flex flex-col gap-1 p-3 rounded-lg border border-gray-700 bg-gray-800/50">
					<span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
						Total Batches
					</span>
					<span className="text-lg font-semibold text-gray-200">
						{totals.totalBatches}
					</span>
				</div>
				<div className="flex flex-col gap-1 p-3 rounded-lg border border-gray-700 bg-gray-800/50">
					<span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
						Avg Effective Parallelism
					</span>
					<span className="text-lg font-semibold text-gray-200">
						{totals.avgParallel}
					</span>
				</div>
				<div
					className={`flex flex-col gap-1 p-3 rounded-lg border ${
						totals.needsReview > 0
							? "border-amber-800 bg-amber-900/30"
							: "border-gray-700 bg-gray-800/50"
					}`}
				>
					<span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
						Needs Review
					</span>
					<span
						className={`text-lg font-semibold ${
							totals.needsReview > 0 ? "text-amber-400" : "text-emerald-400"
						}`}
					>
						{totals.needsReview}
					</span>
				</div>
			</div>

			{/* Per-file details */}
			<div className="space-y-2">
				{entries.map(([fileName, result]) => {
					if (!result.success || !result.batchPlan) return null;
					const bp = result.batchPlan;
					return (
						<div
							key={fileName}
							className="p-3 rounded-lg border border-gray-700 bg-gray-800/30"
						>
							<div className="flex items-center justify-between mb-2">
								<p className="text-xs font-medium text-gray-200">{fileName}</p>
								{result.requiresApproval && (
									<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-900/30 text-amber-300 border border-amber-800">
										<AlertTriangle size={8} />
										review
									</span>
								)}
							</div>

							{/* Parallelism metrics */}
							<div className="grid grid-cols-4 gap-2 mb-2">
								<div>
									<span className="text-[9px] text-gray-500">Batches</span>
									<p className="text-xs text-gray-200 font-medium">
										{bp.totalBatches}
									</p>
								</div>
								<div>
									<span className="text-[9px] text-gray-500">Effective</span>
									<p className="text-xs text-gray-200 font-medium">
										{bp.effectiveParallelism}
									</p>
								</div>
								<div>
									<span className="text-[9px] text-gray-500">Requested</span>
									<p className="text-xs text-gray-200 font-medium">
										{bp.requestedParallelism}
									</p>
								</div>
								<div>
									<span className="text-[9px] text-gray-500">
										&Delta;
									</span>
									<p
										className={`text-xs font-medium ${
											bp.parallelismDelta > 0
												? "text-amber-400"
												: "text-gray-400"
										}`}
									>
										{bp.parallelismDelta > 0
											? `+${bp.parallelismDelta}`
											: "0"}
									</p>
								</div>
							</div>

							{/* Batch visualization */}
							{bp.batches.length > 0 && (
								<div className="flex flex-wrap gap-1">
									{bp.batches.map((batch) => (
										<div
											key={batch.batchIndex}
											className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] bg-blue-900/20 text-blue-300 border border-blue-800 font-mono"
											title={`Batch ${batch.batchIndex}: ${batch.workspaceIds.join(", ")}`}
										>
											B{batch.batchIndex}
											<span className="text-blue-500">
												&times;{batch.width}
											</span>
											{batch.batchIndex < bp.totalBatches && (
												<ChevronRight size={8} className="text-blue-700" />
											)}
										</div>
									))}
								</div>
							)}

							{/* Over-serialized warning */}
							{bp.isOverSerialized && (
								<div className="mt-2 flex items-center gap-1 text-[10px] text-amber-400">
									<AlertTriangle size={10} />
									Over-serialized &mdash; requested &gt; effective
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Dep Diff Tab
// ---------------------------------------------------------------------------

function DepDiffTab({
	results,
}: {
	results: Map<string, ValidateWithPreviewResponse>;
}) {
	const entries = useMemo(() => Array.from(results.entries()), [results]);

	// For each file that has a batchPlan, check if there are any changes
	// (In the current design, the diff requires an edited graph from patches.
	//  If no patches were applied, there's nothing to diff.)
	const hasAnyDiffs = useMemo(() => {
		for (const [, result] of entries) {
			if (result.success && result.batchPlan) {
				// If the plan has suggestedFixes or errors, it means the user
				// could potentially edit it — but without an editedGraph we
				// show "No dependency changes."
				return false;
			}
		}
		return false;
	}, [entries]);

	if (!hasAnyDiffs) {
		return (
			<div className="flex flex-col items-center justify-center py-12 gap-3">
				<GitCompare size={28} className="text-gray-600" strokeWidth={1.2} />
				<p className="text-sm text-gray-500">No dependency changes</p>
				<p className="text-[10px] text-gray-600 max-w-sm text-center">
					Apply dependency patches in the ParallelismEditor to see a diff
					between the original and edited dependency graphs.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{entries.map(([fileName, result]) => {
				if (!result.success || !result.batchPlan) return null;
				// Create a no-diff data structure since we don't have edited graphs yet
				const diffData: GraphDiffData = {
					added: [],
					removed: [],
					changed: [],
				};
				return (
					<div key={fileName}>
						<p className="text-xs font-medium text-gray-300 mb-2">
							{fileName}
						</p>
						<GraphDiffView diffData={diffData} />
					</div>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Approval Tab
// ---------------------------------------------------------------------------

function ApprovalTab({
	results,
	approvalChecks,
	onApprovalCheckChange,
	safetyOverrides,
	onSafetyOverride,
}: {
	results: Map<string, ValidateWithPreviewResponse>;
	approvalChecks: Record<string, boolean>;
	onApprovalCheckChange: (key: string, checked: boolean) => void;
	safetyOverrides?: Record<string, boolean>;
	onSafetyOverride?: (key: string, approved: boolean) => void;
}) {
	const plansNeedingReview = useMemo(
		() =>
			Array.from(results.entries()).filter(
				([, r]) => r.success && r.requiresApproval,
			),
		[results],
	);

	// Compute self-modification issues directly from validation results
	// (instead of relying on a potentially stale prop from the parent)
	const selfModIssues: SelfModIssue[] = useMemo(() => {
		const issues: SelfModIssue[] = [];
		for (const [fileName, r] of results) {
			for (const c of r.safety?.critical ?? []) {
				if (c.type === "self_modification") {
					issues.push({ fileName, message: c.message });
				}
			}
		}
		return issues;
	}, [results]);

	const selfModApproved = safetyOverrides?.["self_modification"] ?? false;

	const allChecked =
		approvalChecks["reviewed_preflight"] &&
		approvalChecks["acknowledged_warnings"] &&
		approvalChecks["confirmed_patches"];

	const noPlansNeedReview = plansNeedingReview.length === 0 && selfModIssues.length === 0;

	return (
		<div className="space-y-4">
			{/* When no plans need review and no self-mod issues, show a pass-through message */}
			{noPlansNeedReview && (
				<div className="flex flex-col items-center justify-center py-12 gap-3">
					<ShieldCheck size={28} className="text-emerald-600" strokeWidth={1.2} />
					<p className="text-sm text-emerald-400">No plans require approval</p>
					<p className="text-[10px] text-gray-600 max-w-sm text-center">
						All plans can be executed without review.
					</p>
				</div>
			)}

			{/* Warning banner — only when there are plans needing review */}
			{plansNeedingReview.length > 0 && (
				<div className="flex items-start gap-2 p-3 rounded-lg border border-amber-800 bg-amber-900/30">
					<AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
					<div>
						<p className="text-xs font-medium text-amber-300">
							{plansNeedingReview.length} plan
							{plansNeedingReview.length !== 1 ? "s" : ""} require
							{plansNeedingReview.length === 1 ? "s" : ""} review
						</p>
						<ul className="mt-1 space-y-0.5">
							{plansNeedingReview.map(([fileName]) => (
								<li
									key={fileName}
									className="text-[10px] text-amber-400 flex items-center gap-1"
								>
									<AlertCircle size={8} />
									{fileName}
								</li>
							))}
						</ul>
					</div>
				</div>
			)}

			{/* Checklist — only shown when there are plans that need standard review approval */}
			{plansNeedingReview.length > 0 && (
				<div className="space-y-2">
					<label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800 transition-colors">
						<input
							type="checkbox"
							checked={approvalChecks["reviewed_preflight"] ?? false}
							onChange={(e) =>
								onApprovalCheckChange("reviewed_preflight", e.target.checked)
							}
							className="mt-0.5 w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 accent-blue-500"
						/>
						<div>
							<p className="text-xs font-medium text-gray-200">
								I have reviewed the preflight summary
							</p>
							<p className="text-[10px] text-gray-500 mt-0.5">
								Batch plan, parallelism settings, and workspace dependencies
							</p>
						</div>
					</label>

					<label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800 transition-colors">
						<input
							type="checkbox"
							checked={approvalChecks["acknowledged_warnings"] ?? false}
							onChange={(e) =>
								onApprovalCheckChange("acknowledged_warnings", e.target.checked)
							}
							className="mt-0.5 w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 accent-blue-500"
						/>
						<div>
							<p className="text-xs font-medium text-gray-200">
								I acknowledge the warnings
							</p>
							<p className="text-[10px] text-gray-500 mt-0.5">
								Over-serialization, safety warnings, and other non-blocking issues
							</p>
						</div>
					</label>

					<label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800 transition-colors">
						<input
							type="checkbox"
							checked={approvalChecks["confirmed_patches"] ?? false}
							onChange={(e) =>
								onApprovalCheckChange("confirmed_patches", e.target.checked)
							}
							className="mt-0.5 w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 accent-blue-500"
						/>
						<div>
							<p className="text-xs font-medium text-gray-200">
								I confirm dependency patches are correct
							</p>
							<p className="text-[10px] text-gray-500 mt-0.5">
								Applied dependency graph modifications and batch adjustments
							</p>
						</div>
					</label>
				</div>
			)}

			{/* Self-modification safety override */}
			{selfModIssues.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-start gap-2 p-3 rounded-lg border border-purple-800 bg-purple-900/30">
						<AlertTriangle size={14} className="text-purple-400 shrink-0 mt-0.5" />
						<div>
							<p className="text-xs font-medium text-purple-300">
								Self-modification detected
							</p>
							<ul className="mt-1 space-y-0.5">
								{selfModIssues.map((issue, i) => (
									<li
										key={i}
										className="text-[10px] text-purple-400 flex items-start gap-1"
									>
										<AlertCircle size={8} className="mt-0.5 shrink-0" />
										<span>{issue.message}</span>
									</li>
								))}
							</ul>
						</div>
					</div>
					<label className="flex items-start gap-2.5 p-3 rounded-lg border border-purple-800/50 bg-gray-800/50 cursor-pointer hover:bg-gray-800 transition-colors">
						<input
							type="checkbox"
							checked={selfModApproved}
							onChange={(e) =>
								onSafetyOverride?.("self_modification", e.target.checked)
							}
							className="mt-0.5 w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 accent-purple-500"
						/>
						<div>
							<p className="text-xs font-medium text-gray-200">
								I approve self-modification
							</p>
							<p className="text-[10px] text-gray-500 mt-0.5">
								This plan modifies files inside the project tooling itself
								(system prompts, firewall, policies). Only approve if you
								understand the consequences.
							</p>
						</div>
					</label>
				</div>
			)}

			{/* Status */}
			{(() => {
				// Determine if the standard approval checklist is satisfied.
				// When no plans require review (only self-mod issues), the checklist is vacuously satisfied.
				const checklistMet =
					plansNeedingReview.length === 0 ? true : allChecked;

				if (checklistMet && selfModApproved) {
					return (
						<div className="flex items-center gap-2 p-2.5 rounded-lg border border-emerald-800 bg-emerald-900/30">
							<CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
							<span className="text-xs text-emerald-300">
								{selfModIssues.length > 0
									? "All checks completed. Self-modification approved."
									: "All checks completed. You can proceed to execution."}
							</span>
						</div>
					);
				}

				if (checklistMet && !selfModApproved && selfModIssues.length > 0) {
					return (
						<div className="flex items-center gap-2 p-2.5 rounded-lg border border-amber-800 bg-amber-900/30">
							<AlertTriangle size={12} className="text-amber-400 shrink-0" />
							<span className="text-xs text-amber-300">
								Approve self-modification above to proceed.
							</span>
						</div>
					);
				}

				return null;
			})()}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main ReviewScreen component
// ---------------------------------------------------------------------------

type ReviewTab = "preflight" | "depdiff" | "approval";

export function ReviewScreen(props: ReviewScreenProps) {
	const { results, approvalChecks, onApprovalCheckChange, safetyOverrides, onSafetyOverride } = props;
	const [activeTab, setActiveTab] = useState<ReviewTab>("preflight");

	const hasPlansNeedingApproval = useMemo(
		() =>
			Array.from(results.values()).some(
				(r) => r.success && r.requiresApproval,
			),
		[results],
	);

	const tabs: Array<{
		id: ReviewTab;
		label: string;
		icon: React.ElementType;
		showDot?: boolean;
	}> = [
		{ id: "preflight", label: "Preflight", icon: Eye },
		{ id: "depdiff", label: "Dep. diff", icon: GitCompare },
		{
			id: "approval",
			label: "Approval",
			icon: ShieldCheck,
			showDot: hasPlansNeedingApproval,
		},
	];

	return (
		<div className="flex flex-col gap-4">
			{/* ── Tab bar ── */}
			<div className="flex border-b border-gray-700">
				{tabs.map((tab) => {
					const isActive = activeTab === tab.id;
					const Icon = tab.icon;
					return (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
								isActive
									? "border-blue-500 text-blue-400"
									: "border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600"
							}`}
						>
							<Icon size={12} />
							{tab.label}
							{tab.showDot && (
								<span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
							)}
						</button>
					);
				})}
			</div>

			{/* ── Tab content ── */}
			<div className="flex-1 min-h-0 overflow-y-auto">
				{activeTab === "preflight" && <PreflightTab results={results} />}
				{activeTab === "depdiff" && <DepDiffTab results={results} />}
				{activeTab === "approval" && (
					<ApprovalTab
						results={results}
						approvalChecks={approvalChecks}
						onApprovalCheckChange={onApprovalCheckChange}
						safetyOverrides={safetyOverrides}
						onSafetyOverride={onSafetyOverride}
					/>
				)}
			</div>
		</div>
	);
}
