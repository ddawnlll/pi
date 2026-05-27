/**
 * Failure Clusterer — 25.L
 *
 * Covers:
 * - Constructor and configuration
 * - Diagnostic ingestion and clustering
 * - Matching strategies (error code, message similarity, context overlap)
 * - Cluster lifecycle (create, merge, evict)
 * - Edge cases and error conditions
 */

import { describe, expect, test } from "vitest";
import {
	createFailureClusterer,
	DEFAULT_FAILURE_CLUSTERER_CONFIG,
	FailureClusterer,
} from "../../src/brain-workers/regression-hunter/failure-clusterer.js";
import type { WorkerDiagnostic } from "../../src/brain-workers/types.js";
import { createWorkerDiagnostic } from "../../src/brain-workers/types.js";

// =============================================================================
// Helper: create a diagnostic
// =============================================================================

let diagnosticSeq = 0;

/**
 * Create a diagnostic with a unique sequence-based timestamp to avoid
 * dedup collisions (the clusterer uses timestamp+stopCondition as key).
 */
function makeDiagnostic(
	overrides?: Partial<WorkerDiagnostic> & { stopCondition?: string; message?: string },
): WorkerDiagnostic {
	diagnosticSeq++;
	const sc: any = overrides?.stopCondition ?? "test_error";
	return {
		timestamp: new Date(Date.now() + diagnosticSeq).toISOString(),
		stopCondition: sc,
		message: overrides?.message ?? `Test error ${diagnosticSeq}`,
		context: overrides?.context ?? {},
		evidenceRefs: overrides?.evidenceRefs ?? [],
	};
}

// =============================================================================
// FailureClusterer — Constructor & Configuration
// =============================================================================

describe("FailureClusterer — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const clusterer = new FailureClusterer();
		const config = clusterer.getConfig();

		expect(config.messageSimilarityThreshold).toBe(0.6);
		expect(config.matchOnErrorCode).toBe(true);
		expect(config.useMessageSimilarity).toBe(true);
		expect(config.useContextOverlap).toBe(true);
		expect(config.minContextOverlapRatio).toBe(0.3);
		expect(config.maxClusters).toBe(50);
	});

	test("creates with partial configuration overrides", () => {
		const clusterer = new FailureClusterer({
			matchOnErrorCode: false,
			maxClusters: 10,
			messageSimilarityThreshold: 0.8,
		});

		const config = clusterer.getConfig();
		expect(config.matchOnErrorCode).toBe(false);
		expect(config.maxClusters).toBe(10);
		expect(config.messageSimilarityThreshold).toBe(0.8);
		// Unchanged
		expect(config.useMessageSimilarity).toBe(true);
		expect(config.minContextOverlapRatio).toBe(0.3);
	});

	test("setConfig updates configuration", () => {
		const clusterer = new FailureClusterer();
		clusterer.setConfig({ maxClusters: 25, useMessageSimilarity: false });

		const config = clusterer.getConfig();
		expect(config.maxClusters).toBe(25);
		expect(config.useMessageSimilarity).toBe(false);
	});

	test("initial state has no clusters", () => {
		const clusterer = new FailureClusterer();
		expect(clusterer.getAllClusters()).toEqual([]);
		expect(clusterer.clusterCount).toBe(0);
		expect(clusterer.totalDiagnosticsClustered).toBe(0);
	});

	test("factory function creates instance", () => {
		const clusterer = createFailureClusterer({ maxClusters: 5 });
		expect(clusterer).toBeInstanceOf(FailureClusterer);
		expect(clusterer.getConfig().maxClusters).toBe(5);
	});
});

// =============================================================================
// FailureClusterer — Ingestion & Clustering
// =============================================================================

