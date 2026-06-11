import { describe, expect, it } from "vitest";
import { EngineMode } from "../../src/core/mode/engine-mode.js";
import { EventRecorder } from "../../src/execution-runtime/event-recorder.js";

describe("EventRecorder", () => {
	it("records an event", () => {
		const recorder = new EventRecorder();
		recorder.record("mode_inspected", EngineMode.Write);
		expect(recorder.count).toBe(1);
	});

	it("filters by mode filter", () => {
		const recorder = new EventRecorder();
		recorder.setModeFilter([EngineMode.Write]);
		recorder.record("mode_compiled", EngineMode.Write); // recorded
		recorder.record("mode_compiled", EngineMode.Edit); // filtered
		expect(recorder.count).toBe(1);
	});

	it("always records mode-unknown events even with filter", () => {
		const recorder = new EventRecorder();
		recorder.setModeFilter([EngineMode.Write]);
		recorder.record("gate_verdict_emitted", null); // mode-unknown
		expect(recorder.count).toBe(1);
	});

	it("marks shadow events", () => {
		const recorder = new EventRecorder();
		recorder.setShadowMode(true);
		recorder.record("evidence_bound", EngineMode.SmartEdit);
		const events = recorder.getEvents();
		expect(events[0].isShadow).toBe(true);
	});

	it("separates real from shadow events", () => {
		const recorder = new EventRecorder();
		recorder.record("write_authorized", EngineMode.Write);
		recorder.setShadowMode(true);
		recorder.record("write_authorized", EngineMode.Write);
		expect(recorder.getRealEvents()).toHaveLength(1);
	});

	it("groups events by type", () => {
		const recorder = new EventRecorder();
		recorder.record("mode_inspected", EngineMode.Write);
		recorder.record("mode_compiled", EngineMode.Write);
		recorder.record("mode_inspected", EngineMode.Edit);
		expect(recorder.getEventsByType("mode_inspected")).toHaveLength(2);
	});

	it("clears events", () => {
		const recorder = new EventRecorder();
		recorder.record("mode_inspected", EngineMode.Write);
		recorder.clear();
		expect(recorder.count).toBe(0);
	});

	it("always checks shouldRecord — no silent skip (the fix)", () => {
		const recorder = new EventRecorder();
		recorder.setModeFilter([EngineMode.Write]);
		// shouldRecord is the sole gatekeeper
		expect(recorder.shouldRecord(EngineMode.Write)).toBe(true);
		expect(recorder.shouldRecord(EngineMode.Edit)).toBe(false);
		// Every record() call goes through shouldRecord — no inline conditional
		recorder.record("mode_compiled", EngineMode.Edit); // filtered by shouldRecord
		expect(recorder.count).toBe(0);
	});
});
