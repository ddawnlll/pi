/**
 * ACCP Mode Picker Tests (P49.22)
 *
 * Tests for the interactive ACCP mode picker component.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import {
	ACCP_MODE_OPTIONS,
	ACCP_REPORT_TYPES,
	AccpModePicker,
	type AccpModePickerResult,
	renderAccpModePicker,
	selectAccpMode,
} from "../src/components/accp-mode-picker.js";

describe("AccpModePicker", () => {
	describe("ACCP_MODE_OPTIONS", () => {
		it("should have three mode options", () => {
			assert.equal(ACCP_MODE_OPTIONS.length, 3);
		});

		it("should include off, warn, and required", () => {
			const values = ACCP_MODE_OPTIONS.map((o) => o.value);
			assert.deepStrictEqual(values, ["off", "warn", "required"]);
		});

		it("should have labels and descriptions for each mode", () => {
			for (const opt of ACCP_MODE_OPTIONS) {
				assert.ok(opt.label.length > 0);
				assert.ok(opt.description.length > 0);
			}
		});
	});

	describe("ACCP_REPORT_TYPES", () => {
		it("should have 24 report types", () => {
			assert.equal(ACCP_REPORT_TYPES.length, 24);
		});

		it("should have unique report type values", () => {
			const values = ACCP_REPORT_TYPES.map((r) => r.value);
			const unique = new Set(values);
			assert.equal(unique.size, values.length);
		});

		it("should have valid categories", () => {
			const validCategories = ["core", "bugfix", "feature", "writing", "coordination"];
			for (const rt of ACCP_REPORT_TYPES) {
				assert.ok(validCategories.includes(rt.category), `Invalid category: ${rt.category}`);
			}
		});

		it("should contain all core report types", () => {
			const coreTypes = ACCP_REPORT_TYPES.filter((r) => r.category === "core").map((r) => r.value);
			assert.deepStrictEqual(coreTypes, ["RIR", "PIR", "IPR", "TVR", "HIR", "RAR", "PRR", "CAR"]);
		});

		it("each report type should have a description", () => {
			for (const rt of ACCP_REPORT_TYPES) {
				assert.ok(rt.description.length > 0, `Missing description for ${rt.value}`);
			}
		});

		it("each report type should have a valid support level", () => {
			const validLevels = ["known", "template_available", "schema_lite", "schema_strict", "gate_blocking"];
			for (const rt of ACCP_REPORT_TYPES) {
				assert.ok(
					validLevels.includes(rt.supportLevel),
					`Invalid support level for ${rt.value}: ${rt.supportLevel}`,
				);
			}
		});
	});

	describe("selectAccpMode (legacy)", () => {
		it("should return the correct mode for index 1", () => {
			const result = selectAccpMode(1);
			assert.ok(result);
			assert.equal(result!.selectedMode, "off");
			assert.equal(result!.initialAction, "Off");
		});

		it("should return the correct mode for index 2", () => {
			const result = selectAccpMode(2);
			assert.ok(result);
			assert.equal(result!.selectedMode, "warn");
			assert.equal(result!.initialAction, "Warn");
		});

		it("should return the correct mode for index 3", () => {
			const result = selectAccpMode(3);
			assert.ok(result);
			assert.equal(result!.selectedMode, "required");
			assert.equal(result!.initialAction, "Required");
		});

		it("should return null for out-of-range indices", () => {
			assert.equal(selectAccpMode(0), null);
			assert.equal(selectAccpMode(4), null);
			assert.equal(selectAccpMode(-1), null);
		});
	});

	describe("renderAccpModePicker (legacy)", () => {
		it("should return a non-empty string", () => {
			const output = renderAccpModePicker();
			assert.ok(output.length > 0);
		});

		it("should contain mode labels", () => {
			const output = renderAccpModePicker();
			assert.ok(output.includes("Off"));
			assert.ok(output.includes("Warn"));
			assert.ok(output.includes("Required"));
		});

		it("should contain selection instructions", () => {
			const output = renderAccpModePicker();
			assert.ok(output.includes("Enter 1-3 to select"));
			assert.ok(output.includes("Esc to cancel"));
		});
	});

	describe("AccpModePicker component", () => {
		it("should construct with default mode 'off'", () => {
			const picker = new AccpModePicker("off");
			const rendered = picker.render(80);
			// Should render without errors
			assert.ok(rendered.length > 0);
		});

		it("should construct with 'warn' mode", () => {
			const picker = new AccpModePicker("warn");
			const rendered = picker.render(80);
			assert.ok(rendered.length > 0);
		});

		it("should construct with 'required' mode", () => {
			const picker = new AccpModePicker("required");
			const rendered = picker.render(80);
			assert.ok(rendered.length > 0);
		});

		it("should render mode options and report types", () => {
			const picker = new AccpModePicker("off");
			const rendered = picker.render(100);
			const output = rendered.join("\n");

			// Should show mode options
			assert.ok(output.includes("Off"));
			assert.ok(output.includes("Warn"));
			assert.ok(output.includes("Required"));

			// Should show report types
			assert.ok(output.includes("RIR"));
			assert.ok(output.includes("TVR"));

			// Should show implications
			assert.ok(output.includes("Mode Implications"));
			assert.ok(output.includes("Mutation policy"));
			assert.ok(output.includes("Route signals"));
			assert.ok(output.includes("Gate behavior"));
		});

		it("should show navigation hints", () => {
			const picker = new AccpModePicker("off");
			const rendered = picker.render(80);
			const output = rendered.join("\n");

			assert.ok(output.includes("Enter=Select"));
			assert.ok(output.includes("Esc=Cancel"));
			assert.ok(output.includes("1-3=Quick Mode"));
		});

		it("should render without errors at reasonable widths", () => {
			const picker = new AccpModePicker("off");
			// Test at 80 cols (typical terminal) and wider
			const lines80 = picker.render(80);
			assert.ok(lines80.length > 0);

			const lines120 = picker.render(120);
			assert.ok(lines120.length > 0);

			// Test narrow width doesn't crash
			const lines40 = picker.render(40);
			assert.ok(lines40.length > 0);
		});

		it("should call onCancel when escape is pressed", () => {
			const picker = new AccpModePicker("off");
			let cancelled = false;
			picker.onCancel = () => {
				cancelled = true;
			};

			// Simulate escape press
			picker.handleInput("\x1b");

			assert.ok(cancelled, "onCancel should have been called");
		});

		it("should call onSelect with mode when enter is pressed", () => {
			const picker = new AccpModePicker("off");
			let result: AccpModePickerResult | null = null;
			picker.onSelect = (r) => {
				result = r;
			};

			// Simulate enter press (default mode is 'off' at index 0)
			picker.handleInput("\r");

			assert.ok(result, "onSelect should have been called");
			assert.equal((result as AccpModePickerResult).selectedMode, "off");
		});

		it("should navigate report types with up/down", () => {
			const picker = new AccpModePicker("off");

			// Move selection down
			picker.handleInput("\x1b[B"); // down arrow
			picker.handleInput("\x1b[B"); // down arrow

			// Render should still work
			const rendered = picker.render(80);
			assert.ok(rendered.length > 0);

			// Move selection up
			picker.handleInput("\x1b[A"); // up arrow

			const rendered2 = picker.render(80);
			assert.ok(rendered2.length > 0);
		});

		it("should select mode via number keys", () => {
			const picker = new AccpModePicker("off");
			let result: AccpModePickerResult | null = null;
			picker.onSelect = (r) => {
				result = r;
			};

			// Press '2' for warn mode
			picker.handleInput("2");

			assert.ok(result, "onSelect should have been called");
			assert.equal((result as AccpModePickerResult).selectedMode, "warn");
		});

		it("should call onSelect with initial report type when enter is pressed after navigation", () => {
			const picker = new AccpModePicker("off");
			let result: AccpModePickerResult | null = null;
			picker.onSelect = (r) => {
				result = r;
			};

			// Navigate down 3 times to select a different report type
			picker.handleInput("\x1b[B");
			picker.handleInput("\x1b[B");
			picker.handleInput("\x1b[B");

			// Press enter
			picker.handleInput("\r");

			assert.ok(result, "onSelect should have been called");
			assert.ok((result as AccpModePickerResult).initialReportType, "Should have an initial report type");
		});

		it("should not crash on pageUp/pageDown input", () => {
			const picker = new AccpModePicker("off");
			assert.doesNotThrow(() => {
				picker.handleInput("\x1b[5~"); // pageUp
				picker.handleInput("\x1b[6~"); // pageDown
			});
		});

		it("should handle unrecognized input gracefully", () => {
			const picker = new AccpModePicker("off");
			assert.doesNotThrow(() => {
				picker.handleInput("x");
				picker.handleInput("!");
			});
		});
	});

	describe("Authority boundary", () => {
		it("ACCP mode picker result should not contain executable commands", () => {
			const picker = new AccpModePicker("off");
			let result: AccpModePickerResult | null = null;
			picker.onSelect = (r) => {
				result = r;
			};

			picker.handleInput("\r");

			assert.ok(result);
			// selectedMode is a string, not executable
			assert.equal(typeof (result as AccpModePickerResult).selectedMode, "string");
			// No executable fields
			assert.ok(!("execute" in (result as any)));
			assert.ok(!("command" in (result as any)));
		});

		it("mode picker should not have access to filesystem", () => {
			const picker = new AccpModePicker("off");
			// Verify the component doesn't expose filesystem operations
			assert.ok(!("readFile" in (picker as any)));
			assert.ok(!("writeFile" in (picker as any)));
		});

		it("route signal implications should be advisory text only", () => {
			const picker = new AccpModePicker("off");
			const rendered = picker.render(80);
			const output = rendered.join("\n");

			// Route implication should contain advisory language
			assert.ok(
				output.includes("advisory") || output.includes("No route signals"),
				"Route implications should indicate advisory nature",
			);
		});
	});
});
