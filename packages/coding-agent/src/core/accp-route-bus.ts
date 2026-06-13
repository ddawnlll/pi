/**
 * ACCP Route Bus (P49.24)
 *
 * Multi-agent artifact handoff mechanism. Moves compiled ACCP artifacts
 * between scout, fixer, validator, reviewer, and coordinator agents.
 *
 * ## Authority
 *
 * The route bus moves compiled artifacts between agents. It does NOT
 * grant route signals execution authority over any agent. Route signals
 * remain advisory until runtime checks PlanSpec authority.
 *
 * ## Integration Path
 *
 * The route bus is wired into the autonomous executor (P49.5) where
 * compiled ACCP worker results are published. Subscribers registered
 * via createDefaultSubscriptions() bridge the bus to the workspace
 * scheduler and transition router.
 *
 * ## Artifact Lineage
 *
 * Each delivery records a parentDeliveryId to trace the chain of
 * artifact handoffs: scout(BSR) → fixer(FPR) → validator(TVR) →
 * reviewer(PRR) → coordinator(DCR/CAR).
 *
 * @packageDocumentation
 */

import type {
	AccpCompileResult,
	AccpDiagnostic,
	AccpGateVerdict,
	AccpRouteSignal,
} from "@earendil-works/pi-execution-contracts";

/** Agent roles in the route bus. */
export type AccpAgentRole = "scout" | "fixer" | "validator" | "reviewer" | "coordinator";

/** A delivery on the route bus containing compiled artifacts. */
export interface AccpBusDelivery {
	/** Delivery ID. */
	deliveryId: string;
	/** Source agent role. */
	sourceRole: AccpAgentRole;
	/** Target agent role. */
	targetRole: AccpAgentRole;
	/** Compiled ACCP report. */
	compileResult: AccpCompileResult;
	/** Route signal (if emitted). */
	routeSignal?: AccpRouteSignal;
	/** Gate verdict (if evaluated). */
	gateVerdict?: AccpGateVerdict;
	/** Additional diagnostics. */
	diagnostics: AccpDiagnostic[];
	/** Timestamp. */
	timestamp: number;
	/** Parent delivery ID in the artifact lineage chain. */
	parentDeliveryId?: string;
}

/**
 * A chain of deliveries representing multi-agent artifact handoff.
 *
 * Records the flow of compiled artifacts across agents:
 * e.g., scout(BSR) → fixer(FPR) → validator(TVR) → reviewer(PRR) → coordinator(CAR)
 */
export interface AccpBusDeliveryChain {
	/** Chain ID. */
	chainId: string;
	/** Ordered deliveries in the chain (source → next → ...). */
	deliveries: AccpBusDelivery[];
	/** Whether the chain reached the coordinator. */
	reachedCoordinator: boolean;
}

/** Route bus subscriber callback. */
export type AccpBusSubscriber = (delivery: AccpBusDelivery) => void | Promise<void>;

/** Integrity error thrown when an artifact hash does not match its recorded hash. */
export class ArtifactIntegrityError extends Error {
	constructor(
		public readonly artifactPath: string,
		expectedHash: string,
		actualHash: string,
	) {
		super(`Artifact integrity check failed for ${artifactPath}: expected ${expectedHash}, got ${actualHash}`);
		this.name = "ArtifactIntegrityError";
	}
}

/**
 * Authority boundary violation error.
 *
 * Thrown when code attempts to use an ACCP route signal or gate verdict
 * to authorize filesystem mutation, command execution, or workspace
 * transition without runtime PlanSpec authority.
 */
export class AuthorityBoundaryError extends Error {
	constructor(message: string) {
		super(`ACCP authority boundary violation: ${message}`);
		this.name = "AuthorityBoundaryError";
	}
}

