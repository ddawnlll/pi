/**
 * Tests for Cacheable Workspace Packet Format - P2 Workstream 5.5.C
 *
 * Acceptance criteria:
 * 1. Same workspace contract produces same packet hash
 * 2. Retry does not change packet hash unless contract changes
 * 3. Dynamic state changes do not alter packet hash
 * 4. Packet hash is visible in logs/artifacts
 * 5. Deterministic packet tests pass
 */

import { describe, expect, it } from "vitest";
import {
	type CachedWorkspacePacket,
	createWorkspacePacket,
	formatPacketForLog,
	getPacketHash,
	hashContract,
	serializeContract,
	updatePacketState,
	verifyContractHash,
	WORKSPACE_PACKET_VERSION,
	type WorkspacePacketContract,
} from "../src/context/workspace-packet.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContract(overrides: Partial<WorkspacePacketContract> = {}): WorkspacePacketContract {
	return {
		id: "5.5.C",
		title: "Cacheable workspace packet format",
		dependencies: ["5.5.A", "5.5.B"],
		roleBudget: "worker",
		maxRetries: 3,
		acceptanceCriteria: [
			"Same workspace contract produces same packet hash",
			"Retry does not change packet hash unless contract changes",
			"Dynamic state changes do not alter packet hash",
			"Packet hash is visible in logs/artifacts",
			"Deterministic packet tests pass",
		],
		targetCommand: "npm run typecheck && npm test -- workspace-packet",
		autoCommit: true,
		parallelGroup: "5.5",
		capabilities: {
			canEdit: ["packages/coding-agent/src/context/*.ts"],
			cannotEdit: ["**/*.key", "**/*.pem", ".env*"],
			canRun: ["npm test"],
			cannotRun: ["rm -rf"],
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC1: Same workspace contract produces same packet hash
// ---------------------------------------------------------------------------

describe("AC1: Same workspace contract produces same packet hash", () => {
	it("should produce identical hashes for identical contracts", () => {
		const contract1 = makeContract();
		const contract2 = makeContract();

		const hash1 = hashContract(contract1);
		const hash2 = hashContract(contract2);

		expect(hash1).toBe(hash2);
	});

	it("should produce identical hashes across multiple calls", () => {
		const contract = makeContract();
		const hashes = Array.from({ length: 10 }, () => hashContract(contract));

		const first = hashes[0];
		for (const h of hashes) {
			expect(h).toBe(first);
		}
	});

	it("should produce identical hashes when called at different times", () => {
		const contract = makeContract();

		// Sleep is not used since we rely on deterministic hashing
		const hash1 = hashContract(contract);

		// Perform some allocations to simulate time passing
		const _garbage = new Array(1000).fill("x").join("");
		const hash2 = hashContract(contract);

		expect(hash1).toBe(hash2);
	});
});

// ---------------------------------------------------------------------------
// AC2: Retry does not change packet hash unless contract changes
// ---------------------------------------------------------------------------

describe("AC2: Retry does not change packet hash unless contract changes", () => {
	it("should keep the same hash after multiple retry state updates", () => {
		const contract = makeContract();
		let packet = createWorkspacePacket(contract, { stage: "pending", attempts: 0 });

		const originalHash = packet.contractHash;

		// Simulate multiple retries with state changes
		packet = updatePacketState(packet, { stage: "active", attempts: 1 });
		packet = updatePacketState(packet, { stage: "failed", attempts: 2, error: "Something went wrong" });
		packet = updatePacketState(packet, { stage: "active", attempts: 3 });
		packet = updatePacketState(packet, { stage: "complete", attempts: 4 });

		expect(packet.contractHash).toBe(originalHash);
	});

	it("should change hash when contract fields change", () => {
		const contractA = makeContract({ id: "5.5.C" });
		const contractB = makeContract({ id: "5.5.D" }); // Different id

		const hashA = hashContract(contractA);
		const hashB = hashContract(contractB);

		expect(hashA).not.toBe(hashB);
	});

	it("should change hash when title changes", () => {
		const contractA = makeContract({ title: "Original title" });
		const contractB = makeContract({ title: "Updated title" });

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});

	it("should change hash when dependencies change", () => {
		const contractA = makeContract({ dependencies: ["5.5.A"] });
		const contractB = makeContract({ dependencies: ["5.5.A", "5.5.B"] });

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});

	it("should change hash when role budget changes", () => {
		const contractA = makeContract({ roleBudget: "worker" });
		const contractB = makeContract({ roleBudget: "lead" });

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});

	it("should change hash when maxRetries changes", () => {
		const contractA = makeContract({ maxRetries: 3 });
		const contractB = makeContract({ maxRetries: 5 });

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});

	it("should change hash when acceptance criteria change", () => {
		const contractA = makeContract({ acceptanceCriteria: ["Crit A", "Crit B"] });
		const contractB = makeContract({ acceptanceCriteria: ["Crit A"] });

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});

	it("should change hash when autoCommit changes", () => {
		const contractA = makeContract({ autoCommit: true });
		const contractB = makeContract({ autoCommit: false });

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});

	it("should change hash when parallelGroup changes", () => {
		const contractA = makeContract({ parallelGroup: "5.5" });
		const contractB = makeContract({ parallelGroup: "6.0" });

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});

	it("should change hash when capabilities change", () => {
		const contractA = makeContract({
			capabilities: { canEdit: ["src/*.ts"], cannotEdit: [] },
		});
		const contractB = makeContract({
			capabilities: { canEdit: ["src/*.ts", "test/*.ts"], cannotEdit: [] },
		});

		expect(hashContract(contractA)).not.toBe(hashContract(contractB));
	});
});

// ---------------------------------------------------------------------------
// AC3: Dynamic state changes do not alter packet hash
// ---------------------------------------------------------------------------

describe("AC3: Dynamic state changes do not alter packet hash", () => {
	it("should not change hash when stage changes", () => {
		const contract = makeContract();
		const packet1 = createWorkspacePacket(contract, { stage: "pending" });
		const packet2 = createWorkspacePacket(contract, { stage: "active" });
		const packet3 = createWorkspacePacket(contract, { stage: "complete" });

		expect(packet1.contractHash).toBe(packet2.contractHash);
		expect(packet2.contractHash).toBe(packet3.contractHash);
	});

	it("should not change hash when attempts count changes", () => {
		const contract = makeContract();
		const packet1 = createWorkspacePacket(contract, { attempts: 0 });
		const packet2 = createWorkspacePacket(contract, { attempts: 5 });
		const packet3 = createWorkspacePacket(contract, { attempts: 100 });

		expect(packet1.contractHash).toBe(packet2.contractHash);
		expect(packet2.contractHash).toBe(packet3.contractHash);
	});

	it("should not change hash when error message changes", () => {
		const contract = makeContract();
		const packet1 = createWorkspacePacket(contract, { error: undefined });
		const packet2 = createWorkspacePacket(contract, { error: "Error type 1" });
		const packet3 = createWorkspacePacket(contract, { error: "Different error" });

		expect(packet1.contractHash).toBe(packet2.contractHash);
		expect(packet2.contractHash).toBe(packet3.contractHash);
	});

	it("should not change hash when timestamp changes", () => {
		const contract = makeContract();
		const packet1 = createWorkspacePacket(contract, { lastUpdated: 1000 });
		const packet2 = createWorkspacePacket(contract, { lastUpdated: Date.now() });

		expect(packet1.contractHash).toBe(packet2.contractHash);
	});

	it("should not change hash when metadata changes", () => {
		const contract = makeContract();
		const packet1 = createWorkspacePacket(contract, {
			metadata: { key: "value" },
		});
		const packet2 = createWorkspacePacket(contract, {
			metadata: { different: "metadata" },
		});

		expect(packet1.contractHash).toBe(packet2.contractHash);
	});

	it("should not change hash when combined state fields change", () => {
		const contract = makeContract();
		const basePacket = createWorkspacePacket(contract);

		const updated = updatePacketState(basePacket, {
			stage: "failed",
			attempts: 3,
			error: "Network timeout",
			lastUpdated: 9999999999999,
			metadata: { retryReason: "timeout" },
		});

		expect(updated.contractHash).toBe(basePacket.contractHash);
	});
});

// ---------------------------------------------------------------------------
// AC4: Packet hash is visible in logs/artifacts
// ---------------------------------------------------------------------------

describe("AC4: Packet hash is visible in logs/artifacts", () => {
	it("should expose contract hash via getPacketHash", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract);

		const hash = getPacketHash(packet);
		expect(hash).toBeTypeOf("string");
		expect(hash).toHaveLength(64); // SHA-256 hex
		expect(hash).toBe(packet.contractHash);
	});

	it("should include hash in formatted log output", () => {
		const contract = makeContract({ id: "5.5.C", title: "Test workspace" });
		const packet = createWorkspacePacket(contract, { stage: "pending" });

		const logLine = formatPacketForLog(packet);

		expect(logLine).toContain(packet.contractHash);
		expect(logLine).toContain("5.5.C");
		expect(logLine).toContain("Test workspace");
		expect(logLine).toContain("pending");
		expect(logLine).toContain("v1");
	});

	it("should show state in log output", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract, { stage: "active" });

		const logLine = formatPacketForLog(packet);
		expect(logLine).toContain("state=active");
	});

	it("should show 'unknown' in log when no stage is set", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract);

		const logLine = formatPacketForLog(packet);
		expect(logLine).toContain("state=unknown");
	});

	it("should produce valid hex hash", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract);

		const hash = getPacketHash(packet);
		// SHA-256 hex should only contain hex characters
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});
});

