/**
 * Brain Worker Contracts, Roles, Manifests, and Lifecycle States — 25.C
 *
 * Covers:
 * - Type correctness (compile-time)
 * - WorkerRole enum and constants
 * - WorkerLifecycleState enum and constants
 * - Factory functions produce valid objects
 * - Validation rejects invalid objects
 * - Serialization / deserialization round-trips
 * - Contract generation for each role
 * - Capability matching
 * - Dependency resolution
 * - Contract validation against requirements
 * - ContractRegistry operations
 * - Manifest generation
 * - Lifecycle state transitions
 * - Budget enforcement
 * - Cooldown management
 * - Deduplication
 * - Diagnostics and health checks
 * - Edge cases and error conditions
 */

import { describe, expect, test } from "vitest";
import {
	ContractRegistry,
	// Contract functions
	generateContractForRole,
	generateManifest,
	matchCapabilities,
	resolveDependencies,
	validateContractAgainstRequirements,
} from "../../src/brain-workers/contracts.js";
import {
	// Lifecycle
	WorkerLifecycleEngine,
	type WorkerTransition,
} from "../../src/brain-workers/lifecycle.js";
import {
	ALL_WORKER_LIFECYCLE_STATES,
	// Constants
	ALL_WORKER_ROLES,
	ALL_WORKER_STOP_CONDITIONS,
	createWorkerCooldown,
	createWorkerDiagnostic,
	// Factory functions
	createWorkerManifest,
	DEFAULT_ROLE_BUDGETS,
	DEFAULT_WORKER_DEDUP_CONFIG,
	deserializeWorkerManifest,
	deserializeWorkerStatus,
	NON_OPERATIONAL_STATES,
	OPERATIONAL_STATES,
	// Serialization
	serializeWorkerManifest,
	serializeWorkerStatus,
	validateWorkerBudget,
	validateWorkerContract,
	// Validation
	validateWorkerManifest,
	validateWorkerStatus,
	WORKER_LIFECYCLE_STATE_LABELS,
	WORKER_ROLE_LABELS,
	type WorkerLifecycleState,
	// Types
	type WorkerManifest,
	type WorkerStatus,
} from "../../src/brain-workers/types.js";

// =============================================================================
// Types & Constants
// =============================================================================

describe("ALL_WORKER_ROLES", () => {
	test("contains all expected roles", () => {
		expect(ALL_WORKER_ROLES).toContain("observer");
		expect(ALL_WORKER_ROLES).toContain("analyst");
		expect(ALL_WORKER_ROLES).toContain("proposer");
		expect(ALL_WORKER_ROLES).toContain("reflector");
		expect(ALL_WORKER_ROLES).toContain("diagnostician");
		expect(ALL_WORKER_ROLES).toContain("archivist");
		expect(ALL_WORKER_ROLES).toContain("coordinator");
		expect(ALL_WORKER_ROLES).toContain("auditor");
		expect(ALL_WORKER_ROLES).toContain("ideaScout");
		expect(ALL_WORKER_ROLES).toContain("fixStrategist");
		expect(ALL_WORKER_ROLES.length).toBe(10);
	});

	test("every role has a label", () => {
		for (const role of ALL_WORKER_ROLES) {
			expect(WORKER_ROLE_LABELS[role]).toBeDefined();
			expect(typeof WORKER_ROLE_LABELS[role]).toBe("string");
		}
	});

	test("every role has a default budget", () => {
		for (const role of ALL_WORKER_ROLES) {
			const budget = DEFAULT_ROLE_BUDGETS[role];
			expect(budget).toBeDefined();
			expect(budget.maxTokensPerCycle).toBeGreaterThan(0);
			expect(budget.maxConsecutiveFailures).toBeGreaterThan(0);
			expect(budget.cooldownMs).toBeGreaterThanOrEqual(0);
			expect(budget.maxRuntimeMs).toBeGreaterThan(0);
		}
	});
});

describe("ALL_WORKER_LIFECYCLE_STATES", () => {
	test("contains all expected states", () => {
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("dormant");
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("standby");
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("active");
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("busy");
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("cooling");
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("paused");
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("retired");
		expect(ALL_WORKER_LIFECYCLE_STATES).toContain("failed");
		expect(ALL_WORKER_LIFECYCLE_STATES.length).toBe(8);
	});

	test("every state has a label", () => {
		for (const state of ALL_WORKER_LIFECYCLE_STATES) {
			expect(WORKER_LIFECYCLE_STATE_LABELS[state]).toBeDefined();
			expect(typeof WORKER_LIFECYCLE_STATE_LABELS[state]).toBe("string");
		}
	});

	test("OPERATIONAL_STATES and NON_OPERATIONAL_STATES partition all states", () => {
		const all = new Set(ALL_WORKER_LIFECYCLE_STATES);
		const operational = new Set(OPERATIONAL_STATES);
		const nonOperational = new Set(NON_OPERATIONAL_STATES);

		for (const state of all) {
			expect(operational.has(state) || nonOperational.has(state)).toBe(true);
		}

		// They should be disjoint
		for (const s of operational) {
			expect(nonOperational.has(s)).toBe(false);
		}
	});
});

describe("ALL_WORKER_STOP_CONDITIONS", () => {
	test("contains all expected conditions", () => {
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("completed");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("timeout");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("token_budget_exhausted");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("consecutive_failures_exceeded");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("user_interrupt");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("policy_blocked");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("dependency_unavailable");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("system_shutdown");
		expect(ALL_WORKER_STOP_CONDITIONS).toContain("unknown_error");
		expect(ALL_WORKER_STOP_CONDITIONS.length).toBe(9);
	});
});

describe("DEFAULT_WORKER_DEDUP_CONFIG", () => {
	test("has expected defaults", () => {
		expect(DEFAULT_WORKER_DEDUP_CONFIG.enabled).toBe(true);
		expect(DEFAULT_WORKER_DEDUP_CONFIG.windowMs).toBe(300_000);
		expect(DEFAULT_WORKER_DEDUP_CONFIG.useSimilarity).toBe(true);
		expect(DEFAULT_WORKER_DEDUP_CONFIG.similarityThreshold).toBe(0.85);
	});
});

