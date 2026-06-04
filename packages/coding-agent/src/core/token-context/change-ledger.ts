/**
 * P43 Change Ledger - W016
 *
 * Records file changes and provides safe delta reread.
 * beforeHash/afterHash/delta/checkpoint policy.
 * Default max delta chain: 5.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ChangeLedgerEvent, LedgerState } from "./types.js";

export interface ChangeLedgerOptions {
	maxDeltaChainBeforeCheckpoint?: number;
}

export class ChangeLedger {
	private events: ChangeLedgerEvent[] = [];
	private eventsByFile = new Map<string, ChangeLedgerEvent[]>();
	private maxDeltaChain: number;

	constructor(options: ChangeLedgerOptions = {}) {
		this.maxDeltaChain = options.maxDeltaChainBeforeCheckpoint ?? 5;
	}

	/**
	 * Record a file change event.
	 */
	recordChange(
		filePath: string,
		beforeContent: string,
		afterContent: string,
		changedRanges?: Array<{ start: number; end: number }>,
		changedSymbols?: string[],
	): ChangeLedgerEvent {
		const beforeHash = this.hashContent(beforeContent);
		const afterHash = this.hashContent(afterContent);
		const delta = this.computeDelta(beforeContent, afterContent);

		const fileEvents = this.eventsByFile.get(filePath) ?? [];
		const deltaChainLength = fileEvents.length + 1;
		const checkpointRequired = deltaChainLength > this.maxDeltaChain;

		const state = this.determineState(deltaChainLength, false, false);

		const event: ChangeLedgerEvent = {
			id: this.generateId(),
			filePath,
			beforeHash,
			afterHash,
			changedRanges,
			changedSymbols,
			delta,
			state,
			deltaChainLength,
			timestamp: Date.now(),
			checkpointRequired,
		};

		this.events.push(event);

		fileEvents.push(event);
		this.eventsByFile.set(filePath, fileEvents);

		return event;
	}

	/**
	 * Record an external mutation detection.
	 */
	recordExternalMutation(filePath: string): ChangeLedgerEvent {
		const event: ChangeLedgerEvent = {
			id: this.generateId(),
			filePath,
			beforeHash: "unknown",
			state: "external_mutation",
			deltaChainLength: 0,
			timestamp: Date.now(),
			checkpointRequired: true,
		};

		this.events.push(event);
		return event;
	}

	/**
	 * Record a stale hash detection.
	 */
	recordStaleHash(filePath: string, beforeHash: string): ChangeLedgerEvent {
		const event: ChangeLedgerEvent = {
			id: this.generateId(),
			filePath,
			beforeHash,
			state: "stale_hash",
			deltaChainLength: 0,
			timestamp: Date.now(),
			checkpointRequired: true,
		};

		this.events.push(event);
		return event;
	}

	/**
	 * Record raw missing.
	 */
	recordRawMissing(filePath: string): ChangeLedgerEvent {
		const event: ChangeLedgerEvent = {
			id: this.generateId(),
			filePath,
			beforeHash: "unknown",
			state: "raw_missing",
			deltaChainLength: 0,
			timestamp: Date.now(),
			checkpointRequired: true,
		};

		this.events.push(event);
		return event;
	}

	/**
	 * Get the current ledger state for a file.
	 */
	getState(filePath: string): LedgerState {
		const fileEvents = this.eventsByFile.get(filePath);
		if (!fileEvents || fileEvents.length === 0) return "no_entry";

		const latest = fileEvents[fileEvents.length - 1];
		return latest.state;
	}

	/**
	 * Get the delta chain length for a file.
	 */
	getDeltaChainLength(filePath: string): number {
		const fileEvents = this.eventsByFile.get(filePath);
		if (!fileEvents) return 0;
		return fileEvents.length;
	}

	/**
	 * Get the latest event for a file.
	 */
	getLatestEvent(filePath: string): ChangeLedgerEvent | undefined {
		const fileEvents = this.eventsByFile.get(filePath);
		if (!fileEvents || fileEvents.length === 0) return undefined;
		return fileEvents[fileEvents.length - 1];
	}

	/**
	 * Get all events for a file.
	 */
	getEvents(filePath: string): ChangeLedgerEvent[] {
		return this.eventsByFile.get(filePath) ?? [];
	}

	/**
	 * Get all events across all files.
	 */
	getAllEvents(): ChangeLedgerEvent[] {
		return [...this.events];
	}

	/**
	 * Clear the ledger for a file (checkpoint).
	 */
	checkpoint(filePath: string): void {
		this.eventsByFile.delete(filePath);
	}

	/**
	 * Clear all events.
	 */
	clear(): void {
		this.events = [];
		this.eventsByFile.clear();
	}

	private generateId(): string {
		return `cl_${randomUUID().slice(0, 8)}`;
	}

	private hashContent(content: string): string {
		return createHash("sha256").update(content, "utf-8").digest("hex");
	}

	private computeDelta(before: string, after: string): string {
		// Simple line-based delta summary
		const beforeLines = before.split("\n");
		const afterLines = after.split("\n");
		const maxLen = Math.max(beforeLines.length, afterLines.length);

		const changes: string[] = [];
		for (let i = 0; i < maxLen; i++) {
			const bLine = beforeLines[i] ?? "";
			const aLine = afterLines[i] ?? "";
			if (bLine !== aLine) {
				if (bLine && !aLine) {
					changes.push(`L${i + 1}: -${bLine}`);
				} else if (!bLine && aLine) {
					changes.push(`L${i + 1}: +${aLine}`);
				} else {
					changes.push(`L${i + 1}: -${bLine}`);
					changes.push(`L${i + 1}: +${aLine}`);
				}
			}
		}

		return changes.slice(0, 50).join("\n");
	}

	private determineState(deltaChainLength: number, isStale: boolean, isExternalMutation: boolean): LedgerState {
		if (isExternalMutation) return "external_mutation";
		if (isStale) return "stale_hash";
		if (deltaChainLength === 0) return "no_entry";
		if (deltaChainLength === 1) return "changed_with_delta";
		if (deltaChainLength <= this.maxDeltaChain) return "changed_delta_chain_short";
		if (deltaChainLength > this.maxDeltaChain) return "changed_delta_chain_long";
		return "checkpoint_required";
	}
}