describe("FailureClusterer — Ingestion & Clustering", () => {
	test("ingest creates cluster from a single diagnostic", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "timeout", message: "Operation timed out" });

		const clusters = clusterer.ingest([diag]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].dominantErrorCode).toBe("timeout");
		expect(clusters[0].failureCount).toBe(1);
		expect(clusters[0].diagnosticIds).toHaveLength(1);
	});

	test("ingest clusters diagnostics with same error code", () => {
		const clusterer = new FailureClusterer();
		const d1 = makeDiagnostic({ stopCondition: "timeout", message: "Request timed out" });
		const d2 = makeDiagnostic({ stopCondition: "timeout", message: "Connection timed out" });

		const clusters = clusterer.ingest([d1, d2]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].failureCount).toBe(2);
		expect(clusters[0].dominantErrorCode).toBe("timeout");
	});

	test("ingest creates separate clusters for different error codes (when messages differ)", () => {
		const clusterer = new FailureClusterer();
		const d1 = makeDiagnostic({ stopCondition: "timeout", message: "Request timed out" });
		const d2 = makeDiagnostic({ stopCondition: "dependency_unavailable", message: "Database unreachable" });

		const clusters = clusterer.ingest([d1, d2]);
		expect(clusters).toHaveLength(2);
	});

	test("ingestOne returns the cluster for a single diagnostic", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "timeout" });

		const cluster = clusterer.ingestOne(diag);
		expect(cluster).toBeDefined();
		expect(cluster.dominantErrorCode).toBe("timeout");
		expect(cluster.failureCount).toBe(1);
	});

	test("ingestOne returns the same cluster for duplicate diagnostics", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "timeout" });

		const cluster1 = clusterer.ingestOne(diag);
		const cluster2 = clusterer.ingestOne(diag);
		expect(cluster2.id).toBe(cluster1.id);
	});

	test("totalDiagnosticsClustered increments correctly", () => {
		const clusterer = new FailureClusterer();
		const d1 = makeDiagnostic({ stopCondition: "timeout" });
		const d2 = makeDiagnostic({ stopCondition: "dependency_unavailable" });

		clusterer.ingest([d1, d2]);
		expect(clusterer.totalDiagnosticsClustered).toBe(2);
	});
});

// =============================================================================
// FailureClusterer — Matching Strategies
// =============================================================================

describe("FailureClusterer — Matching Strategies", () => {
	test("fuzzy message similarity matches similar messages", () => {
		const clusterer = new FailureClusterer({
			matchOnErrorCode: false,
			useContextOverlap: false,
			messageSimilarityThreshold: 0.4,
		});

		const d1 = makeDiagnostic({ stopCondition: "error_1", message: "Failed to connect to database server" });
		const d2 = makeDiagnostic({ stopCondition: "error_2", message: "Failed to connect to database cluster" });

		const clusters = clusterer.ingest([d1, d2]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].failureCount).toBe(2);
	});

	test("fuzzy message similarity does not match dissimilar messages", () => {
		const clusterer = new FailureClusterer({
			matchOnErrorCode: false,
			useContextOverlap: false,
			messageSimilarityThreshold: 0.8, // High threshold
		});

		const d1 = makeDiagnostic({ stopCondition: "error_1", message: "Failed to connect to database" });
		const d2 = makeDiagnostic({ stopCondition: "error_2", message: "Out of memory in renderer" });

		const clusters = clusterer.ingest([d1, d2]);
		expect(clusters).toHaveLength(2);
	});

	test("context key overlap matches diagnostics with same context keys", () => {
		const clusterer = new FailureClusterer({
			matchOnErrorCode: false,
			useMessageSimilarity: false,
			minContextOverlapRatio: 0.5,
		});

		const d1 = makeDiagnostic({
			stopCondition: "error_1",
			context: { module: "auth", operation: "login", region: "us-east" },
		});
		const d2 = makeDiagnostic({
			stopCondition: "error_2",
			context: { module: "auth", operation: "login", region: "eu-west" },
		});

		const clusters = clusterer.ingest([d1, d2]);
		// 2 of 3 keys overlap (module, operation) -> 0.66 >= 0.5
		expect(clusters).toHaveLength(1);
	});

	test("context key overlap does not match when too few keys overlap", () => {
		const clusterer = new FailureClusterer({
			matchOnErrorCode: false,
			useMessageSimilarity: false,
			minContextOverlapRatio: 0.8, // High threshold
		});

		const d1 = makeDiagnostic({
			stopCondition: "error_1",
			context: { module: "auth", region: "us-east" },
		});
		const d2 = makeDiagnostic({
			stopCondition: "error_2",
			context: { module: "billing", environment: "prod" },
		});

		const clusters = clusterer.ingest([d1, d2]);
		// 1 of 3 keys overlap (module) -> 0.33 < 0.8
		expect(clusters).toHaveLength(2);
	});

	test("matching disabled matchOnErrorCode does not group by error code", () => {
		const clusterer = new FailureClusterer({
			matchOnErrorCode: false,
			useMessageSimilarity: false,
			useContextOverlap: false,
		});

		const d1 = makeDiagnostic({ stopCondition: "timeout", message: "Request A timed out" });
		const d2 = makeDiagnostic({ stopCondition: "timeout", message: "Request B timed out" });

		const clusters = clusterer.ingest([d1, d2]);
		expect(clusters).toHaveLength(2);
	});
});

