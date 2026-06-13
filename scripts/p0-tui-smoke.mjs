#!/usr/bin/env node
// P0.1 — Live TUI Smoke Probe for NEG-010
//
// This probe launches the real TUI editor
// (packages/tui/src/components/editor.ts) inside a real
// VirtualTerminal (packages/tui/test/virtual-terminal.ts,
// backed by @xterm/headless). It writes some text into the
// editor, sends a Tab keypress, and captures the rendered
// screen. It then checks whether the rendered screen shows
// the accp-mode-picker overlay (the claimed P49 user-visible
// behavior) and records a structured finding.
//
// The probe never invents a screen; it captures the actual
// differential render output of the live TUI component.
//
// Exit codes:
//   0  probe ran end-to-end and produced structured evidence
//   1  probe setup error (no tty context, missing module)
//   2  live tui context could not be established
//   3  unexpected exception

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = resolve(REPO_ROOT, "reports/tmp/gate-sanity/P0_1/tui");
mkdirSync(RAW_DIR, { recursive: true });

const RAW_CAPTURE = resolve(RAW_DIR, "tui-screen-capture.txt");
const RAW_TRACE = resolve(RAW_DIR, "tui-event-trace.json");
const RESULT_PATH = resolve(RAW_DIR, "smoke-result.json");

async function main() {
	const t0 = performance.now();

	// Import xterm/headless and the TUI components via tsx loader.
	await import("tsx/esm");

	const { VirtualTerminal } = await import(
		"../packages/tui/test/virtual-terminal.ts"
	);
	const editorMod = await import(
		"../packages/tui/src/components/editor.ts"
	);
	const accpPickerMod = await import(
		"../packages/tui/src/components/accp-mode-picker.ts"
	);

	const { Editor } = editorMod;
	const { renderAccpModePicker } = accpPickerMod;
	const testThemes = await import("../packages/tui/test/test-themes.ts");
	const { defaultEditorTheme } = testThemes;
	const tuiMod = await import("../packages/tui/src/tui.ts");
	const { TUI } = tuiMod;

	// 1. Establish a live TUI context.
	const liveTuiContextUsed = existsSync(
		resolve(REPO_ROOT, "packages/tui/test/virtual-terminal.ts"),
	) && typeof VirtualTerminal === "function";

	if (!liveTuiContextUsed) {
		const result = {
			probe: "P0.1-NEG-010-tui-smoke",
			live_tui_context_used: false,
			status: "failed",
			error: "VirtualTerminal could not be loaded",
		};
		writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
		process.exit(2);
	}

	const vt = new VirtualTerminal(80, 24);

	// 2. Construct a real editor and run it inside the virtual terminal.
	//    The TUI class accepts a Terminal-compatible object. We pass the
	//    VirtualTerminal and let it manage a single component (the editor).

	const tui = new TUI(vt);
	const editor = new Editor(tui, defaultEditorTheme, {});

	// Capture event trace.
	const eventTrace = [];
	const originalRequestRender = tui.requestRender.bind(tui);
	tui.requestRender = () => {
		eventTrace.push({ event: "requestRender", ts: performance.now() });
		return originalRequestRender();
	};

	// Start the TUI loop (this is a sync renderer; we drive it manually
	// to send a single keypress and capture a single screen).
	tui.addChild(editor);
	tui.start();

	// 3. Send some text into the editor.
	const inputSequence = ["h", "e", "l", "l", "o", " ", "w", "o", "r", "l", "d", "tab"];
	for (const ch of inputSequence) {
		const data = ch === "tab" ? "\t" : ch;
		eventTrace.push({ event: "sendInput", data: data === "\t" ? "\\t" : data, ts: performance.now() });
		vt.write(data);
		// Allow the TUI to process
		await new Promise((r) => setImmediate(r));
	}

	// 4. Capture the rendered screen from the virtual terminal.
	const viewport = vt.getViewport();
	const screenText = viewport.join("\n");
	writeFileSync(RAW_CAPTURE, screenText);
	writeFileSync(RAW_TRACE, JSON.stringify(eventTrace, null, 2));

	// 5. Stop the TUI.
	tui.stop();

	// 6. Check whether the rendered screen contains the accp-mode-picker
	//    options. The picker has well-defined option labels.
	const pickerLabels = ["auto", "build", "research", "plan"];
	const expectedPickerRender = renderAccpModePicker();
	const screenContainsPickerLabel = pickerLabels.some((label) =>
		screenText.toLowerCase().includes(label),
	);
	const screenContainsExpectedPicker = expectedPickerRender
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.some((line) => screenText.includes(line.trim()));

	const tuiSmoke = {
		probe: "P0.1-NEG-010-tui-smoke",
		live_tui_context_used: liveTuiContextUsed,
		entrypoint: "packages/tui/src/components/editor.ts",
		input_sequence: inputSequence,
		captured_artifacts: [
			"reports/tmp/gate-sanity/P0_1/tui/tui-screen-capture.txt",
			"reports/tmp/gate-sanity/P0_1/tui/tui-event-trace.json",
		],
		observation: {
			screen_contains_picker_label: screenContainsPickerLabel,
			screen_contains_expected_picker_render: screenContainsExpectedPicker,
			expected_picker_render: expectedPickerRender,
			screen_lines: screenText.split("\n").length,
		},
		tab_keypress_observed: eventTrace.some((e) => e.event === "sendInput" && e.data === "\\t"),
		live_tui_render_invoked: eventTrace.some((e) => e.event === "requestRender"),
		result_summary: screenContainsExpectedPicker
			? "Tab opens accp-mode-picker overlay; user-visible behavior is observable in the live TUI."
			: "Tab does NOT open accp-mode-picker overlay in the live TUI editor. The accp-mode-picker module exists but is not wired to the editor's Tab handler. User-visible behavior is unverified.",
	};

	const status = screenContainsExpectedPicker
		? "pass"
		: "blocked"; // blocked because the claimed behavior is not observable.

	tuiSmoke.status = status;
	const durationMs = Math.round(performance.now() - t0);
	tuiSmoke.duration_ms = durationMs;

	writeFileSync(RESULT_PATH, JSON.stringify(tuiSmoke, null, 2));

	const resultJson = readFileSync(RESULT_PATH, "utf-8");
	const resultSha = createHash("sha256").update(resultJson).digest("hex");

	console.log("PROBE_STATUS=" + status);
	console.log("PROBE_RESULT_PATH=" + RESULT_PATH);
	console.log("PROBE_RESULT_SHA256=" + resultSha);
	console.log("PROBE_LIVE_TUI_CONTEXT=" + liveTuiContextUsed);
	console.log("PROBE_TAB_OBSERVED=" + tuiSmoke.tab_keypress_observed);
	console.log("PROBE_SCREEN_CONTAINS_PICKER=" + screenContainsExpectedPicker);
	process.exit(0);
}

main().catch((err) => {
	const result = {
		probe: "P0.1-NEG-010-tui-smoke",
		live_tui_context_used: false,
		status: "failed",
		error: String(err && err.stack ? err.stack : err),
	};
	try {
		writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
	} catch (_) {
		// ignore
	}
	console.error("PROBE_ERROR:", err && err.message ? err.message : err);
	process.exit(3);
});
