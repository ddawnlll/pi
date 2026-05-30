/**
 * Invariant Checker — P38.1
 *
 * Asserts execution platform invariants after each scenario run.
 * Verifies FSM validity, CompletionGate behavior, Lead Agent decisions,
 * parallelism bounds, patch transaction safety, and visibility requirements.
 */

import type { LeadReviewResult } from "../lead-agent/types.js";
import type { GauntletPlan } from "./synthetic-plan-builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvariantSeverity = "error" | "warning" | "info";

export interface InvariantResult {
	/** Invariant name */
	name: string;
	/** Whether the invariant passed */
	passed: boolean;
	/** Severity if it failed */
	severity: InvariantSeverity;
	/** Human-readable message */
	message: string;
	/** Category */
	category: InvariantCategory;
}

export type InvariantCategory =
	| "attempt-fsm"
	| "stop-continue"
	| "completion-gate"
	| "lead-agent"
	| "patch-transaction"
	| "parallelism"
	| "visibility"
	| "general";

// ---------------------------------------------------------------------------
// Scenario execution context passed to the checker
// ---------------------------------------------------------------------------

export interface ScenarioInvariantContext {
	/** Plan that was executed */
	plan: GauntletPlan;
	/** Observed workspace states after execution */
	workspaceStates: Array<{
		workspaceId: string;
		stage: string;
		errorMessage?: string;
		completionGateBlockReasons?: string[];
		lastCommand?: string;
		lastCommandExitCode?: number | null;
		attempts: number;
	}>;
	/** Lead Agent review results collected during execution */
	leadResults: LeadReviewResult[];
	/** How many directives were created */
	directiveCount: number;
	/** How many escalations were created */
	escalationCount: number;
	/** FSM transitions observed (from -> to) */
	fsmTransitions: Array<{ from: string; to: string; workspaceId: string }>;
	/** Stale completions that were (or should have been) ignored */
	staleCompletionsCount: number;
	/** Direct worker repo mutations attempted */
	directMutationsObserved: number;
	/** Patch artifacts processed */
	patchApplyCount: number;
	/** Patches rejected or handoff */
	patchRejectedCount: number;
	/** Max observed active workers */
	maxObservedParallelism: number;
	/** Average observed active workers */
	averageActiveWorkers: number;
	/** Active worker timeline snapshots */
	activeWorkerTimeline: Array<{ timestampMs: number; active: number }>;
	/** Whether plan completed */
	planCompleted: boolean;
	/** Whether report was written */
	reportWritten: boolean;
	/** Completion gate block events */
	completionGateBlocks: Array<{
		workspaceId: string;
		reasons: string[];
	}>;
	/** No-tests-found detected events */
	noTestsFoundEvents: Array<{
		workspaceId: string;
		command: string;
	}>;
	/** Visibility artifacts produced */
	visibilityArtifacts: Record<string, boolean>;
	/** Execution mode used */
	executionMode: "stable_3" | "patch_transaction";
	/** Whether scenario ran in fast mode */
	fastMode: boolean;
}

// ---------------------------------------------------------------------------
// Invariant checker
// ---------------------------------------------------------------------------

export function checkInvariants(ctx: ScenarioInvariantContext): InvariantResult[] {
	const results: InvariantResult[] = [];

	// --- FSM Invariants ---
	checkFSMInvariants(ctx, results);

	// --- Stop/Continue Invariants ---
	checkStopContinueInvariants(ctx, results);

	// --- Completion Gate Invariants ---
	checkCompletionGateInvariants(ctx, results);

	// --- Lead Agent Invariants ---
	checkLeadAgentInvariants(ctx, results);

	// --- Patch Transaction Invariants ---
	checkPatchTransactionInvariants(ctx, results);

	// --- Parallelism Invariants ---
	checkParallelismInvariants(ctx, results);

	// --- Visibility Invariants ---
	checkVisibilityInvariants(ctx, results);

	// --- General ---
	checkGeneralInvariants(ctx, results);

	return results;
}

// ---------------------------------------------------------------------------
// FSM Invariants
// ---------------------------------------------------------------------------

function checkFSMInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	// No PENDING -> SUCCEEDED
	const pendingToSucceeded = ctx.fsmTransitions.filter((t) => t.from === "PENDING" && t.to === "SUCCEEDED");
	results.push({
		name: "No PENDING -> SUCCEEDED attempted",
		passed: pendingToSucceeded.length === 0,
		severity: "error",
		message:
			pendingToSucceeded.length === 0
				? "No illegal PENDING -> SUCCEEDED transitions observed."
				: `Found ${pendingToSucceeded.length} illegal PENDING -> SUCCEEDED transitions: ${pendingToSucceeded.map((t) => t.workspaceId).join(", ")}`,
		category: "attempt-fsm",
	});

	// No SUCCEEDED -> RUNNING
	const succeededToRunning = ctx.fsmTransitions.filter((t) => t.from === "SUCCEEDED" && t.to === "RUNNING");
	results.push({
		name: "No SUCCEEDED -> RUNNING retry-cache regression",
		passed: succeededToRunning.length === 0,
		severity: "error",
		message:
			succeededToRunning.length === 0
				? "No illegal SUCCEEDED -> RUNNING transitions observed."
				: `Found ${succeededToRunning.length} illegal SUCCEEDED -> RUNNING transitions: ${succeededToRunning.map((t) => t.workspaceId).join(", ")}`,
		category: "attempt-fsm",
	});

	// Stale completion after reset is ignored
	if (ctx.plan.expected.staleCompletionIgnored) {
		results.push({
			name: "Stale completion after reset ignored",
			passed: ctx.staleCompletionsCount > 0, // At least detected
			severity: "error",
			message:
				ctx.staleCompletionsCount > 0
					? `Stale completions detected: ${ctx.staleCompletionsCount}.`
					: "Expected stale completion but none detected.",
			category: "attempt-fsm",
		});
	}
}

// ---------------------------------------------------------------------------
// Stop/Continue Invariants
// ---------------------------------------------------------------------------

function checkStopContinueInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	// Stop prevents new scheduling (checked against plan expectations)
	// This is checked more deeply in specific stop/continue scenarios
	if (ctx.plan.id === "G9") {
		const hasStaleIgnored = ctx.staleCompletionsCount > 0;
		results.push({
			name: "Stale completion from stopped workspace ignored",
			passed: hasStaleIgnored,
			severity: "error",
			message: hasStaleIgnored
				? "Stale completion correctly ignored."
				: "Stale completion was not detected as stale.",
			category: "stop-continue",
		});
	}
}

// ---------------------------------------------------------------------------
// Completion Gate Invariants
// ---------------------------------------------------------------------------

function checkCompletionGateInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	if (ctx.plan.expected.completionGateBlocks) {
		const blocked = ctx.completionGateBlocks.length > 0;
		results.push({
			name: "CompletionGate blocks when conditions not met",
			passed: blocked,
			severity: "error",
			message: blocked
				? `CompletionGate correctly blocked ${ctx.completionGateBlocks.length} workspace(s): ${ctx.completionGateBlocks.map((b) => `${b.workspaceId}: ${b.reasons.join(", ")}`).join("; ")}`
				: "Expected CompletionGate to block but it did not.",
			category: "completion-gate",
		});
	}

	if (ctx.plan.expected.noTestsFoundClassified) {
		const noTestsDetected = ctx.noTestsFoundEvents.length > 0;
		results.push({
			name: "No tests found exit zero is treated as failure",
			passed: noTestsDetected,
			severity: "error",
			message: noTestsDetected
				? `No-tests-found detected in ${ctx.noTestsFoundEvents.length} workspace(s).`
				: "Expected no-tests-found detection but none occurred.",
			category: "completion-gate",
		});

		// Plan should NOT complete when no tests are found
		if (noTestsDetected) {
			results.push({
				name: "Plan does not complete on no-tests-found",
				passed: !ctx.planCompleted,
				severity: "error",
				message: ctx.planCompleted
					? "Plan completed despite no-tests-found — this is a bug."
					: "Plan correctly blocked from completing on no-tests-found.",
				category: "completion-gate",
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Lead Agent Invariants
// ---------------------------------------------------------------------------

function checkLeadAgentInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	if (ctx.plan.expected.leadDirectiveCreated) {
		results.push({
			name: "LeadDirective created on repeated failure",
			passed: ctx.directiveCount > 0,
			severity: "error",
			message:
				ctx.directiveCount > 0
					? `LeadAgent created ${ctx.directiveCount} directive(s).`
					: "Expected LeadDirective but none created.",
			category: "lead-agent",
		});
	}

	if (ctx.plan.expected.userEscalationCreated) {
		results.push({
			name: "UserEscalation created after retry budget exhausted",
			passed: ctx.escalationCount > 0,
			severity: "error",
			message:
				ctx.escalationCount > 0
					? `LeadAgent created ${ctx.escalationCount} escalation(s).`
					: "Expected UserEscalation but none created.",
			category: "lead-agent",
		});
	}

	// If plan does not complete AND failure repeated, LeadAgent should act
	if (!ctx.planCompleted && ctx.workspaceStates.some((ws) => ws.attempts >= 2)) {
		// At minimum, a directive should exist
		const hasLeadAction = ctx.directiveCount > 0 || ctx.escalationCount > 0;
		results.push({
			name: "LeadAgent acts on repeated failures",
			passed: hasLeadAction,
			severity: "warning",
			message: hasLeadAction
				? "LeadAgent responded to repeated failures."
				: "Repeated failures without LeadAgent intervention.",
			category: "lead-agent",
		});
	}
}

// ---------------------------------------------------------------------------
// Patch Transaction Invariants
// ---------------------------------------------------------------------------

function checkPatchTransactionInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	if (ctx.executionMode !== "patch_transaction") return;

	// No direct repo mutation from workers
	if (ctx.plan.expected.noDirectMutation) {
		results.push({
			name: "Workers do not directly mutate repo",
			passed: ctx.directMutationsObserved === 0,
			severity: "error",
			message:
				ctx.directMutationsObserved === 0
					? "No direct worker mutations observed."
					: `${ctx.directMutationsObserved} direct worker mutations detected — patch transaction violation.`,
			category: "patch-transaction",
		});
	}

	// Patch rejection or handoff for violations
	if (ctx.plan.expected.patchRejectedOrHandoff) {
		const rejectionHandled = ctx.patchRejectedCount > 0;
		results.push({
			name: "Patch rejected or handoff_required for writeSet violation",
			passed: rejectionHandled,
			severity: "error",
			message: rejectionHandled
				? `${ctx.patchRejectedCount} patch(es) rejected or handoff triggered.`
				: "Expected patch rejection or handoff but none occurred.",
			category: "patch-transaction",
		});
	}
}

// ---------------------------------------------------------------------------
// Parallelism Invariants
// ---------------------------------------------------------------------------

function checkParallelismInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	if (ctx.plan.expected.maxParallelism !== undefined) {
		results.push({
			name: `Max observed parallelism <= ${ctx.plan.expected.maxParallelism}`,
			passed: ctx.maxObservedParallelism <= ctx.plan.expected.maxParallelism,
			severity: ctx.maxObservedParallelism > ctx.plan.expected.maxParallelism ? "error" : "info",
			message:
				ctx.maxObservedParallelism <= ctx.plan.expected.maxParallelism
					? `Max observed: ${ctx.maxObservedParallelism} (limit: ${ctx.plan.expected.maxParallelism}).`
					: `Max observed ${ctx.maxObservedParallelism} exceeds limit ${ctx.plan.expected.maxParallelism}.`,
			category: "parallelism",
		});
	}

	if (ctx.plan.expected.minObservedParallelism !== undefined) {
		results.push({
			name: `Max observed parallelism >= ${ctx.plan.expected.minObservedParallelism}`,
			passed: ctx.maxObservedParallelism >= ctx.plan.expected.minObservedParallelism,
			severity: ctx.maxObservedParallelism < ctx.plan.expected.minObservedParallelism ? "error" : "info",
			message:
				ctx.maxObservedParallelism >= ctx.plan.expected.minObservedParallelism
					? `Max observed: ${ctx.maxObservedParallelism} (minimum expected: ${ctx.plan.expected.minObservedParallelism}).`
					: `Max observed ${ctx.maxObservedParallelism} below minimum expected ${ctx.plan.expected.minObservedParallelism}.`,
			category: "parallelism",
		});
	}

	// stable_3 specific
	if (ctx.executionMode === "stable_3") {
		results.push({
			name: "stable_3 max workers <= 3",
			passed: ctx.maxObservedParallelism <= 3,
			severity: "error",
			message:
				ctx.maxObservedParallelism <= 3
					? `stable_3 max parallelism: ${ctx.maxObservedParallelism} (limit: 3).`
					: `stable_3 parallelism violation: ${ctx.maxObservedParallelism} > 3.`,
			category: "parallelism",
		});
	}
}

// ---------------------------------------------------------------------------
// Visibility Invariants
// ---------------------------------------------------------------------------

function checkVisibilityInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	if (ctx.plan.expected.visibilityArtifactsPresent) {
		const hasArtifacts = Object.values(ctx.visibilityArtifacts).some((v) => v);
		results.push({
			name: "Dashboard visibility artifacts produced",
			passed: hasArtifacts,
			severity: "error",
			message: hasArtifacts
				? `Visibility artifacts present: ${Object.entries(ctx.visibilityArtifacts)
						.filter(([, v]) => v)
						.map(([k]) => k)
						.join(", ")}`
				: "No visibility artifacts produced for failure scenario.",
			category: "visibility",
		});
	}

	// Report must be written
	results.push({
		name: "Execution report written",
		passed: ctx.reportWritten,
		severity: "warning",
		message: ctx.reportWritten ? "Report written." : "No report written.",
		category: "visibility",
	});
}