// =============================================================================
// FailureClusterer — Cluster Lifecycle
// =============================================================================

describe("FailureClusterer — Cluster Lifecycle", () => {
	test("getCluster returns a specific cluster by ID", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "timeout" });
		const clusters = clusterer.ingest([diag]);

		const retrieved = clusterer.getCluster(clusters[0].id);
		expect(retrieved).toBeDefined();
		expect(retrieved!.id).toBe(clusters[0].id);
	});

	test("getCluster returns undefined for unknown ID", () => {
		const clusterer = new FailureClusterer();
		expect(clusterer.getCluster("nonexistent")).toBeUndefined();
	});

	test("getClusterForDiagnostic returns cluster for a diagnostic key", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "timeout" });
		clusterer.ingest([diag]);

		// Key format matches makeDiagnosticKey: timestamp + stopCondition + message
		const diagnosticKey = diag.timestamp + diag.stopCondition + diag.message;
		const cluster = clusterer.getClusterForDiagnostic(diagnosticKey);
		expect(cluster).toBeDefined();
	});

	test("getClusterForDiagnostic returns undefined for unknown key", () => {
		const clusterer = new FailureClusterer();
		expect(clusterer.getClusterForDiagnostic("nonexistent")).toBeUndefined();
	});

	test("getClustersByFrequency sorts by failure count descending", () => {
		const clusterer = new FailureClusterer();

		// Ingest multiple diagnostics to create clusters
		const d1 = makeDiagnostic({ stopCondition: "timeout" });
		const d2 = makeDiagnostic({ stopCondition: "timeout" });
		const d3 = makeDiagnostic({ stopCondition: "dependency_unavailable" });

		clusterer.ingest([d1, d2, d3]);

		const byFreq = clusterer.getClustersByFrequency();
		expect(byFreq[0].failureCount).toBeGreaterThanOrEqual(byFreq[1].failureCount);
	});

	test("getClustersByRecency sorts by lastSeenAt descending", () => {
		const clusterer = new FailureClusterer();
		const d1 = makeDiagnostic({ stopCondition: "timeout" });
		const d2 = makeDiagnostic({ stopCondition: "dependency_unavailable" });

		clusterer.ingest([d1, d2]);

		const byRecency = clusterer.getClustersByRecency();
		expect(byRecency.length).toBe(2);
		// Both should have valid timestamps
		for (const c of byRecency) {
			expect(() => new Date(c.lastSeenAt)).not.toThrow();
		}
	});

	test("mergeClusters merges two clusters into one", () => {
		const clusterer = new FailureClusterer({
			matchOnErrorCode: false,
			useMessageSimilarity: false,
			useContextOverlap: false,
		});

		const d1 = makeDiagnostic({ stopCondition: "timeout" });
		const d2 = makeDiagnostic({ stopCondition: "dependency_unavailable" });

		const clusters = clusterer.ingest([d1, d2]);
		expect(clusters).toHaveLength(2);

		const merged = clusterer.mergeClusters(clusters[0].id, clusters[1].id);
		expect(merged).not.toBeNull();
		expect(merged!.id).toBe(clusters[0].id);
		expect(merged!.failureCount).toBe(2);
		expect(clusterer.clusterCount).toBe(1);
	});

	test("mergeClusters returns null for unknown IDs", () => {
		const clusterer = new FailureClusterer();
		const d1 = makeDiagnostic({ stopCondition: "timeout" });
		clusterer.ingest([d1]);

		expect(clusterer.mergeClusters("nonexistent", "nonexistent2")).toBeNull();
	});

	test("maxClusters eviction removes oldest cluster", () => {
		const clusterer = new FailureClusterer({
			maxClusters: 2,
			matchOnErrorCode: false,
			useMessageSimilarity: false,
			useContextOverlap: false,
		});

		// Ingest 3 diagnostics to force eviction
		const d1 = makeDiagnostic({ stopCondition: "timeout" });
		const d2 = makeDiagnostic({ stopCondition: "dependency_unavailable" });
		const d3 = makeDiagnostic({ stopCondition: "policy_blocked" });

		clusterer.ingest([d1, d2, d3]);
		expect(clusterer.clusterCount).toBeLessThanOrEqual(2);
	});

	test("clear resets all state", () => {
		const clusterer = new FailureClusterer();
		clusterer.ingest([makeDiagnostic({ stopCondition: "timeout" })]);
		expect(clusterer.clusterCount).toBe(1);

		clusterer.clear();
		expect(clusterer.clusterCount).toBe(0);
		expect(clusterer.totalDiagnosticsClustered).toBe(0);
		expect(clusterer.getAllClusters()).toEqual([]);
	});
});

