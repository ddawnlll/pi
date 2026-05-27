/**
 * Regression Hunter Worker — Failure Clusterer — 25.L
 *
 * Clusters similar failures together by analyzing error codes, message
 * patterns, and diagnostic context. Enables identifying shared root
 * causes across multiple regression findings.
 *
 * Key design:
 * - Failures are clustered by error code, fuzzy message similarity,
 *   and matching context keys.
 * - Each cluster carries a confidence score and suggested common
 *   remediation.
 * - Clusters can be merged when new failures arrive.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { WorkerDiagnostic } from "../types.js";

// ---------------------------------------------------------------------------
// Failure Cluster Types
// ---------------------------------------------------------------------------

/**
 * A cluster of related failures sharing common characteristics.
 *
 * Clusters group failures by error code, message similarity, or
 * context overlap so that remediation can target the root cause.
 */
export interface FailureCluster {
	/** Unique cluster identifier (UUID v4) */
	id: string;

	/** Human-readable label summarizing this cluster */
	label: string;

	/** The dominant error code across clustered failures */
	dominantErrorCode: string;

	/** Diagnostic IDs belonging to this cluster */
	diagnosticIds: string[];

	/** Number of failures grouped in this cluster */
	failureCount: number;

	/** ISO 8601 timestamp of the first failure in this cluster */
	firstSeenAt: string;

	/** ISO 8601 timestamp of the most recent failure in this cluster */
	lastSeenAt: string;

	/** Suggested common remediation, if determinable */
	suggestedRemediation: string;

	/** Confidence in the clustering (0-1) */
	confidence: number;

	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Failure Clusterer Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Failure Clusterer.
 */
export interface FailureClustererConfig {
	/**
	 * Similarity threshold (0-1) for fuzzy message matching within a cluster.
	 * Default: 0.6.
	 */
	messageSimilarityThreshold: number;

	/**
	 * Whether to match on exact error code alone (fast path).
	 * Default: true.
	 */
	matchOnErrorCode: boolean;

	/**
	 * Whether to use fuzzy message similarity when error codes differ.
	 * Default: true.
	 */
	useMessageSimilarity: boolean;

	/**
	 * Whether to consider context key overlap when clustering.
	 * Default: true.
	 */
	useContextOverlap: boolean;

	/**
	 * Minimum context key overlap ratio (0-1) to consider failures related.
	 * Default: 0.3.
	 */
	minContextOverlapRatio: number;

	/**
	 * Maximum number of clusters to maintain.
	 * Default: 50.
	 */
	maxClusters: number;
}

/**
 * Default configuration for the Failure Clusterer.
 */
export const DEFAULT_FAILURE_CLUSTERER_CONFIG: FailureClustererConfig = {
	messageSimilarityThreshold: 0.6,
	matchOnErrorCode: true,
	useMessageSimilarity: true,
	useContextOverlap: true,
	minContextOverlapRatio: 0.3,
	maxClusters: 50,
};

// ---------------------------------------------------------------------------
// Failure Clusterer
// ---------------------------------------------------------------------------

/**
 * Clusters similar failures by comparing error codes, diagnostic
 * messages, and context keys. Produces a deduplicated set of clusters
 * that can be used to identify common root causes.
 *
 * Features:
 * - Exact error code matching (fast path)
 * - Fuzzy message similarity via token overlap
 * - Context key overlap detection
 * - Cluster merging on addition of new diagnostics
 * - Confidence scoring for each cluster
 */
export class FailureClusterer {
	private config: FailureClustererConfig;
	private clusters: Map<string, FailureCluster>;
	private diagnosticToCluster: Map<string, string>; // diagnosticId -> clusterId

