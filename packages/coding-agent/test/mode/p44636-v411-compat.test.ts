import { describe, expect, it } from "vitest";
import { checkV411Compatibility } from "../../src/core/compat/v411-adapter-pack.js";
import { EngineMode } from "../../src/core/mode/engine-mode.js";

describe("checkV411Compatibility", () => {
	it("confirms compatibility for all modes", () => {
		for (const mode of [EngineMode.Write, EngineMode.Edit, EngineMode.SmartWrite, EngineMode.SmartEdit]) {
			const result = checkV411Compatibility(mode);
			expect(result.compatible).toBe(true);
			expect(result.markdownNotParsed).toBe(true);
			expect(result.accpProseNotParsed).toBe(true);
		}
	});

	it("maps to correct adapter mode for write", () => {
		const result = checkV411Compatibility(EngineMode.Write);
		expect(result.adapterMode).toBe("v411_write");
	});
});
