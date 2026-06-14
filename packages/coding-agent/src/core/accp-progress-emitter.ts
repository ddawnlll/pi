/**
 * ACCP Progress Emitter (P49.TUI-001)
 *
 * Thin callback interface that the ACCP artifact store and gate stage
 * runner call into as they do real work. Multiple subscribers can attach
 * so both session persistence and live TUI rendering see the same event
 * stream in real time.
 *
 * ## Authority
 *
 * This emitter is a control/visibility signal. It does NOT authorize
 * execution, mutation, workspace transitions, or promotion. Events
 * emitted here are advisory; downstream consumers must verify against
 * PlanSpec, command policy, write gate, and human-confirmation.
 *
 * ## Lifetime
 *
 * The emitter is process-wide (a single shared instance). Callers
 * subscribe and unsubscribe independently. Tests can still replace the
 * subscriber list via `setAccpProgressEmitter` when they need a reset.
 *
 * @packageDocumentation
 */

/** Payload for a compilation-started notification. */
export interface AccpCompilationStarted {
	reportId: string;
	reportType: import("@earendil-works/pi-execution-contracts").AccpReportType;
}

/** Payload for a compilation-completed notification. */
export interface AccpCompilationCompleted {
	reportId: string;
	reportType: import("@earendil-works/pi-execution-contracts").AccpReportType;
	status: "compiled" | "compiled_with_warnings" | "failed";
	diagnosticCount: number;
	fatalCount: number;
	/** Diagnostics from the compiler (for verbose TUI output). */
	diagnostics?: import("@earendil-works/pi-execution-contracts").AccpDiagnostic[];
}

/** Payload for a gate-started notification. */
export interface AccpGateStarted {
	reportId: string;
	reportType: import("@earendil-works/pi-execution-contracts").AccpReportType;
}

/** Payload for a gate-completed notification. */
export interface AccpGateCompleted {
	reportId: string;
	reportType: import("@earendil-works/pi-execution-contracts").AccpReportType;
	valid: boolean;
	evidenceStatus: "complete" | "partial" | "missing" | "not_checked";
	fatalErrorCount: number;
	blockingFindingCount: number;
	warningCount: number;
}

/** Payload for an artifact-written notification. */
export interface AccpArtifactWritten {
	reportId: string;
	kind: string;
	path: string;
}

/** Handler bundle that AgentSession installs in its constructor. */
export interface AccpProgressHandlers {
	onCompilationStarted?: (
		reportId: string,
		reportType: import("@earendil-works/pi-execution-contracts").AccpReportType,
	) => void;
	onCompilationCompleted?: (
		reportId: string,
		reportType: import("@earendil-works/pi-execution-contracts").AccpReportType,
		status: "compiled" | "compiled_with_warnings" | "failed",
		diagnosticCount: number,
		fatalCount: number,
		diagnostics?: import("@earendil-works/pi-execution-contracts").AccpDiagnostic[],
	) => void;
	onGateStarted?: (
		reportId: string,
		reportType: import("@earendil-works/pi-execution-contracts").AccpReportType,
	) => void;
	onGateCompleted?: (
		reportId: string,
		reportType: import("@earendil-works/pi-execution-contracts").AccpReportType,
		valid: boolean,
		evidenceStatus: "complete" | "partial" | "missing" | "not_checked",
		fatalErrorCount: number,
		blockingFindingCount: number,
		warningCount: number,
	) => void;
	onArtifactWritten?: (reportId: string, kind: string, path: string) => void;
}

/**
 * The shared emitter. Callers (artifact store, gate runner) invoke the
 * methods; AgentSession's `attachAccpProgressEmitter` registers the
 * handlers. If no handler is registered, the calls are silently dropped.
 *
 * The emitter is intentionally synchronous. Consumers that need async
 * work should queue it; events are advisory and must not block the
 * critical path.
 */
class AccpProgressEmitterImpl {
	private subscribers = new Set<AccpProgressHandlers>();

	/**
	 * Replace the subscriber list with a single handler bundle.
	 */
	set(handlers: AccpProgressHandlers): void {
		this.subscribers.clear();
		if (Object.keys(handlers).length > 0) {
			this.subscribers.add(handlers);
		}
	}

	/**
	 * Add a subscriber and return an unsubscribe function.
	 */
	subscribe(handlers: AccpProgressHandlers): () => void {
		this.subscribers.add(handlers);
		return () => {
			this.subscribers.delete(handlers);
		};
	}

	/**
	 * Get the current subscriber bundles. Mainly for tests.
	 */
	get(): AccpProgressHandlers[] {
		return Array.from(this.subscribers);
	}

	emitCompilationStarted(payload: AccpCompilationStarted): void {
		for (const handlers of this.subscribers) {
			handlers.onCompilationStarted?.(payload.reportId, payload.reportType);
		}
	}

	emitCompilationCompleted(payload: AccpCompilationCompleted): void {
		for (const handlers of this.subscribers) {
			handlers.onCompilationCompleted?.(
				payload.reportId,
				payload.reportType,
				payload.status,
				payload.diagnosticCount,
				payload.fatalCount,
				payload.diagnostics,
			);
		}
	}

	emitGateStarted(payload: AccpGateStarted): void {
		for (const handlers of this.subscribers) {
			handlers.onGateStarted?.(payload.reportId, payload.reportType);
		}
	}

	emitGateCompleted(payload: AccpGateCompleted): void {
		for (const handlers of this.subscribers) {
			handlers.onGateCompleted?.(
				payload.reportId,
				payload.reportType,
				payload.valid,
				payload.evidenceStatus,
				payload.fatalErrorCount,
				payload.blockingFindingCount,
				payload.warningCount,
			);
		}
	}

	emitArtifactWritten(payload: AccpArtifactWritten): void {
		for (const handlers of this.subscribers) {
			handlers.onArtifactWritten?.(payload.reportId, payload.kind, payload.path);
		}
	}
}

/** Process-wide singleton. */
const sharedEmitter = new AccpProgressEmitterImpl();

/** Get the shared emitter. Artifact store and gate runner call into this. */
export function getAccpProgressEmitter(): AccpProgressEmitterImpl {
	return sharedEmitter;
}

/** Type alias for the emitter return type (helps imports stay narrow). */
export type AccpProgressEmitter = AccpProgressEmitterImpl;

/**
 * Install a handler bundle on the shared emitter. AgentSession calls this
 * in its constructor; tests can call it to register mock handlers.
 */
export function attachAccpProgressEmitter(handlers: AccpProgressHandlers): void {
	sharedEmitter.set(handlers);
}

/**
 * Subscribe to the shared ACCP progress emitter.
 */
export function subscribeToAccpProgressEmitter(handlers: AccpProgressHandlers): () => void {
	return sharedEmitter.subscribe(handlers);
}