	/**
	 * Create a new FailureClusterer.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<FailureClustererConfig>) {
		this.config = {
			messageSimilarityThreshold:
				config?.messageSimilarityThreshold ?? DEFAULT_FAILURE_CLUSTERER_CONFIG.messageSimilarityThreshold,
			matchOnErrorCode: config?.matchOnErrorCode ?? DEFAULT_FAILURE_CLUSTERER_CONFIG.matchOnErrorCode,
			useMessageSimilarity: config?.useMessageSimilarity ?? DEFAULT_FAILURE_CLUSTERER_CONFIG.useMessageSimilarity,
			useContextOverlap: config?.useContextOverlap ?? DEFAULT_FAILURE_CLUSTERER_CONFIG.useContextOverlap,
			minContextOverlapRatio:
				config?.minContextOverlapRatio ?? DEFAULT_FAILURE_CLUSTERER_CONFIG.minContextOverlapRatio,
			maxClusters: config?.maxClusters ?? DEFAULT_FAILURE_CLUSTERER_CONFIG.maxClusters,
		};

		this.clusters = new Map();
		this.diagnosticToCluster = new Map();
	}

	/**
	 * Update the clusterer configuration.
	 */
	setConfig(config: Partial<FailureClustererConfig>): void {
		if (config.messageSimilarityThreshold !== undefined)
			this.config.messageSimilarityThreshold = config.messageSimilarityThreshold;
		if (config.matchOnErrorCode !== undefined) this.config.matchOnErrorCode = config.matchOnErrorCode;
		if (config.useMessageSimilarity !== undefined) this.config.useMessageSimilarity = config.useMessageSimilarity;
		if (config.useContextOverlap !== undefined) this.config.useContextOverlap = config.useContextOverlap;
		if (config.minContextOverlapRatio !== undefined)
			this.config.minContextOverlapRatio = config.minContextOverlapRatio;
		if (config.maxClusters !== undefined) this.config.maxClusters = config.maxClusters;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): FailureClustererConfig {
		return { ...this.config };
	}

	/**
	 * Ingest one or more diagnostics and cluster them.
	 *
	 * Each diagnostic is either added to an existing matching cluster
	 * or used to create a new cluster. Returns the updated list of
	 * all clusters.
	 *
	 * @param diagnostics - Array of WorkerDiagnostic objects to cluster.
	 * @returns All current clusters.
	 */
	ingest(diagnostics: WorkerDiagnostic[]): FailureCluster[] {
		for (const diagnostic of diagnostics) {
			const diagnosticKey = this.makeDiagnosticKey(diagnostic);

			// Skip if already clustered
			if (this.diagnosticToCluster.has(diagnosticKey)) {
				continue;
			}

			const matchedClusterId = this.findMatchingCluster(diagnostic);

			if (matchedClusterId) {
				this.addToCluster(matchedClusterId, diagnostic);
			} else {
				this.createCluster(diagnostic);
			}
		}

		return this.getAllClusters();
	}

	/**
	 * Ingest a single diagnostic and return the cluster it was added to
	 * or the newly created cluster.
	 *
	 * @param diagnostic - WorkerDiagnostic to cluster.
	 * @returns The cluster this diagnostic was assigned to.
	 */
	ingestOne(diagnostic: WorkerDiagnostic): FailureCluster {
		const diagnosticKey = this.makeDiagnosticKey(diagnostic);
		const existingClusterId = this.diagnosticToCluster.get(diagnosticKey);
		if (existingClusterId) {
			const cluster = this.clusters.get(existingClusterId);
			if (cluster) return cluster;
		}

		const matchedClusterId = this.findMatchingCluster(diagnostic);

		if (matchedClusterId) {
			this.addToCluster(matchedClusterId, diagnostic);
			return this.clusters.get(matchedClusterId)!;
		}

		return this.createCluster(diagnostic);
	}

	/**
	 * Find an existing cluster that matches the given diagnostic.
	 *
	 * Matching strategy (in order):
	 * 1. Exact error code match (if enabled)
	 * 2. Fuzzy message similarity (if enabled)
	 * 3. Context key overlap (if enabled)
	 *
	 * @param diagnostic - The diagnostic to match.
	 * @returns The matching cluster ID, or null if no match.
	 */
	private findMatchingCluster(diagnostic: WorkerDiagnostic): string | null {
		for (const [clusterId, cluster] of this.clusters) {
			// Strategy 1: Exact error code match
			if (this.config.matchOnErrorCode && cluster.dominantErrorCode === diagnostic.stopCondition) {
				return clusterId;
			}

			// Strategy 2: Fuzzy message similarity
			if (this.config.useMessageSimilarity) {
				// Compare against the first diagnostic's message in the cluster
				// (we store the cluster label as representative)
				const similarity = this.computeMessageSimilarity(cluster.label, diagnostic.message);
				if (similarity >= this.config.messageSimilarityThreshold) {
					return clusterId;
				}
			}

			// Strategy 3: Context key overlap
			if (this.config.useContextOverlap) {
				const overlap = this.computeContextOverlap(
					diagnostic.context,
					cluster.metadata.lastContext as Record<string, unknown> | undefined,
				);
				if (overlap >= this.config.minContextOverlapRatio) {
					return clusterId;
				}
			}
		}

		return null;
	}

