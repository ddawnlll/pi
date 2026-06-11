import { describe, expect, it } from "vitest";
import { createEvidenceSnapshot } from "../../src/core/evidence/ledger-export.js";

describe("createEvidenceSnapshot", () => {
	it("creates a snapshot with provided data", () => {
		const snap = createEvidenceSnapshot("write", "pass", "ROUTE_TO_WRITE", ["type_check"]);
		expect(snap.mode).toBe("write");
		expect(snap.gateVerdict).toBe("pass");
		expect(snap.version).toBe("1.0.0");
	});
});
