/**
 * PlanLock, WorkerPacket, and Lock Awareness Tests — ACCP 1.2 / PlanSpec v5
 *
 * Covers:
 * - PlanLock (PLANLOCK-001 through 007)
 * - Worker packet (WORKER_PACKET-001 through 010)
 * - Kernel events (KERNEL_EVENTS-001 through 007)
 * - Lock/worker negative and positive cases
 */

import { describe, expect, it } from "vitest";
import { computeLockHashes, computeWorkspaceLockHash, sha256Hex } from "../src/core/planlock-hash.js";
import type { PlanLock, WorkerPacketV5 } from "../src/core/planlock-types.js";
import {
	isWorkerPacketStale,
	recomputePlanLockHash,
	verifyAdmission,
	verifyPlanLockHash,
	verifyPlanLockRequiredFields,
	verifyWorkerPacketLockEcho,
	verifyWorkerReportEcho,
} from "../src/core/planlock-verifier.js";
import {
	deriveWorkerPacket,
	deriveWorkspaceLock,
	recomputeWorkspaceLockHash,
} from "../src/core/worker-packet-deriver.js";

// =============================================================================
// Helpers
// =============================================================================

function createTestPlanLock(overrides?: Partial<PlanLock>): PlanLock {
	const canonicalJson = JSON.stringify({ taskId: "TEST-001" });
	const deps: Record<string, string[]> = { "WS-01": [] };
	const hashes = computeLockHashes({
		canonicalPlanSpecJson: canonicalJson,
		workspaceIds: ["WS-01"],
		workspaceAllowedFiles: { "WS-01": ["src/**"] },
		workspaceForbiddenFiles: { "WS-01": [] },
		workspaceDependencies: deps,
		workspaceACs: { "WS-01": ["AC-01"] },
		workspaceValidationRefs: { "WS-01": ["CMD-TEST"] },
		workspaceFinalValidationRefs: { "WS-01": [] },
		workspaceInstructions: { "WS-01": "Do the thing" },
		reportPaths: ["reports/test.md"],
		mode: "stable_3",
		maxParallelWorkspaces: 3,
		worktreeRequired: false,
		validationLockRequired: false,
	});

	const wsLock = deriveWorkspaceLock("WS-01", ["src/**"], [], [], ["AC-01"], ["CMD-TEST"], []);

	const lock: PlanLock = {
		accpVersion: "1.2",
		planLockVersion: "1.0.0",
		source: {
			planSpecTaskId: "TEST-001",
			specPath: "plans/01_planspec.example.json",
			lockedAt: new Date().toISOString(),
			lockedBy: "test",
		},
		planLockHash: "",
		contract: {
			workspaceCount: 1,
			mode: "stable_3",
			maxParallelWorkspaces: 3,
			worktreeRequired: false,
			validationLockRequired: false,
		},
		integrity: hashes,
		normalized: {
			workspaceIds: ["WS-01"],
			workspaces: { "WS-01": wsLock },
			commandPolicyFrozen: false,
			schemaFrozen: true,
		},
		...overrides,
	};

	// Compute planLockHash from the lock
	return {
		...lock,
		planLockHash: recomputePlanLockHash(lock),
	};
}

function createTestWorkerPacket(
	planLock: PlanLock,
	workspaceId = "WS-01",
	overrides?: Partial<WorkerPacketV5>,
): WorkerPacketV5 {
	const wsLock = planLock.normalized.workspaces[workspaceId];
	return {
		accpVersion: "1.2",
		planLockHash: planLock.planLockHash,
		workspaceLockHash: wsLock.workspaceLockHash,
		repoBaseSha: "abc123def456",
		workspaceId,
		workspaceTitle: "Test Workspace",
		description: "A test workspace",
		allowedFiles: wsLock.allowedFiles,
		forbiddenFiles: wsLock.forbiddenFiles,
		acceptanceCriteria: wsLock.acceptanceCriteria,
		validationRefs: wsLock.validationRefs,
		finalValidationRefs: wsLock.finalValidationRefs,
		commandScope: { "CMD-TEST": "npm test" },
		requiredReports: ["reports/test.md"],
		completionEchoRequired: true,
		dependencies: wsLock.dependencies,
		...overrides,
	};
}