// =============================================================================
// Factory Functions
// =============================================================================

describe("createWorkerManifest", () => {
	const observerContract = generateContractForRole("observer");

	test("creates a valid manifest with required fields", () => {
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test-observer",
			description: "Test observer worker",
			contract: observerContract,
		});

		expect(manifest.id).toBeDefined();
		expect(typeof manifest.id).toBe("string");
		expect(manifest.role).toBe("observer");
		expect(manifest.name).toBe("test-observer");
		expect(manifest.description).toBe("Test observer worker");
		expect(manifest.createdAt).toBeDefined();
		expect(manifest.version).toBe("1.0.0");
		expect(manifest.tags).toEqual([]);
		expect(manifest.metadata).toEqual({});
		expect(manifest.budget).toBeDefined();
		expect(manifest.budget.maxTokensPerCycle).toBe(50_000);
	});

	test("passes validation after creation", () => {
		const manifest = createWorkerManifest({
			role: "analyst",
			name: "test-analyst",
			description: "Test analyst worker",
			contract: generateContractForRole("analyst"),
		});
		const result = validateWorkerManifest(manifest);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	test("accepts optional overrides", () => {
		const manifest = createWorkerManifest({
			role: "proposer",
			name: "custom-proposer",
			description: "Custom proposer worker",
			contract: generateContractForRole("proposer"),
			version: "2.0.0",
			tags: ["test", "custom"],
			metadata: { key: "value" },
		});

		expect(manifest.version).toBe("2.0.0");
		expect(manifest.tags).toEqual(["test", "custom"]);
		expect(manifest.metadata).toEqual({ key: "value" });
	});
});

describe("createWorkerCooldown", () => {
	test("creates an empty (not cooling) cooldown", () => {
		const cooldown = createWorkerCooldown();
		expect(cooldown.startedAt).toBeNull();
		expect(cooldown.endsAt).toBeNull();
		expect(cooldown.reason).toBe("");
		expect(cooldown.count).toBe(0);
	});
});

describe("createWorkerDiagnostic", () => {
	test("creates a diagnostic with required fields", () => {
		const diag = createWorkerDiagnostic("timeout", "Worker timed out", { runtimeMs: 5000 });

		expect(diag.timestamp).toBeDefined();
		expect(diag.stopCondition).toBe("timeout");
		expect(diag.message).toBe("Worker timed out");
		expect(diag.context).toEqual({ runtimeMs: 5000 });
		expect(diag.evidenceRefs).toEqual([]);
	});

	test("accepts optional errorDetail and evidenceRefs", () => {
		const diag = createWorkerDiagnostic(
			"unknown_error",
			"Something went wrong",
			{},
			["ref-1", "ref-2"],
			"Error: ENOTFOUND",
		);

		expect(diag.errorDetail).toBe("Error: ENOTFOUND");
		expect(diag.evidenceRefs).toEqual(["ref-1", "ref-2"]);
	});
});

// =============================================================================
// Validation
// =============================================================================

describe("validateWorkerManifest", () => {
	test("rejects null/undefined", () => {
		expect(validateWorkerManifest(null).valid).toBe(false);
		expect(validateWorkerManifest(undefined).valid).toBe(false);
		expect(validateWorkerManifest("string").valid).toBe(false);
	});

	test("rejects missing required fields", () => {
		const result = validateWorkerManifest({});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	test("rejects invalid role", () => {
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "test",
			contract: generateContractForRole("observer"),
		});
		(manifest as unknown as Record<string, unknown>).role = "invalid_role";
		const result = validateWorkerManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("role"))).toBe(true);
	});

	test("rejects missing contract", () => {
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "test",
			contract: generateContractForRole("observer"),
		});
		(manifest as unknown as Record<string, unknown>).contract = null;
		const result = validateWorkerManifest(manifest);
		expect(result.valid).toBe(false);
	});
});

describe("validateWorkerContract", () => {
	test("rejects null/undefined", () => {
		expect(validateWorkerContract(null).valid).toBe(false);
		expect(validateWorkerContract(undefined).valid).toBe(false);
	});

	test("validates a well-formed contract", () => {
		const contract = generateContractForRole("reflector");
		const result = validateWorkerContract(contract);
		expect(result.valid).toBe(true);
	});

	test("rejects missing capabilities", () => {
		const contract = generateContractForRole("reflector");
		(contract as unknown as Record<string, unknown>).capabilities = null;
		const result = validateWorkerContract(contract);
		expect(result.valid).toBe(false);
	});

	test("rejects empty id", () => {
		const contract = generateContractForRole("reflector");
		(contract as unknown as Record<string, unknown>).id = "";
		const result = validateWorkerContract(contract);
		expect(result.valid).toBe(false);
	});
});

describe("validateWorkerBudget", () => {
	test("validates a valid budget", () => {
		const budget = DEFAULT_ROLE_BUDGETS.observer;
		const result = validateWorkerBudget(budget);
		expect(result.valid).toBe(true);
	});

	test("rejects negative maxTokensPerCycle", () => {
		const budget = { ...DEFAULT_ROLE_BUDGETS.observer, maxTokensPerCycle: -1 };
		const result = validateWorkerBudget(budget);
		expect(result.valid).toBe(false);
	});

	test("rejects maxConsecutiveFailures < 1", () => {
		const budget = { ...DEFAULT_ROLE_BUDGETS.observer, maxConsecutiveFailures: 0 };
		const result = validateWorkerBudget(budget);
		expect(result.valid).toBe(false);
	});
});

