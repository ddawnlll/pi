/**
 * Live Command Log / Terminal Stream — P41.05
 *
 * Pub/sub interface and in-memory implementation for streaming command output
 * in real-time during workspace execution.
 *
 * Consumption path:
 *   Worker executes command → command output chunks emitted via ICommandLogStream →
 *   Subscribers (dashboard SSE, UI, log aggregator) receive typed CommandLogEntry events
 *
 * Usage:
 *   const logStream = new InMemoryCommandLogStream();
 *   const unsub = logStream.subscribe((entry) => console.log(entry.data));
 *   await logStream.emitOutput({ ... });
 *   unsub();
 */

// ---------------------------------------------------------------------------
// Command Log Entry — a single chunk of command output
// ---------------------------------------------------------------------------

/**
 * A single chunk of live command output emitted during execution.
 * Each entry represents a partial stdout or stderr data chunk.
 */
export interface CommandLogEntry {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace ID the command belongs to */
	workspaceId: string;
	/** The command being executed */
	command: string;
	/** Working directory */
	cwd: string;
	/** Which stream produced the output */
	stream: "stdout" | "stderr";
	/** The output data chunk */
	data: string;
	/** Byte offset from the start of the command's output */
	offset: number;
	/** Optional run identifier */
	runId?: string;
	/** Whether this is the final chunk for this command */
	final?: boolean;
	/** Monotonically increasing sequence number (global order across all commands) */
	seq: number;
	/** Timestamp when the chunk was emitted (ms since epoch) */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Log Stream Subscriber — callback signature
// ---------------------------------------------------------------------------

/**
 * Callback invoked when a new command log entry is emitted.
 * Return void — subscribers are synchronous consumers by design.
 */
export type CommandLogSubscriber = (entry: CommandLogEntry) => void;

// ---------------------------------------------------------------------------
// ICommandLogStream — pub/sub contract
// ---------------------------------------------------------------------------

/**
 * Pub/sub interface for live command log streaming.
 *
 * Consumers subscribe to receive real-time CommandLogEntry events
 * as commands produce output during workspace execution.
 */
export interface ICommandLogStream {
	/**
	 * Subscribe to all command output events for a plan execution.
	 * Returns an unsubscribe function.
	 *
	 * @param planExecutionId - Plan execution to subscribe to (or '*' for all)
	 * @param subscriber - Callback receiving each CommandLogEntry
	 * @returns Unsubscribe function
	 */
	subscribe(planExecutionId: string, subscriber: CommandLogSubscriber): () => void;

	/**
	 * Emit a command output entry to all subscribers of the given plan execution.
	 *
	 * @param entry - The command log entry to emit
	 */
	emitOutput(entry: CommandLogEntry): void;

	/**
	 * Unsubscribe a specific subscriber from a plan execution.
	 *
	 * @param planExecutionId - Plan execution the subscriber was registered for
	 * @param subscriber - The subscriber callback to remove
	 */
	unsubscribe(planExecutionId: string, subscriber: CommandLogSubscriber): void;

	/**
	 * Remove all subscribers for a given plan execution.
	 * Useful when a plan execution completes or is cleaned up.
	 *
	 * @param planExecutionId - Plan execution to clear subscribers for
	 */
	clearPlan(planExecutionId: string): void;

	/**
	 * Remove all subscribers across all plan executions (e.g., on teardown).
	 */
	clearAll(): void;
}

// ---------------------------------------------------------------------------
// InMemoryCommandLogStream — lightweight pub/sub implementation
// ---------------------------------------------------------------------------

/**
 * In-memory pub/sub implementation of ICommandLogStream.
 *
 * Subscribers are stored per plan execution ID in a Map.
 * A wildcard key ('*') allows subscribing to ALL plan executions.
 *
 * This implementation is NOT persistent — entries are delivered to
 * current subscribers in real-time and are not replayed for late subscribers.
 * For persistent command log storage, use the event store (command_output events).
 *
 * Thread-safety note: All operations are synchronous in practice
 * (JavaScript single-threaded). If shared across workers, use a
 * persistent pub/sub backend instead.
 */
export class InMemoryCommandLogStream implements ICommandLogStream {
	/**
	 * Subscriber registry: planExecutionId → Set<CommandLogSubscriber>
	 * A special key '*' holds subscribers that receive ALL plan execution output.
	 */
	private readonly subscribers: Map<string, Set<CommandLogSubscriber>> = new Map();

	/**
	 * Global sequence counter for ordering command log entries across all commands.
	 */
	private seqCounter = 0;

	// -----------------------------------------------------------------------
	// ICommandLogStream implementation
	// -----------------------------------------------------------------------

	subscribe(planExecutionId: string, subscriber: CommandLogSubscriber): () => void {
		let subs = this.subscribers.get(planExecutionId);
		if (!subs) {
			subs = new Set();
			this.subscribers.set(planExecutionId, subs);
		}
		subs.add(subscriber);

		// Return an unsubscribe function
		return () => {
			this.unsubscribe(planExecutionId, subscriber);
		};
	}

	emitOutput(entry: Omit<CommandLogEntry, "seq" | "timestamp">): void {
		const fullEntry: CommandLogEntry = {
			...entry,
			seq: ++this.seqCounter,
			timestamp: Date.now(),
		};

		// Notify plan-specific subscribers
		const planSubs = this.subscribers.get(entry.planExecutionId);
		if (planSubs) {
			for (const sub of planSubs) {
				try {
					sub(fullEntry);
				} catch {
					// Swallow subscriber errors to keep the stream alive
				}
			}
		}

		// Notify wildcard subscribers
		const wildcardSubs = this.subscribers.get("*");
		if (wildcardSubs) {
			for (const sub of wildcardSubs) {
				try {
					sub(fullEntry);
				} catch {
					// Swallow subscriber errors
				}
			}
		}
	}

	unsubscribe(planExecutionId: string, subscriber: CommandLogSubscriber): void {
		const subs = this.subscribers.get(planExecutionId);
		if (subs) {
			subs.delete(subscriber);
			if (subs.size === 0) {
				this.subscribers.delete(planExecutionId);
			}
		}
	}

	clearPlan(planExecutionId: string): void {
		this.subscribers.delete(planExecutionId);
	}

	clearAll(): void {
		this.subscribers.clear();
	}

	// -----------------------------------------------------------------------
	// Introspection (useful for testing and debugging)
	// -----------------------------------------------------------------------

	/**
	 * Return the number of unique plan executions with active subscribers.
	 */
	get activePlanCount(): number {
		return this.subscribers.size;
	}

	/**
	 * Return the subscriber count for a given plan execution (or 0 if none).
	 */
	subscriberCount(planExecutionId: string): number {
		return this.subscribers.get(planExecutionId)?.size ?? 0;
	}
}
