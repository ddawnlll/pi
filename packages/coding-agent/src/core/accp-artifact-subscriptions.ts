/**
 * ACCP Artifact Subscriptions (P49.24)
 *
 * Subscriptions that bridge compiled ACCP artifacts to runtime actions.
 * When an agent completes a report and emits a route signal, the
 * subscription maps the signal to a next action.
 *
 * ## Multi-Agent Artifact Handoff
 *
 * The handoff flow maps the ACCP v2.0 24-type report registry to the
 * five agent roles:
 *
 *   scout: BSR, ECR, RIR, PIR, RCA, FER, FDR, WBR, WDR
 *   fixer:  FPR, BRR
 *   validator: TVR, FVR, HIR, RAR, WQR
 *   reviewer: PRR, IPR, FGR, WER
 *   coordinator: DCR, CAR, FCR, FIR
 *
 * Each role subscribes to its report types and, on receiving a delivery
 * with a matching route signal, publishes the next artifact in the chain.
 *
 * ## Authority
 *
 * The createAuthorityBoundaryGuard() function produces a guard that
 * rejects any attempt to use route signals or gate verdicts as
 * authorization for filesystem mutation, command execution, or
 * workspace transition. This guard is invoked at every handoff step.
 *
 * @packageDocumentation
 */

import type {
	AccpCompileResult,
	AccpReportType,
	AccpRouteSignal,
} from "@earendil-works/pi-execution-contracts";
import type { AccpAgentRole, AccpBusDelivery, AccpRouteBus } from "./accp-route-bus.js";

// =============================================================================
// Route signal action → agent role mapping
// =============================================================================

/** Maps a route signal's recommended action to a target agent role. */
export const ROUTE_TO_ROLE: Record<string, AccpAgentRole> = {
	investigate_failures: "scout",
	root_cause_analysis: "scout",
	bug_search: "scout",
	evidence_capsule: "scout",
	validate_fix: "validator",
	validate_implementation: "validator",
	revalidate_after_correction: "validator",
	promotion_readiness: "reviewer",
	resolve_blockers: "fixer",
	fix_implementation: "fixer",
	review_warnings: "reviewer",
	promote: "coordinator",
	conflict_resolution: "coordinator",
	decision_record: "coordinator",
	unresolved_route_target: "coordinator",
};

// =============================================================================
// Report type → default agent role mapping
// =============================================================================

/**
 * Maps ACCP report types to their default producing agent role.
 *
 * Derived from the accp_v2_0_package/ registry and 24-type support matrix.
 */
export const REPORT_TYPE_TO_ROLE: Record<AccpReportType, AccpAgentRole> = {
	// Core (8)
	RIR: "scout",
	PIR: "scout",
	IPR: "reviewer",
	TVR: "validator",
	HIR: "validator",
	RAR: "validator",
	PRR: "reviewer",
	CAR: "coordinator",
	// Bugfix (5)
	BSR: "scout",
	BRR: "fixer",
	RCA: "scout",
	FPR: "fixer",
	FVR: "validator",
	// Feature (5)
	FER: "scout",
	FDR: "scout",
	FCR: "coordinator",
	FIR: "coordinator",
	FGR: "reviewer",
	// Writing (4)
	WBR: "scout",
	WDR: "scout",
	WER: "reviewer",
	WQR: "validator",
	// Coordination (2)
	ECR: "scout",
	DCR: "coordinator",
};

// =============================================================================
// Report type → default next report type (handoff chain)
// =============================================================================

/**
 * Maps each report type to the default next report type in the handoff chain.
 *
 * Examples:
 *   BSR → FPR (bug search → fix)
 *   FPR → TVR (fix → validation)
 *   TVR → PRR (validation → promotion readiness)
 *   PRR → CAR (promotion readiness → coordinator)
 */
