import { describe, expect, it } from "vitest";
import { FailureCategory } from "../src/failure/failure-classifier.js";
import { createRetryRequestedEvent, getMergedRetryStrategy } from "../src/failure/retry-router.js";

describe("retry-router event-only", () => {
	it("emits retry_requested event", () => {
		const event = createRetryRequestedEvent({
			attemptId: "att-1",
			workspaceId: "ws-1",
			category: FailureCategory.Test,
			attemptNumber: 2,
		});

		expect(event.type).toBe("retry_requested");
		expect(event.payload.attemptId).toBe("att-1");
		expect(event.payload.workspaceId).toBe("ws-1");
		expect(event.payload.strategyType).toBe(getMergedRetryStrategy(FailureCategory.Test, 2).type);
	});
});
