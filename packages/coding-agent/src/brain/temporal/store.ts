/**
 * Temporal Journal v2 — In-Memory Store
 *
 * In-memory implementation of TemporalJournalStore with optional JSON file
 * persistence so that temporal events and rollups survive process restarts.
 *
 * Events are stored in chronological order. Rollups are stored indexed by
 * period and optional entity ID. All operations are serialised through a
 * promise-chain mutex for single-process thread safety.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	RollupPeriod,
	TemporalEvent,
	TemporalEventQuery,
	TemporalJournalStore,
	TemporalRollup,
	TemporalRollupQuery,
} from "./types.js";

// =========================================================================
// InMemoryTemporalJournalStore
// =========================================================================

/**
 * In-memory implementation of TemporalJournalStore.
 *
 * Stores events and rollups in arrays. Supports optional JSON file persistence
 * via saveToFile/loadFromFile. All operations are serialised through a
 * promise-chain mutex for single-process thread safety.
 */
export class InMemoryTemporalJournalStore implements TemporalJournalStore {
	private events: TemporalEvent[] = [];
	private rollups: TemporalRollup[] = [];
	/** Promise-chain mutex serialising all store operations. */
	private mutex: Promise<void> = Promise.resolve();

	/** Acquire the mutex to serialise concurrent access. */
	private async withMutex<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.mutex;
		let release: () => void;
		this.mutex = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prev;
		try {
			return await fn();
		} finally {
			release!();
		}
	}

	// ── Events ──

	async recordEvent(event: TemporalEvent): Promise<void> {
		return this.withMutex(async () => {
			if (!event.id || !event.timestamp) {
				throw new Error("TemporalEvent must have id and timestamp");
			}
			this.events.push(event);
		});
	}

	async recordEvents(events: TemporalEvent[]): Promise<void> {
		return this.withMutex(async () => {
			for (const event of events) {
				if (!event.id || !event.timestamp) {
					throw new Error(`TemporalEvent (id=${event.id}) must have id and timestamp`);
				}
			}
			this.events.push(...events);
		});
	}

	async getEvent(id: string): Promise<TemporalEvent | null> {
		return this.withMutex(async () => {
			return this.events.find((e) => e.id === id) ?? null;
		});
	}

	async queryEvents(query: TemporalEventQuery): Promise<TemporalEvent[]> {
		return this.withMutex(async () => {
			const filtered = this.applyEventFilters(this.events, query);
			// Sort by timestamp ascending
			filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
			const offset = query.offset ?? 0;
			const limit = query.limit ?? 100;
			return filtered.slice(offset, offset + limit);
		});
	}

	async countEvents(query: TemporalEventQuery): Promise<number> {
		return this.withMutex(async () => {
			return this.applyEventFilters(this.events, query).length;
		});
	}

	// ── Rollups ──

	async storeRollup(rollup: TemporalRollup): Promise<void> {
		return this.withMutex(async () => {
			if (!rollup.id || !rollup.periodStart || !rollup.periodEnd) {
				throw new Error("TemporalRollup must have id, periodStart, and periodEnd");
			}
			// Append; duplicates are allowed (regeneration overwrites by time)
			this.rollups.push(rollup);
		});
	}

	async getRollup(id: string): Promise<TemporalRollup | null> {
		return this.withMutex(async () => {
			return this.rollups.find((r) => r.id === id) ?? null;
		});
	}

	async queryRollups(query: TemporalRollupQuery): Promise<TemporalRollup[]> {
		return this.withMutex(async () => {
			const filtered = this.applyRollupFilters(this.rollups, query);
			// Sort by periodStart descending (newest first)
			filtered.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
			const offset = query.offset ?? 0;
			const limit = query.limit ?? 100;
			return filtered.slice(offset, offset + limit);
		});
	}

	async countRollups(query: TemporalRollupQuery): Promise<number> {
		return this.withMutex(async () => {
			return this.applyRollupFilters(this.rollups, query).length;
		});
	}

	async getLatestRollup(period: RollupPeriod, entityId?: string): Promise<TemporalRollup | null> {
		return this.withMutex(async () => {
			const matching = this.rollups.filter((r) => {
				if (r.period !== period) return false;
				if (entityId !== undefined && r.entityId !== entityId) return false;
				return true;
			});
			if (matching.length === 0) return null;
			// Return the one with the latest periodStart
			matching.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
			return matching[0] ?? null;
		});
	}

	// ── Maintenance ──

	async clear(): Promise<void> {
		return this.withMutex(async () => {
			this.events = [];
			this.rollups = [];
		});
	}

	async saveToFile(filePath: string): Promise<void> {
		return this.withMutex(async () => {
			const dir = path.dirname(filePath);
			await fs.mkdir(dir, { recursive: true });
			const data = { events: this.events, rollups: this.rollups };
			const json = JSON.stringify(data, null, 2);
			await fs.writeFile(filePath, json, "utf-8");
		});
	}

	async loadFromFile(filePath: string): Promise<number> {
		return this.withMutex(async () => {
			const json = await fs.readFile(filePath, "utf-8");
			let parsed: unknown;
			try {
				parsed = JSON.parse(json);
			} catch (e) {
				throw new Error(`Failed to parse temporal journal file: ${(e as Error).message}`);
			}

			if (!parsed || typeof parsed !== "object") {
				throw new Error("Temporal journal file must contain a JSON object");
			}

			const data = parsed as { events?: unknown; rollups?: unknown };

			if (!Array.isArray(data.events)) {
				throw new Error("Temporal journal file must contain an 'events' array");
			}
			if (!Array.isArray(data.rollups)) {
				throw new Error("Temporal journal file must contain a 'rollups' array");
			}

			this.events = data.events as TemporalEvent[];
			this.rollups = data.rollups as TemporalRollup[];
			return this.events.length;
		});
	}

	async eventCount(): Promise<number> {
		return this.withMutex(async () => {
			return this.events.length;
		});
	}

	async rollupCount(): Promise<number> {
		return this.withMutex(async () => {
			return this.rollups.length;
		});
	}

	// ── Internals ──

	private applyEventFilters(events: TemporalEvent[], query: TemporalEventQuery): TemporalEvent[] {
		return events.filter((e) => {
			if (query.since && e.timestamp < query.since) return false;
			if (query.until && e.timestamp >= query.until) return false;
			if (query.entityId && e.entityId !== query.entityId) return false;
			if (query.eventTypes && query.eventTypes.length > 0) {
				if (!query.eventTypes.includes(e.eventType)) return false;
			}
			return true;
		});
	}

	private applyRollupFilters(rollups: TemporalRollup[], query: TemporalRollupQuery): TemporalRollup[] {
		return rollups.filter((r) => {
			if (query.period && r.period !== query.period) return false;
			if (query.since && r.periodEnd <= query.since) return false;
			if (query.until && r.periodStart >= query.until) return false;
			if (query.entityId && r.entityId !== query.entityId) return false;
			return true;
		});
	}
}