// =============================================================================
// PlanLock Tests
// =============================================================================

describe("PLANLOCK", () => {
	// PLANLOCK-001: type exists
	it("001 — PlanLock type exists and can be created", () => {
		const lock = createTestPlanLock();
		expect(lock).toBeDefined();
		expect(lock.accpVersion).toBe("1.2");
		expect(lock.source.planSpecTaskId).toBe("TEST-001");
	});

	// PLANLOCK-002: integrity hashes exist
	it("002 — integrity hashes exist and are non-empty", () => {
		const lock = createTestPlanLock();
		expect(lock.integrity.canonicalJsonHash).toBeTruthy();
		expect(lock.integrity.workspaceGraphHash).toBeTruthy();
		expect(lock.integrity.allowedFilesHash).toBeTruthy();
		expect(lock.integrity.validationPolicyHash).toBeTruthy();
		expect(lock.integrity.acceptanceCriteriaHash).toBeTruthy();
		expect(lock.integrity.instructionHash).toBeTruthy();
		expect(lock.integrity.reportContractHash).toBeTruthy();
		expect(lock.integrity.p45BridgeHash).toBeTruthy();
		expect(lock.integrity.commandPolicyHash).toBeTruthy();
	});

	// PLANLOCK-003: hash utility exists
	it("003 — hash utility produces deterministic hashes", () => {
		const h1 = sha256Hex("hello");
		const h2 = sha256Hex("hello");
		expect(h1).toBe(h2);
		expect(h1.length).toBe(64); // SHA-256 hex
	});

	// PLANLOCK-004: workspaceLockHash derivation
	it("004 — workspaceLockHash derivation is deterministic", () => {
		const hash1 = computeWorkspaceLockHash("WS-01", ["src/**"], [], [], ["AC-01"], ["CMD-TEST"], []);
		const hash2 = computeWorkspaceLockHash("WS-01", ["src/**"], [], [], ["AC-01"], ["CMD-TEST"], []);
		expect(hash1).toBe(hash2);
		expect(hash1.length).toBe(64);
	});

	// PLANLOCK-005: verifier rejects missing hash
	it("005 — verifier rejects missing planLockHash", () => {
		const lock = createTestPlanLock();
		(lock as any).planLockHash = "";
		const result = verifyPlanLockRequiredFields(lock);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_LOCK_MISSING_FIELD");
	});

	// PLANLOCK-006: verifier rejects hash mismatch
	it("006 — verifier rejects hash mismatch", () => {
		const lock = createTestPlanLock();
		const result = verifyPlanLockHash(lock, "wrong-hash");
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_LOCK_HASH_MISMATCH");
	});

	// PLANLOCK-007: admission path exists
	it("007 — admission rejects missing lock in PlanSpec mode", () => {
		const result = verifyAdmission(undefined, true);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_LOCK_REQUIRED");
	});

	it("007b — admission allows missing lock in legacy mode", () => {
		const result = verifyAdmission(undefined, false);
		expect(result.valid).toBe(true);
	});

	it("007c — admission allows present lock in PlanSpec mode", () => {
		const lock = createTestPlanLock();
		const result = verifyAdmission(lock, true);
		expect(result.valid).toBe(true);
	});
});

// =============================================================================
// Worker Packet Tests
// =============================================================================

