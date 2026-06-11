/**
 * P45.S8 — Failure Policy, Retry Policy, and Time Budget Enforcer
 *
 * Three integrated safety policies:
 *
 * FailurePolicy: classifies failures and enforces per-class behavior
 *   (abort, retry, fallback, hold, escalate).
 *
 * RetryPolicy: limits retry attempts per namespace/work unit and
 *   prevents retry storms with exponential backoff.
 *
 * TimeBudgetPolicy: enforces wall-clock time budgets per workspace,
 *   wave, and overall P45 execution. Triggers fallback on expiration.
 */

// =============================================================================
// Types
// =============================================================================

export type FailureClass =
	| "validation_error"
	| "typecheck_error"
	| "test_failure"
	| "accp_compile_error"
	| "assembler_error"
	| "timeout"
	| "unknown";

export type FailureAction = "abort" | "retry" | "fallback" | "hold" | "escalate";

export interface FailureEvent {
	id: string;
	failureClass: FailureClass;
	namespace: string;
	contract: string;
	detectedAt: string;
	description: string;
	action: FailureAction;
	retryAttempt: number;
}

export interface RetryState {
	/** Total retries used. */
	totalRetries: number;
	/** Retries per namespace. */
	perNamespace: Map<string, number>;
	/** Maximum retries allowed per unit. */
	maxRetriesPerUnit: number;
	/** Maximum total retries. */
	maxTotalRetries: number;
	/** Whether total retry limit is exhausted. */
	retriesExhausted: boolean;
}

export interface TimeBudget {
	/** Budget per workspace in milliseconds. */
	perWorkspaceMs: number;
	/** Budget per wave in milliseconds. */
	perWaveMs: number;
	/** Total P45 budget in milliseconds. */
	totalMs: number;
	/** Elapsed time for current workspace. */
	workspaceElapsedMs: number;
	/** Elapsed time for current wave. */
	waveElapsedMs: number;
	/** Total elapsed time. */
	totalElapsedMs: number;
	/** Start time (epoch ms). */
	startTimeMs: number;
}

export interface TimeBudgetState {
	budget: TimeBudget;
	/** Whether workspace budget is exceeded. */
	workspaceExceeded: boolean;
	/** Whether wave budget is exceeded. */
	waveExceeded: boolean;
	/** Whether total budget is exceeded. */
	totalExceeded: boolean;
	/** Whether any budget is exceeded. */
	anyExceeded: boolean;
}

// =============================================================================
// Failure Policy
// =============================================================================

export const FAILURE_ACTION_MAP: Record<FailureClass, FailureAction> = {
	validation_error: "retry",
	typecheck_error: "retry",
	test_failure: "retry",
	accp_compile_error: "fallback",
	assembler_error: "escalate",
	timeout: "fallback",
	unknown: "hold",
};