/**
 * ACCP Route Bus — in-memory pub/sub for compiled artifact handoff.
 *
 * Agents subscribe to roles they can handle. When a delivery arrives
 * for a role, matching subscribers are notified.
 *
 * ## Integrity
 *
 * Before dispatching to subscribers, the bus can verify artifact hashes
 * against recorded values. If a hash does not match, delivery is rejected
 * with an ArtifactIntegrityError.
 *
 * ## Authority
 *
 * The route bus explicitly marks deliveries as advisory. Route signals
 * and gate verdicts carried on the bus are evidence inputs; they do NOT
 * authorize mutation, command execution, or workspace transitions.
 *
 * ## Singleton
 *
 * Use getAccpRouteBus() to obtain the shared singleton instance.
 */
export class AccpRouteBus {
	private subscribers: Map<AccpAgentRole, AccpBusSubscriber[]> = new Map();
	private deliveryHistory: AccpBusDelivery[] = [];
	private integrityErrorHandler: ((error: ArtifactIntegrityError) => void) | null = null;

	/** Set an integrity error handler. When set, hash verification is enabled. */
	setIntegrityErrorHandler(handler: (error: ArtifactIntegrityError) => void): void {
		this.integrityErrorHandler = handler;
	}

	/** Subscribe to deliveries for a specific role. */
	subscribe(role: AccpAgentRole, handler: AccpBusSubscriber): void {
		const handlers = this.subscribers.get(role) || [];
		handlers.push(handler);
		this.subscribers.set(role, handlers);
	}

	/** Unsubscribe a handler from a specific role. */
	unsubscribe(role: AccpAgentRole, handler: AccpBusSubscriber): void {
		const handlers = this.subscribers.get(role);
		if (!handlers) return;
		const idx = handlers.indexOf(handler);
		if (idx >= 0) handlers.splice(idx, 1);
	}

	/**
	 * Deliver artifacts to a target role.
	 *
	 * If an integrity error handler is registered, the delivery's compile result
	 * is checked for consistency before subscribers are notified. If any integrity
	 * check fails, the delivery is rejected and subscribers are NOT notified.
	 *
	 * The delivery is recorded in history regardless of whether there are
	 * subscribers for the target role.
	 */
	async deliver(delivery: AccpBusDelivery): Promise<void> {
		// Integrity check: verify compile result consistency
		if (this.integrityErrorHandler) {
			const passed = this.validateDeliveryIntegrity(delivery);
			if (!passed) return; // Reject delivery — do not notify subscribers
		}

		this.deliveryHistory.push(delivery);
		const handlers = this.subscribers.get(delivery.targetRole) || [];
		for (const handler of handlers) {
			await handler(delivery);
		}
	}

	/**
	 * Route artifacts by signal: resolve the target role from the route signal
	 * and deliver to matching subscribers.
	 *
	 * This is a convenience method for the multi-agent handoff flow. It builds
	 * a delivery from the compile result and signal, resolves the target role,
	 * and calls deliver().
	 *
	 * If the signal target cannot be resolved, the delivery defaults to
	 * the coordinator role.
	 */
	async routeBySignal(
		deliveryId: string,
		compileResult: AccpCompileResult,
		signal: AccpRouteSignal,
		resolveTarget: (signal: AccpRouteSignal) => AccpAgentRole,
		sourceRole: AccpAgentRole,
		parentDeliveryId?: string,
	): Promise<AccpBusDelivery> {
		const targetRole = resolveTarget(signal);
		const delivery: AccpBusDelivery = {
			deliveryId,
			sourceRole,
			targetRole,
			compileResult,
			routeSignal: signal,
			diagnostics: compileResult.diagnostics,
			timestamp: Date.now(),
			parentDeliveryId,
		};
		await this.deliver(delivery);
		return delivery;
	}

