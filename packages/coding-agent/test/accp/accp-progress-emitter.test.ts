import { afterEach, describe, expect, it } from "vitest";
import { getAccpProgressEmitter } from "../../src/core/accp-progress-emitter.js";

describe("ACCP progress emitter", () => {
	afterEach(() => {
		getAccpProgressEmitter().set({});
	});

	it("should fan out events to multiple subscribers", () => {
		const emitter = getAccpProgressEmitter();
		const started: string[] = [];
		const completed: string[] = [];

		const unsubscribeStarted = emitter.subscribe({
			onCompilationStarted: (reportId) => {
				started.push(reportId);
			},
		});
		const unsubscribeCompleted = emitter.subscribe({
			onCompilationStarted: (reportId) => {
				completed.push(reportId);
			},
		});

		emitter.emitCompilationStarted({
			reportId: "ACC-001",
			reportType: "RIR",
		});

		expect(started).toEqual(["ACC-001"]);
		expect(completed).toEqual(["ACC-001"]);

		unsubscribeStarted();
		unsubscribeCompleted();
	});
});