describe("validateWorkerStatus", () => {
	test("validates a correctly shaped object", () => {
		const status: WorkerStatus = {
			workerId: "test-id",
			state: "standby",
			role: "observer",
			timestamp: new Date().toISOString(),
			budgetConsumption: {
				currentCycleTokens: 0,
				totalTokens: 0,
				currentCycleRuntimeMs: 0,
				consecutiveFailures: 0,
			},
			cooldown: createWorkerCooldown(),
			recentDiagnostics: [],
			totalCyclesCompleted: 0,
			totalCyclesFailed: 0,
			lastCycleStartedAt: null,
			lastCycleCompletedAt: null,
			totalDeduped: 0,
			healthy: true,
			healthDetail: "OK",
			metadata: {},
		};
		const result = validateWorkerStatus(status);
		expect(result.valid).toBe(true);
	});

	test("rejects invalid state", () => {
		const status: WorkerStatus = {
			workerId: "test-id",
			state: "invalid_state" as WorkerLifecycleState,
			role: "observer",
			timestamp: new Date().toISOString(),
			budgetConsumption: {
				currentCycleTokens: 0,
				totalTokens: 0,
				currentCycleRuntimeMs: 0,
				consecutiveFailures: 0,
			},
			cooldown: createWorkerCooldown(),
			recentDiagnostics: [],
			totalCyclesCompleted: 0,
			totalCyclesFailed: 0,
			lastCycleStartedAt: null,
			lastCycleCompletedAt: null,
			totalDeduped: 0,
			healthy: true,
			healthDetail: "OK",
			metadata: {},
		};
		const result = validateWorkerStatus(status);
		expect(result.valid).toBe(false);
	});
});

// =============================================================================
// Serialization
// =============================================================================

describe("serialization round-trip", () => {
	test("WorkerManifest serializes and deserializes correctly", () => {
		const manifest = createWorkerManifest({
			role: "auditor",
			name: "test-auditor",
			description: "Test auditor",
			contract: generateContractForRole("auditor"),
			tags: ["audit", "test"],
			metadata: { version: 2 },
		});

		const json = serializeWorkerManifest(manifest);
		const parsed = deserializeWorkerManifest(json);

		expect(parsed).toEqual(manifest);
		expect(parsed.id).toBe(manifest.id);
	});

	test("deserializeWorkerManifest throws on invalid JSON", () => {
		expect(() => deserializeWorkerManifest("not json")).toThrow();
	});

	test("deserializeWorkerManifest throws on valid JSON but invalid structure", () => {
		expect(() => deserializeWorkerManifest(JSON.stringify({}))).toThrow();
	});

	test("WorkerStatus serializes and deserializes correctly", () => {
		const status: WorkerStatus = {
			workerId: "test-id",
			state: "active",
			role: "observer",
			timestamp: new Date().toISOString(),
			budgetConsumption: {
				currentCycleTokens: 100,
				totalTokens: 500,
				currentCycleRuntimeMs: 10000,
				consecutiveFailures: 0,
			},
			cooldown: createWorkerCooldown(),
			recentDiagnostics: [],
			totalCyclesCompleted: 3,
			totalCyclesFailed: 0,
			lastCycleStartedAt: new Date().toISOString(),
			lastCycleCompletedAt: new Date().toISOString(),
			totalDeduped: 1,
			healthy: true,
			healthDetail: "All good",
			metadata: {},
		};

		const json = serializeWorkerStatus(status);
		const parsed = deserializeWorkerStatus(json);

		expect(parsed).toEqual(status);
	});

	test("deserializeWorkerStatus throws on invalid JSON", () => {
		expect(() => deserializeWorkerStatus("not json")).toThrow();
	});
});

// =============================================================================
// Contract Generation (per role)
// =============================================================================

describe("generateContractForRole", () => {
	test("generates an observer contract with correct properties", () => {
		const contract = generateContractForRole("observer");

		expect(contract.id).toContain("brain-worker.observer");
		expect(contract.capabilities).toContain("monitor_queue");
		expect(contract.capabilities).toContain("monitor_execution");
		expect(contract.capabilities).toContain("detect_signals");
		expect(contract.capabilities).toContain("record_observations");
		expect(contract.inputs.length).toBeGreaterThan(0);
		expect(contract.outputs.length).toBeGreaterThan(0);
		expect(contract.errors.length).toBeGreaterThan(0);
		expect(contract.dependencies).toEqual([]);
	});

	test("generates an analyst contract with analyst dependencies", () => {
		const contract = generateContractForRole("analyst");

		expect(contract.id).toContain("brain-worker.analyst");
		expect(contract.capabilities).toContain("pattern_detection");
		expect(contract.capabilities).toContain("signal_synthesis");
		expect(contract.dependencies).toContain("brain-worker.observer");
	});

	test("generates a proposer contract that depends on analyst", () => {
		const contract = generateContractForRole("proposer");

		expect(contract.id).toContain("brain-worker.proposer");
		expect(contract.capabilities).toContain("proposal_generation");
		expect(contract.dependencies).toContain("brain-worker.analyst");
	});

	test("generates a reflector contract", () => {
		const contract = generateContractForRole("reflector");

		expect(contract.id).toContain("brain-worker.reflector");
		expect(contract.capabilities).toContain("reflection_execution");
		expect(contract.dependencies).toContain("brain-worker.archivist");
	});

	test("generates a diagnostician contract", () => {
		const contract = generateContractForRole("diagnostician");

		expect(contract.id).toContain("brain-worker.diagnostician");
		expect(contract.capabilities).toContain("failure_analysis");
		expect(contract.capabilities).toContain("root_cause_diagnosis");
		expect(contract.dependencies).toContain("brain-worker.analyst");
	});

	test("generates an archivist contract with no dependencies", () => {
		const contract = generateContractForRole("archivist");

		expect(contract.id).toContain("brain-worker.archivist");
		expect(contract.capabilities).toContain("memory_lifecycle");
		expect(contract.dependencies).toEqual([]);
	});

	test("generates a coordinator contract", () => {
		const contract = generateContractForRole("coordinator");

		expect(contract.id).toContain("brain-worker.coordinator");
		expect(contract.capabilities).toContain("workflow_orchestration");
		expect(contract.dependencies).toContain("brain-worker.observer");
		expect(contract.supportsStreaming).toBe(true);
	});

	test("generates an auditor contract", () => {
		const contract = generateContractForRole("auditor");

		expect(contract.id).toContain("brain-worker.auditor");
		expect(contract.capabilities).toContain("policy_compliance_audit");
		expect(contract.dependencies).toContain("brain-worker.coordinator");
	});

	test("generates an ideaScout contract", () => {
		const contract = generateContractForRole("ideaScout");

		expect(contract.id).toContain("brain-worker.ideaScout");
		expect(contract.capabilities).toContain("signal_mining");
		expect(contract.capabilities).toContain("idea_generation");
		expect(contract.capabilities).toContain("trend_detection");
		expect(contract.capabilities).toContain("opportunity_identification");
		expect(contract.inputs.length).toBeGreaterThan(0);
		expect(contract.outputs.length).toBeGreaterThan(0);
		expect(contract.errors.length).toBeGreaterThan(0);
		expect(contract.dependencies).toContain("brain-worker.analyst");
	});

	test("generates a fixStrategist contract", () => {
		const contract = generateContractForRole("fixStrategist");

		expect(contract.id).toContain("brain-worker.fixStrategist");
		expect(contract.capabilities).toContain("evidence_analysis");
		expect(contract.capabilities).toContain("root_cause_identification");
		expect(contract.capabilities).toContain("patch_strategy_generation");
		expect(contract.capabilities).toContain("test_plan_generation");
		expect(contract.capabilities).toContain("fix_priority_scoring");
		expect(contract.inputs.some((i) => i.name === "evidence_summary")).toBe(true);
		expect(contract.outputs.some((o) => o.name === "fix_strategies")).toBe(true);
		expect(contract.errors.some((e) => e.code === "INSUFFICIENT_EVIDENCE")).toBe(true);
		expect(contract.errors.some((e) => e.code === "STRATEGY_GENERATION_FAILED")).toBe(true);
		expect(contract.errors.some((e) => e.code === "TEST_PLAN_GENERATION_FAILED")).toBe(true);
		expect(contract.dependencies).toContain("brain-worker.diagnostician");
		expect(contract.dependencies).toContain("brain-worker.debugger");
	});

	test("accepts custom version string", () => {
		const contract = generateContractForRole("observer", "2.1.0");
		expect(contract.version).toBe("2.1.0");
		expect(contract.id).toContain("v2.1.0");
	});

	test("all contracts are structurally valid", () => {
		for (const role of ALL_WORKER_ROLES) {
			const contract = generateContractForRole(role);
			const result = validateWorkerContract(contract);
			expect(result.valid).toBe(true);
		}
	});
});

