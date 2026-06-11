/**
 * ACCP Artifact Subscriptions (P49.24)
 *
 * Subscriptions that bridge compiled ACCP artifacts to runtime actions.
 * When an agent completes a report and emits a route signal, the
 * subscription maps the signal to a next action.
 *
 * @packageDocumentation
 */

import type { AccpRouteSignal } from "@earendil-works/pi-execution-contracts";
import type { AccpAgentRole, AccpBusDelivery, AccpRouteBus } from "./accp-route-bus.js";

/** Maps a route signal's recommended action to a target agent role. */
const ROUTE_TO_ROLE: Record<string, AccpAgentRole> = {
	investigate_failures: "scout",
	root_cause_analysis: "scout",
	validate_fix: "validator",
	validate_implementation: "validator",
	revalidate_after_correction: "validator",
	promotion_readiness: "reviewer",
	resolve_blockers: "fixer",
	review_warnings: "reviewer",
	promote: "coordinator",
	unresolved_route_target: "coordinator",
};

/**
 * Create default subscriptions on a route bus.
 * Each subscription listens for deliveries with specific route signals
 * and routes them to the appropriate next agent.
 */
export function createDefaultSubscriptions(bus: AccpRouteBus): void {
	// Scout agent subscription
	bus.subscribe("scout", async (delivery: AccpBusDelivery) => {
		if (delivery.routeSignal?.mutationPolicyNeeded === "read_only") {
			// Scout handles investigation by producing more reports
			console.error(`[ACCP RouteBus] Scout processing: ${delivery.deliveryId}`);
		}
	});

	// Validator agent subscription
	bus.subscribe("validator", async (delivery: AccpBusDelivery) => {
		if (delivery.routeSignal?.mutationPolicyNeeded === "validation_only") {
			console.error(`[ACCP RouteBus] Validator processing: ${delivery.deliveryId}`);
		}
	});

	// Reviewer agent subscription
	bus.subscribe("reviewer", async (delivery: AccpBusDelivery) => {
		if (delivery.routeSignal?.recommendedNextAction === "promotion_readiness") {
			console.error(`[ACCP RouteBus] Reviewer processing promotion readiness: ${delivery.deliveryId}`);
		}
	});

	// Coordinator agent subscription
	bus.subscribe("coordinator", async (delivery: AccpBusDelivery) => {
		console.error(`[ACCP RouteBus] Coordinator reviewing: ${delivery.deliveryId}`);
	});
}

/**
 * Resolve the target role for a route signal's recommended action.
 */
export function resolveTargetRole(signal: AccpRouteSignal): AccpAgentRole {
	return ROUTE_TO_ROLE[signal.recommendedNextAction] || "coordinator";
}
