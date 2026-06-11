/**
 * P45.03 — Partition Cost Model
 *
 * Computes replay and assembly cost estimates for a given namespace partition.
 * Feeds into the adaptive concurrency governor for load-aware scheduling.
 */

import type { PartitionResult } from "./static-partitioner.js";

// =============================================================================
// Types
// =============================================================================

export interface PartitionCost {
	namespace: string;
	fileCount: number;
	estimatedReplayCost: number;
	blastRadius: number;
}

export interface PartitionCostModel {
	totalFiles: number;
	namespaceCount: number;
	costs: PartitionCost[];
	totalReplayCost: number;
}

// =============================================================================
// Cost Estimator
// =============================================================================

/**
 * Estimate partition costs for load-aware scheduling.
 * Replay cost is estimated as the blast radius times a constant factor.
 */
export function estimatePartitionCosts(result: PartitionResult): PartitionCostModel {
	const costs: PartitionCost[] = [];
	let totalReplayCost = 0;

	for (const ns of result.namespaces) {
		const fileCount = ns.files.length;
		const blastRadius = result.blastRadius.get(ns.namespace) ?? fileCount;
		// Replay cost is proportional to blast radius
		const estimatedReplayCost = blastRadius * 1.5;

		costs.push({
			namespace: ns.namespace,
			fileCount,
			estimatedReplayCost,
			blastRadius,
		});

		totalReplayCost += estimatedReplayCost;
	}

	return {
		totalFiles: costs.reduce((sum, c) => sum + c.fileCount, 0),
		namespaceCount: costs.length,
		costs,
		totalReplayCost,
	};
}