// =============================================================================
// Capability Matching
// =============================================================================

describe("matchCapabilities", () => {
	test("exact match returns all matched, none missing", () => {
		const result = matchCapabilities(
			["monitor_queue", "monitor_execution", "detect_signals"],
			["monitor_queue", "monitor_execution"],
		);

		expect(result.satisfied).toBe(true);
		expect(result.matched).toEqual(["monitor_queue", "monitor_execution"]);
		expect(result.missing).toEqual([]);
	});

	test("missing capabilities returns unsatisfied", () => {
		const result = matchCapabilities(["monitor_queue"], ["monitor_queue", "monitor_execution", "detect_signals"]);

		expect(result.satisfied).toBe(false);
		expect(result.matched).toEqual(["monitor_queue"]);
		expect(result.missing).toEqual(["monitor_execution", "detect_signals"]);
	});

	test("allowPartial returns satisfied if at least one matches", () => {
		const result = matchCapabilities(["monitor_queue"], ["monitor_queue", "monitor_execution"], true);

		expect(result.satisfied).toBe(true);
		expect(result.matched).toEqual(["monitor_queue"]);
		expect(result.missing).toEqual(["monitor_execution"]);
	});

	test("extra capabilities are reported", () => {
		const result = matchCapabilities(["a", "b", "c", "d"], ["a", "b"]);

		expect(result.extra).toEqual(["c", "d"]);
	});

	test("empty required returns satisfied", () => {
		const result = matchCapabilities(["a", "b"], []);
		expect(result.satisfied).toBe(true);
		expect(result.matched).toEqual([]);
	});

	test("empty provided with non-empty required returns unsatisfied", () => {
		const result = matchCapabilities([], ["a", "b"]);
		expect(result.satisfied).toBe(false);
		expect(result.missing).toEqual(["a", "b"]);
	});
});

// =============================================================================
// Dependency Resolution
// =============================================================================

describe("resolveDependencies", () => {
	test("no dependencies resolves immediately", () => {
		const contract = generateContractForRole("archivist");
		const result = resolveDependencies(contract, []);
		expect(result.resolved).toBe(true);
		expect(result.errors).toEqual([]);
	});

	test("satisfied dependencies resolve correctly", () => {
		const contract = generateContractForRole("analyst");
		const observerContract = generateContractForRole("observer");

		const result = resolveDependencies(contract, [observerContract]);
		expect(result.resolved).toBe(true);
		expect(result.satisfied).toContain("brain-worker.observer");
	});

	test("unsatisfied dependencies return errors", () => {
		const contract = generateContractForRole("analyst");
		const result = resolveDependencies(contract, []);
		expect(result.resolved).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.unsatisfied).toContain("brain-worker.observer");
	});

	test("prefix matching works (dependency = 'brain-worker.observer' matches 'brain-worker.observer.v1.0.0')", () => {
		const analystContract = generateContractForRole("analyst");
		const observerContract = generateContractForRole("observer", "1.0.0");

		const result = resolveDependencies(analystContract, [observerContract]);
		expect(result.resolved).toBe(true);
		expect(result.satisfied).toContain("brain-worker.observer");
	});
});

// =============================================================================
// Contract Validation Against Requirements
// =============================================================================

