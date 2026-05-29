import { describe, expect, test } from "vitest";
import { FailureClusterer } from "../../src/brain-workers/regression-hunter/failure-clusterer.js";

let seq = 0;
function md(overrides?: any) {
	seq++;
	const sc = overrides?.stopCondition ?? "test_error";
	return {
		timestamp: new Date(Date.now() + seq).toISOString(),
		stopCondition: sc,
		message: overrides?.message ?? `error ${seq}`,
		context: overrides?.context ?? {},
		evidenceRefs: overrides?.evidenceRefs ?? [],
	};
}

describe("DEBUG clusterer", () => {
	test("direct test", () => {
		const c = new FailureClusterer();
		const d = md({ stopCondition: "timeout" });

		// Verify diagnostic object
		expect(typeof d.timestamp).toBe("string");
		expect(d.timestamp.length).toBeGreaterThan(0);
		expect(typeof d.stopCondition).toBe("string");
		expect(d.stopCondition).toBe("timeout");

		const key = d.timestamp + d.stopCondition;
		expect(typeof key).toBe("string");

		// Ingest
		const clusters = c.ingest([d]);
		expect(clusters).toHaveLength(1);

		// Try lookup
		const found = c.getClusterForDiagnostic(key);

		// Debug info
		expect(c.clusterCount).toBe(1);
		expect(c.totalDiagnosticsClustered).toBe(1);

		// The key might differ - let's check by iterating diagnosticToCluster
		const storedKeys = (c as any).diagnosticToCluster;
		console.log("storedKeys size:", storedKeys.size);
		console.log("storedKeys entries:", Array.from(storedKeys.entries()));
		console.log("lookup key:", JSON.stringify(key));

		// Alternative: iterate clusters to find the diagnostic key
		for (const cluster of c.getAllClusters()) {
			console.log("cluster diagnosticIds:", cluster.diagnosticIds);
			for (const storedKey of cluster.diagnosticIds) {
				console.log("  stored key:", JSON.stringify(storedKey));
				console.log("  test key:", JSON.stringify(key));
				console.log("  equal:", storedKey === key);
			}
		}

		expect(found).toBeDefined();
	});
});