export const REPORT_HANDOFF_CHAIN: Partial<Record<AccpReportType, AccpReportType>> = {
	// Bugfix pipeline: BSR → FPR → TVR → PRR → CAR
	BSR: "FPR",
	FPR: "TVR",
	FVR: "TVR",
	BRR: "FPR",
	RCA: "BSR",
	// Validation pipeline: TVR → PRR / HIR
	TVR: "PRR",
	HIR: "TVR",
	RAR: "TVR",
	// Promotion pipeline: PRR → CAR / DCR
	PRR: "CAR",
	IPR: "PRR",
	FGR: "CAR",
	// Coordination pipeline: CAR / DCR terminate chains
	CAR: undefined,
	DCR: undefined,
	// Feature pipeline
	FER: "FDR",
	FDR: "FCR",
	FCR: "FIR",
	FIR: "FGR",
	// Writing pipeline
	WBR: "WDR",
	WDR: "WER",
	WER: "WQR",
	WQR: undefined,
	// Evidence capsules and scouting
	ECR: "BSR",
	RIR: "PIR",
	PIR: "IPR",
};

// =============================================================================
// Authority boundary guard
// =============================================================================

/** Result of an authority boundary check. */
export interface AuthorityCheckResult {
	/** Whether the action is permitted under the authority model. */
	allowed: boolean;
	/** If not allowed, the reason. */
	reason?: string;
}

/**
 * Create an authority boundary guard function.
 *
 * The guard enforces that ACCP route signals and gate verdicts are
 * advisory only. It rejects any request to use them as authorization
 * for mutations, command execution, or workspace transitions.
 *
 * The guard accepts an optional external authority check that can
 * grant permission based on PlanSpec, command policy, write gate,
 * or human confirmation.
 *
 * ## Invariant
 *
 * Without an external authority check, ALL mutation-requiring actions
 * are denied. The guard is fail-closed.
 */
export function createAuthorityBoundaryGuard(
	externalCheck?: (action: string, delivery: AccpBusDelivery) => boolean,
): (action: string, delivery: AccpBusDelivery) => AuthorityCheckResult {
	return (action: string, delivery: AccpBusDelivery): AuthorityCheckResult => {
		const signal = delivery.routeSignal;
		const verdict = delivery.gateVerdict;

		// MUTATION REQUEST: route signal recommends mutation_allowed
		if (action === "mutate_files" || action === "execute_command") {
			if (signal?.mutationPolicyNeeded === "mutation_allowed") {
				// Check if external authority grants permission
				if (externalCheck?.(action, delivery)) {
					return { allowed: true };
				}
				return {
					allowed: false,
					reason:
						`Route signal recommends mutation but no external authority ` +
						`(PlanSpec, command policy, write gate) granted permission. ` +
						`ACCP signals are advisory only.`,
				};
			}
			// Mutation requested but signal does not recommend it
			if (!signal || signal.mutationPolicyNeeded === "none") {
				return {
					allowed: false,
					reason:
						`Mutation action '${action}' requested but route signal ` +
						`mutationPolicyNeeded is '${signal?.mutationPolicyNeeded ?? "absent"}'. ` +
						`Requires mutation_allowed with external authority grant.`,
				};
			}
		}

		// WORKSPACE TRANSITION: requires external authority
		if (action === "transition_workspace") {
			if (externalCheck?.(action, delivery)) {
				return { allowed: true };
			}
			return {
				allowed: false,
				reason:
					`Workspace transition requested but no external authority ` +
					`granted permission. Gate verdicts are diagnostic, not authoritative.`,
			};
		}

		// PROMOTION: gate verdict alone does not authorize promotion
		if (action === "promote_plan") {
			if (verdict?.promotionReady) {
				if (externalCheck?.(action, delivery)) {
					return { allowed: true };
				}
				return {
					allowed: false,
					reason:
						`Promotion requested and gate verdict indicates readiness, ` +
						`but no external authority (promotion gate, human confirmation) ` +
						`granted permission. Gate verdicts are advisory.`,
				};
			}
			return {
				allowed: false,
				reason:
					`Promotion requested but gate verdict does not indicate readiness ` +
					`(promotionReady=${verdict?.promotionReady ?? false}). ` +
					`Fatal errors: ${verdict?.fatalErrors.length ?? 0}.`,
			};
		}

		// READ-ONLY ACTIONS: always allowed (advisory information flow)
		if (
			action === "read_report" ||
			action === "inspect_artifact" ||
			action === "resolve_target"
		) {
			return { allowed: true };
		}

		// Unknown actions: fail-closed
		return {
			allowed: false,
			reason: `Unknown action '${action}'. ACCP authority guard is fail-closed.`,
		};
	};
}

