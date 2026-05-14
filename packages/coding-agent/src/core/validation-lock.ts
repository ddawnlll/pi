/**
 * Global Validation Command Lock
 *
 * Ensures that only one validation command runs at a time across the
 * entire plan execution. Workers may edit in parallel, but validation
 * commands (tests, type checks, builds) are serialized via a
 * process-wide async lock.
 *
 * Events emitted on the provided EventBus:
 * - validation_lock_waiting   — a worker is waiting for the lock
 * - validation_lock_acquired  — a worker acquired the lock
 * - validation_lock_released  — a worker released the lock
 *
 * The lock always releases in a `finally` block, even if the command
 * fails or throws.
 *
 * Time spent waiting for the lock does NOT count toward the
 * hung-worker detection threshold because waiting is expected
 * serialization, not a hang.
 */

import type { EventBus } from "./event-bus.js";

export type { EventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Validation command patterns
// ---------------------------------------------------------------------------

/**
 * Commands that are considered validation commands and must be serialized.
 *
 * These are matched against the beginning of the command string (after
 * stripping leading whitespace). The match is prefix-based so that
 * flag-bearing variants like `vitest --run` are still recognized.
 */
const VALIDATION_COMMAND_PREFIXES: readonly string[] = [
	"vitest",
	"npm test",
	"npm run test",
	"pnpm test",
	"pnpm run test",
	"npm run typecheck",
	"npx tsgo --noEmit",
	"tsc --noEmit",
	"npm run build",
	"vite build",
];

/**
 * Check whether a shell command is a validation command.
 *
 * @param command - The shell command to check
 * @returns True if the command matches a known validation command prefix
 */
export function isValidationCommand(command: string): boolean {
	const trimmed = command.trimStart();
	return VALIDATION_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Async lock implementation
// ---------------------------------------------------------------------------

/**
 * A fair, single-writer async lock (mutex).
 *
 * Uses a promise-chain to guarantee FIFO fairness: waiters acquire the
 * lock in the order they requested it. No external dependencies required.
 */
class AsyncLock {
	private _queue: (() => void)[] = [];
	private _locked: boolean = false;

	/** Whether the lock is currently held. */
	get isLocked(): boolean {
		return this._locked;
	}

	/** Number of waiters currently queued. */
	get waitingCount(): number {
		return this._queue.length;
	}

	/**
	 * Acquire the lock. Resolves when the caller holds the lock.
	 */
	acquire(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (!this._locked) {
				this._locked = true;
				resolve();
				return;
			}
			this._queue.push(resolve);
		});
	}

	/**
	 * Reset the lock to an unlocked state.
	 *
	 * Drains any waiting queue and sets the lock to unlocked.
	 * Intended ONLY for use in tests between test cases.
	 */
	reset(): void {
		this._queue = [];
		this._locked = false;
	}

	/**
	 * Release the lock. Passes ownership to the next waiter in line.
	 */
	release(): void {
		if (this._queue.length > 0) {
			const next = this._queue.shift()!;
			// Microtask scheduling ensures the new owner runs after our
			// finally block completes.
			queueMicrotask(next);
		} else {
			this._locked = false;
		}
	}
}

// ---------------------------------------------------------------------------
// Global validation lock singleton
// ---------------------------------------------------------------------------

/** The process-wide validation lock instance. */
const globalLock = new AsyncLock();

/**
 * Get the global validation lock instance (for testing / introspection).
 *
 * @returns The global AsyncLock
 */
export function getGlobalValidationLock(): AsyncLock {
	return globalLock;
}

/**
 * Reset the global validation lock to an unlocked state.
 *
 * Intended ONLY for use in tests between test cases. Do NOT call this
 * in production code.
 */
export function resetGlobalValidationLock(): void {
	globalLock.reset();
}

// ---------------------------------------------------------------------------
// Lock event names
// ---------------------------------------------------------------------------

/** Event channel: a worker is waiting for the validation lock. */
export const VALIDATION_LOCK_WAITING = "validation_lock_waiting";

/** Event channel: a worker acquired the validation lock. */
export const VALIDATION_LOCK_ACQUIRED = "validation_lock_acquired";

/** Event channel: a worker released the validation lock. */
export const VALIDATION_LOCK_RELEASED = "validation_lock_released";

// ---------------------------------------------------------------------------
// Run-with-lock helper
// ---------------------------------------------------------------------------

/**
 * Metadata included with each validation lock event.
 */
export interface ValidationLockEventPayload {
	/** The command that triggered the lock. */
	command: string;
	/** Timestamp (epoch ms) when the event was emitted. */
	timestamp: number;
}

/**
 * Execute a function under the global validation lock.
 *
 * If the command is not a validation command, the function runs
 * immediately without acquiring the lock.
 *
 * If the command IS a validation command:
 * 1. Emit `validation_lock_waiting`
 * 2. Acquire the global lock
 * 3. Emit `validation_lock_acquired`
 * 4. Run the function
 * 5. Release the lock in a `finally` block and emit `validation_lock_released`
 *
 * @param command - The shell command being executed
 * @param eventBus - EventBus to emit lock events on (may be undefined)
 * @param fn - The async function to execute
 * @returns The result of fn
 */
export async function withValidationLock<T>(
	command: string,
	eventBus: EventBus | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	if (!isValidationCommand(command)) {
		return fn();
	}

	const emit = (channel: string): void => {
		if (!eventBus) return;
		const payload: ValidationLockEventPayload = {
			command,
			timestamp: Date.now(),
		};
		eventBus.emit(channel, payload);
	};

	emit(VALIDATION_LOCK_WAITING);
	await globalLock.acquire();
	emit(VALIDATION_LOCK_ACQUIRED);

	try {
		return await fn();
	} finally {
		globalLock.release();
		emit(VALIDATION_LOCK_RELEASED);
	}
}