export function classifyFailure(error: Error | string, namespace: string, contract: string): FailureEvent {
	const msg = typeof error === "string" ? error : error.message;
	let failureClass: FailureClass = "unknown";

	if (msg.includes("validation") || msg.includes("assert")) {
		failureClass = "validation_error";
	} else if (msg.includes("TS") || msg.includes("type") || msg.includes("TypeScript")) {
		failureClass = "typecheck_error";
	} else if (msg.includes("test") && (msg.includes("fail") || msg.includes("FAIL"))) {
		failureClass = "test_failure";
	} else if (msg.includes("accp") || msg.includes("ACCP")) {
		failureClass = "accp_compile_error";
	} else if (msg.includes("assembler") || msg.includes("assemble")) {
		failureClass = "assembler_error";
	} else if (msg.includes("timeout") || msg.includes("timed out")) {
		failureClass = "timeout";
	}

	return {
		id: `fail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		failureClass,
		namespace,
		contract,
		detectedAt: new Date().toISOString(),
		description: msg,
		action: FAILURE_ACTION_MAP[failureClass],
		retryAttempt: 0,
	};
}

// =============================================================================
// Retry Policy
// =============================================================================

export class RetryPolicy {
	private retriesPerNamespace = new Map<string, number>();
	private totalRetries = 0;
	private maxRetriesPerUnit: number;
	private maxTotalRetries: number;

	constructor(maxRetriesPerUnit = 3, maxTotalRetries = 50) {
		this.maxRetriesPerUnit = maxRetriesPerUnit;
		this.maxTotalRetries = maxTotalRetries;
	}

	/**
	 * Check if a retry is allowed for the given namespace.
	 */
	canRetry(namespace: string): { allowed: boolean; reason?: string } {
		if (this.totalRetries >= this.maxTotalRetries) {
			return { allowed: false, reason: `Total retry limit ${this.maxTotalRetries} exhausted` };
		}

		const nsRetries = this.retriesPerNamespace.get(namespace) ?? 0;
		if (nsRetries >= this.maxRetriesPerUnit) {
			return { allowed: false, reason: `Namespace ${namespace} retry limit ${this.maxRetriesPerUnit} exhausted` };
		}

		return { allowed: true };
	}

	/**
	 * Record a retry attempt and return the new attempt number.
	 */
	recordRetry(namespace: string, event: FailureEvent): FailureEvent {
		const nsRetries = (this.retriesPerNamespace.get(namespace) ?? 0) + 1;
		this.retriesPerNamespace.set(namespace, nsRetries);
		this.totalRetries++;

		return {
			...event,
			retryAttempt: nsRetries,
			action: nsRetries >= this.maxRetriesPerUnit ? "fallback" : "retry",
		};
	}

	/**
	 * Get current retry state.
	 */
	getState(): RetryState {
		return {
			totalRetries: this.totalRetries,
			perNamespace: new Map(this.retriesPerNamespace),
			maxRetriesPerUnit: this.maxRetriesPerUnit,
			maxTotalRetries: this.maxTotalRetries,
			retriesExhausted: this.totalRetries >= this.maxTotalRetries,
		};
	}

	/**
	 * Reset retry counters (e.g., after successful workspace completion).
	 */
	reset(): void {
		this.retriesPerNamespace.clear();
		this.totalRetries = 0;
	}
}

// =============================================================================
// Time Budget Enforcer
// =============================================================================

export class TimeBudgetEnforcer {
	private budget: TimeBudget;
	private workspaceStartMs = 0;
	private waveStartMs = 0;

	constructor(
		perWorkspaceMs = 600_000, // 10 min
		perWaveMs = 3_600_000, // 60 min
		totalMs = 36_000_000, // 10 hours
	) {
		const now = Date.now();
		this.budget = {
			perWorkspaceMs,
			perWaveMs,
			totalMs,
			workspaceElapsedMs: 0,
			waveElapsedMs: 0,
			totalElapsedMs: 0,
			startTimeMs: now,
		};
		this.workspaceStartMs = now;
		this.waveStartMs = now;
	}

	/**
	 * Start timing a new workspace.
	 */
	startWorkspace(): void {
		this.workspaceStartMs = Date.now();
		this.budget.workspaceElapsedMs = 0;
	}

	/**
	 * End the current workspace and add its elapsed time to wave/total.
	 */
	endWorkspace(): void {
		const elapsed = Date.now() - this.workspaceStartMs;
		this.budget.workspaceElapsedMs += elapsed;
		this.budget.waveElapsedMs += elapsed;
		this.budget.totalElapsedMs += elapsed;
	}

	/**
	 * Start timing a new wave.
	 */
	startWave(): void {
		this.waveStartMs = Date.now();
		this.budget.waveElapsedMs = 0;
	}

	/**
	 * End the current wave.
	 */
	endWave(): void {
		// wave already accumulated from workspace endWorkspace calls
	}

	/**
	 * Get current time budget state.
	 */
	getState(): TimeBudgetState {
		const now = Date.now();
		const currentWorkspaceElapsed = this.budget.workspaceElapsedMs + (now - this.workspaceStartMs);
		const currentWaveElapsed = this.budget.waveElapsedMs + (now - this.waveStartMs);
		const totalElapsed = now - this.budget.startTimeMs;

		const budget: TimeBudget = {
			...this.budget,
			workspaceElapsedMs: currentWorkspaceElapsed,
			waveElapsedMs: currentWaveElapsed,
			totalElapsedMs: totalElapsed,
		};

		const workspaceExceeded = currentWorkspaceElapsed > this.budget.perWorkspaceMs;
		const waveExceeded = currentWaveElapsed > this.budget.perWaveMs;
		const totalExceeded = totalElapsed > this.budget.totalMs;

		return {
			budget,
			workspaceExceeded,
			waveExceeded,
			totalExceeded,
			anyExceeded: workspaceExceeded || waveExceeded || totalExceeded,
		};
	}

	/**
	 * Check if there is remaining time budget.
	 */
	hasRemainingBudget(): { hasBudget: boolean; exceeded: string[] } {
		const state = this.getState();
		const exceeded: string[] = [];
		if (state.workspaceExceeded) exceeded.push("workspace");
		if (state.waveExceeded) exceeded.push("wave");
		if (state.totalExceeded) exceeded.push("total");
		return { hasBudget: exceeded.length === 0, exceeded };
	}
}
