/**
 * P26.N — Promotion gates, stress tests, and scale-readiness
 *
 * Tests:
 * - Promotion gate records exist for all workstreams
 * - Stable_3 dogfood requires all gates to pass
 * - Stable_6 requires stress gates to pass
 * - Scale mode permission checks
 * - Gate persistence and loading
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createP26PromotionGates } from "../src/core/promotion-gates.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.N — Promotion gates and scale readiness", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p26n-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	// ---- Gate creation ----

	it("should create all P26 promotion gates", () => {
		const gates = createP26PromotionGates();
		const allGates = gates.getAllGates();

		// Verify specific gates exist
		const gateIds = allGates.map((g) => g.id);
		expect(gateIds).toContain("repair_mode_lockdown");
		expect(gateIds).toContain("executor_isolation");
		expect(gateIds).toContain("execution_context");
		expect(gateIds).toContain("abort_chain");
		expect(gateIds).toContain("git_serialization");
		expect(gateIds).toContain("attempt_scoped_worktrees");
		expect(gateIds).toContain("state_store_concurrency");
		expect(gateIds).toContain("validation_runner");
		expect(gateIds).toContain("validation_lane");
		expect(gateIds).toContain("llm_watchdog");
		expect(gateIds).toContain("lease_monitor");
		expect(gateIds).toContain("integration_queue");
		expect(gateIds).toContain("anti_stall_analysis");
		expect(gateIds).toContain("stable_3_dogfood");
		expect(gateIds).toContain("stable_6_stress");
	});

	it("should start all gates as pending", () => {
		const gates = createP26PromotionGates();
		const allGates = gates.getAllGates();
		expect(allGates.every((g) => g.status === "pending")).toBe(true);
	});

	it("should register each gate with description and workstream", () => {
		const gates = createP26PromotionGates();
		for (const gate of gates.getAllGates()) {
			expect(gate.description).toBeTruthy();
			expect(gate.workstream).toMatch(/^P26\.[A-N]$/);
		}
	});

	// ---- Gate lifecycle ----

	it("should mark a gate as passed", async () => {
		const gates = createP26PromotionGates();
		await gates.passGate("executor_isolation", "All 8 executor isolation tests pass");

		const gate = gates.getGate("executor_isolation");
		expect(gate?.status).toBe("passed");
		expect(gate?.evaluatedAt).toBeTruthy();
		expect(gate?.evidence).toContain("8 executor isolation tests");
	});

	it("should mark a gate as failed", async () => {
		const gates = createP26PromotionGates();
		await gates.failGate("abort_chain", "Abort signal not propagating");

		const gate = gates.getGate("abort_chain");
		expect(gate?.status).toBe("failed");
		expect(gate?.error).toContain("Abort signal not propagating");
	});

	it("should throw on unknown gate", async () => {
		const gates = createP26PromotionGates();
		await expect(gates.passGate("unknown_gate")).rejects.toThrow();
	});

	// ---- Scale mode permissions ----

	it("should not permit stable_3 when gates are pending", () => {
		const gates = createP26PromotionGates();
		expect(gates.isModePermitted("stable_3")).toBe(false);
	});

	it("should permit stable_3 when all gates pass", async () => {
		const gates = createP26PromotionGates();
		for (const gate of gates.getAllGates()) {
			await gates.passGate(gate.id, "Automated");
		}
		expect(gates.isModePermitted("stable_3")).toBe(true);
	});

	it("should permit stable_1 regardless of gate status", () => {
		const gates = createP26PromotionGates();
		expect(gates.isModePermitted("stable_1")).toBe(true);
	});

	it("should not permit stable_6 when gates are pending", () => {
		const gates = createP26PromotionGates();
		expect(gates.isModePermitted("stable_6")).toBe(false);
	});

	it("should not permit stable_6 when stress gates are pending even if others pass", async () => {
		const gates = createP26PromotionGates();
		// Pass all non-stress gates
		for (const gate of gates.getAllGates()) {
			if (gate.workstream !== "P26.N") {
				await gates.passGate(gate.id, "Automated");
			}
		}
		// stable_6 should still be blocked because stress gates are pending
		expect(gates.isModePermitted("stable_6")).toBe(false);
	});

	it("should permit stable_6 when all gates including stress pass", async () => {
		const gates = createP26PromotionGates();
		for (const gate of gates.getAllGates()) {
			await gates.passGate(gate.id, "Automated");
		}
		expect(gates.isModePermitted("stable_6")).toBe(true);
	});

	// ---- Gate blocking ----

	it("should return blocked gates for stable_3 mode", () => {
		const gates = createP26PromotionGates();
		const blocked = gates.getBlockedGates("stable_3");
		expect(blocked.length).toBe(gates.getAllGates().length);
	});

	it("should return empty blocked gates when all pass", async () => {
		const gates = createP26PromotionGates();
		for (const gate of gates.getAllGates()) {
			await gates.passGate(gate.id, "Automated");
		}
		const blocked = gates.getBlockedGates("stable_3");
		expect(blocked.length).toBe(0);
	});

	// ---- Persistence ----

	it("should persist gate records to disk", async () => {
		const persistPath = path.join(tmpDir, ".pi", "promotion-gates.json");
		const gates = createP26PromotionGates({ persistPath });
		await gates.passGate("executor_isolation", "Passed");

		// Read the file
		const content = await fs.readFile(persistPath, "utf-8");
		const data = JSON.parse(content);
		expect(Array.isArray(data)).toBe(true);
		expect(data.some((r: any) => r.id === "executor_isolation" && r.status === "passed")).toBe(true);
	});

	it("should load persisted gate records", async () => {
		const persistPath = path.join(tmpDir, ".pi", "promotion-gates.json");
		await fs.mkdir(path.dirname(persistPath), { recursive: true });

		// Write initial records
		const initial = [
			{
				id: "executor_isolation",
				description: "Test",
				status: "passed",
				evaluatedAt: new Date().toISOString(),
				workstream: "P26.B",
			},
		];
		await fs.writeFile(persistPath, JSON.stringify(initial), "utf-8");

		const gates = createP26PromotionGates({ persistPath });
		await gates.load();

		const gate = gates.getGate("executor_isolation");
		expect(gate?.status).toBe("passed");
	});

	// ---- Reset ----

	it("should reset all gates to pending", async () => {
		const gates = createP26PromotionGates();
		for (const gate of gates.getAllGates()) {
			await gates.passGate(gate.id, "Automated");
		}

		await gates.reset();
		expect(gates.getAllGates().every((g) => g.status === "pending")).toBe(true);
	});
});