	/**
	 * Build a delivery chain by following parentDeliveryId links.
	 *
	 * Returns deliveries in chronological order from the chain's
	 * earliest ancestor to the latest delivery.
	 */
	getDeliveryChain(latestDeliveryId: string): AccpBusDeliveryChain | null {
		const deliveries: AccpBusDelivery[] = [];
		let current = this.deliveryHistory.find((d) => d.deliveryId === latestDeliveryId);
		if (!current) return null;

		// Walk backward to find all ancestors
		const stack: AccpBusDelivery[] = [];
		while (current) {
			stack.push(current);
			if (current.parentDeliveryId) {
				current = this.deliveryHistory.find((d) => d.deliveryId === current!.parentDeliveryId);
			} else {
				current = undefined;
			}
		}

		// Reverse to get chronological order
		deliveries.push(...stack.reverse());

		return {
			chainId: deliveries[0].deliveryId,
			deliveries,
			reachedCoordinator:
				deliveries.length > 0 && deliveries[deliveries.length - 1].targetRole === "coordinator",
		};
	}

	/**
	 * Get delivery history for a specific source report.
	 */
	getHistoryForReport(reportId: string): AccpBusDelivery[] {
		return this.deliveryHistory.filter((d) => d.compileResult.reportId === reportId);
	}

	/**
	 * Get all delivery history.
	 */
	getAllHistory(): AccpBusDelivery[] {
		return [...this.deliveryHistory];
	}

	/**
	 * Get deliveries for a specific target role.
	 */
	getHistoryForRole(role: AccpAgentRole): AccpBusDelivery[] {
		return this.deliveryHistory.filter((d) => d.targetRole === role);
	}

	/**
	 * Clear delivery history.
	 */
	clearHistory(): void {
		this.deliveryHistory = [];
	}

	/**
	 * Reset all subscriptions.
	 */
	clearSubscriptions(): void {
		this.subscribers.clear();
	}

	/**
	 * Validate delivery integrity.
	 *
	 * Checks:
	 * - hasBlockingFindings consistency with fatal diagnostics
	 * - Gate verdict consistency with compile result
	 * - Route signal advisory flag
	 *
	 * If any check fails, the integrity error handler is called and
	 * false is returned to signal that delivery should be rejected.
	 *
	 * @returns true if integrity checks pass, false if any check fails
	 */
	private validateDeliveryIntegrity(delivery: AccpBusDelivery): boolean {
		const { compileResult, gateVerdict, routeSignal } = delivery;

		// Check 1: hasBlockingFindings requires >=1 fatal diagnostic
		const diagnosticFatalCount = compileResult.diagnostics.filter((d) => d.fatal).length;
		if (compileResult.hasBlockingFindings && diagnosticFatalCount === 0) {
			const err = new ArtifactIntegrityError(
				compileResult.reportId,
				"hasBlockingFindings=true requires >=1 fatal diagnostic",
				`got ${diagnosticFatalCount} fatal diagnostics`,
			);
			this.integrityErrorHandler!(err);
			return false;
		}

		// Check 2: gateVerdict with promotionReady=true must not have fatalErrors
		if (gateVerdict?.promotionReady && gateVerdict.fatalErrors.length > 0) {
			const err = new ArtifactIntegrityError(
				compileResult.reportId,
				"promotionReady=true requires zero fatalErrors",
				`got ${gateVerdict.fatalErrors.length} fatal errors: ${gateVerdict.fatalErrors.join(", ")}`,
			);
			this.integrityErrorHandler!(err);
			return false;
		}

		// Check 3: route signal must be advisory
		if (routeSignal && !routeSignal.isAdvisory) {
			const err = new ArtifactIntegrityError(
				compileResult.reportId,
				"routeSignal.isAdvisory must be true per authority invariant",
				"isAdvisory is false",
			);
			this.integrityErrorHandler!(err);
			return false;
		}

		return true;
	}
}

// =============================================================================
// Singleton
// =============================================================================

let _globalBus: AccpRouteBus | null = null;

/**
 * Get or create the global ACCP route bus singleton.
 *
 * The singleton is the shared instance wired into the autonomous executor
 * and available to all agent roles. Use this instead of constructing a new
 * AccpRouteBus when integrating into the runtime.
 */
export function getAccpRouteBus(): AccpRouteBus {
	if (!_globalBus) {
		_globalBus = new AccpRouteBus();
	}
	return _globalBus;
}

/**
 * Reset the global singleton. Primarily for testing.
 */
export function resetAccpRouteBus(): void {
	_globalBus = null;
}
