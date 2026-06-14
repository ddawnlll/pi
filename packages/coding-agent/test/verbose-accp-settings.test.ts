import { describe, expect, test } from "vitest";
import type { SettingsCallbacks, SettingsConfig } from "../src/modes/interactive/components/settings-selector.js";
import { SettingsSelectorComponent } from "../src/modes/interactive/components/settings-selector.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("verbose ACCP output setting", () => {
	function makeConfig(overrides?: Partial<SettingsConfig>): SettingsConfig {
		return {
			autoCompact: false,
			showImages: false,
			imageWidthCells: 80,
			autoResizeImages: true,
			blockImages: false,
			enableSkillCommands: true,
			steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time",
			transport: "sse",
			thinkingLevel: "off",
			availableThinkingLevels: ["off"],
			currentTheme: "dark",
			availableThemes: ["dark"],
			hideThinkingBlock: false,
			collapseChangelog: false,
			enableInstallTelemetry: false,
			doubleEscapeAction: "tree",
			treeFilterMode: "default",
			showHardwareCursor: false,
			editorPaddingX: 0,
			autocompleteMaxVisible: 5,
			quietStartup: true,
			clearOnShrink: false,
			showTerminalProgress: false,
			verboseAccpOutput: false,
			tokenContextMode: "disabled",
			warnings: { anthropicExtraUsage: true },
			...overrides,
		};
	}

	function makeCallbacks(overrides?: Partial<SettingsCallbacks>): SettingsCallbacks {
		return {
			onAutoCompactChange: () => {},
			onShowImagesChange: () => {},
			onImageWidthCellsChange: () => {},
			onAutoResizeImagesChange: () => {},
			onBlockImagesChange: () => {},
			onEnableSkillCommandsChange: () => {},
			onSteeringModeChange: () => {},
			onFollowUpModeChange: () => {},
			onTransportChange: () => {},
			onThinkingLevelChange: () => {},
			onThemeChange: () => {},
			onHideThinkingBlockChange: () => {},
			onCollapseChangelogChange: () => {},
			onEnableInstallTelemetryChange: () => {},
			onDoubleEscapeActionChange: () => {},
			onTreeFilterModeChange: () => {},
			onShowHardwareCursorChange: () => {},
			onEditorPaddingXChange: () => {},
			onAutocompleteMaxVisibleChange: () => {},
			onTokenContextModeChange: () => {},
			onQuietStartupChange: () => {},
			onClearOnShrinkChange: () => {},
			onShowTerminalProgressChange: () => {},
			onVerboseAccpOutputChange: () => {},
			onWarningsChange: () => {},
			onCancel: () => {},
			...overrides,
		};
	}

	test("setting item exists in the items array", () => {
		initTheme("dark");

		const component = new SettingsSelectorComponent(makeConfig({ verboseAccpOutput: true }), makeCallbacks());
		const settingsList = component.getSettingsList();
		const items = (settingsList as any).items as Array<{ id: string; label: string; currentValue: string }>;

		const item = items.find((i) => i.id === "verbose-accp-output");
		expect(item).toBeDefined();
		expect(item!.label).toBe("Verbose ACCP output");
		expect(item!.currentValue).toBe("true");
	});

	test("setting item shows false when disabled", () => {
		initTheme("dark");

		const component = new SettingsSelectorComponent(makeConfig({ verboseAccpOutput: false }), makeCallbacks());
		const settingsList = component.getSettingsList();
		const items = (settingsList as any).items as Array<{ id: string; label: string; currentValue: string }>;

		const item = items.find((i) => i.id === "verbose-accp-output");
		expect(item).toBeDefined();
		expect(item!.currentValue).toBe("false");
	});

	test("renders the item label when scrolled into view", () => {
		initTheme("dark");

		const component = new SettingsSelectorComponent(makeConfig({ verboseAccpOutput: true }), makeCallbacks());
		const settingsList = component.getSettingsList();
		const items = (settingsList as any).items as Array<{ id: string }>;

		const verboseAccpIndex = items.findIndex((i: any) => i.id === "verbose-accp-output");
		expect(verboseAccpIndex).toBeGreaterThanOrEqual(0);

		// Scroll to the item by setting the selectedIndex
		(settingsList as any).selectedIndex = verboseAccpIndex;
		const output = settingsList.render(80).join("\n");

		expect(output).toContain("Verbose ACCP output");
	});

	test("item is ordered after token-context-mode", () => {
		initTheme("dark");

		const component = new SettingsSelectorComponent(makeConfig(), makeCallbacks());
		const settingsList = component.getSettingsList();
		const items = (settingsList as any).items as Array<{ id: string }>;

		const tokenContextIndex = items.findIndex((i: any) => i.id === "token-context-mode");
		const verboseAccpIndex = items.findIndex((i: any) => i.id === "verbose-accp-output");

		expect(tokenContextIndex).toBeGreaterThanOrEqual(0);
		expect(verboseAccpIndex).toBeGreaterThanOrEqual(0);
		expect(verboseAccpIndex).toBe(tokenContextIndex + 1);
	});

	test("updateValue updates the display value", () => {
		initTheme("dark");

		const component = new SettingsSelectorComponent(makeConfig({ verboseAccpOutput: false }), makeCallbacks());
		const settingsList = component.getSettingsList();

		// updateValue should find the item and update its currentValue
		settingsList.updateValue("verbose-accp-output", "true");

		const items = (settingsList as any).items as Array<{ id: string; currentValue: string }>;
		const item = items.find((i: any) => i.id === "verbose-accp-output");
		expect(item!.currentValue).toBe("true");
	});
});
