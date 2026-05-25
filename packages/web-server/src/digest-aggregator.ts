/**
 * Digest Aggregator — 24.N
 *
 * Collects staleness and momentum data from the brain's StalenessDetector
 * and produces digest reports that can be consumed by the overnight
 * morning report pipeline or surfaced via the web dashboard.
 *
 * The aggregator combines staleness scan results with momentum signals
 * to produce a human-readable summary of the brain's health: which items
 * are going stale, which are gaining or losing attention, and what the
 * overall trend looks like.
 *
 * This module defines its own input types rather than depending on the
 * coding-agent package directly, keeping the web-server dependency
 * surface minimal.
 */

// ---------------------------------------------------------------------------
// Input types (matches StalenessResult from coding-agent)
// ---------------------------------------------------------------------------

/**
 * A single staleness result for one item (structured like
 * StalenessResult in the coding-agent's staleness-detector).
 */
export interface DigestStalenessEntry {
	itemId: string;
	itemType: string;
	title: string;
	daysSinceActivity: number;
	stalenessScore: number;
	lastActivityAt: string;
	severity: string;
	isDecaying: boolean;
}

/**
 * A single momentum result for one item (structured like
 * MomentumResult in the coding-agent's staleness-detector).
 */
export interface DigestMomentumEntry {
	itemId: string;
	currentScore: number;
	averageScore: number;
	velocity: number;
	direction: string;
	confidence: number;
	sampleCount: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * A single digest entry summarizing the state of one brain item.
 */
export interface DigestEntry {
	/** Item identifier. */
	itemId: string;
	/** Item type label for display. */
	type: string;
	/** Human-readable title. */
	title: string;
	/** Staleness score (0–1), or undefined if not scanned. */
	stalenessScore?: number;
	/** Staleness severity, or undefined if not scanned. */
	stalenessSeverity?: string;
	/** Days since last activity, or undefined if not scanned. */
	daysSinceActivity?: number;
	/** Momentum direction, or undefined if insufficient data. */
	momentumDirection?: string;
	/** Momentum velocity, or undefined if insufficient data. */
	momentumVelocity?: number;
	/** Whether this item is flagged as stale (stalenessScore > 0.5). */
	isStale: boolean;
	/** Whether this item's staleness is increasing. */
	isDecaying: boolean;
}

/**
 * Aggregated statistics across the entire scan.
 */
export interface DigestStats {
	/** Total items tracked. */
	totalItems: number;
	/** Number of stale items. */
	staleCount: number;
	/** Number of decaying items. */
	decayingCount: number;
	/** Number of items with accelerating momentum. */
	acceleratingCount: number;
	/** Number of items with decaying momentum (score decreasing). */
	momentumDecayingCount: number;
	/** Breakdown by item type. */
	byType: Record<string, { total: number; stale: number; decaying: number }>;
}

/**
 * The complete digest report.
 */
export interface DigestReport {
	/** ISO 8601 timestamp of report generation. */
	generatedAt: string;
	/** Aggregate statistics. */
	stats: DigestStats;
	/** All entries sorted by priority (stalest first). */
	entries: DigestEntry[];
	/** Top items needing immediate attention (stale AND decaying). */
	critical: DigestEntry[];
}

// ---------------------------------------------------------------------------
// Error states
// ---------------------------------------------------------------------------

/**
 * Result of a digest aggregation, including error states.
 */
export type DigestResult = { ok: true; report: DigestReport } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// DigestAggregator
// ---------------------------------------------------------------------------

export class DigestAggregator {
	/**
	 * Build a digest report from staleness scan results and momentum data.
	 *
	 * Merges scan results with momentum information, computes aggregate
	 * statistics, and produces a sorted priority list.
	 *
	 * @param scanEntries - Flattened array of staleness results from scanning.
	 * @param momentum - Optional array of momentum results.
	 * @returns A digest report.
	 */
	aggregate(scanEntries: DigestStalenessEntry[], momentum?: DigestMomentumEntry[]): DigestReport {
		const momentumByItemId = new Map<string, DigestMomentumEntry>();
		if (momentum) {
			for (const m of momentum) {
				momentumByItemId.set(m.itemId, m);
			}
		}

		// Sort by staleness score descending
		const sorted = [...scanEntries].sort((a, b) => b.stalenessScore - a.stalenessScore);

		const entries: DigestEntry[] = sorted.map((result) => {
			const mom = momentumByItemId.get(result.itemId);

			return {
				itemId: result.itemId,
				type: result.itemType,
				title: result.title,
				stalenessScore: result.stalenessScore,
				stalenessSeverity: result.severity,
				daysSinceActivity: result.daysSinceActivity,
				momentumDirection: mom?.direction,
				momentumVelocity: mom?.velocity,
				isStale: result.stalenessScore > 0.5,
				isDecaying: result.isDecaying,
			};
		});

		// Compute aggregate statistics
		const byType: Record<string, { total: number; stale: number; decaying: number }> = {};
		let staleCount = 0;
		let decayingCount = 0;
		let acceleratingCount = 0;
		let momentumDecayingCount = 0;

		for (const entry of entries) {
			if (!byType[entry.type]) {
				byType[entry.type] = { total: 0, stale: 0, decaying: 0 };
			}
			byType[entry.type].total++;
			if (entry.isStale) {
				byType[entry.type].stale++;
				staleCount++;
			}
			if (entry.isDecaying) {
				byType[entry.type].decaying++;
				decayingCount++;
			}
			if (entry.momentumDirection === "accelerating") {
				acceleratingCount++;
			}
			if (entry.momentumDirection === "decaying") {
				momentumDecayingCount++;
			}
		}

		// Critical items: stale AND decaying (most urgent)
		const critical = entries.filter((e) => e.isStale && e.isDecaying);

		return {
			generatedAt: new Date().toISOString(),
			stats: {
				totalItems: entries.length,
				staleCount,
				decayingCount,
				acceleratingCount,
				momentumDecayingCount,
				byType,
			},
			entries,
			critical,
		};
	}