/**
 * Pre-built authority guard with no external checks.
 *
 * All mutation, transition, and promotion actions are denied.
 * Only read-only actions are permitted.
 */
export const DEFAULT_AUTHORITY_GUARD = createAuthorityBoundaryGuard();

// =============================================================================
// Default subscriptions
// =============================================================================

/**
 * Create default subscriptions on a route bus.
 *
 * Each subscription:
 * 1. Receives deliveries for its agent role
 * 2. Checks the authority boundary guard
 * 3. Publishes the next artifact in the handoff chain (via callback)
 *
 * The publishNext callback is where the runtime integration hooks in:
 * it receives the next report type and the delivery, and is responsible
 * for triggering the next agent (e.g., via the workspace scheduler).
 *
 * @param bus - The route bus to configure.
 * @param publishNext - Callback invoked when a delivery should trigger
 *   the next agent in the handoff chain. Receives the recommended next
 *   report type and the originating delivery.
 */
export function createDefaultSubscriptions(
	bus: AccpRouteBus,
	publishNext?: (nextReportType: AccpReportType | undefined, delivery: AccpBusDelivery) => void,
): void {
	// Scout agent subscription: handles investigation, bug search, evidence capsules.
	// When a delivery arrives at the scout role, the scout processes it based on
	// the delivery's route signal and compile result, then publishes the next artifact.
	bus.subscribe("scout", async (delivery: AccpBusDelivery) => {
		const signal = delivery.routeSignal;
		const reportType = delivery.compileResult.reportType;

		// Process any delivery sent to scout, regardless of source report type.
		// The delivery arriving here means the scout should investigate.
		if (signal && !signal.targetResolved) {
			// Unresolved target — route to coordinator
			publishNext?.("DCR", delivery);
		} else if (signal?.targetResolved) {
			const nextType = REPORT_HANDOFF_CHAIN[reportType];
			publishNext?.(nextType, delivery);
		} else {
			// No signal: determine next step from report type chain
			const nextType = REPORT_HANDOFF_CHAIN[reportType];
			publishNext?.(nextType, delivery);
		}
	});

	// Fixer agent subscription: handles fix implementation, blocker resolution.
	// When a delivery arrives at the fixer role (e.g., BSR from scout), the fixer
	// should produce the appropriate fix report and route to validation.
	bus.subscribe("fixer", async (delivery: AccpBusDelivery) => {
		const signal = delivery.routeSignal;
		const reportType = delivery.compileResult.reportType;

		// Process any delivery sent to fixer. The fixer's job is to produce a fix
		// report (FPR/BRR) and route to validator.
		if (signal?.targetResolved) {
			const nextType = REPORT_HANDOFF_CHAIN[reportType];
			publishNext?.(nextType, delivery);
		} else if (signal && !signal.targetResolved) {
			publishNext?.("DCR", delivery);
		} else {
			// Default fixer handoff: after receiving any report, publish FPR
			publishNext?.(REPORT_HANDOFF_CHAIN[reportType], delivery);
		}
	});

	// Validator agent subscription: validates fixes, implementations.
	// Receives fix reports (FPR) and other artifacts, validates them,
	// and routes to reviewer for promotion check.
	bus.subscribe("validator", async (delivery: AccpBusDelivery) => {
		const reportType = delivery.compileResult.reportType;
		const signal = delivery.routeSignal;

		// After validation, check if promotion is ready
		if (delivery.gateVerdict?.promotionReady) {
			publishNext?.("PRR", delivery);
		} else if (signal?.targetResolved) {
			const nextType = REPORT_HANDOFF_CHAIN[reportType];
			publishNext?.(nextType, delivery);
		} else if (signal && !signal.targetResolved) {
			publishNext?.("DCR", delivery);
		} else {
			// Default: after receiving an artifact, validate and route to reviewer
			const nextType = REPORT_HANDOFF_CHAIN[reportType];
			publishNext?.(nextType ?? "PRR", delivery);
		}
	});

	// Reviewer agent subscription: reviews promotion readiness.
	// Receives validation results and promotion candidates, evaluates
	// readiness, and routes to coordinator.
	bus.subscribe("reviewer", async (delivery: AccpBusDelivery) => {
		const reportType = delivery.compileResult.reportType;
		const signal = delivery.routeSignal;

		if (delivery.gateVerdict?.promotionReady && signal?.targetResolved) {
			// Ready for coordinator — publish the next in chain
			const nextType = REPORT_HANDOFF_CHAIN[reportType];
			publishNext?.(nextType, delivery);
		} else if (signal?.recommendedNextAction === "promotion_readiness") {
			publishNext?.("CAR", delivery);
		} else if (signal && !signal.targetResolved) {
			publishNext?.("DCR", delivery);
		} else {
			// Default: review and publish next
			const nextType = REPORT_HANDOFF_CHAIN[reportType];
			publishNext?.(nextType, delivery);
		}
	});

	// Coordinator agent subscription: resolves conflicts, makes decisions.
	// Receives promotion-ready artifacts and conflict reports. The coordinator
	// terminates chains unless a signal explicitly requests another action.
	bus.subscribe("coordinator", async (delivery: AccpBusDelivery) => {
		const signal = delivery.routeSignal;
		const reportType = delivery.compileResult.reportType;

		// Coordinator processes the delivery; chains normally terminate here.
		// Only continue if there's an unresolved target.
		if (signal && !signal.targetResolved) {
			// Re-entrant coordination for unresolved targets
			publishNext?.(REPORT_HANDOFF_CHAIN[reportType], delivery);
		}
	});
}