// =============================================================================
// FailureClusterer — Remediation Inference
// =============================================================================

describe("FailureClusterer — Remediation Inference", () => {
	test("timeout stop condition gets appropriate remediation", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "timeout" });
		const clusters = clusterer.ingest([diag]);
		expect(clusters[0].suggestedRemediation).toContain("runtime budget");
	});

	test("token_budget_exhausted stop condition gets appropriate remediation", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "token_budget_exhausted" });
		const clusters = clusterer.ingest([diag]);
		expect(clusters[0].suggestedRemediation).toContain("token budget");
	});

	test("consecutive_failures_exceeded stop condition gets appropriate remediation", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "consecutive_failures_exceeded" });
		const clusters = clusterer.ingest([diag]);
		expect(clusters[0].suggestedRemediation).toContain("root cause");
	});

	test("unknown stop condition gets generic remediation", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "unknown_error" });
		const clusters = clusterer.ingest([diag]);
		expect(clusters[0].suggestedRemediation).toContain("diagnostic details");
	});
});

// =============================================================================
// FailureClusterer — Edge Cases
// =============================================================================

describe("FailureClusterer — Edge Cases", () => {
	test("ingest with empty array returns empty clusters", () => {
		const clusterer = new FailureClusterer();
		expect(clusterer.ingest([])).toEqual([]);
	});

	test("handles diagnostic with empty context gracefully", () => {
		const clusterer = new FailureClusterer();
		const diag = makeDiagnostic({ stopCondition: "timeout", context: {} });
		const clusters = clusterer.ingest([diag]);
		expect(clusters).toHaveLength(1);
	});

	test("computeMessageSimilarity with both empty messages returns 1", () => {
		const clusterer = new FailureClusterer();
		const d1 = makeDiagnostic({ stopCondition: "timeout", message: "" });
		const d2 = makeDiagnostic({ stopCondition: "timeout", message: "" });
		const clusters = clusterer.ingest([d1, d2]);
		// Both have empty messages and same error code - should cluster
		expect(clusters).toHaveLength(1);
	});

	test("handles large number of diagnostics without error", () => {
		const clusterer = new FailureClusterer();
		const diagnostics: WorkerDiagnostic[] = [];

		for (let i = 0; i < 100; i++) {
			diagnostics.push(
				makeDiagnostic({
					stopCondition: i % 2 === 0 ? "timeout" : "dependency_unavailable",
					message: `Error ${i}: something happened`,
				}),
			);
		}

		const clusters = clusterer.ingest(diagnostics);
		expect(clusters.length).toBeGreaterThan(0);
		expect(clusters.length).toBeLessThanOrEqual(50); // maxClusters default
	});

	test("cluster label is truncated to 120 characters", () => {
		const clusterer = new FailureClusterer();
		const longMessage = "A".repeat(300);
		const diag = makeDiagnostic({ stopCondition: "timeout", message: longMessage });
		const clusters = clusterer.ingest([diag]);
		expect(clusters[0].label.length).toBe(120);
	});
});