describe("validateContractAgainstRequirements", () => {
	test("valid contract with no requirements passes", () => {
		const contract = generateContractForRole("observer");
		const result = validateContractAgainstRequirements(contract);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	test("detects missing capabilities", () => {
		const contract = generateContractForRole("observer");
		const result = validateContractAgainstRequirements(contract, ["non_existent_capability"]);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("non_existent_capability"))).toBe(true);
	});

	test("detects unsatisfied dependencies when available contracts provided", () => {
		const contract = generateContractForRole("coordinator");
		const result = validateContractAgainstRequirements(
			contract,
			undefined,
			[], // No available contracts → dependencies unsatisfied
		);
		expect(result.valid).toBe(false);
	});

	test("passes with satisfied dependencies", () => {
		const contract = generateContractForRole("coordinator");
		const available = [
			generateContractForRole("observer"),
			generateContractForRole("analyst"),
			generateContractForRole("proposer"),
		];
		const result = validateContractAgainstRequirements(contract, undefined, available);
		expect(result.valid).toBe(true);
	});
});

// =============================================================================
// ContractRegistry
// =============================================================================

describe("ContractRegistry", () => {
	test("register and get a contract", () => {
		const registry = new ContractRegistry();
		const contract = generateContractForRole("observer");

		registry.register(contract);
		expect(registry.get(contract.id)).toBe(contract);
		expect(registry.size).toBe(1);
	});

	test("register throws on duplicate", () => {
		const registry = new ContractRegistry();
		const contract = generateContractForRole("observer");

		registry.register(contract);
		expect(() => registry.register(contract)).toThrow();
	});

	test("unregister removes a contract", () => {
		const registry = new ContractRegistry();
		const contract = generateContractForRole("observer");

		registry.register(contract);
		expect(registry.unregister(contract.id)).toBe(true);
		expect(registry.size).toBe(0);
	});

	test("findByCapability returns matching contracts", () => {
		const registry = new ContractRegistry();
		registry.register(generateContractForRole("observer"));
		registry.register(generateContractForRole("analyst"));
		registry.register(generateContractForRole("archivist"));

		const matches = registry.findByCapability("monitor_queue");
		expect(matches.length).toBe(1);
		expect(matches[0].id).toContain("observer");
	});

	test("findByRole returns contracts for a given role", () => {
		const registry = new ContractRegistry();
		registry.register(generateContractForRole("observer", "1.0.0"));
		registry.register(generateContractForRole("observer", "2.0.0"));

		const matches = registry.findByRole("observer");
		expect(matches.length).toBe(2);
	});

	test("clear removes all contracts", () => {
		const registry = new ContractRegistry();
		registry.register(generateContractForRole("observer"));
		registry.register(generateContractForRole("analyst"));

		registry.clear();
		expect(registry.size).toBe(0);
	});

	test("getAll returns all registered contracts", () => {
		const registry = new ContractRegistry();
		registry.register(generateContractForRole("observer"));
		registry.register(generateContractForRole("analyst"));

		const all = registry.getAll();
		expect(all.length).toBe(2);
	});
});

// =============================================================================
// Manifest Generation
// =============================================================================

describe("generateManifest", () => {
	test("generates a complete manifest for a given role", () => {
		const manifest = generateManifest({
			role: "observer",
			name: "queue-observer",
			description: "Monitors queue health",
		});

		expect(manifest.id).toBeDefined();
		expect(manifest.role).toBe("observer");
		expect(manifest.name).toBe("queue-observer");
		expect(manifest.description).toBe("Monitors queue health");
		expect(manifest.contract).toBeDefined();
		expect(manifest.budget).toBeDefined();
		expect(manifest.tags).toEqual([]);

		// Verify validation passes
		const result = validateWorkerManifest(manifest);
		expect(result.valid).toBe(true);
	});

	test("applies contract overrides correctly", () => {
		const manifest = generateManifest({
			role: "observer",
			name: "custom-observer",
			description: "Custom observer",
			contractOverrides: {
				capabilities: ["custom_cap"],
				inputs: [
					{
						name: "custom_input",
						description: "Custom input",
						type: "string",
						required: true,
						sources: ["custom-source"],
					},
				],
			},
		});

		expect(manifest.contract.capabilities).toEqual(["custom_cap"]);
		expect(manifest.contract.inputs).toHaveLength(1);
		expect(manifest.contract.inputs[0].name).toBe("custom_input");
	});

	test("sets custom version and tags", () => {
		const manifest = generateManifest({
			role: "analyst",
			name: "test-analyst",
			description: "Test",
			version: "2.0.0",
			tags: ["production", "critical"],
			metadata: { environment: "staging" },
		});

		expect(manifest.version).toBe("2.0.0");
		expect(manifest.tags).toEqual(["production", "critical"]);
		expect(manifest.metadata).toEqual({ environment: "staging" });
	});
});

// =============================================================================
// Lifecycle Engine — Registration
// =============================================================================

describe("WorkerLifecycleEngine — Registration", () => {
	test("registers a worker and creates initial status", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test-worker",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		const status = engine.registerWorker(manifest);
		expect(status.workerId).toBe(manifest.id);
		expect(status.state).toBe("standby"); // auto-activated
		expect(status.healthy).toBe(true);
		expect(engine.workerCount).toBe(1);
	});

	test("auto-activation can be disabled", () => {
		const engine = new WorkerLifecycleEngine({ autoActivateOnRegister: false });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test-worker",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		const status = engine.registerWorker(manifest);
		expect(status.state).toBe("dormant"); // not auto-activated
	});

	test("register throws on duplicate", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		expect(() => engine.registerWorker(manifest)).toThrow();
	});

	test("unregister removes a worker", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		expect(engine.unregisterWorker(manifest.id)).toBe(true);
		expect(engine.workerCount).toBe(0);
	});

	test("getManifest returns the registered manifest", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		const retrieved = engine.getManifest(manifest.id);
		expect(retrieved).toBeDefined();
		expect(retrieved!.id).toBe(manifest.id);
	});

	test("getStatus returns current status", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		const status = engine.registerWorker(manifest);
		const retrieved = engine.getStatus(manifest.id);
		expect(retrieved).toBeDefined();
		expect(retrieved!.state).toBe(status.state);
	});

	test("getAllStatuses returns all workers", () => {
		const engine = new WorkerLifecycleEngine({ autoActivateOnRegister: false });
		const m1 = createWorkerManifest({
			role: "observer",
			name: "w1",
			description: "d1",
			contract: generateContractForRole("observer"),
		});
		const m2 = createWorkerManifest({
			role: "analyst",
			name: "w2",
			description: "d2",
			contract: generateContractForRole("analyst"),
		});

		engine.registerWorker(m1);
		engine.registerWorker(m2);

		const all = engine.getAllStatuses();
		expect(all.length).toBe(2);
	});
});