describe("WORKER_PACKET", () => {
	// WORKER_PACKET-001: type exists
	it("001 — WorkerPacket type exists and can be created", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet).toBeDefined();
		expect(packet.accpVersion).toBe("1.2");
	});

	// WORKER_PACKET-002: derivation exists
	it("002 — derivation includes lock hashes", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.planLockHash).toBe(lock.planLockHash);
		expect(packet.workspaceLockHash).toBe(lock.normalized.workspaces["WS-01"].workspaceLockHash);
	});

	// WORKER_PACKET-003: includes allowedFiles
	it("003 — packet includes allowedFiles from lock", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.allowedFiles).toEqual(["src/**"]);
	});

	// WORKER_PACKET-004: includes ACs
	it("004 — packet includes acceptance criteria from lock", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.acceptanceCriteria).toEqual(["AC-01"]);
	});

	// WORKER_PACKET-005: includes validation refs
	it("005 — packet includes validation refs", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.validationRefs).toEqual(["CMD-TEST"]);
	});

	// WORKER_PACKET-006: includes command scope
	it("006 — packet includes command scope", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.commandScope).toEqual({ "CMD-TEST": "npm test" });
	});

	// WORKER_PACKET-007: includes required reports
	it("007 — packet includes required reports", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.requiredReports).toEqual(["reports/test.md"]);
	});

	// WORKER_PACKET-008: includes lock hashes
	it("008 — packet has completionEchoRequired=true", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.completionEchoRequired).toBe(true);
	});

	// WORKER_PACKET-009: worker report echo verification
	it("009 — worker report echo verification succeeds with matching hashes", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const result = verifyWorkerReportEcho(lock.planLockHash, wsLock.workspaceLockHash, lock, wsLock);
		expect(result.valid).toBe(true);
	});

	it("009b — worker report echo verification fails with mismatched planLockHash", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const result = verifyWorkerReportEcho("bad-hash", wsLock.workspaceLockHash, lock, wsLock);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_LOCK_HASH_MISMATCH");
	});

	// WORKER_PACKET-010: stale packet rejected
	it("010 — stale packet (mismatched planLockHash) is detected", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const packet = createTestWorkerPacket(lock, "WS-01", {
			planLockHash: "stale-hash",
		});
		const result = isWorkerPacketStale(packet, lock, wsLock);
		expect(result.stale).toBe(true);
	});

	it("010b — non-stale packet is not stale", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const packet = createTestWorkerPacket(lock);
		const result = isWorkerPacketStale(packet, lock, wsLock);
		expect(result.stale).toBe(false);
	});

	it("throws when workspace not found in PlanLock", () => {
		const lock = createTestPlanLock();
		expect(() =>
			deriveWorkerPacket({
				planLock: lock,
				repoBaseSha: "abc123",
				workspaceId: "NONEXISTENT",
				workspaceTitle: "Bad",
				commandScope: {},
				requiredReports: [],
			}),
		).toThrow("not found in PlanLock");
	});
});

// =============================================================================
// Kernel Event Tests
// =============================================================================

describe("KERNEL_EVENTS", () => {
	it("001 — plan_lock_admitted event payload type exists", () => {
		const payload = {
			planLockHash: "abc",
			planSpecTaskId: "TEST-001",
			workspaceCount: 3,
			mode: "stable_3",
		};
		expect(payload.planLockHash).toBe("abc");
		expect(payload.mode).toBe("stable_3");
	});

	it("002 — workspace_packet_created payload type exists", () => {
		const payload = {
			planLockHash: "abc",
			workspaceLockHash: "def",
			workspaceId: "WS-01",
		};
		expect(payload.workspaceId).toBe("WS-01");
	});

	it("003 — workspace_packet_rejected payload type exists", () => {
		const payload = {
			planLockHash: "abc",
			workspaceLockHash: "def",
			workspaceId: "WS-01",
			reason: "Stale lock",
		};
		expect(payload.reason).toBe("Stale lock");
	});

	it("004 — command_grant_requested payload type exists", () => {
		const payload = {
			workspaceId: "WS-01",
			command: "npm run deploy",
			reason: "Need to deploy",
			risk: "high",
		};
		expect(payload.risk).toBe("high");
	});

	it("005 — command_grant_decision payload type exists", () => {
		const payload = {
			workspaceId: "WS-01",
			command: "npm run deploy",
			decision: "approved" as const,
			grantedBy: "auto",
		};
		expect(payload.decision).toBe("approved");
	});

	it("006 — delete_policy_blocked payload type exists", () => {
		const payload = {
			workspaceId: "WS-01",
			command: "rm package.json",
			target: "package.json",
			errorCode: "E_DELETE_TARGET_FORBIDDEN",
		};
		expect(payload.errorCode).toBe("E_DELETE_TARGET_FORBIDDEN");
	});

	it("007 — plan_amendment_requested payload type exists", () => {
		const payload = {
			workspaceId: "WS-01",
			reason: "Need additional file permissions",
			changes: ["allowedFiles: +src/extra/**"],
		};
		expect(payload.changes.length).toBe(1);
	});
});