	/**
	 * Compute fuzzy message similarity using token overlap (Jaccard index).
	 *
	 * Splits both messages into word tokens (lowercased, non-alphanumeric
	 * stripped) and computes the Jaccard similarity coefficient.
	 *
	 * @param a - First message string.
	 * @param b - Second message string.
	 * @returns Similarity score 0-1.
	 */
	private computeMessageSimilarity(a: string, b: string): number {
		const tokensA = this.tokenize(a);
		const tokensB = this.tokenize(b);

		if (tokensA.size === 0 && tokensB.size === 0) return 1;
		if (tokensA.size === 0 || tokensB.size === 0) return 0;

		const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
		const union = new Set([...tokensA, ...tokensB]);

		return intersection.size / union.size;
	}

	/**
	 * Split a string into normalized word tokens.
	 */
	private tokenize(text: string): Set<string> {
		const words = text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 0);
		return new Set(words);
	}

	/**
	 * Compute context key overlap ratio between two context objects.
	 *
	 * @param a - First context object.
	 * @param b - Second context object (may be undefined for new clusters).
	 * @returns Overlap ratio 0-1.
	 */
	private computeContextOverlap(a: Record<string, unknown>, b?: Record<string, unknown>): number {
		if (!b) return 0;

		const keysA = new Set(Object.keys(a));
		const keysB = new Set(Object.keys(b));

		// Empty contexts do not match meaningfully
		if (keysA.size === 0 || keysB.size === 0) return 0;

		const intersection = new Set([...keysA].filter((k) => keysB.has(k)));
		const union = new Set([...keysA, ...keysB]);

		return intersection.size / union.size;
	}

	/**
	 * Build a unique key for a diagnostic.
	 *
	 * Uses timestamp, stop condition, and message to distinguish
	 * diagnostics that may share the same timestamp (created within
	 * the same millisecond) but have different messages.
	 */
	private makeDiagnosticKey(diagnostic: WorkerDiagnostic): string {
		return diagnostic.timestamp + diagnostic.stopCondition + diagnostic.message;
	}

	/**
	 * Add a diagnostic to an existing cluster.
	 */
	private addToCluster(clusterId: string, diagnostic: WorkerDiagnostic): void {
		const cluster = this.clusters.get(clusterId);
		if (!cluster) return;

		const diagnosticKey = this.makeDiagnosticKey(diagnostic);

		cluster.diagnosticIds.push(diagnosticKey);
		cluster.failureCount++;
		cluster.lastSeenAt = diagnostic.timestamp;

		// Update last context for future matching
		cluster.metadata.lastContext = diagnostic.context;

		this.diagnosticToCluster.set(diagnosticKey, clusterId);
	}

	/**
	 * Create a new cluster for a diagnostic.
	 */
	private createCluster(diagnostic: WorkerDiagnostic): FailureCluster {
		// Enforce max clusters limit — evict oldest if needed
		if (this.clusters.size >= this.config.maxClusters) {
			const oldestKey = this.findOldestClusterKey();
			if (oldestKey) {
				this.clusters.delete(oldestKey);
			}
		}

		const clusterId = randomUUID();
		const diagnosticKey = this.makeDiagnosticKey(diagnostic);

		const cluster: FailureCluster = {
			id: clusterId,
			label: diagnostic.message.substring(0, 120),
			dominantErrorCode: diagnostic.stopCondition,
			diagnosticIds: [diagnosticKey],
			failureCount: 1,
			firstSeenAt: diagnostic.timestamp,
			lastSeenAt: diagnostic.timestamp,
			suggestedRemediation: this.inferRemediation(diagnostic),
			confidence: 0.7,
			metadata: {
				lastContext: diagnostic.context,
			},
		};

		this.clusters.set(clusterId, cluster);
		this.diagnosticToCluster.set(diagnosticKey, clusterId);

		return cluster;
	}

