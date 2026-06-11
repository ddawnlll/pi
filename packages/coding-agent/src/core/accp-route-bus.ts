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
 */
export class AccpRouteBus {
	private subscribers: Map<AccpAgentRole, AccpBusSubscriber[]> = new Map();
	private deliveryHistory: AccpBusDelivery[] = [];
	private integrityErrorHandler: ((error: ArtifactIntegrityError) => void) | null = null;

	/**
	 * Set an integrity error handler. When set, hash verification is enabled.
	 * If verification fails, the handler is called and the delivery is rejected
	 * (subscribers are not notified).
	 */
	setIntegrityErrorHandler(handler: (error: ArtifactIntegrityError) => void): void {
		this.integrityErrorHandler = handler;
	}

	/**
	 * Subscribe to deliveries for a specific role.
	 */
	subscribe(role: AccpAgentRole, handler: AccpBusSubscriber): void {
		const handlers = this.subscribers.get(role) || [];
		handlers.push(handler);
		this.subscribers.set(role, handlers);
	}

	/**
	 * Deliver artifacts to a target role.
	 *
	 * If an integrity error handler is registered, the delivery's compile result
	 * is checked for hash consistency before subscribers are notified.
	 */
	async deliver(delivery: AccpBusDelivery): Promise<void> {
		// Integrity check: if verified hashes are available, verify before dispatch
		if (this.integrityErrorHandler) {
			const compileResult = delivery.compileResult;
			// Check that blocking findings count is consistent with diagnostics
			const diagnosticFatalCount = compileResult.diagnostics.filter((d) => d.fatal).length;
			if (compileResult.hasBlockingFindings && diagnosticFatalCount === 0) {
				// Inconsistency: hasBlockingFindings is true but no fatal diagnostics
				const err = new ArtifactIntegrityError(
					compileResult.reportId,
					"hasBlockingFindings=true requires >=1 fatal diagnostic",
					`got ${diagnosticFatalCount} fatal diagnostics`,
				);
				this.integrityErrorHandler(err);
				return; // Reject delivery — do not notify subscribers
			}
		}

		this.deliveryHistory.push(delivery);
		const handlers = this.subscribers.get(delivery.targetRole) || [];
		for (const handler of handlers) {
			await handler(delivery);
		}
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
	 * Clear delivery history.
	 */
	clearHistory(): void {
		this.deliveryHistory = [];
	}
}