// ---------------------------------------------------------------------------
// General Invariants
// ---------------------------------------------------------------------------

function checkGeneralInvariants(ctx: ScenarioInvariantContext, results: InvariantResult[]): void {
	// Plan completion matches expectations
	if (ctx.plan.expected.planCompletes !== undefined) {
		results.push({
			name: "Plan completion matches expectation",
			passed: ctx.planCompleted === ctx.plan.expected.planCompletes,
			severity: "error",
			message:
				ctx.planCompleted === ctx.plan.expected.planCompletes
					? `Plan completion (${ctx.planCompleted}) matches expected (${ctx.plan.expected.planCompletes}).`
					: `Plan completion mismatch: got ${ctx.planCompleted}, expected ${ctx.plan.expected.planCompletes}.`,
			category: "general",
		});
	}

	// No illegal FSM transitions overall
	const illegalTransitions = ctx.fsmTransitions.filter((t) => {
		// Check specific illegal transitions
		if (t.from === "PENDING" && t.to === "SUCCEEDED") return true;
		if (t.from === "SUCCEEDED" && t.to === "RUNNING") return true;
		if (t.from === "SUCCEEDED" && t.to === "PENDING") return true;
		return false;
	});

	results.push({
		name: "No illegal FSM transitions",
		passed: illegalTransitions.length === 0,
		severity: "error",
		message:
			illegalTransitions.length === 0
				? "All FSM transitions are legal."
				: `Illegal FSM transitions: ${illegalTransitions.map((t) => `${t.workspaceId}: ${t.from} -> ${t.to}`).join(", ")}`,
		category: "general",
	});
}

// ---------------------------------------------------------------------------
// Result aggregation
// ---------------------------------------------------------------------------

export function aggregateInvariantResults(results: InvariantResult[]): {
	passed: number;
	failed: number;
	warnings: number;
	byCategory: Record<string, { passed: number; failed: number }>;
} {
	const summary = {
		passed: 0,
		failed: 0,
		warnings: 0,
		byCategory: {} as Record<string, { passed: number; failed: number }>,
	};

	for (const r of results) {
		if (r.passed) {
			summary.passed++;
		} else {
			if (r.severity === "warning") {
				summary.warnings++;
			} else {
				summary.failed++;
			}
		}

		const cat = r.category;
		if (!summary.byCategory[cat]) {
			summary.byCategory[cat] = { passed: 0, failed: 0 };
		}
		if (r.passed) {
			summary.byCategory[cat].passed++;
		} else {
			summary.byCategory[cat].failed++;
		}
	}

	return summary;
}
