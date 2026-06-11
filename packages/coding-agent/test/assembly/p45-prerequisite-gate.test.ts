import { describe, expect, it } from "vitest";
import { buildPrerequisiteCertificate } from "../../src/core/assembly/p45-prerequisite-certificate.js";
import {
	evaluateP45PrerequisiteGate,
	evaluateP45PrerequisiteGateFull,
	isP45FixtureAllowed,
	isP45ProductionAllowed,
	type P45PrerequisiteVerdict,
	type PrerequisiteGateInput,
	summarizePrerequisiteVerdict,
} from "../../src/core/assembly/p45-prerequisite-gate.js";

// =============================================================================
// Helpers
// =============================================================================

function greenInput(overrides?: Partial<PrerequisiteGateInput>): PrerequisiteGateInput {
	return {
		certificateDecision: "allow_p45",
		blockingReasons: [],
		p44CompletionGreen: true,
		p49AccpV2Ready: true,
		dirtyRuntimeStatus: "acceptable",
		evidenceLedgerAccessible: true,
		writeGateEnabled: true,
		...overrides,
	};
}

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("P45PrerequisiteGate — positive path", () => {
	it("all-green input produces production admission", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput());
		expect(verdict.admissionMode).toBe("production");
		expect(verdict.certificateDecision).toBe("allow_p45");
		expect(isP45ProductionAllowed(verdict)).toBe(true);
		expect(isP45FixtureAllowed(verdict)).toBe(true);
		expect(verdict.blockingReasons).toHaveLength(0);
		expect(verdict.checks.every((c) => c.passed)).toBe(true);
	});

	it("all-green input has all checks passed", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput());
		const names = verdict.checks.map((c) => c.name);
		expect(names).toContain("P44 Completion Gate");
		expect(names).toContain("P49 ACCP v2 Readiness");
		expect(names).toContain("Evidence Ledger");
		expect(names).toContain("Write Gate");
		expect(names).toContain("Dirty Runtime Status");
		expect(names).toContain("P49.5 Certificate Decision");
		for (const check of verdict.checks) {
			expect(check.passed).toBe(true);
		}
	});

	it("allow_fixture_only certificate with all sub-systems green produces fixture_only", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ certificateDecision: "allow_fixture_only" }));
		expect(verdict.admissionMode).toBe("fixture_only");
		expect(isP45ProductionAllowed(verdict)).toBe(false);
		expect(isP45FixtureAllowed(verdict)).toBe(true);
	});

	it("all-green fixture_only has no blocking reasons", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ certificateDecision: "allow_fixture_only" }));
		expect(verdict.blockingReasons).toHaveLength(0);
	});

	it("dirty runtime unknown with everything else green allows production (unknown is not blocking)", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ dirtyRuntimeStatus: "unknown" }));
		expect(verdict.admissionMode).toBe("production");
		expect(verdict.dirtyRuntimeStatus).toBe("unknown");
		expect(verdict.checks.find((c) => c.name === "Dirty Runtime Status")?.passed).toBe(true);
	});

	it("dirty runtime unknown with allow_fixture_only certificate downgrades to fixture_only", () => {
		const verdict = evaluateP45PrerequisiteGateFull(
			greenInput({ certificateDecision: "allow_fixture_only", dirtyRuntimeStatus: "unknown" }),
		);
		expect(verdict.admissionMode).toBe("fixture_only");
		expect(verdict.dirtyRuntimeStatus).toBe("unknown");
	});

	it("backward-compatible evaluateP45PrerequisiteGate still works", () => {
		const verdict = evaluateP45PrerequisiteGate("allow_p45");
		expect(verdict.admissionMode).toBe("production");
		expect(isP45ProductionAllowed(verdict)).toBe(true);
	});

	it("buildPrerequisiteCertificate ties verdict to hash", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput());
		const cert = buildPrerequisiteCertificate("abc123hash", verdict);
		expect(cert.p495CertificateHash).toBe("abc123hash");
		expect(cert.verdict.admissionMode).toBe("production");
	});

	it("summary contains admission mode and decision", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput());
		const summary = summarizePrerequisiteVerdict(verdict);
		expect(summary).toContain("production");
		expect(summary).toContain("allow_p45");
		expect(summary).not.toContain("Blockers");
		expect(summary).not.toContain("Failed checks");
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("P45PrerequisiteGate — negative path", () => {
	it("block_p45 certificate always blocks", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ certificateDecision: "block_p45" }));
		expect(verdict.admissionMode).toBe("blocked");
		expect(isP45ProductionAllowed(verdict)).toBe(false);
		expect(isP45FixtureAllowed(verdict)).toBe(false);
	});

	it("missing P44 completion gate blocks admission", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ p44CompletionGreen: false }));
		expect(verdict.admissionMode).toBe("blocked");
		expect(verdict.blockingReasons).toContain("p44_completion_gate_not_green");
		expect(verdict.p44CompletionGreen).toBe(false);
		expect(verdict.checks.find((c) => c.name === "P44 Completion Gate")?.passed).toBe(false);
	});

	it("missing P49 ACCP v2 blocks admission", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ p49AccpV2Ready: false }));
		expect(verdict.admissionMode).toBe("blocked");
		expect(verdict.blockingReasons).toContain("p49_accp_v2_not_ready");
		expect(verdict.p49AccpV2Ready).toBe(false);
	});

	it("inaccessible evidence ledger blocks admission", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ evidenceLedgerAccessible: false }));
		expect(verdict.admissionMode).toBe("blocked");
		expect(verdict.blockingReasons).toContain("evidence_ledger_not_accessible");
	});

	it("disabled write gate blocks admission", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ writeGateEnabled: false }));
		expect(verdict.admissionMode).toBe("blocked");
		expect(verdict.blockingReasons).toContain("write_gate_not_enabled");
	});

	it("blocking dirty runtime blocks admission", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ dirtyRuntimeStatus: "blocking" }));
		expect(verdict.admissionMode).toBe("blocked");
		expect(verdict.blockingReasons).toContain("dirty_runtime_blocking");
	});

	it("multiple simultaneous failures all recorded", () => {
		const verdict = evaluateP45PrerequisiteGateFull({
			certificateDecision: "allow_p45",
			blockingReasons: [],
			p44CompletionGreen: false,
			p49AccpV2Ready: false,
			dirtyRuntimeStatus: "blocking",
			evidenceLedgerAccessible: false,
			writeGateEnabled: false,
		});
		expect(verdict.admissionMode).toBe("blocked");
		expect(verdict.blockingReasons.length).toBeGreaterThanOrEqual(3);
		expect(verdict.blockingReasons).toContain("p44_completion_gate_not_green");
		expect(verdict.blockingReasons).toContain("p49_accp_v2_not_ready");
		expect(verdict.blockingReasons).toContain("dirty_runtime_blocking");
	});

	it("summary exposes blockers and failed checks", () => {
		const verdict = evaluateP45PrerequisiteGateFull(
			greenInput({ p44CompletionGreen: false, evidenceLedgerAccessible: false }),
		);
		const summary = summarizePrerequisiteVerdict(verdict);
		expect(summary).toContain("blocked");
		expect(summary).toContain("Blockers:");
		expect(summary).toContain("Failed checks:");
		expect(summary).toContain("P44 Completion Gate");
		expect(summary).toContain("Evidence Ledger");
	});

	it("unknown certificate decision defaults to blocked", () => {
		const verdict = evaluateP45PrerequisiteGate("unknown_decision" as "allow_p45");
		expect(verdict.admissionMode).toBe("blocked");
		expect(isP45ProductionAllowed(verdict)).toBe(false);
	});

	it("all checks include detail when failed", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput({ p44CompletionGreen: false, p49AccpV2Ready: false }));
		const failedChecks = verdict.checks.filter((c) => !c.passed);
		expect(failedChecks.length).toBeGreaterThanOrEqual(2);
		for (const check of failedChecks) {
			expect(check.detail).toBeTruthy();
			expect(check.detail!.length).toBeGreaterThan(10);
		}
	});

	it("passed checks have no detail (undefined)", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput());
		const passedChecks = verdict.checks.filter((c) => c.passed);
		expect(passedChecks.length).toBeGreaterThanOrEqual(5);
		for (const check of passedChecks) {
			expect(check.detail).toBeUndefined();
		}
	});

	it("schemaVersion is 2.0.0 for full gate", () => {
		const verdict = evaluateP45PrerequisiteGateFull(greenInput());
		expect(verdict.schemaVersion).toBe("2.0.0");
	});
});

// =============================================================================
// Determinism Tests
// =============================================================================

describe("P45PrerequisiteGate — determinism", () => {
	it("same input produces same admission mode", () => {
		const input = greenInput();
		const v1 = evaluateP45PrerequisiteGateFull(input);
		const v2 = evaluateP45PrerequisiteGateFull({ ...input });
		expect(v1.admissionMode).toBe(v2.admissionMode);
		expect(v1.blockingReasons).toEqual(v2.blockingReasons);
		expect(v1.checks.length).toBe(v2.checks.length);
	});

	it("generatedAt is present for both calls, rest is stable", () => {
		const input = greenInput();
		const v1 = evaluateP45PrerequisiteGateFull(input);
		const v2 = evaluateP45PrerequisiteGateFull(input);
		// generatedAt is ISO timestamp — may be identical if calls are fast enough
		expect(v1.generatedAt).toBeTruthy();
		expect(v2.generatedAt).toBeTruthy();
		expect(v1.admissionMode).toBe(v2.admissionMode);
		expect(v1.certificateDecision).toBe(v2.certificateDecision);
	});
});
