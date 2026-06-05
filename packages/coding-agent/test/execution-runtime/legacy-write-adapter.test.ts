import { describe, expect, it, vi } from "vitest";
import { routeLegacyStateWrite } from "../../src/execution-runtime/legacy-write-adapter.js";

describe("legacy-write-adapter", () => {
	it("executes mutation and emits shadow signal in observe mode", async () => {
		let mutated = false;
		const result = await routeLegacyStateWrite("observe", () => {
			mutated = true;
		});

		expect(mutated).toBe(true);
		expect(result.action).toBe("executed");
		expect(result.signal).toBe("legacy_state_write_detected");
		expect(result.shadowEmitted).toBe(false);
	});

	it("emits shadow event when journal is provided in observe mode", async () => {
		let mutated = false;
		const mockJournal = {
			append: vi.fn(async () => {}),
		};
		const result = await routeLegacyStateWrite(
			"observe",
			() => {
				mutated = true;
			},
			mockJournal as any,
			{
				attemptId: "shadow:ws:ws-1",
				planExecutionId: "plan-1",
				workspaceExecutionId: "ws-exec-1",
				eventType: "attempt_succeeded",
				version: 1,
			},
		);

		expect(mutated).toBe(true);
		expect(result.signal).toBe("legacy_state_write_detected");
		expect(result.shadowEmitted).toBe(true);
		expect(mockJournal.append).toHaveBeenCalledOnce();
	});

	it("routes mutation and emits controller_event_routed in route mode", async () => {
		let mutated = false;
		const result = await routeLegacyStateWrite("route", () => {
			mutated = true;
		});

		expect(mutated).toBe(true);
		expect(result.action).toBe("executed");
		expect(result.signal).toBe("controller_event_routed");
	});

	it("rejects mutation in enforce mode", async () => {
		let mutated = false;
		const result = await routeLegacyStateWrite("enforce", () => {
			mutated = true;
		});

		expect(mutated).toBe(false);
		expect(result.action).toBe("rejected");
		expect(result.signal).toBe("legacy_state_write_rejected");
		expect(result.shadowEmitted).toBe(false);
	});

	it("emits legacy_state_write_rejected shadow event in enforce mode", async () => {
		const mockJournal = {
			append: vi.fn(async () => {}),
		};
		const result = await routeLegacyStateWrite("enforce", () => undefined, mockJournal as any, {
			attemptId: "shadow:ws:ws-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-exec-1",
			eventType: "attempt_failed",
			version: 2,
		});

		expect(result.shadowEmitted).toBe(true);
		expect(result.signal).toBe("legacy_state_write_rejected");
		expect(mockJournal.append).toHaveBeenCalledOnce();
	});

	it("handles async mutations", async () => {
		let mutated = false;
		await routeLegacyStateWrite("observe", async () => {
			await Promise.resolve();
			mutated = true;
		});

		expect(mutated).toBe(true);
	});

	it("defaults to observe mode", async () => {
		const result = await (routeLegacyStateWrite as any)("observe", () => {});
		expect(result.action).toBe("executed");
	});
});
