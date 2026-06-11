/**
 * ACCP Evidence Validator Tests
 */
import { describe, expect, it } from "vitest";
import type { AccpEvidenceEntry } from "../src/validation/evidence-validator.js";
import { validateEvidence, validateEvidenceEntry } from "../src/validation/evidence-validator.js";

describe("ACCP Evidence Validator", () => {
	it("should validate a valid evidence entry with hash", () => {
		const entry: AccpEvidenceEntry = {
			type: "unit_test",
			description: "All tests pass",
			hashRequired: true,
			hash: "abc123",
		};
		const diags = validateEvidenceEntry(entry);
		expect(diags).toHaveLength(0);
	});

	it("should reject an entry with hashRequired but no hash", () => {
		const entry: AccpEvidenceEntry = {
			type: "unit_test",
			hashRequired: true,
		};
		const diags = validateEvidenceEntry(entry);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should accept an entry without hash when not required", () => {
		const entry: AccpEvidenceEntry = {
			type: "source",
			hashRequired: false,
		};
		const diags = validateEvidenceEntry(entry);
		expect(diags).toHaveLength(0);
	});

	it("should validate a batch of evidence entries", () => {
		const entries: AccpEvidenceEntry[] = [
			{ type: "source", hashRequired: false },
			{ type: "unit_test", hashRequired: true, hash: "def456" },
		];
		const diags = validateEvidence(entries);
		expect(diags).toHaveLength(0);
	});

	it("should reject empty evidence list", () => {
		const diags = validateEvidence([]);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should warn on non-zero exit code", () => {
		const entries: AccpEvidenceEntry[] = [{ type: "command", command: "npm test", exitCode: 1 }];
		const diags = validateEvidence(entries);
		expect(diags.some((d) => d.severity === "warning")).toBe(true);
	});

	it("should pass for command with exit code 0", () => {
		const entries: AccpEvidenceEntry[] = [{ type: "command", command: "npm test", exitCode: 0 }];
		const diags = validateEvidence(entries);
		expect(diags).toHaveLength(0);
	});
});