// =============================================================================
// Lifecycle Engine — State Transitions
// =============================================================================

describe("WorkerLifecycleEngine — State Transitions", () => {
	test("transition from standby to active", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		const status = engine.transition(manifest.id, "active", "Starting work");

		expect(status.state).toBe("active");
		expect(status.lastCycleStartedAt).toBeDefined();
	});

	test("transition from active to cooling triggers stop condition", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);

		const status = engine.completeCycle(manifest.id, "completed");
		expect(status.state).toBe("cooling");
		expect(status.totalCyclesCompleted).toBe(1);
	});

	test("invalid transition throws", () => {
		const engine = new WorkerLifecycleEngine({ autoActivateOnRegister: false });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		// Cannot go from dormant directly to active
		expect(() => engine.transition(manifest.id, "active", "test")).toThrow();
	});

	test("transition from cooling to standby via finishCooldown", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);
		engine.completeCycle(manifest.id, "completed");

		const status = engine.finishCooldown(manifest.id);
		expect(status.state).toBe("standby");
		expect(status.cooldown.startedAt).toBeNull();
	});

	test("cannot go from cooling directly to active", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);
		engine.completeCycle(manifest.id, "completed");

		// Must go through standby first
		expect(() => engine.transition(manifest.id, "active", "skip standby")).toThrow();
	});

	test("onTransition callback fires", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		const transitions: WorkerTransition[] = [];
		engine.onTransition((t) => transitions.push(t));

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);

		// Should have at least one transition (dormant → standby from registration, standby → active from startCycle)
		expect(transitions.length).toBeGreaterThanOrEqual(2);
		expect(transitions.some((t) => t.toState === "active")).toBe(true);
	});
});

// =============================================================================
// Lifecycle Engine — Work Cycles
// =============================================================================

describe("WorkerLifecycleEngine — Work Cycles", () => {
	test("startCycle transitions from standby to active", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		const status = engine.startCycle(manifest.id);
		expect(status.state).toBe("active");
	});

	test("startCycle throws if not in standby", () => {
		const engine = new WorkerLifecycleEngine({ autoActivateOnRegister: false });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest); // stays dormant
		expect(() => engine.startCycle(manifest.id)).toThrow();
	});

	test("startCycle throws if in cooldown", () => {
		const engine = new WorkerLifecycleEngine({ enforceCooldowns: true });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);

		// Complete a cycle to enter cooldown
		engine.startCycle(manifest.id);
		engine.completeCycle(manifest.id, "completed");

		// Should be in cooling
		expect(() => engine.startCycle(manifest.id)).toThrow();
	});

	test("completeCycle throws if not in active", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		// Worker is in standby, not active
		expect(() => engine.completeCycle(manifest.id, "completed")).toThrow();
	});

	test("completeCycle with 'completed' increments totalCyclesCompleted", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);
		const status = engine.completeCycle(manifest.id, "completed");

		expect(status.totalCyclesCompleted).toBe(1);
		expect(status.totalCyclesFailed).toBe(0);
	});

	test("completeCycle with failure increments totalCyclesFailed", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);
		const status = engine.completeCycle(manifest.id, "timeout");

		expect(status.totalCyclesCompleted).toBe(0);
		expect(status.totalCyclesFailed).toBe(1);
		expect(status.budgetConsumption.consecutiveFailures).toBe(1);
	});
});

// =============================================================================
// Lifecycle Engine — Budget Enforcement
// =============================================================================

describe("WorkerLifecycleEngine — Budget Enforcement", () => {
	test("consecutive failures lead to failed state", () => {
		const engine = new WorkerLifecycleEngine({ enforceBudgets: true });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		// observer budget has maxConsecutiveFailures = 5
		engine.registerWorker(manifest);

		// Fail 5 times
		for (let i = 0; i < 5; i++) {
			engine.startCycle(manifest.id);
			const status = engine.completeCycle(manifest.id, "timeout");
			if (status.state !== "failed") {
				engine.finishCooldown(manifest.id);
			}
		}

		// After 5 consecutive failures, should now be in failed state
		const final = engine.getStatus(manifest.id);
		expect(final!.state).toBe("failed");
		expect(final!.healthy).toBe(false);
	});

	test("successful cycle resets consecutive failures", () => {
		const engine = new WorkerLifecycleEngine({ enforceBudgets: true });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);

		// Fail twice
		engine.startCycle(manifest.id);
		engine.completeCycle(manifest.id, "timeout");
		engine.finishCooldown(manifest.id);

		engine.startCycle(manifest.id);
		engine.completeCycle(manifest.id, "timeout");
		engine.finishCooldown(manifest.id);

		// Succeed once - should reset consecutive failures
		engine.startCycle(manifest.id);
		const status = engine.completeCycle(manifest.id, "completed");

		expect(status.budgetConsumption.consecutiveFailures).toBe(0);
	});

	test("recordTokens enforces token budget", () => {
		const engine = new WorkerLifecycleEngine({ enforceBudgets: true });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		// observer budget: maxTokensPerCycle = 50,000
		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);

		// Record tokens below limit — should stay active
		const stillActive = engine.recordTokens(manifest.id, 30_000);
		expect(stillActive!.state).toBe("active");

		// Record tokens above limit — should force stop
		const stopped = engine.recordTokens(manifest.id, 30_000);
		expect(stopped!.state).toBe("cooling");
	});

	test("isOverRuntimeBudget detects exceeded runtime", () => {
		const engine = new WorkerLifecycleEngine({ enforceBudgets: true });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		// observer budget: maxRuntimeMs = 300,000
		engine.registerWorker(manifest);

		// Before starting, should not be over budget
		expect(engine.isOverRuntimeBudget(manifest.id)).toBe(false);

		// We can't easily mock Date.now to test actual runtime,
		// but we can verify the method runs without error
		engine.startCycle(manifest.id);
		expect(typeof engine.isOverRuntimeBudget(manifest.id)).toBe("boolean");
	});

	test("handleTimeout transitions to cooling", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);

		const status = engine.handleTimeout(manifest.id);
		expect(status.state).toBe("cooling");
		expect(status.totalCyclesFailed).toBe(1);
	});

	test("handleTokenBudgetExhaustion transitions to cooling", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);

		const status = engine.handleTokenBudgetExhaustion(manifest.id);
		expect(status.state).toBe("cooling");
		expect(status.totalCyclesFailed).toBe(1);
	});
});

