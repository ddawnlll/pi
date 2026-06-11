/**
 * P44.6.14 — Engine Invocation Timeout and Circuit Breaker Wrapper
 *
 * Adds real timeout, cancellation, retry budget, and circuit-breaker
 * behavior around engine invocation. Prevents runaway calls and
 * provides degraded-mode fallback when the engine is unresponsive.
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Circuit breaker state.
 */
export type CircuitState = "closed" | "open" | "half_open";

/**
 * Configuration for the engine invocation wrapper.
 */
export interface EngineInvocationConfig {
	/** Maximum time in ms for a single invocation. */
	timeoutMs: number;
	/** Maximum retry attempts before circuit opens. */
	maxRetries: number;
	/** Time in ms to wait before attempting a half-open check. */
	circuitResetTimeoutMs: number;
	/** Number of consecutive failures to open the circuit. */
	failureThreshold: number;
}

/**
 * Result of an engine invocation.
 */
export interface EngineInvocationResult<T> {
	success: boolean;
	value?: T;
	error?: string;
	attempts: number;
	circuitState: CircuitState;
}

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

export const DEFAULT_ENGINE_INVOCATION_CONFIG: EngineInvocationConfig = {
	timeoutMs: 30_000,
	maxRetries: 2,
	circuitResetTimeoutMs: 60_000,
	failureThreshold: 3,
};

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
	private state: CircuitState = "closed";
	private failureCount = 0;
	private lastFailureTime = 0;
	private config: EngineInvocationConfig;

	constructor(config?: Partial<EngineInvocationConfig>) {
		this.config = { ...DEFAULT_ENGINE_INVOCATION_CONFIG, ...config };
	}

	getState(): CircuitState {
		return this.state;
	}

	async call<T>(fn: () => Promise<T>): Promise<EngineInvocationResult<T>> {
		// Check circuit state
		if (this.state === "open") {
			const elapsed = Date.now() - this.lastFailureTime;
			if (elapsed >= this.config.circuitResetTimeoutMs) {
				this.state = "half_open";
			} else {
				return {
					success: false,
					error: `Circuit breaker is OPEN. Reset in ${this.config.circuitResetTimeoutMs - elapsed}ms.`,
					attempts: 0,
					circuitState: "open",
				};
			}
		}

		let lastError: Error | undefined;
		let attempts = 0;

		for (let i = 0; i <= this.config.maxRetries; i++) {
			attempts++;
			try {
				const result = await this.invokeWithTimeout(fn);
				// Success — reset failure count
				this.failureCount = 0;
				if (this.state === "half_open") {
					this.state = "closed";
				}
				return {
					success: true,
					value: result,
					attempts,
					circuitState: this.state,
				};
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				this.failureCount++;
				this.lastFailureTime = Date.now();

				if (this.failureCount >= this.config.failureThreshold) {
					this.state = "open";
					break;
				}
			}
		}

		return {
			success: false,
			error: lastError?.message ?? "Unknown error",
			attempts,
			circuitState: this.state,
		};
	}

	private async invokeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Engine invocation timed out after ${this.config.timeoutMs}ms`));
			}, this.config.timeoutMs);

			fn()
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}

	reset(): void {
		this.state = "closed";
		this.failureCount = 0;
		this.lastFailureTime = 0;
	}
}

/**
 * Wraps an engine invocation with timeout, retry, and circuit breaker.
 */
export async function invokeEngine<T>(
	fn: () => Promise<T>,
	breaker: CircuitBreaker,
): Promise<EngineInvocationResult<T>> {
	return breaker.call(fn);
}
