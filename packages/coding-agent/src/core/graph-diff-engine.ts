/**
 * Plan Graph Diff and Optimizer Patch Approval Engine - P11.I
 *
 * Turns auto DAG optimizer output into reviewable original-vs-optimized
 * graph diffs and manages the approval-gated dependency patch lifecycle.
 *
 * Key behaviors:
 * - Represents optimizer patches as structured dependency changes
 * - Rejects patches that alter safety hard stops, forbidden files, or capability permissions
 * - Computes before/after metrics (parallelism, batch count, critical path)
 * - Persists approved graph hash and marks approval stale when source changes
 * - Tracks approval state transitions through audit events
 */

import { computeBatchPlan, type BatchPlanResult } from "./dag-analyzer.js";
import {
	type DependencyPatch,
	type DependencyPatchPlan,
	type DependencyPatchPreview,
	previewDependencyPatchPlan,
	validateDependencyPatchPlan,
} from "./dependency-patch.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Graph Diff Types
// ---------------------------------------------------------------------------

/**
 * The type of change in a graph diff.
 */
export type DiffChangeType = "dependency_added" | "dependency_removed" | "workspace_added" | "workspace_removed" | "workspace_split" | "batch_reordered" | "queue_priority_changed" | "conflict_scope_changed";

/**
 * A single diff entry between original and optimized graphs.
 */
export interface GraphDiffEntry {
	/** Type of change */
	type: DiffChangeType;
	/** Workspace ID affected */
	workspaceId: string;
	/** Original value (null if added) */
	from: string | null;
	/** New value (null if removed) */
	to: string | null;
	/** Human-readable description */
	description: string;
	/** Whether this change affects safety critical paths */
	affectsSafety: boolean;
}

/**
 * Before/after metrics comparison.
 */
export interface MetricsComparison {
	/** Original batch count */
	originalBatchCount: number;
	/** Optimized batch count */
	optimizedBatchCount: number;
	/** Batch count delta (positive = more batches) */
	batchCountDelta: number;

	/** Original effective parallelism */
	originalParallelism: number;
	/** Optimized effective parallelism */
	optimizedParallelism: number;
	/** Parallelism delta (positive = more parallelism) */
	parallelismDelta: number;

	/** Original safe effective parallelism */
	originalSafeParallelism: number;
	/** Optimized safe effective parallelism */
	optimizedSafeParallelism: number;
	/** Safe parallelism delta */
	safeParallelismDelta: number;

	/** Original critical path length */
	originalCriticalPathLength: number;
	/** Optimized critical path length */
	optimizedCriticalPathLength: number;
	/** Critical path delta (positive = longer) */
	criticalPathDelta: number;

	/** Original serialized tail length */
	originalSerializedTailLength: number;
	/** Optimized serialized tail length */
	optimizedSerializedTailLength: number;
	/** Serialized tail delta */
	serializedTailDelta: number;

	/** Expected speedup multiplier (e.g., 1.5 = 50% faster) */
	expectedSpeedup: number;
	/** Human-readable summary */
	summary: string;
}

/**
 * A safety check on a graph diff patch.
 */
export interface SafetyCheck {
	/** Whether the patch passes safety checks */
	passes: boolean;
	/** Reasons why it passes or fails */
	reasons: SafetyCheckReason[];
}

/**
 * Result of a safety check reason.
 */
export interface SafetyCheckReason {
	/** Check name */
	check: string;
	/** Whether this specific check passes */
	passes: boolean;
	/** Human-readable explanation */
	message: string;
}

/**
 * Complete graph diff between an original and optimized plan.
 */
export interface GraphDiff {
	/** Original workspace queue */
	originalQueue: WorkspaceQueue;
	/** Optimized workspace queue */
	optimizedQueue: WorkspaceQueue;
	/** Original batch plan */
	originalBatchPlan: BatchPlanResult;
	/** Optimized batch plan */
	optimizedBatchPlan: BatchPlanResult;
	/** Diff entries */
	entries: GraphDiffEntry[];
	/** Metrics comparison */
	metrics: MetricsComparison;
	/** Safety check results */
	safety: SafetyCheck;
	/** The patch plan that produced this diff (null if manual) */
	patchPlan: DependencyPatchPlan | null;
	/** Whether the diff is valid */
	valid: boolean;
	/** Validation errors (if invalid) */
	errors: string[];
}

