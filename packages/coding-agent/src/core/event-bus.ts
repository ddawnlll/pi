import { EventEmitter } from "node:events";

export interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface EventBusController extends EventBus {
	clear(): void;
}

/**
 * FIFO signal queue for each channel.
 * Ensures reliable delivery ordering and prevents signal loss
 * when multiple listeners are registered on the same channel.
 */
class SignalQueue {
	private queues = new Map<string, unknown[]>();

	enqueue(channel: string, data: unknown): void {
		if (!this.queues.has(channel)) {
			this.queues.set(channel, []);
		}
		this.queues.get(channel)!.push(data);
	}

	dequeue(channel: string): unknown | undefined {
		return this.queues.get(channel)?.shift();
	}

	hasPending(channel: string): boolean {
		const queue = this.queues.get(channel);
		return queue !== undefined && queue.length > 0;
	}

	clear(channel?: string): void {
		if (channel) {
			this.queues.delete(channel);
		} else {
			this.queues.clear();
		}
	}
}

export function createEventBus(): EventBusController {
	const emitter = new EventEmitter();
	const signalQueue = new SignalQueue();

	return {
		emit: (channel, data) => {
			// Enqueue the signal for FIFO delivery
			signalQueue.enqueue(channel, data);

			// Deliver to all current listeners
			const listenerCount = emitter.listenerCount(channel);
			if (listenerCount > 0) {
				emitter.emit(channel, data);
			}
		},
		on: (channel, handler) => {
			const safeHandler = async (data: unknown) => {
				try {
					await handler(data);
				} catch (err) {
					console.error(`Event handler error (${channel}):`, err);
				}
			};
			emitter.on(channel, safeHandler);

			// Deliver any pending signals that were queued before this listener registered
			while (signalQueue.hasPending(channel)) {
				const pending = signalQueue.dequeue(channel);
				if (pending !== undefined) {
					// Use setImmediate to avoid stack overflow with many queued events
					setImmediate(() => {
						safeHandler(pending);
					});
				}
			}

			return () => emitter.off(channel, safeHandler);
		},
		clear: () => {
			emitter.removeAllListeners();
			signalQueue.clear();
		},
	};
}
