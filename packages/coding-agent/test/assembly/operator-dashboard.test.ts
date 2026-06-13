import { describe, expect, it } from "vitest";
import { evaluateGovernor } from "../../src/core/assembly/adaptive-concurrency-governor.js";
import { buildOperatorDashboard, computeAssemblyHealth } from "../../src/core/assembly/operator-dashboard.js";

describe("OperatorDashboard", () => {
	it("builds dashboard from governor verdict", () => {
		const input = {
			resources: { cpuUsage: 0.2, memoryUsage: 0.3, cpuPressure: false, memoryPressure: false },
			rateLimit: { tokensRemaining: 100, limited: false, provider: "openai" },
			queues: {
				eventJournalDepth: 1,
				accpCompilerDepth: 1,
				artifactAcceptanceDepth: 1,
				assemblerDepth: 1,
				maxDepth: 100,
			},
			failureRate: { failureRate: 0, failures: 0, total: 10, throttleThreshold: 0.25 },
			signalStale: false,
			activeWorkers: 2,
			maxWorkersAtTier: 6,
			operatorVisibilityRemaining: 100,
			lastSampleAt: new Date().toISOString(),
		};
		const governor = evaluateGovernor(input);
		const dashboard = buildOperatorDashboard({ governor });
		expect(dashboard.governor.signal).toBe("green");
		expect(dashboard.governor.canAdmit).toBe(true);
	});

	it("computeAssemblyHealth is 1.0 for green dashboard", () => {
		const dashboard = buildOperatorDashboard({});
		expect(computeAssemblyHealth(dashboard)).toBeGreaterThanOrEqual(0.9);
	});

	it("computeAssemblyHealth drops for red governor", () => {
		const input = {
			resources: { cpuUsage: 0.9, memoryUsage: 0.9, cpuPressure: true, memoryPressure: true },
			rateLimit: { tokensRemaining: 0, limited: true, provider: "openai" },
			queues: {
				eventJournalDepth: 1,
				accpCompilerDepth: 1,
				artifactAcceptanceDepth: 1,
				assemblerDepth: 1,
				maxDepth: 100,
			},
			failureRate: { failureRate: 0.3, failures: 3, total: 10, throttleThreshold: 0.25 },
			signalStale: false,
			activeWorkers: 0,
			maxWorkersAtTier: 6,
			operatorVisibilityRemaining: 100,
			lastSampleAt: new Date().toISOString(),
		};
		const governor = evaluateGovernor(input);
		const dashboard = buildOperatorDashboard({ governor });
		expect(computeAssemblyHealth(dashboard)).toBeLessThanOrEqual(0.5);
	});

	it("dashboard has all required sections", () => {
		const dashboard = buildOperatorDashboard({});
		expect(dashboard.governor).toBeDefined();
		expect(dashboard.conflicts).toBeDefined();
		expect(dashboard.retries).toBeDefined();
		expect(dashboard.concurrency).toBeDefined();
	});
});