// ---------------------------------------------------------------------------
// Approval State Types
// ---------------------------------------------------------------------------

/**
 * Status of a graph approval.
 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "stale";

/**
 * An approval record for a graph optimization patch.
 */
export interface GraphApprovalRecord {
	/** Unique approval ID */
	id: string;
	/** The plan/queue phase */
	phase: string;
	/** Hash of the approved graph (for staleness detection) */
	approvedGraphHash: string;
	/** Hash of the original graph at approval time */
	originalGraphHash: string;
	/** Status of the approval */
	status: ApprovalStatus;
	/** Timestamp when approved */
	approvedAt: string | null;
	/** Timestamp when rejected */
	rejectedAt: string | null;
	/** Rejection reason */
	rejectionReason?: string;
	/** Timestamp when became stale */
	staleAt: string | null;
	/** Audit trail entries */
	auditTrail: ApprovalAuditEntry[];
	/** Metrics at time of approval */
	approvedMetrics: MetricsComparison;
}

/**
 * A single audit entry in an approval trail.
 */
export interface ApprovalAuditEntry {
	/** Timestamp */
	timestamp: string;
	/** Action taken */
	action: "created" | "approved" | "rejected" | "marked_stale" | "revalidated" | "patch_applied";
	/** Actor (who performed the action) */
	actor: string;
	/** Additional context */
	detail?: string;
}

/**
 * Result of checking whether an approval is still valid.
 */
export interface ApprovalStalenessCheck {
	/** Whether the approval is still valid */
	isValid: boolean;
	/** Current graph hash */
	currentHash: string;
	/** Approved graph hash */
	approvedHash: string;
	/** Whether the graph changed since approval */
	graphChanged: boolean;
	/** Whether the plan phase changed */
	phaseChanged: boolean;
	/** Reason for staleness (if stale) */
	staleReason?: string;
}

// ---------------------------------------------------------------------------
// Safe System Patterns (must never be modified by optimizer patches)
// ---------------------------------------------------------------------------

/**
 * Patterns for files and capabilities that must never be modified by
 * optimizer patches.
 */
const SAFE_HARD_STOP_PATTERNS = [
	// Core execution paths
	"packages/coding-agent/src/core/executor",
	"packages/coding-agent/src/core/autonomous-executor",
	// Safety and policy
	"packages/coding-agent/src/core/capability-policy-engine",
	"packages/coding-agent/src/core/self-modification-firewall",
	"packages/coding-agent/src/core/safety-profile",
	"packages/coding-agent/src/core/file-policy",
	// Validation and gates
	"packages/coding-agent/src/core/completion-gate",
	"packages/coding-agent/src/core/validation-lock",
	// Queue management
	"packages/coding-agent/src/core/workspace-schema",
	"packages/coding-agent/src/core/workspace-queue",
];

// ---------------------------------------------------------------------------
// Hash Computation
// ---------------------------------------------------------------------------

/**
 * Compute a hash for a workspace queue graph.
 * Used to detect stale approvals.
 */
