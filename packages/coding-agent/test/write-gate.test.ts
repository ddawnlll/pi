/**
 * Tests for Write Gate - Large existing file write gate with P4.5 enhancements
 *
 * Acceptance criteria:
 * 1. write tool path calls EditStrategyPolicy before full write
 * 2. full write to existing large file is blocked
 * 3. targeted patch/edit to same file is allowed
 * 4. new file write remains allowed
 * 5. pre-write snapshot created for guarded files
 * 6. blocked rewrite emits edit_strategy_blocked event
 * 7. P4.5: same-file failure threshold blocks further writes
 * 8. P4.5: truncation detection forces fallback
 * 9. P4.5: audit events are emitted
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createEditAttemptTracker } from "../src/core/edit-attempt-tracker.js";
import { createEditStrategyPolicy } from "../src/core/edit-strategy-policy.js";
import { createEventBus, type EventBusController } from "../src/core/event-bus.js";
import { createTruncationDetector } from "../src/core/truncation-detector.js";
import {
	countLines,
	createWriteGate,
	EDIT_STRATEGY_BLOCKED_CHANNEL,
	type EditStrategyBlockedEvent,
} from "../src/core/write-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock stat result. */
function mockStat(size: number) {
	return async (_path: string) => ({
		size,
		isFile: () => true,
	});
}

/** Create content with a specific number of lines. */
function makeLineContent(lines: number, bytesPerLine: number = 40): Buffer {
	const lineContent = "x".repeat(bytesPerLine - 1);
	const content = Array.from({ length: lines }, () => lineContent).join("_NL_PLACEHOLDER_");
	return Buffer.from(content.replace(/_NL_PLACEHOLDER_/g, String.fromCharCode(10)), "utf-8");
}

// ---------------------------------------------------------------------------
// countLines
// ---------------------------------------------------------------------------

