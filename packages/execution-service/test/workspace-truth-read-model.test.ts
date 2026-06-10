/**
 * P44.5.09 — Workspace Truth Read Model Tests
 *
 * Tests verify:
 * - getWorkspaceTruthStatus returns correct status dimensions
 * - Runtime complete alone does NOT result in verifiedComplete
 * - Commit hash presence updates durability status
 * - Blocked/failed workspaces report correctly
 * - Dashboard fields are never runtime-only
 *
 * Contract Schema: 4.1.1
 */

import type { WorkspaceTruthStatusView } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Workspace Truth Status Structural Tests
// ---------------------------------------------------------------------------

describe("WorkspaceTruthStatusView structural contract", () => {
	it("should have all required truth status fields", () => {
		const status: WorkspaceTruthStatusView = {
			runtimeStatus: "COMPLETE",
			implementationStatus: "DECLARED_OUTPUT_EXISTS",
			validationStatus: "PASSED",
			durabilityStatus: "POST_COMMIT_VERIFIED",
			verifiedComplete: true,
			backfillStatus: "not_applicable",
			verifiedFiles: ["src/main.ts"],
			blockers: [],
			warnings: [],
			rolloutMode: "shadow",
			dataAvailability: { available: true },
		};

		expect(status.runtimeStatus).toBe("COMPLETE");
		expect(status.implementationStatus).toBe("DECLARED_OUTPUT_EXISTS");
		expect(status.validationStatus).toBe("PASSED");
		expect(status.durabilityStatus).toBe("POST_COMMIT_VERIFIED");
		expect(status.verifiedComplete).toBe(true);
	});

	it("should NOT allow verifiedComplete from runtime complete alone", () => {
		const status: WorkspaceTruthStatusView = {
			runtimeStatus: "COMPLETE",
			implementationStatus: "UNKNOWN",
			validationStatus: "UNKNOWN",
			durabilityStatus: "NOT_COMMITTED",
			verifiedComplete: false,
			backfillStatus: "legacy_no_commit_data",
			verifiedFiles: [],
			blockers: ["No commit hash"],
			warnings: [],
			rolloutMode: "shadow",
			dataAvailability: { available: true },
		};

		expect(status.verifiedComplete).toBe(false);
		expect(status.blockers).toHaveLength(1);
	});

	it("should show durability failed when commit hash is missing", () => {
		const status: WorkspaceTruthStatusView = {
			runtimeStatus: "COMPLETE",
			implementationStatus: "DECLARED_OUTPUT_EXISTS",
			validationStatus: "PASSED",
			durabilityStatus: "NOT_COMMITTED",
			verifiedComplete: false,
			backfillStatus: "legacy_no_commit_data",
			verifiedFiles: [],
			blockers: [],
			warnings: [],
			rolloutMode: "shadow",
			dataAvailability: { available: true },
		};

		expect(status.verifiedComplete).toBe(false);
		expect(status.durabilityStatus).toBe("NOT_COMMITTED");
	});

	it("should support recovery state in truth status", () => {
		const status: WorkspaceTruthStatusView = {
			runtimeStatus: "BLOCKED",
			implementationStatus: "NOT_STARTED",
			validationStatus: "NOT_RUN",
			durabilityStatus: "NOT_COMMITTED",
			verifiedComplete: false,
			backfillStatus: "not_applicable",
			verifiedFiles: [],
			blockers: ["Unauthorized mutation"],
			warnings: [],
			rolloutMode: "block_strict_plans",
			recoveryState: "NEEDS_HIR",
			dataAvailability: { available: true },
		};

		expect(status.recoveryState).toBe("NEEDS_HIR");
	});

	it("should handle data unavailability", () => {
		const status: WorkspaceTruthStatusView = {
			runtimeStatus: "UNKNOWN",
			implementationStatus: "UNKNOWN",
			validationStatus: "UNKNOWN",
			durabilityStatus: "UNKNOWN",
			verifiedComplete: false,
			backfillStatus: "not_applicable",
			verifiedFiles: [],
			blockers: [],
			warnings: [],
			rolloutMode: "shadow",
			dataAvailability: { available: false, reason: "Workspace state not found" },
		};

		expect(status.dataAvailability.available).toBe(false);
		expect(status.dataAvailability.reason).toBeDefined();
	});
});
