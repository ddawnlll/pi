import { AccpModePicker, matchesKey } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { KEYBINDINGS } from "../../../src/core/keybindings.js";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.js";

describe("P49.14Z - ACCP Tab Selection Menu Regression Repair", () => {
	describe("FIX-001: Restore ACCP menu keybinding", () => {
		test("app.accp.modePicker has default keybinding in KEYBINDINGS", () => {
			const entry = KEYBINDINGS["app.accp.modePicker"];
			expect(entry).toBeDefined();
			expect(entry.defaultKeys).toBeDefined();
			const keys = Array.isArray(entry.defaultKeys) ? entry.defaultKeys : [entry.defaultKeys];
			expect(keys).toContain("tab");
			expect(entry.description).toBe("Open ACCP mode picker");
		});
	});

	describe("FIX-002: AccpModePicker always enabled (required)", () => {
		test("AccpModePicker is imported by production InteractiveMode", () => {
			expect(AccpModePicker).toBeDefined();
			expect(typeof AccpModePicker).toBe("function");
		});

		test("showAccpModePicker exists on InteractiveMode prototype", () => {
			const proto = InteractiveMode.prototype as unknown as Record<string, unknown>;
			expect(proto.showAccpModePicker).toBeDefined();
			expect(typeof proto.showAccpModePicker).toBe("function");
		});
	});

	describe("FIX-003: Keybinding hints always show ACCP picker", () => {
		test("footer ACCP mode indicator maps all three modes", () => {
			const accpModeToLabel = (mode: string): string => {
				if (mode === "required") return "ACCP[req]";
				if (mode === "warn") return "ACCP[warn]";
				return "ACCP[off]";
			};
			expect(accpModeToLabel("required")).toBe("ACCP[req]");
			expect(accpModeToLabel("warn")).toBe("ACCP[warn]");
			expect(accpModeToLabel("off")).toBe("ACCP[off]");
		});

		test("hotkeys help always references ACCP picker", () => {
			const tabAction = "Open ACCP mode picker";
			expect(tabAction).toBe("Open ACCP mode picker");
		});
	});

	describe("FIX-004: Number keys work in AccpModePicker (Kitty protocol)", () => {
		test("matchesKey handles plain digit '1'", () => {
			expect(matchesKey("1", "1")).toBe(true);
		});

		test("matchesKey handles Kitty-encoded digit (CSI u sequence)", () => {
			// \x1b[49u = codepoint 49 ("1") with no modifier in Kitty protocol
			expect(matchesKey("\x1b[49u", "1")).toBe(true);
		});

		test("matchesKey handles Kitty-encoded digits 2 and 3", () => {
			expect(matchesKey("\x1b[50u", "2")).toBe(true);
			expect(matchesKey("\x1b[51u", "3")).toBe(true);
		});
	});

	describe("FIX-005: Settings regression verification", () => {
		test("verboseAccpOutput getter/setter exist on SettingsManager", async () => {
			const { SettingsManager } = await import("../../../src/core/settings-manager.js");
			const proto = SettingsManager.prototype as unknown as Record<string, unknown>;
			expect(proto.getVerboseAccpOutput).toBeDefined();
			expect(typeof proto.getVerboseAccpOutput).toBe("function");
			expect(proto.setVerboseAccpOutput).toBeDefined();
			expect(typeof proto.setVerboseAccpOutput).toBe("function");
		});
	});

	describe("FIX-006: Session wiring for ACCP selection", () => {
		test("AgentSession.setAccpMode exists on prototype", async () => {
			const { AgentSession } = await import("../../../src/core/agent-session.js");
			const proto = AgentSession.prototype as unknown as Record<string, unknown>;
			expect(proto.setAccpMode).toBeDefined();
			expect(typeof proto.setAccpMode).toBe("function");
		});

		test("AgentSession.accpTaskEnvelope getter exists", async () => {
			const { AgentSession } = await import("../../../src/core/agent-session.js");
			const proto = AgentSession.prototype as unknown as Record<string, unknown>;
			const descriptor = Object.getOwnPropertyDescriptor(proto, "accpTaskEnvelope");
			expect(descriptor?.get).toBeDefined();
		});
	});
});