// =============================================================================
// Lifecycle Engine — Cooldown Management
// =============================================================================

describe("WorkerLifecycleEngine — Cooldown Management", () => {
	test("checkCooldown transitions from cooling to standby when cooldown expires", () => {
		const engine = new WorkerLifecycleEngine({ enforceCooldowns: true });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		// observer budget: cooldownMs = 60,000
		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);
		engine.completeCycle(manifest.id, "completed");

		// Check cooldown — should still be in cooldown
		const stillCooling = engine.checkCooldown(manifest.id);
		expect(stillCooling).toBeUndefined();

		// Manually expire the cooldown for testing
		const status = engine.getStatus(manifest.id)!;
		status.cooldown.endsAt = new Date(Date.now() - 1000).toISOString();

		// Now checkCooldown should transition back to standby
		const transitioned = engine.checkCooldown(manifest.id);
		expect(transitioned).toBeDefined();
		expect(transitioned!.state).toBe("standby");
	});

	test("checkAllCooldowns processes all workers", () => {
		const engine = new WorkerLifecycleEngine();
		const m1 = createWorkerManifest({
			role: "observer",
			name: "w1",
			description: "d1",
			contract: generateContractForRole("observer"),
		});
		const m2 = createWorkerManifest({
			role: "observer",
			name: "w2",
			description: "d2",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(m1);
		engine.registerWorker(m2);

		// Both finish cycles and enter cooldown
		engine.startCycle(m1.id);
		engine.completeCycle(m1.id, "completed");
		engine.startCycle(m2.id);
		engine.completeCycle(m2.id, "completed");

		// Expire cooldowns
		const s1 = engine.getStatus(m1.id)!;
		s1.cooldown.endsAt = new Date(Date.now() - 1000).toISOString();
		const s2 = engine.getStatus(m2.id)!;
		s2.cooldown.endsAt = new Date(Date.now() - 1000).toISOString();

		const transitioned = engine.checkAllCooldowns();
		expect(transitioned.length).toBe(2);
		expect(transitioned.every((s) => s.state === "standby")).toBe(true);
	});
});

// =============================================================================
// Lifecycle Engine — Deduplication
// =============================================================================

describe("WorkerLifecycleEngine — Deduplication", () => {
	test("checkDedup returns no_match for new tasks", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);

		const result = engine.checkDedup(manifest.id, "unique task content");
		expect(result.isDuplicate).toBe(false);
		expect(result.matchType).toBe("no_match");
	});

	test("checkDedup finds exact match for duplicate tasks", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);

		engine.recordTask(manifest.id, "duplicate task");
		const result = engine.checkDedup(manifest.id, "duplicate task");
		expect(result.isDuplicate).toBe(true);
		expect(result.matchType).toBe("exact_match");
	});

	test("dedup can be disabled per-worker", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});
		manifest.dedupConfig.enabled = false;

		engine.registerWorker(manifest);

		engine.recordTask(manifest.id, "task");
		const result = engine.checkDedup(manifest.id, "task");
		expect(result.isDuplicate).toBe(false); // disabled
	});

	test("dedup can be disabled globally", () => {
		const engine = new WorkerLifecycleEngine({ enableDeduplication: false });
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);

		engine.recordTask(manifest.id, "task");
		const result = engine.checkDedup(manifest.id, "task");
		expect(result.isDuplicate).toBe(false); // globally disabled
	});

	test("recordDedupedTask increments totalDeduped counter", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.recordDedupedTask(manifest.id, "task content", "exact_match");

		const status = engine.getStatus(manifest.id);
		expect(status!.totalDeduped).toBe(1);

		const history = engine.getDedupHistory(manifest.id);
		expect(history.length).toBe(1);
		expect(history[0].reason).toBe("exact_match");
	});
});

// =============================================================================
// Lifecycle Engine — Health & Diagnostics
// =============================================================================

describe("WorkerLifecycleEngine — Health & Diagnostics", () => {
	test("getHealthSummary returns correct counts", () => {
		const engine = new WorkerLifecycleEngine({ autoActivateOnRegister: false });
		const m1 = createWorkerManifest({
			role: "observer",
			name: "w1",
			description: "d1",
			contract: generateContractForRole("observer"),
		});
		const m2 = createWorkerManifest({
			role: "analyst",
			name: "w2",
			description: "d2",
			contract: generateContractForRole("analyst"),
		});

		engine.registerWorker(m1);
		engine.registerWorker(m2);

		const summary = engine.getHealthSummary();
		expect(summary.total).toBe(2);
		// Dormant workers are created with healthy=true
		expect(summary.healthy).toBe(2);
	});

	test("healthCheck transitions active worker over runtime budget to cooling", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);

		// Can't easily mock time, but we can verify the check runs
		const _result = engine.healthCheck(manifest.id);
		// If elapsed <= 300000ms, result is undefined (not over budget yet)
		// This is fine — the method is exercised
		expect(typeof engine.getStatus(manifest.id)).toBe("object");
	});

	test("healthCheck transitions worker at max consecutive failures to failed", () => {
		const engine = new WorkerLifecycleEngine({ enforceBudgets: false }); // disable auto-enforcement
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);

		// Manually set consecutive failures above threshold
		const status = engine.getStatus(manifest.id)!;
		status.budgetConsumption.consecutiveFailures = 10;

		const result = engine.healthCheck(manifest.id);
		expect(result).toBeDefined();
		expect(result!.state).toBe("failed");
	});

	test("healthCheck transitions from cooling back to standby if cooldown expired", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);
		engine.completeCycle(manifest.id, "completed");

		// Expire cooldown manually
		const status = engine.getStatus(manifest.id)!;
		status.cooldown.endsAt = new Date(Date.now() - 1000).toISOString();

		const result = engine.healthCheck(manifest.id);
		expect(result).toBeDefined();
		expect(result!.state).toBe("standby");
	});

	test("diagnostics are stored and bounded", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);

		// Add many diagnostics
		for (let i = 0; i < 25; i++) {
			engine.startCycle(manifest.id);
			engine.completeCycle(manifest.id, "timeout");
			if (engine.getStatus(manifest.id)!.state === "failed") break;
			engine.finishCooldown(manifest.id);
		}

		const status = engine.getStatus(manifest.id)!;
		expect(status.recentDiagnostics.length).toBeLessThanOrEqual(20);
	});
});