// =============================================================================
// Target role resolution
// =============================================================================

/**
 * Resolve the target role for a route signal's recommended action.
 */
export function resolveTargetRole(signal: AccpRouteSignal): AccpAgentRole {
	return ROUTE_TO_ROLE[signal.recommendedNextAction] || "coordinator";
}

/**
 * Resolve the target agent role for a compile result, using the report
 * type mapping as a fallback when no route signal is present.
 */
export function resolveTargetRoleFromCompileResult(
	signal: AccpRouteSignal | undefined,
	compileResult: AccpCompileResult,
): AccpAgentRole {
	if (signal) {
		return resolveTargetRole(signal);
	}
	return REPORT_TYPE_TO_ROLE[compileResult.reportType] || "coordinator";
}

/**
 * Determine the default next report type for a given report type.
 * Returns undefined if the chain terminates (coordinator reports).
 */
export function getNextReportType(reportType: AccpReportType): AccpReportType | undefined {
	return REPORT_HANDOFF_CHAIN[reportType];
}

/**
 * Build the full handoff chain from a starting report type.
 *
 * Returns the ordered list of report types that would flow through
 * the multi-agent handoff, terminating at a coordinator report or
 * when no next type is defined.
 */
export function buildHandoffChain(startType: AccpReportType): AccpReportType[] {
	const chain: AccpReportType[] = [startType];
	let current: AccpReportType | undefined = startType;
	const visited = new Set<AccpReportType>();
	visited.add(startType);

	while (true) {
		const next = REPORT_HANDOFF_CHAIN[current];
		if (!next) break;
		if (visited.has(next)) break; // Cycle detection
		visited.add(next);
		chain.push(next);
		current = next;
	}

	return chain;
}