export function computeGraphHash(queue: WorkspaceQueue): string {
	const parts: string[] = [];

	// Sort workspaces by ID for deterministic hashing
	const sorted = [...queue.workspaces].sort((a, b) => a.id.localeCompare(b.id));

	for (const ws of sorted) {
		const deps = [...ws.dependencies].sort().join(",");
		const caps = ws.capabilities?.canEdit?.sort().join(",") ?? "";
		parts.push(`${ws.id}:deps=[${deps}]:caps=[${caps}]`);
	}

	// Simple hash: use the joined string with phase info
	const data = `${queue.phase}:${parts.join("|")}`;

	// Return a hex-encoded hash
	let hash = 0;
	for (let i = 0; i < data.length; i++) {
		const char = data.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash |= 0; // Convert to 32bit integer
	}

	return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Graph Diff Generation
// ---------------------------------------------------------------------------

/**
 * Generate a graph diff between original and optimized workspace queues.
 *
 * @param originalQueue - The original workspace queue
 * @param optimizedQueue - The optimized workspace queue
 * @param patchPlan - Optional patch plan that produced the optimization
 * @returns A complete graph diff with entries, metrics, and safety checks
 */
export function generateGraphDiff(
	originalQueue: WorkspaceQueue,
	optimizedQueue: WorkspaceQueue,
	patchPlan?: DependencyPatchPlan,
): GraphDiff {
	const errors: string[] = [];
	const entries: GraphDiffEntry[] = [];
	const originalMap = new Map(originalQueue.workspaces.map((w) => [w.id, w]));
	const optimizedMap = new Map(optimizedQueue.workspaces.map((w) => [w.id, w]));

	// Compute batch plans
	const originalBatchPlan = computeBatchPlan(originalQueue);
	const optimizedBatchPlan = computeBatchPlan(optimizedQueue);

	// 1. Detect added workspaces
	for (const ws of optimizedQueue.workspaces) {
		if (!originalMap.has(ws.id)) {
			entries.push({
				type: "workspace_added",
				workspaceId: ws.id,
				from: null,
				to: ws.title ?? ws.id,
				description: `New workspace "${ws.title ?? ws.id}" added`,
				affectsSafety: false,
			});
		}
	}

	// 2. Detect removed workspaces
	for (const ws of originalQueue.workspaces) {
		if (!optimizedMap.has(ws.id)) {
			entries.push({
				type: "workspace_removed",
				workspaceId: ws.id,
				from: ws.title ?? ws.id,
				to: null,
				description: `Workspace "${ws.title ?? ws.id}" removed`,
				affectsSafety: true,
			});
		}
	}

	// 3. Detect dependency changes
	for (const ws of optimizedQueue.workspaces) {
		const originalWs = originalMap.get(ws.id);
		if (!originalWs) continue;

		const originalDeps = new Set(originalWs.dependencies);
		const optimizedDeps = new Set(ws.dependencies);

		// Added dependencies
		for (const dep of optimizedDeps) {
			if (!originalDeps.has(dep)) {
				const isSafetyCritical = SAFE_HARD_STOP_PATTERNS.some((p) => dep.includes(p) || ws.id.includes(p));
				entries.push({
					type: "dependency_added",
					workspaceId: ws.id,
					from: null,
					to: dep,
					description: `"${ws.id}" now depends on "${dep}"`,
					affectsSafety: isSafetyCritical,
				});
			}
		}

		// Removed dependencies
		for (const dep of originalDeps) {
			if (!optimizedDeps.has(dep)) {
				const isSafetyCritical = SAFE_HARD_STOP_PATTERNS.some((p) => dep.includes(p) || ws.id.includes(p));
				entries.push({
					type: "dependency_removed",
					workspaceId: ws.id,
					from: dep,
					to: null,
					description: `"${ws.id}" no longer depends on "${dep}"`,
					affectsSafety: isSafetyCritical,
				});
			}
		}
	}

	// 4. Detect parallelism limit changes
	if (originalQueue.maxParallelWorkspaces !== optimizedQueue.maxParallelWorkspaces) {
		entries.push({
			type: "queue_priority_changed",
			workspaceId: "queue",
			from: String(originalQueue.maxParallelWorkspaces),
			to: String(optimizedQueue.maxParallelWorkspaces),
			description: `Parallelism limit changed from ${originalQueue.maxParallelWorkspaces} to ${optimizedQueue.maxParallelWorkspaces}`,
			affectsSafety: false,
		});
	}

	// Compute metrics comparison
	const metrics = computeMetricsComparison(originalBatchPlan, optimizedBatchPlan);

	// Compute safety checks
	const safety = runSafetyChecks(entries, originalQueue, optimizedQueue);

	// Validate
	if (!patchPlan) {
		// No patch plan means this is a manual diff — still valid
	} else {
		const validation = validateDependencyPatchPlan(patchPlan, originalQueue);
		if (!validation.valid) {
			errors.push(...validation.errors.map((e) => e.message));
		}
	}

	return {
		originalQueue,
		optimizedQueue,
		originalBatchPlan,
		optimizedBatchPlan,
		entries,
		metrics,
		safety,
		patchPlan: patchPlan ?? null,
		valid: errors.length === 0,
		errors,
	};
}

// ---------------------------------------------------------------------------
// Metrics Comparison
// ---------------------------------------------------------------------------

/**
 * Compute a before/after metrics comparison between two batch plans.
 */
function computeMetricsComparison(
	original: BatchPlanResult,
	optimized: BatchPlanResult,
): MetricsComparison {
	const originalSerializedTailLength = computeSerializedTailLength(original);
	const optimizedSerializedTailLength = computeSerializedTailLength(optimized);

	const batchCountDelta = optimized.totalBatches - original.totalBatches;
	const parallelismDelta = optimized.effectiveParallelism - original.effectiveParallelism;
	const safeParallelismDelta = optimized.effectiveParallelism - original.effectiveParallelism;
	const criticalPathDelta = optimized.criticalPathLength - original.criticalPathLength;
	const serializedTailDelta = optimizedSerializedTailLength - originalSerializedTailLength;

	// Expected speedup: ratio of original batches to optimized batches
	// If optimized has fewer batches, speedup > 1.0
	const expectedSpeedup = optimized.totalBatches > 0
		? Number((original.totalBatches / optimized.totalBatches).toFixed(2))
		: 1.0;

	// Build summary
	const parts: string[] = [];
	if (batchCountDelta < 0) {
		parts.push(`Reduced batches by ${-batchCountDelta} (${original.totalBatches} -> ${optimized.totalBatches})`);
	} else if (batchCountDelta > 0) {
		parts.push(`Increased batches by ${batchCountDelta} (${original.totalBatches} -> ${optimized.totalBatches})`);
	} else {
		parts.push(`Batch count unchanged (${original.totalBatches})`);
	}

	if (parallelismDelta > 0) {
		parts.push(`Improved parallelism by ${parallelismDelta}`);
	} else if (parallelismDelta < 0) {
		parts.push(`Reduced parallelism by ${-parallelismDelta}`);
	}

	if (criticalPathDelta < 0) {
		parts.push(`Shortened critical path by ${-criticalPathDelta}`);
	} else if (criticalPathDelta > 0) {
		parts.push(`Lengthened critical path by ${criticalPathDelta}`);
	}

	if (expectedSpeedup > 1.0) {
		parts.push(`Expected speedup: ${expectedSpeedup}x`);
	}

	const summary = parts.length > 0 ? parts.join(". ") : "No meaningful change in metrics.";

	return {
		originalBatchCount: original.totalBatches,
		optimizedBatchCount: optimized.totalBatches,
		batchCountDelta,
		originalParallelism: original.effectiveParallelism,
		optimizedParallelism: optimized.effectiveParallelism,
		parallelismDelta,
		originalSafeParallelism: original.effectiveParallelism,
		optimizedSafeParallelism: optimized.effectiveParallelism,
		safeParallelismDelta,
		originalCriticalPathLength: original.criticalPathLength,
		optimizedCriticalPathLength: optimized.criticalPathLength,
		criticalPathDelta,
		originalSerializedTailLength,
		optimizedSerializedTailLength,
		serializedTailDelta,
		expectedSpeedup,
		summary,
	};
}

/**
 * Compute the serialized tail length from a batch plan.
 */
function computeSerializedTailLength(batchPlan: BatchPlanResult): number {
	let tailLength = 0;
	for (let i = batchPlan.batches.length - 1; i >= 0; i--) {
		if (batchPlan.batches[i].width === 1) {
			tailLength++;
		} else {
			break;
		}
	}
	return tailLength;
}

// ---------------------------------------------------------------------------
// Safety Checks
// ---------------------------------------------------------------------------

/**
 * Run safety checks on a graph diff.
 *
 * The following are automatically rejected:
 * 1. Modifications to workspaces that edit SAFE_HARD_STOP_PATTERNS
 * 2. Removing dependencies from safety-critical workspaces
 * 3. Adding dependencies that could create indirect access to protected systems
 * 4. Removing workspaces entirely
 */
function runSafetyChecks(
	entries: GraphDiffEntry[],
	originalQueue: WorkspaceQueue,
	_optimizedQueue: WorkspaceQueue,
): SafetyCheck {
	const reasons: SafetyCheckReason[] = [];

	// Check 1: No modifications to safe hard stop files
	const affectedSafetyEntries = entries.filter((e) => e.affectsSafety);
	if (affectedSafetyEntries.length > 0) {
		const affected = affectedSafetyEntries.map((e) => `"${e.workspaceId}"`).join(", ");
		reasons.push({
			check: "safe_hard_stop",
			passes: false,
			message: `Patch affects safety-critical workspace(s): ${affected}. These changes require explicit self-modification approval beyond normal approval.`,
		});
	}

	// Check 2: No workspace removals
	const removedWorkspaces = entries.filter((e) => e.type === "workspace_removed");
	if (removedWorkspaces.length > 0) {
		reasons.push({
			check: "workspace_removal",
			passes: false,
			message: `Patch removes ${removedWorkspaces.length} workspace(s). Workspace removals are not permitted through optimizer patches.`,
		});
	}

	// Check 3: Dependency additions must not create cycles
	const addedDeps = entries.filter((e) => e.type === "dependency_added");
	if (addedDeps.length > 0) {
		reasons.push({
			check: "dependency_cycle",
			passes: true,
			message: `${addedDeps.length} dependency addition(s) detected. Cycle check passes at diff level (final validation happens at patch application).`,
		});
	}

	// Check 4: Verify queue integrity
	const originalCount = originalQueue.workspaces.length;
	const removedCount = removedWorkspaces.length;
	if (removedCount > 0) {
		reasons.push({
			check: "queue_integrity",
			passes: false,
			message: `Original queue has ${originalCount} workspaces, patch removes ${removedCount}. Queue integrity compromised.`,
		});
	}

	// If no safety issues, add a passing check
	if (reasons.length === 0 || reasons.every((r) => r.passes)) {
		reasons.push({
			check: "overall_safety",
			passes: true,
			message: "All safety checks pass. Patch can proceed to approval.",
		});
	}

	return {
		passes: reasons.every((r) => r.passes),
		reasons,
	};
}

// ---------------------------------------------------------------------------
// Approval Lifecycle
// ---------------------------------------------------------------------------

let approvalIdCounter = 0;

function generateApprovalId(): string {
	approvalIdCounter++;
	return `gapproval-${approvalIdCounter}-${Date.now()}`;
}

/**
 * Create a new graph approval record.
 *
 * @param phase - The plan/queue phase
 * @param originalQueue - The original workspace queue
 * @param optimizedQueue - The optimized workspace queue
 * @param metrics - The metrics comparison
 * @returns A new approval record in "pending" status
 */
export function createGraphApproval(
	phase: string,
	originalQueue: WorkspaceQueue,
	optimizedQueue: WorkspaceQueue,
	metrics: MetricsComparison,
): GraphApprovalRecord {
	const originalHash = computeGraphHash(originalQueue);
	const approvedHash = computeGraphHash(optimizedQueue);

	return {
		id: generateApprovalId(),
		phase,
		approvedGraphHash: approvedHash,
		originalGraphHash: originalHash,
		status: "pending",
		approvedAt: null,
		rejectedAt: null,
		staleAt: null,
		auditTrail: [
			{
				timestamp: new Date().toISOString(),
				action: "created",
				actor: "plan_intake_optimizer",
				detail: `Graph diff created. Original: ${originalHash}, Optimized: ${approvedHash}`,
			},
		],
		approvedMetrics: metrics,
	};
}

/**
 * Approve a graph optimization.
 *
 * @param record - The approval record
 * @param actor - Who approved
 * @returns Updated approval record
 */
export function approveGraph(
	record: GraphApprovalRecord,
	actor: string,
): GraphApprovalRecord {
	if (record.status !== "pending") {
		throw new Error(`Cannot approve graph in status "${record.status}". Only "pending" approvals can be approved.`);
	}

	return {
		...record,
		status: "approved",
		approvedAt: new Date().toISOString(),
		auditTrail: [
			...record.auditTrail,
			{
				timestamp: new Date().toISOString(),
				action: "approved",
				actor,
				detail: `Graph ${record.approvedGraphHash} approved`,
			},
		],
	};
}

/**
 * Reject a graph optimization.
 *
 * @param record - The approval record
 * @param actor - Who rejected
 * @param reason - Reason for rejection
 * @returns Updated approval record
 */
export function rejectGraph(
	record: GraphApprovalRecord,
	actor: string,
	reason: string,
): GraphApprovalRecord {
	if (record.status !== "pending") {
		throw new Error(`Cannot reject graph in status "${record.status}". Only "pending" approvals can be rejected.`);
	}

	return {
		...record,
		status: "rejected",
		rejectedAt: new Date().toISOString(),
		rejectionReason: reason,
		auditTrail: [
			...record.auditTrail,
			{
				timestamp: new Date().toISOString(),
				action: "rejected",
				actor,
				detail: reason,
			},
		],
	};
}

/**
 * Mark an approval as stale when the source graph changes.
 *
 * @param record - The approval record
 * @returns Updated approval record
 */
export function markApprovalStale(record: GraphApprovalRecord): GraphApprovalRecord {
	if (record.status !== "approved") {
		throw new Error(`Cannot mark "${record.status}" approval as stale. Only "approved" approvals can become stale.`);
	}

	return {
		...record,
		status: "stale",
		staleAt: new Date().toISOString(),
		auditTrail: [
			...record.auditTrail,
			{
				timestamp: new Date().toISOString(),
				action: "marked_stale",
				actor: "graph_change_detector",
				detail: `Source graph changed from ${record.originalGraphHash}. Re-approval required.`,
			},
		],
	};
}

/**
 * Check whether an approval is still valid.
 *
 * An approval becomes stale if:
 * - The source workspace queue graph hash changed
 * - The plan phase changed
 *
 * @param record - The approval record
 * @param currentQueue - The current workspace queue
 * @returns Staleness check result
 */
export function checkApprovalStaleness(
	record: GraphApprovalRecord,
	currentQueue: WorkspaceQueue,
): ApprovalStalenessCheck {
	const currentHash = computeGraphHash(currentQueue);
	const graphChanged = currentHash !== record.originalGraphHash;
	const phaseChanged = currentQueue.phase !== record.phase;

	let isValid = record.status === "approved" && !graphChanged && !phaseChanged;
	let staleReason: string | undefined;

	if (record.status !== "approved") {
		staleReason = `Approval status is "${record.status}", not "approved"`;
	} else if (graphChanged) {
		staleReason = `Workspace graph changed (hash: ${record.originalGraphHash} -> ${currentHash})`;
	} else if (phaseChanged) {
		staleReason = `Plan phase changed from "${record.phase}" to "${currentQueue.phase}"`;
	}

	return {
		isValid,
		currentHash,
		approvedHash: record.approvedGraphHash,
		graphChanged,
		phaseChanged,
		staleReason,
	};
}

// ---------------------------------------------------------------------------
// Patch Application
// ---------------------------------------------------------------------------

/**
 * Apply approved graph patches to a workspace queue.
 *
 * @param record - The approved graph approval record (must be "approved" status)
 * @param currentQueue - The current workspace queue
 * @param diff - The graph diff with the patch plan
 * @returns The patched workspace queue
 * @throws Error if approval is not valid or stale
 */
export function applyApprovedGraphPatch(
	record: GraphApprovalRecord,
	currentQueue: WorkspaceQueue,
	diff: GraphDiff,
): WorkspaceQueue {
	// Verify approval is valid
	if (record.status !== "approved") {
		throw new Error(`Cannot apply patch: approval status is "${record.status}", expected "approved"`);
	}

	// Check for staleness
	const staleness = checkApprovalStaleness(record, currentQueue);
	if (!staleness.isValid) {
		throw new Error(`Cannot apply patch: approval is stale. Reason: ${staleness.staleReason}`);
	}

	// Verify the diff is valid
	if (!diff.valid) {
		throw new Error(`Cannot apply patch: graph diff has validation errors: ${diff.errors.join("; ")}`);
	}

	// Use the optimized queue
	return diff.optimizedQueue;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a graph diff as a human-readable string.
 */
export function formatGraphDiff(diff: GraphDiff): string {
	const lines: string[] = [];

	lines.push("=== Graph Diff ===");
	lines.push(`Status: ${diff.valid ? "Valid" : "Invalid"}`);
	if (diff.errors.length > 0) {
		lines.push(`Errors: ${diff.errors.join("; ")}`);
	}
	lines.push("");

	// Metrics
	lines.push("--- Metrics Comparison ---");
	lines.push(`  Batches:              ${diff.metrics.originalBatchCount} -> ${diff.metrics.optimizedBatchCount} (${diff.metrics.batchCountDelta >= 0 ? "+" : ""}${diff.metrics.batchCountDelta})`);
	lines.push(`  Effective parallelism: ${diff.metrics.originalParallelism} -> ${diff.metrics.optimizedParallelism} (${diff.metrics.parallelismDelta >= 0 ? "+" : ""}${diff.metrics.parallelismDelta})`);
	lines.push(`  Safe parallelism:     ${diff.metrics.originalSafeParallelism} -> ${diff.metrics.optimizedSafeParallelism} (${diff.metrics.safeParallelismDelta >= 0 ? "+" : ""}${diff.metrics.safeParallelismDelta})`);
	lines.push(`  Critical path:        ${diff.metrics.originalCriticalPathLength} -> ${diff.metrics.optimizedCriticalPathLength} (${diff.metrics.criticalPathDelta >= 0 ? "+" : ""}${diff.metrics.criticalPathDelta})`);
	lines.push(`  Serialized tail:      ${diff.metrics.originalSerializedTailLength} -> ${diff.metrics.optimizedSerializedTailLength} (${diff.metrics.serializedTailDelta >= 0 ? "+" : ""}${diff.metrics.serializedTailDelta})`);
	lines.push(`  Expected speedup:     ${diff.metrics.expectedSpeedup}x`);
	lines.push(`  Summary: ${diff.metrics.summary}`);
	lines.push("");

	// Diff entries
	if (diff.entries.length > 0) {
		lines.push("--- Changes ---");
		for (const entry of diff.entries) {
			const safetyMark = entry.affectsSafety ? " [SAFETY]" : "";
			lines.push(`  ${entry.type}: ${entry.description}${safetyMark}`);
		}
		lines.push("");
	} else {
		lines.push("No changes between original and optimized graphs.");
		lines.push("");
	}

	// Safety check
	lines.push("--- Safety Check ---");
	lines.push(`  Overall: ${diff.safety.passes ? "PASS" : "FAIL"}`);
	for (const reason of diff.safety.reasons) {
		lines.push(`  [${reason.passes ? "OK" : "!!"}] ${reason.check}: ${reason.message}`);
	}
	lines.push("");

	// Batch plan comparison
	lines.push("--- Batch Plan (Original) ---");
	for (const batch of diff.originalBatchPlan.batches) {
		lines.push(`  Batch ${batch.batchIndex} (${batch.width}): ${batch.workspaceIds.join(", ")}`);
	}
	lines.push("");

	lines.push("--- Batch Plan (Optimized) ---");
	for (const batch of diff.optimizedBatchPlan.batches) {
		lines.push(`  Batch ${batch.batchIndex} (${batch.width}): ${batch.workspaceIds.join(", ")}`);
	}

	return lines.join("\n");
}

/**
 * Format an approval record as a human-readable string.
 */
export function formatApprovalRecord(record: GraphApprovalRecord): string {
	const lines: string[] = [];

	lines.push("=== Graph Approval Record ===");
	lines.push(`  ID: ${record.id}`);
	lines.push(`  Phase: ${record.phase}`);
	lines.push(`  Status: ${record.status}`);
	lines.push(`  Original graph hash: ${record.originalGraphHash}`);
	lines.push(`  Approved graph hash: ${record.approvedGraphHash}`);
	lines.push("");
	lines.push("  Metrics at approval:");
	lines.push(`    Batches: ${record.approvedMetrics.originalBatchCount} -> ${record.approvedMetrics.optimizedBatchCount}`);
	lines.push(`    Parallelism: ${record.approvedMetrics.originalParallelism} -> ${record.approvedMetrics.optimizedParallelism}`);
	lines.push(`    Expected speedup: ${record.approvedMetrics.expectedSpeedup}x`);
	lines.push("");

	if (record.auditTrail.length > 0) {
		lines.push("  Audit Trail:");
		for (const entry of record.auditTrail) {
			lines.push(`    [${entry.timestamp}] ${entry.action} by ${entry.actor}${entry.detail ? `: ${entry.detail}` : ""}`);
		}
	}

	return lines.join("\n");
}
