import { describe, expect, it } from "vitest";
import { stable1Preflight } from "../../src/execution-runtime/preflight.js";

describe("stable1Preflight", () => {
	it("passes only when all gates are active", () => {
		expect(
			stable1Preflight({
				controllerActive: true,
				watchdogActive: true,
				postgresAuthority: true,
				admissionGate: true,
				legacyDirectWritesDisabled: true,
			}),
		).toEqual({ ok: true, reasons: [] });
	});

	it("collects all failed gates", () => {
		const result = stable1Preflight({
			controllerActive: false,
			watchdogActive: false,
			postgresAuthority: false,
			admissionGate: false,
			legacyDirectWritesDisabled: false,
		});
		expect(result.ok).toBe(false);
		expect(result.reasons).toContain("controller_inactive");
		expect(result.reasons).toContain("legacy_direct_writes_enabled");
	});
});
