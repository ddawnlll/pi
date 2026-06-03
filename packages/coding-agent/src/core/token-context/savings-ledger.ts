/**
 * P43 Savings Ledger - W003
 *
 * Records per-tool and per-mechanism token saving events.
 * JSONL session store. Per-mechanism aggregation.
 * Fail-open on write errors (I008).
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SavingsConfidence, SavingsMechanism, TokenSavingEvent } from "./types.js";

export interface SavingsSummary {
	/** Total estimated baseline tokens */
	totalEstimatedBaseline: number;
	/** Total estimated optimized tokens */
	totalEstimatedOptimized: number;
	/** Total estimated saving tokens */
	totalEstimatedSaving: number;
	/** Total actual baseline tokens (if provider data available) */
	totalActualBaseline: number;
	/** Total actual optimized tokens (if provider data available) */
	totalActualOptimized: number;
	/** Total actual saving tokens (if provider data available) */
	totalActualSaving: number;
	/** Estimated saving percentage */
	estimatedSavingPercent: number;
	/** Actual saving percentage (if provider data available) */
	actualSavingPercent?: number;
	/** Per-mechanism breakdown */
	byMechanism: Record<SavingsMechanism, MechanismSavingsSummary>;
	/** Per-tool breakdown */
	byTool: Record<string, ToolSavingsSummary>;
	/** Total events recorded */
	totalEvents: number;
	/** Count of events by confidence */
	confidenceBreakdown: Record<SavingsConfidence, number>;
	/** Fallback count */
	fallbackCount: number;
	/** Hard safety counter */
	hardSafetyCount: number;
}

export interface MechanismSavingsSummary {
	estimatedSaving: number;
	actualSaving: number;
	eventCount: number;
}

export interface ToolSavingsSummary {
	estimatedSaving: number;
	actualSaving: number;
	eventCount: number;
}

export class SavingsLedger {
	private events: TokenSavingEvent[] = [];
	private storePath: string | null = null;
	private hardSafetyCount = 0;

	constructor(storeDir?: string) {
		if (storeDir) {
			this.storePath = join(storeDir, "p43-savings.jsonl");
			this.loadEvents();
		}
	}

	/**
	 * Record a token saving event.
	 */
	record(event: Omit<TokenSavingEvent, "id" | "timestamp">): TokenSavingEvent {
		const fullEvent: TokenSavingEvent = {
			...event,
			id: this.generateId(),
			timestamp: Date.now(),
		};
		this.events.push(fullEvent);
		this.persistEvent(fullEvent);
		return fullEvent;
	}

	/**
	 * Record a hard safety counter increment.
	 */
	incrementHardSafety(): void {
		this.hardSafetyCount++;
	}

	/**
	 * Generate a unique event ID.
	 */
	private generateId(): string {
		return `p43_${randomUUID().slice(0, 8)}`;
	}

	/**
	 * Persist event to JSONL (fail-open).
	 */
	private persistEvent(event: TokenSavingEvent): void {
		if (!this.storePath) return;
		try {
			const dir = join(this.storePath, "..");
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			appendFileSync(this.storePath, `${JSON.stringify(event)}\n`, "utf-8");
		} catch {
			// I008: fail-open
		}
	}

	/**
	 * Load events from JSONL store.
	 */
	private loadEvents(): void {
		if (!this.storePath || !existsSync(this.storePath)) return;
		try {
			const content = readFileSync(this.storePath, "utf-8");
			const lines = content.trim().split("\n");
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					this.events.push(JSON.parse(line));
				} catch {
					// skip malformed lines
				}
			}
		} catch {
			// fail-open
		}
	}

	/**
	 * Generate savings summary.
	 */
	summarize(): SavingsSummary {
		const byMechanism: Record<string, MechanismSavingsSummary> = {};
		const byTool: Record<string, ToolSavingsSummary> = {};
		const confidenceBreakdown: Record<string, number> = {
			actual: 0,
			estimated: 0,
			synthetic: 0,
		};
		let totalEstimatedBaseline = 0;
		let totalEstimatedOptimized = 0;
		let totalEstimatedSaving = 0;
		let totalActualBaseline = 0;
		let totalActualOptimized = 0;
		let totalActualSaving = 0;
		let fallbackCount = 0;

		for (const event of this.events) {
			// Per-mechanism
			const mech = event.mechanism;
			if (!byMechanism[mech]) {
				byMechanism[mech] = { estimatedSaving: 0, actualSaving: 0, eventCount: 0 };
			}
			byMechanism[mech].estimatedSaving += event.estimatedSavingTokens;
			byMechanism[mech].actualSaving += event.actualSavingTokens ?? 0;
			byMechanism[mech].eventCount++;

			// Per-tool
			const tool = event.tool;
			if (!byTool[tool]) {
				byTool[tool] = { estimatedSaving: 0, actualSaving: 0, eventCount: 0 };
			}
			byTool[tool].estimatedSaving += event.estimatedSavingTokens;
			byTool[tool].actualSaving += event.actualSavingTokens ?? 0;
			byTool[tool].eventCount++;

			// Totals
			totalEstimatedBaseline += event.estimatedBaselineTokens;
			totalEstimatedOptimized += event.estimatedOptimizedTokens;
			totalEstimatedSaving += event.estimatedSavingTokens;
			totalActualBaseline += event.actualBaselineTokens ?? 0;
			totalActualOptimized += event.actualOptimizedTokens ?? 0;
			totalActualSaving += event.actualSavingTokens ?? 0;

			// Confidence
			confidenceBreakdown[event.confidence] = (confidenceBreakdown[event.confidence] ?? 0) + 1;

			// Fallback
			if (event.mechanism === "fallback" || event.mechanism === "llm_fallback") {
				fallbackCount++;
			}
		}

		const estimatedSavingPercent =
			totalEstimatedBaseline > 0 ? Math.round((totalEstimatedSaving / totalEstimatedBaseline) * 1000) / 10 : 0;

		const actualSavingPercent =
			totalActualBaseline > 0 ? Math.round((totalActualSaving / totalActualBaseline) * 1000) / 10 : undefined;

		return {
			totalEstimatedBaseline,
			totalEstimatedOptimized,
			totalEstimatedSaving,
			totalActualBaseline,
			totalActualOptimized,
			totalActualSaving,
			estimatedSavingPercent,
			actualSavingPercent,
			byMechanism: byMechanism as Record<SavingsMechanism, MechanismSavingsSummary>,
			byTool,
			totalEvents: this.events.length,
			confidenceBreakdown: confidenceBreakdown as Record<SavingsConfidence, number>,
			fallbackCount,
			hardSafetyCount: this.hardSafetyCount,
		};
	}

	/**
	 * Get all recorded events.
	 */
	getEvents(): TokenSavingEvent[] {
		return [...this.events];
	}

	/**
	 * Clear all events (for testing).
	 */
	clear(): void {
		this.events = [];
		this.hardSafetyCount = 0;
	}

	/**
	 * Get estimated saving as a percentage string.
	 */
	getEstimatedSavingPercent(): number {
		const summary = this.summarize();
		return summary.estimatedSavingPercent;
	}
}