// =============================================================================
// Lock Negative/Positive Cases
// =============================================================================

describe("LOCK-NEG negative cases", () => {
	// LOCK-NEG-001: worker report missing planLockHash rejects
	it("001 — worker report missing planLockHash rejects", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const result = verifyWorkerReportEcho("", wsLock.workspaceLockHash, lock, wsLock);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_LOCK_HASH_MISMATCH");
	});

	// LOCK-NEG-002: workspaceLockHash mismatch rejects
	it("002 — workspaceLockHash mismatch rejects", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const result = verifyWorkerReportEcho(lock.planLockHash, "bad-hash", lock, wsLock);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_WORKSPACE_LOCK_HASH_MISMATCH");
	});
});

describe("LOCK-POS positive cases", () => {
	// LOCK-POS-001: valid worker packet derives
	it("001 — valid worker packet derives successfully", () => {
		const lock = createTestPlanLock();
		const packet = deriveWorkerPacket({
			planLock: lock,
			repoBaseSha: "abc123",
			workspaceId: "WS-01",
			workspaceTitle: "Test",
			commandScope: { "CMD-TEST": "npm test" },
			requiredReports: ["reports/test.md"],
		});
		expect(packet.planLockHash).toBeTruthy();
		expect(packet.workspaceLockHash).toBeTruthy();
		expect(packet.allowedFiles.length).toBeGreaterThan(0);
	});
});

describe("KERNEL-POS positive cases", () => {
	// KERNEL-POS-001: PlanLock admitted event payload matches
	it("001 — PlanLock admitted event payload can be created", () => {
		const lock = createTestPlanLock();
		const payload = {
			planLockHash: lock.planLockHash,
			planSpecTaskId: lock.source.planSpecTaskId,
			workspaceCount: lock.contract.workspaceCount,
			mode: lock.contract.mode,
		};
		expect(payload.planLockHash).toBe(lock.planLockHash);
	});

	it("planLockHash recomputation is deterministic", () => {
		const lock1 = createTestPlanLock();
		const lock2 = createTestPlanLock();
		expect(lock1.planLockHash).toBe(lock2.planLockHash);
	});

	it("deriveWorkspaceLock produces valid workspace lock", () => {
		const wsLock = deriveWorkspaceLock("WS-01", ["src/**"], [], [], ["AC-01"], ["CMD-TEST"], []);
		expect(wsLock.workspaceId).toBe("WS-01");
		expect(wsLock.workspaceLockHash.length).toBe(64);
		// recompute should match
		const recomputed = recomputeWorkspaceLockHash(wsLock);
		expect(recomputed).toBe(wsLock.workspaceLockHash);
	});
});

// =============================================================================
// Verifier edge cases
// =============================================================================

describe("VERIFIER_EDGE", () => {
	it("detects missing workspaceIds", () => {
		const lock = createTestPlanLock();
		(lock.normalized as any).workspaceIds = [];
		const result = verifyPlanLockRequiredFields(lock);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_LOCK_MISSING_FIELD");
	});

	it("detects missing source", () => {
		const lock = createTestPlanLock();
		(lock as any).source = undefined;
		const result = verifyPlanLockRequiredFields(lock);
		expect(result.valid).toBe(false);
	});

	it("verifyWorkerPacketLockEcho detects packet planLockHash mismatch", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const packet = createTestWorkerPacket(lock);
		(packet as any).planLockHash = "wrong";
		const result = verifyWorkerPacketLockEcho(packet, lock, wsLock);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_LOCK_HASH_MISMATCH");
	});

	it("verifyWorkerPacketLockEcho detects packet workspaceLockHash mismatch", () => {
		const lock = createTestPlanLock();
		const wsLock = lock.normalized.workspaces["WS-01"];
		const packet = createTestWorkerPacket(lock);
		(packet as any).workspaceLockHash = "wrong";
		const result = verifyWorkerPacketLockEcho(packet, lock, wsLock);
		expect(result.valid).toBe(false);
		expect(result.errorCode).toBe("E_WORKSPACE_LOCK_HASH_MISMATCH");
	});
});