	/**
	 * Aggregate with error handling — catches any issues and returns
	 * a DigestResult indicating success or failure.
	 *
	 * @param scanEntries - Flattened array of staleness results.
	 * @param momentum - Optional array of momentum results.
	 * @returns A DigestResult (ok with report, or ok: false with error string).
	 */
	tryAggregate(scanEntries: DigestStalenessEntry[], momentum?: DigestMomentumEntry[]): DigestResult {
		try {
			if (!Array.isArray(scanEntries)) {
				return { ok: false, error: "scanEntries must be an array" };
			}
			const report = this.aggregate(scanEntries, momentum);
			return { ok: true, report };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, error: `Digest aggregation failed: ${message}` };
		}
	}

	/**
	 * Generate a plain-text summary of the digest report, suitable
	 * for inclusion in a morning report or notification.
	 *
	 * @param report - The digest report to summarize.
	 * @returns A human-readable summary string.
	 */
	formatSummary(report: DigestReport): string {
		const lines: string[] = [];
		lines.push(`Digest Report — ${report.generatedAt}`);
		lines.push("─".repeat(50));
		lines.push("");
		lines.push(`Total items: ${report.stats.totalItems}`);
		lines.push(`Stale: ${report.stats.staleCount}`);
		lines.push(`Decaying (staleness increasing): ${report.stats.decayingCount}`);
		lines.push(`Accelerating attention (positive momentum): ${report.stats.acceleratingCount}`);
		lines.push(`Decaying attention (negative momentum): ${report.stats.momentumDecayingCount}`);
		lines.push("");

		if (report.critical.length > 0) {
			lines.push("CRITICAL ITEMS (stale and decaying):");
			for (const entry of report.critical.slice(0, 10)) {
				lines.push(
					`  - [${entry.type}] ${entry.title} (${entry.daysSinceActivity?.toFixed(1)}d stale, score: ${entry.stalenessScore?.toFixed(2)})`,
				);
			}
			lines.push("");
		}

		// Per-type breakdown
		lines.push("Breakdown by type:");
		for (const [type, stats] of Object.entries(report.stats.byType)) {
			lines.push(`  ${type}: ${stats.total} total, ${stats.stale} stale, ${stats.decaying} decaying`);
		}

		return lines.join("\n");
	}

	/**
	 * Create a minimal digest entry for the "no data" / empty state.
	 */
	emptyReport(): DigestReport {
		return {
			generatedAt: new Date().toISOString(),
			stats: {
				totalItems: 0,
				staleCount: 0,
				decayingCount: 0,
				acceleratingCount: 0,
				momentumDecayingCount: 0,
				byType: {},
			},
			entries: [],
			critical: [],
		};
	}
}
