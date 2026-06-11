/**
 * ACCP Evidence Validator Tests
 */
import { describe, expect, it } from "vitest";
import type { AccpEvidenceEntry } from "../src/validation/evidence-validator.js";
import {
	validateEvidence,
	validateEvidenceEntry,
	validateFalsePositiveGuards,
} from "../src/validation/evidence-validator.js";

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

	// ---------------------------------------------------------------------------
	// False-positive guard tests — all must be BLOCKER (fatal=true)
	// ---------------------------------------------------------------------------

	it("should reject watchModeDetected when watchModeForbidden is true (BLOCKER)", () => {
		const diags = validateFalsePositiveGuards({
			watchModeForbidden: true,
			watchModeDetected: true,
		});
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].fatal).toBe(true);
	});

	it("should reject noTestsFound when noTestsFoundIsFailure is true (BLOCKER)", () => {
		const diags = validateFalsePositiveGuards({
			noTestsFoundIsFailure: true,
			noTestsFound: true,
		});
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].fatal).toBe(true);
	});

	it("should reject commandNotFound when commandNotFoundIsFailure is true (BLOCKER)", () => {
		const diags = validateFalsePositiveGuards({
			commandNotFoundIsFailure: true,
			commandNotFound: true,
		});
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].fatal).toBe(true);
	});

	it("should reject timeout when timeoutIsFailure is true (BLOCKER)", () => {
		const diags = validateFalsePositiveGuards({
			timeoutIsFailure: true,
			timeout: true,
		});
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].fatal).toBe(true);
	});

	it("should pass false-positive guards when no violations exist", () => {
		const diags = validateFalsePositiveGuards({
			watchModeForbidden: true,
			watchModeDetected: false,
			noTestsFoundIsFailure: true,
			noTestsFound: false,
			commandNotFoundIsFailure: true,
			commandNotFound: false,
			timeoutIsFailure: true,
			timeout: false,
		});
		expect(diags).toHaveLength(0);
	});

	// ---------------------------------------------------------------------------
	// Non-zero exit code must be BLOCKER
	// ---------------------------------------------------------------------------

	it("should reject command with non-zero exit code as BLOCKER", () => {
		const entries: AccpEvidenceEntry[] = [{ type: "command", command: "npm test", exitCode: 1 }];
		const diags = validateEvidence(entries);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should pass command with exit code 0", () => {
		const entries: AccpEvidenceEntry[] = [{ type: "command", command: "npm test", exitCode: 0 }];
		const diags = validateEvidence(entries);
		expect(diags).toHaveLength(0);
	});

	it("should pass false-positive guards via validateEvidence", () => {
		const entries: AccpEvidenceEntry[] = [{ type: "command", command: "npm test", exitCode: 0 }];
		const diags = validateEvidence(entries, {
			watchModeForbidden: true,
			watchModeDetected: false,
			noTestsFoundIsFailure: true,
			noTestsFound: false,
			commandNotFoundIsFailure: true,
			commandNotFound: false,
			timeoutIsFailure: true,
			timeout: false,
		});
		expect(diags).toHaveLength(0);
	});
});