	/**
	 * Infer a suggested remediation from a diagnostic's stop condition.
	 */
	private inferRemediation(diagnostic: WorkerDiagnostic): string {
		switch (diagnostic.stopCondition) {
			case "timeout":
				return "Consider increasing the runtime budget or optimizing the operation";
			case "token_budget_exhausted":
				return "Consider increasing the token budget or reducing the scope of analysis";
			case "consecutive_failures_exceeded":
				return "Investigate the root cause of repeated failures before retrying";
			case "dependency_unavailable":
				return "Check that all required dependencies are available and accessible";
			case "policy_blocked":
				return "Review policy rules that may be blocking this operation";
			case "user_interrupt":
				return "Operation was manually cancelled; retry when ready";
			case "system_shutdown":
				return "System was shut down; operation may be retried on restart";
			default:
				return "Review the diagnostic details and investigate the root cause";
		}
	}

	/**
	 * Find the key of the cluster with the oldest lastSeenAt.
	 */
	private findOldestClusterKey(): string | null {
		let oldestKey: string | null = null;
		let oldestTime: string | null = null;

		for (const [key, cluster] of this.clusters) {
			if (oldestTime === null || cluster.lastSeenAt < oldestTime) {
				oldestTime = cluster.lastSeenAt;
				oldestKey = key;
			}
		}

		return oldestKey;
	}

	/**
	 * Get the cluster for a given diagnostic ID (timestamp+stopCondition key).
	 *
	 * @param diagnosticKey - The diagnostic lookup key.
	 * @returns The cluster, or undefined if not found.
	 */
	getClusterForDiagnostic(diagnosticKey: string): FailureCluster | undefined {
		const clusterId = this.diagnosticToCluster.get(diagnosticKey);
		if (!clusterId) return undefined;
		return this.clusters.get(clusterId);
	}

	/**
	 * Get a cluster by its ID.
	 *
	 * @param clusterId - The cluster ID.
	 * @returns The cluster, or undefined if not found.
	 */
	getCluster(clusterId: string): FailureCluster | undefined {
		return this.clusters.get(clusterId);
	}

	/**
	 * Get all current clusters.
	 */
	getAllClusters(): FailureCluster[] {
		return Array.from(this.clusters.values());
	}

	/**
	 * Get clusters sorted by failure count descending.
	 */
	getClustersByFrequency(): FailureCluster[] {
		return Array.from(this.clusters.values()).sort((a, b) => b.failureCount - a.failureCount);
	}

	/**
	 * Get clusters sorted by lastSeenAt descending (most recent first).
	 */
	getClustersByRecency(): FailureCluster[] {
		return Array.from(this.clusters.values()).sort(
			(a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
		);
	}

	/**
	 * Total number of unique diagnostics clustered.
	 */
	get totalDiagnosticsClustered(): number {
		return this.diagnosticToCluster.size;
	}

	/**
	 * Total number of clusters.
	 */
	get clusterCount(): number {
		return this.clusters.size;
	}

	/**
	 * Clear all clusters and diagnostic mappings (for testing or reset).
	 */
	clear(): void {
		this.clusters.clear();
		this.diagnosticToCluster.clear();
	}

	/**
	 * Merge two clusters into one, preserving the first cluster as the
	 * primary and moving all diagnostics from the second cluster into it.
	 *
	 * @param primaryId - ID of the primary cluster (retained after merge).
	 * @param secondaryId - ID of the secondary cluster (removed after merge).
	 * @returns The merged cluster, or null if either ID was not found.
	 */
	mergeClusters(primaryId: string, secondaryId: string): FailureCluster | null {
		const primary = this.clusters.get(primaryId);
		const secondary = this.clusters.get(secondaryId);

		if (!primary || !secondary) return null;

		// Merge diagnostic IDs
		for (const diagnosticKey of secondary.diagnosticIds) {
			if (!primary.diagnosticIds.includes(diagnosticKey)) {
				primary.diagnosticIds.push(diagnosticKey);
				this.diagnosticToCluster.set(diagnosticKey, primaryId);
			}
		}

		// Update counts and timestamps
		primary.failureCount = primary.diagnosticIds.length;
		if (secondary.firstSeenAt < primary.firstSeenAt) {
			primary.firstSeenAt = secondary.firstSeenAt;
		}
		if (secondary.lastSeenAt > primary.lastSeenAt) {
			primary.lastSeenAt = secondary.lastSeenAt;
		}

		// Remove secondary cluster
		this.clusters.delete(secondaryId);

		return primary;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a FailureClusterer with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new FailureClusterer instance.
 */
export function createFailureClusterer(config?: Partial<FailureClustererConfig>): FailureClusterer {
	return new FailureClusterer(config);
}
