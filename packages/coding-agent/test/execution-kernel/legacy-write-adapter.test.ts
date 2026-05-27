import { describe, expect, it } from "vitest";
import { routeLegacyStateWrite } from "../../src/execution-kernel/legacy-write-adapter.js";

describe("legacy-write-adapter", () => {
	it("routes legacy writes", () => {
		expect(routeLegacyStateWrite("observe", () => undefined)).toBe("legacy_state_write_detected");
	});
});