describe("countLines", () => {
	it("should return 0 for empty string", () => {
		expect(countLines("")).toBe(0);
	});

	it("should return 1 for single line without newline", () => {
		expect(countLines("hello")).toBe(1);
	});

	it("should count LF lines correctly", () => {
		expect(countLines("a\nb")).toBe(2);
	});

	it("should handle three lines", () => {
		expect(countLines("a\nb\nc")).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// WriteGate - AC1: Write tool path calls EditStrategyPolicy before full write
// ---------------------------------------------------------------------------

describe("WriteGate - AC1: Calls EditStrategyPolicy before full write", () => {
	it("should consult policy for existing files", async () => {
		let policyCalled = false;
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const originalCheck = policy.checkPolicy.bind(policy);
		policy.checkPolicy = (...args: unknown[]) => {
			policyCalled = true;
			return originalCheck(...(args as [string, boolean, number, number, number?, number?, number?]));
		};

		const gate = createWriteGate({
			policy,
			stat: mockStat(5000),
			readFile: async () => Buffer.from("x".repeat(100)),
		});

		await gate.check("/test/file.ts", "file.ts");
		expect(policyCalled).toBe(true);
	});

	it("should not consult policy for new files", async () => {
		let policyCalled = false;
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const originalCheck = policy.checkPolicy.bind(policy);
		policy.checkPolicy = (...args: unknown[]) => {
			policyCalled = true;
			return originalCheck(...(args as [string, boolean, number, number, number?, number?, number?]));
		};

		const gate = createWriteGate({
			policy,
			stat: async () => {
				throw new Error("ENOENT");
			},
		});

		const result = await gate.check("/test/new.ts", "new.ts");
		expect(policyCalled).toBe(false);
		expect(result.isNewFile).toBe(true);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// WriteGate - AC2: Full write to existing large file is blocked
// ---------------------------------------------------------------------------

describe("WriteGate - AC2: Full write to existing large file is blocked", () => {
	it("should block full write for large existing file in token_saving mode", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const gate = createWriteGate({
			policy,
			stat: mockStat(10000),
			readFile: async () => Buffer.from("x".repeat(300 * 40)),
		});

		const result = await gate.check("/test/large.ts", "large.ts");
		expect(result.allowed).toBe(false);
		expect(result.isNewFile).toBe(false);
		expect(result.reason).toBeTruthy();
	});

	it("should block full write for file over byte limit in token_saving mode", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const gate = createWriteGate({
			policy,
			stat: mockStat(9000),
			readFile: async () => Buffer.from("x".repeat(9000)),
		});

		const result = await gate.check("/test/wide.ts", "wide.ts");
		expect(result.allowed).toBe(false);
	});

	it("should block full write for very large file in speed mode", async () => {
		const policy = createEditStrategyPolicy({ mode: "speed" });
		const buf = makeLineContent(1500);

		const gate = createWriteGate({
			policy,
			stat: async () => ({ size: buf.length, isFile: () => true }),
			readFile: async () => buf,
		});

		const result = await gate.check("/test/huge.ts", "huge.ts");
		expect(result.allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// WriteGate - AC4: New file write remains allowed
// ---------------------------------------------------------------------------

describe("WriteGate - AC4: New file write remains allowed", () => {
	it("should allow write for non-existent files in token_saving mode", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const gate = createWriteGate({
			policy,
			stat: async () => {
				throw new Error("ENOENT");
			},
		});

		const result = await gate.check("/test/new.ts", "new.ts");
		expect(result.allowed).toBe(true);
		expect(result.isNewFile).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// WriteGate - AC5: Pre-write snapshot created for guarded files
// ---------------------------------------------------------------------------

describe("WriteGate - AC5: Pre-write snapshot created for guarded files", () => {
	it("should create snapshot for blocked existing file", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const buf = makeLineContent(300);
		const originalContent = buf.toString("utf-8");

		const gate = createWriteGate({
			policy,
			stat: mockStat(15000),
			readFile: async () => buf,
		});

		const result = await gate.check("/test/guarded.ts", "guarded.ts");
		expect(result.allowed).toBe(false);
		expect(result.snapshot).toBe(originalContent);
	});

	it("should not create snapshot for new files", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const gate = createWriteGate({
			policy,
			stat: async () => {
				throw new Error("ENOENT");
			},
		});

		const result = await gate.check("/test/new.ts", "new.ts");
		expect(result.allowed).toBe(true);
		expect(result.snapshot).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// WriteGate - AC6: Blocked rewrite emits edit_strategy_blocked event
// ---------------------------------------------------------------------------

describe("WriteGate - AC6: Blocked rewrite emits edit_strategy_blocked event", () => {
	let eventBus: EventBusController;
	let receivedEvents: unknown[];

	beforeEach(() => {
		eventBus = createEventBus();
		receivedEvents = [];
		eventBus.on(EDIT_STRATEGY_BLOCKED_CHANNEL, (data: unknown) => {
			receivedEvents.push(data);
		});
	});

	it("should emit edit_strategy_blocked event when write is blocked", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const buf = makeLineContent(300);

		const gate = createWriteGate({
			policy,
			eventBus,
			stat: mockStat(15000),
			readFile: async () => buf,
		});

		await gate.check("/test/blocked.ts", "blocked.ts");

		expect(receivedEvents.length).toBe(1);
		const event = receivedEvents[0] as EditStrategyBlockedEvent;
		expect(event.filePath).toBe("blocked.ts");
		expect(event.reasonCode).toBeTruthy();
		expect(event.reason).toBeTruthy();
		expect(event.existingByteSize).toBe(15000);
	});

	it("should NOT emit event when write is allowed", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const gate = createWriteGate({
			policy,
			eventBus,
			stat: mockStat(5000),
			readFile: async () => Buffer.from("small content"),
		});

		await gate.check("/test/allowed.ts", "allowed.ts");
		expect(receivedEvents.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// P4.5: Same-file failure threshold blocks further writes
// ---------------------------------------------------------------------------

describe("WriteGate - P4.5: Same-file failure threshold", () => {
	it("should block writes when same-file failure threshold is reached", async () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });

		// Record 2 failures for the same file
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation", "truncated");
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "exact_match_failed", "Could not find");

		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			planExecId: "plan1",
			workspaceId: "ws1",
			stat: mockStat(15000),
			readFile: async () => Buffer.from("content"),
		});

		const result = await gate.check("/test/file.ts", "file.ts");
		expect(result.allowed).toBe(false);
		expect(result.handoffTriggered).toBe(true);
	});

	it("should allow writes when failure threshold is not yet reached", async () => {
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });

		// Only 1 failure recorded
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			planExecId: "plan1",
			workspaceId: "ws1",
			stat: mockStat(5000),
			readFile: async () => Buffer.from("small"),
		});

		const result = await gate.check("/test/file.ts", "file.ts");
		expect(result.handoffTriggered).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// P4.5: Integration scenarios
// ---------------------------------------------------------------------------

describe("WriteGate - Integration", () => {
	it("should work with all edit strategy modes", async () => {
		const modes = ["token_saving", "hybrid", "speed"] as const;

		for (const mode of modes) {
			const policy = createEditStrategyPolicy({ mode });
			const eventBus = createEventBus();
			let blockedCount = 0;
			eventBus.on(EDIT_STRATEGY_BLOCKED_CHANNEL, () => {
				blockedCount++;
			});

			const gate = createWriteGate({
				policy,
				eventBus,
				stat: async () => {
					throw new Error("ENOENT");
				},
			});

			const newResult = await gate.check("/test/new.ts", "new.ts");
			expect(newResult.allowed).toBe(true);
			expect(newResult.isNewFile).toBe(true);
			expect(blockedCount).toBe(0);
		}
	});

	it("P4.5: processWriteResult should detect truncation", async () => {
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();

		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			truncationDetector: detector,
			planExecId: "plan1",
			workspaceId: "ws1",
		});

		gate.processWriteResult("file.ts", "The file got truncated during write", false);

		const summary = tracker.getSummary("plan1", "ws1", "file.ts");
		expect(summary.failedAttempts).toBe(1);
		expect(summary.attempts[0].failureType).toBe("truncation");
	});

	it("P4.5: processEditResult should detect exact-match failure", async () => {
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();

		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			truncationDetector: detector,
			planExecId: "plan1",
			workspaceId: "ws1",
		});

		gate.processEditResult("file.ts", "Could not find the exact text in the file", false);

		const summary = tracker.getSummary("plan1", "ws1", "file.ts");
		expect(summary.failedAttempts).toBe(1);
		expect(summary.attempts[0].failureType).toBe("exact_match_failed");
	});
});