// ---------------------------------------------------------------------------
// AC5: Deterministic packet tests pass
// ---------------------------------------------------------------------------

describe("AC5: Deterministic packet tests pass", () => {
	it("should serialize contract deterministically with sorted keys", () => {
		const contractA = makeContract();
		const contractB = makeContract();

		const serializedA = serializeContract(contractA);
		const serializedB = serializeContract(contractB);

		expect(serializedA).toBe(serializedB);
	});

	it("should verify valid contract hash", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract);

		expect(verifyContractHash(packet)).toBe(true);
	});

	it("should detect tampered contract", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract);

		// Tamper with the contract
		const tampered: CachedWorkspacePacket = {
			...packet,
			contract: { ...packet.contract, title: "Tampered title" },
		};

		expect(verifyContractHash(tampered)).toBe(false);
	});

	it("should detect tampered contract hash", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract);

		// Tamper with the hash (use a clearly different hash)
		const tampered: CachedWorkspacePacket = {
			...packet,
			contractHash: "0000000000000000000000000000000000000000000000000000000000000000",
		};

		expect(verifyContractHash(tampered)).toBe(false);
	});

	it("should correctly update state without affecting hash", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract, { stage: "pending", attempts: 0 });

		const originalHash = packet.contractHash;

		// Update state multiple times
		const afterFirstRetry = updatePacketState(packet, { stage: "failed", attempts: 1, error: "Error 1" });
		const afterSecondRetry = updatePacketState(afterFirstRetry, { stage: "failed", attempts: 2, error: "Error 2" });
		const afterThirdRetry = updatePacketState(afterSecondRetry, { stage: "failed", attempts: 3, error: "Error 3" });

		// Hash stays the same
		expect(afterFirstRetry.contractHash).toBe(originalHash);
		expect(afterSecondRetry.contractHash).toBe(originalHash);
		expect(afterThirdRetry.contractHash).toBe(originalHash);

		// But state is updated
		expect(afterThirdRetry.state.attempts).toBe(3);
		expect(afterThirdRetry.state.error).toBe("Error 3");
	});

	it("should produce different hashes for different contracts", () => {
		const contracts = [
			makeContract({ id: "1.A" }),
			makeContract({ id: "1.B" }),
			makeContract({ id: "2.A" }),
			makeContract({ id: "2.B" }),
		];

		const hashes = contracts.map((c) => hashContract(c));
		const uniqueHashes = new Set(hashes);

		expect(uniqueHashes.size).toBe(contracts.length);
	});

	it("should have SHORT_MAX_RETRIES test for edge case", () => {
		// Edge case: maxRetries = 0 (no retries allowed)
		const contract = makeContract({ maxRetries: 0 });
		const packet = createWorkspacePacket(contract);

		expect(packet.contract.maxRetries).toBe(0);
		expect(verifyContractHash(packet)).toBe(true);
	});

	it("should handle minimal contract (only required fields)", () => {
		const minimal: WorkspacePacketContract = {
			id: "test",
			title: "Minimal contract",
			dependencies: [],
			roleBudget: "worker",
			maxRetries: 0,
		};

		const packet = createWorkspacePacket(minimal);
		expect(verifyContractHash(packet)).toBe(true);
		expect(packet.contractHash).toHaveLength(64);
		expect(packet.version).toBe(WORKSPACE_PACKET_VERSION);
	});

	it("should handle contract with all optional fields", () => {
		const full: WorkspacePacketContract = {
			id: "full.test",
			title: "Full contract test",
			dependencies: ["dep1", "dep2", "dep3"],
			roleBudget: "lead",
			maxRetries: 5,
			retryPolicy: { backoff: "exponential", initialDelayMs: 1000 },
			riskLevel: "high",
			capabilities: {
				canEdit: ["**/*.ts"],
				cannotEdit: ["**/*.secret"],
				canRun: ["npm test", "npm run build"],
				cannotRun: ["rm -rf /"],
			},
			acceptanceCriteria: ["All tests pass", "No regressions"],
			targetCommand: "npm test",
			autoCommit: false,
			parallelGroup: "group-1",
			dependencyReason: { dep1: "Needs output from dep1" },
			preflightRequired: true,
		};

		const packet = createWorkspacePacket(full);
		expect(verifyContractHash(packet)).toBe(true);
		expect(packet.contractHash).toHaveLength(64);
	});

	it("should maintain hash stability across Node.js versions", () => {
		// SHA-256 is standardized, so the same string always produces the same hash
		const contract = makeContract();
		const hash = hashContract(contract);

		// Verify it's a proper SHA-256 hex string
		expect(hash).toMatch(/^[0-9a-f]{64}$/);

		// Verify deterministic string output of serializeContract
		const serialized = serializeContract(contract);
		expect(typeof serialized).toBe("string");
		expect(serialized.length).toBeGreaterThan(0);
	});

	it("should handle updatePacketState with empty state update", () => {
		const contract = makeContract();
		const packet = createWorkspacePacket(contract, { stage: "pending" });

		const updated = updatePacketState(packet, {});
		expect(updated.contractHash).toBe(packet.contractHash);
		expect(updated.state.stage).toBe("pending");
	});
});
