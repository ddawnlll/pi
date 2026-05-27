/**
 * Signal Miner — 25.K
 *
 * Extracts raw signals from observation data and signal patterns.
 * Used by the IdeaScoutWorker during the "mining" phase to produce
 * MinedSignal instances from raw inputs.
 *
 * Key design:
 * - Each observation produces a signal with randomized confidence (0.4-0.9).
 * - Each signal pattern produces a signal with randomized confidence (0.5-0.9).
 * - Only signals above the configured minConfidence threshold are retained.
 * - Trend labels are inferred from text via simple keyword matching.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { MinedSignal } from "./idea-scout-worker.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the SignalMiner.
 */
export interface SignalMinerConfig {
	/**
	 * Minimum confidence threshold for accepting mined signals.
	 * Default: 0.3
	 */
	minConfidence: number;
}

/**
 * Default configuration for SignalMiner.
 */
export const DEFAULT_SIGNAL_MINER_CONFIG: SignalMinerConfig = {
	minConfidence: 0.3,
};

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

/**
 * An observation to mine signals from.
 */
export interface MiningObservation {
	/** Unique identifier */
	id: string;
	/** Human-readable title */
	title: string;
}

/**
 * A signal pattern to mine signals from.
 */
export interface MiningSignal {
	/** Unique identifier */
	id: string;
	/** Pattern name */
	pattern: string;
	/** Summary description */
	summary: string;
}

// ---------------------------------------------------------------------------
// Signal Miner
// ---------------------------------------------------------------------------

/**
 * Extracts raw signals from observation data and signal patterns.
 *
 * Each observation and signal pattern is evaluated for signal potential.
 * Signals with confidence above the threshold are returned as MinedSignal
 * instances with inferred trend labels.
 */
export class SignalMiner {
	private config: SignalMinerConfig;

	/**
	 * Create a new SignalMiner.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<SignalMinerConfig>) {
		this.config = {
			minConfidence: config?.minConfidence ?? DEFAULT_SIGNAL_MINER_CONFIG.minConfidence,
		};
	}

	/**
	 * Update the miner configuration.
	 */
	setConfig(config: Partial<SignalMinerConfig>): void {
		if (config.minConfidence !== undefined) this.config.minConfidence = config.minConfidence;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): SignalMinerConfig {
		return { ...this.config };
	}

	/**
	 * Mine signals from observations and signal patterns.
	 *
	 * Processes all observations and signal patterns, producing
	 * MinedSignal instances with randomized confidence scores.
	 * Only signals meeting the minimum confidence threshold are returned.
	 *
	 * @param observations - Observations to mine signals from.
	 * @param signals - Signal patterns to mine signals from.
	 * @returns Array of mined signals above the confidence threshold.
	 */
	mine(observations: MiningObservation[], signals: MiningSignal[]): MinedSignal[] {
		const minedSignals: MinedSignal[] = [];
		const now = new Date().toISOString();

		// Mine from observations
		for (const obs of observations) {
			const confidence = 0.4 + Math.random() * 0.5;
			if (confidence >= this.config.minConfidence) {
				minedSignals.push({
					id: randomUUID(),
					label: `mined:${obs.title}`,
					description: `Signal extracted from observation: ${obs.title}`,
					confidence: Math.round(confidence * 100) / 100,
					observationIds: [obs.id],
					trendLabel: this.inferTrendLabel(obs.title),
					createdAt: now,
				});
			}
		}

		// Mine from signal patterns
		for (const sig of signals) {
			const confidence = 0.5 + Math.random() * 0.4;
			if (confidence >= this.config.minConfidence) {
				minedSignals.push({
					id: randomUUID(),
					label: `pattern:${sig.pattern}`,
					description: `Signal mined from pattern: ${sig.pattern}: ${sig.summary}`,
					confidence: Math.round(confidence * 100) / 100,
					observationIds: [],
					trendLabel: this.inferTrendLabel(sig.pattern),
					createdAt: now,
				});
			}
		}

		return minedSignals;
	}

	/**
	 * Infer a trend label from a title or pattern string.
	 *
	 * Uses simple keyword matching to categorize into trend buckets.
	 *
	 * @param text - The text to analyze.
	 * @returns Inferred trend label string.
	 */
	private inferTrendLabel(text: string): string {
		const lower = text.toLowerCase();

		if (lower.includes("error") || lower.includes("fail") || lower.includes("exception")) {
			return "errors-and-failures";
		}
		if (lower.includes("performance") || lower.includes("slow") || lower.includes("timeout")) {
			return "performance";
		}
		if (lower.includes("memory") || lower.includes("storage") || lower.includes("disk")) {
			return "memory-and-storage";
		}
		if (lower.includes("security") || lower.includes("auth") || lower.includes("permission")) {
			return "security";
		}
		if (lower.includes("queue") || lower.includes("schedul") || lower.includes("wait")) {
			return "queue-and-scheduling";
		}
		if (lower.includes("integration") || lower.includes("api") || lower.includes("connect")) {
			return "integration";
		}
		if (lower.includes("config") || lower.includes("setting") || lower.includes("param")) {
			return "configuration";
		}
		if (lower.includes("test") || lower.includes("spec") || lower.includes("coverage")) {
			return "testing";
		}
		if (lower.includes("doc") || lower.includes("readme") || lower.includes("comment")) {
			return "documentation";
		}

		return "general";
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SignalMiner with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new SignalMiner instance.
 */
export function createSignalMiner(config?: Partial<SignalMinerConfig>): SignalMiner {
	return new SignalMiner(config);
}