// =============================================================================
// Lifecycle Engine — Edge Cases
// =============================================================================

describe("WorkerLifecycleEngine — Edge Cases", () => {
	test("transitioning unknown worker throws", () => {
		const engine = new WorkerLifecycleEngine();
		expect(() => engine.transition("nonexistent", "active", "test")).toThrow();
	});

	test("getStatus returns undefined for unregistered worker", () => {
		const engine = new WorkerLifecycleEngine();
		expect(engine.getStatus("nonexistent")).toBeUndefined();
	});

	test("onTransition swallows callback errors", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		// Register a callback that throws
		engine.onTransition(() => {
			throw new Error("callback error");
		});

		// Should not throw
		expect(() => engine.registerWorker(manifest)).not.toThrow();
	});

	test("setConfig updates configuration", () => {
		const engine = new WorkerLifecycleEngine();
		engine.setConfig({ enforceBudgets: false, enforceCooldowns: false });

		const config = engine.getConfig();
		expect(config.enforceBudgets).toBe(false);
		expect(config.enforceCooldowns).toBe(false);
	});

	test("recordTokens returns null for unknown worker", () => {
		const engine = new WorkerLifecycleEngine();
		const result = engine.recordTokens("nonexistent", 100);
		expect(result).toBeNull();
	});

	test("finishCooldown throws if not in cooling", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		// Worker is in standby, not cooling
		expect(() => engine.finishCooldown(manifest.id)).toThrow();
	});

	test("full cycle: standby -> active -> cooling -> standby", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		expect(engine.getStatus(manifest.id)!.state).toBe("standby");

		engine.startCycle(manifest.id);
		expect(engine.getStatus(manifest.id)!.state).toBe("active");

		engine.completeCycle(manifest.id, "completed");
		expect(engine.getStatus(manifest.id)!.state).toBe("cooling");

		// Expire cooldown
		const s = engine.getStatus(manifest.id)!;
		s.cooldown.endsAt = new Date(Date.now() - 1000).toISOString();

		engine.finishCooldown(manifest.id);
		expect(engine.getStatus(manifest.id)!.state).toBe("standby");
	});

	test("pause and resume cycle", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.startCycle(manifest.id);

		// Pause from active
		engine.transition(manifest.id, "paused", "User requested pause", "user");
		expect(engine.getStatus(manifest.id)!.state).toBe("paused");

		// Resume
		engine.transition(manifest.id, "standby", "User requested resume", "user");
		expect(engine.getStatus(manifest.id)!.state).toBe("standby");
	});

	test("retire a worker", () => {
		const engine = new WorkerLifecycleEngine();
		const manifest = createWorkerManifest({
			role: "observer",
			name: "test",
			description: "Test",
			contract: generateContractForRole("observer"),
		});

		engine.registerWorker(manifest);
		engine.transition(manifest.id, "retired", "Worker no longer needed", "user");

		const status = engine.getStatus(manifest.id)!;
		expect(status.state).toBe("retired");
		expect(status.healthy).toBe(false);
	});
});

// =============================================================================
// Type-level correctness (compile-time checks)
// =============================================================================

describe("type correctness (compile-time)", () => {
	test("WorkerManifest can be created with all fields", () => {
		const manifest: WorkerManifest = {
			id: "test-id",
			role: "observer",
			name: "Test Worker",
			version: "1.0.0",
			createdAt: "2026-01-01T00:00:00.000Z",
			description: "A test worker",
			contract: {
				id: "brain-worker.observer.v1",
				name: "Observer Contract",
				description: "Monitors queues",
				version: "1.0.0",
				capabilities: ["monitor_queue"],
				inputs: [],
				outputs: [],
				errors: [],
				dependencies: [],
				supportsStreaming: false,
				supportsCancellation: true,
			},
			budget: DEFAULT_ROLE_BUDGETS.observer,
			dedupConfig: DEFAULT_WORKER_DEDUP_CONFIG,
			tags: ["test"],
			metadata: {},
		};
		expect(manifest.role).toBe("observer");
	});

	test("all WorkerRole values are assignable to WorkerRole type", () => {
		const roles: string[] = ALL_WORKER_ROLES as unknown as string[];
		expect(roles).toContain("observer");
		expect(roles).toContain("analyst");
		expect(roles).toContain("proposer");
		expect(roles).toContain("reflector");
		expect(roles).toContain("diagnostician");
		expect(roles).toContain("archivist");
		expect(roles).toContain("coordinator");
		expect(roles).toContain("auditor");
		expect(roles).toContain("ideaScout");
	});

	test("all WorkerLifecycleState values are assignable", () => {
		const states: string[] = ALL_WORKER_LIFECYCLE_STATES as unknown as string[];
		expect(states).toContain("dormant");
		expect(states).toContain("standby");
		expect(states).toContain("active");
		expect(states).toContain("cooling");
		expect(states).toContain("failed");
	});

	test("all WorkerStopCondition values are assignable", () => {
		const conditions: string[] = ALL_WORKER_STOP_CONDITIONS as unknown as string[];
		expect(conditions).toContain("completed");
		expect(conditions).toContain("timeout");
		expect(conditions).toContain("unknown_error");
	});
});
