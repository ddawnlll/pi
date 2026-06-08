/**
 * Worker Echo Extraction Tests — ACCP 1.2 / PlanSpec v5
 *
 * Tests for worker report echo extraction from agent output.
 */

import { describe, expect, it } from "vitest";
import { extractWorkerEcho, verifyWorkerEcho } from "../src/core/completion/worker-echo-extractor.js";

// =============================================================================
// ECHO-EXTRACT Tests
// =============================================================================

describe("ECHO-EXTRACT", () => {
	// ECHO-EXTRACT-001: structured worker output with correct lock echo parses
	it("001 — structured worker output with correct lock echo parses", () => {
		const output = JSON.stringify({
			workspaceId: "WS-01",
			planLockHash: "abc123",
			workspaceLockHash: "def456",
			verdict: "complete",
			evidenceRefs: ["EV-001"],
		});

		const result = extractWorkerEcho(output);
		expect(result.success).toBe(true);
		expect(result.claim).toBeDefined();
		expect(result.claim!.workspaceId).toBe("WS-01");
		expect(result.claim!.planLockHash).toBe("abc123");
		expect(result.claim!.workspaceLockHash).toBe("def456");
		expect(result.claim!.verdict).toBe("complete");
		expect(result.claim!.evidenceRefs).toEqual(["EV-001"]);
	});

	// ECHO-EXTRACT-002: raw worker output without lock echo blocks in planspec_locked
	it("002 — raw worker output without lock echo fails extraction", () => {
		const output = "I completed the workspace successfully.";
		const result = extractWorkerEcho(output);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Could not extract lock hashes");
	});

	// ECHO-EXTRACT-003: wrong planLockHash blocks
	it("003 — wrong planLockHash detected during verification", () => {
		const claim = {
			workspaceId: "WS-01",
			planLockHash: "wrong-hash",
			workspaceLockHash: "def456",
			verdict: "complete" as const,
		};

		const verification = verifyWorkerEcho(claim, "correct-hash", "def456", "WS-01");
		expect(verification.valid).toBe(false);
		expect(verification.error).toContain("Plan lock hash mismatch");
	});

	// ECHO-EXTRACT-004: wrong workspaceLockHash blocks
	it("004 — wrong workspaceLockHash detected during verification", () => {
		const claim = {
			workspaceId: "WS-01",
			planLockHash: "abc123",
			workspaceLockHash: "wrong-hash",
			verdict: "complete" as const,
		};

		const verification = verifyWorkerEcho(claim, "abc123", "correct-hash", "WS-01");
		expect(verification.valid).toBe(false);
		expect(verification.error).toContain("Workspace lock hash mismatch");
	});

	// ECHO-EXTRACT-005: wrong workspaceId blocks
	it("005 — wrong workspaceId detected during verification", () => {
		const claim = {
			workspaceId: "WRONG-WS",
			planLockHash: "abc123",
			workspaceLockHash: "def456",
			verdict: "complete" as const,
		};

		const verification = verifyWorkerEcho(claim, "abc123", "def456", "WS-01");
		expect(verification.valid).toBe(false);
		expect(verification.error).toContain("Workspace ID mismatch");
	});

	// ECHO-EXTRACT-006: legacy_v411 does not require V5 lock echo
	it("006 — legacy mode detection (no extraction required)", () => {
		// This test verifies that legacy mode doesn't need echo extraction
		// The actual enforcement is in the execution policy, not here
		const output = "Legacy completion message";
		const result = extractWorkerEcho(output);
		// In legacy mode, we don't care if extraction fails
		expect(result.success).toBe(false);
		// But the function should not crash
		expect(result.rawText).toBe(output);
	});

	// ECHO-EXTRACT-007: manual_no_plan does not require V5 lock echo
	it("007 — manual no-plan mode detection (no extraction required)", () => {
		// Similar to legacy, manual mode doesn't require echo
		const output = "Manual work completed";
		const result = extractWorkerEcho(output);
		expect(result.success).toBe(false);
		expect(result.rawText).toBe(output);
	});

	// Additional: ACCP metadata block parsing
	it("008 — ACCP metadata block parses correctly", () => {
		const output = `
# Workspace Report

## Completion Claim
- workspaceId: WS-01
- planLockHash: abc123
- workspaceLockHash: def456
- verdict: complete

Some additional text here.
`;
		const result = extractWorkerEcho(output);
		expect(result.success).toBe(true);
		expect(result.claim!.workspaceId).toBe("WS-01");
		expect(result.claim!.planLockHash).toBe("abc123");
		expect(result.claim!.workspaceLockHash).toBe("def456");
	});

	// Additional: Explicit completion block parsing
	it("009 — explicit completion block parses correctly", () => {
		const output = `
[COMPLETION]
workspaceId=WS-01
planLockHash=abc123
workspaceLockHash=def456
verdict=complete
[/COMPLETION]
`;
		const result = extractWorkerEcho(output);
		expect(result.success).toBe(true);
		expect(result.claim!.workspaceId).toBe("WS-01");
		expect(result.claim!.planLockHash).toBe("abc123");
		expect(result.claim!.workspaceLockHash).toBe("def456");
	});

	// Additional: Empty output
	it("010 — empty output fails gracefully", () => {
		const result = extractWorkerEcho("");
		expect(result.success).toBe(false);
		expect(result.error).toContain("Empty worker output");
	});

	// Additional: Correct verification passes
	it("011 — correct echo verification passes", () => {
		const claim = {
			workspaceId: "WS-01",
			planLockHash: "abc123",
			workspaceLockHash: "def456",
			verdict: "complete" as const,
		};

		const verification = verifyWorkerEcho(claim, "abc123", "def456", "WS-01");
		expect(verification.valid).toBe(true);
		expect(verification.error).toBeUndefined();
	});
});
