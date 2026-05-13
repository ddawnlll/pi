/**
 * Integration test for validation lock with executeBashWithOperations.
 *
 * Proves that the validation lock wraps actual bash execution,
 * not just the withValidationLock helper.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { executeBashWithOperations } from "../src/core/bash-executor.js";
import type { EventBus } from "../src/core/event-bus.js";
import { createEventBus } from "../src/core/event-bus.js";
import type { BashOperations } from "../src/core/tools/bash.js";
import {
	resetGlobalValidationLock,
	VALIDATION_LOCK_ACQUIRED,
	VALIDATION_LOCK_RELEASED,
	VALIDATION_LOCK_WAITING,
} from "../src/core/validation-lock.js";

/** Delay helper. */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Create a mock BashOperations that records when exec is called
 * and allows controlling timing/delay.
 */
function createMockOperations(options?: { execDelay?: number; shouldFail?: boolean; exitCode?: number }): {
	operations: BashOperations;
	execCalls: Array<{ command: string; cwd: string }>;
} {
	const execCalls: Array<{ command: string; cwd: string }> = [];

	const operations: BashOperations = {
		exec: async (command, cwd, { onData }) => {
			execCalls.push({ command, cwd });

			if (options?.shouldFail) {
				throw new Error("command failed");
			}

			// Simulate some output
			onData(Buffer.from("mock output"));

			if (options?.execDelay) {
				await delay(options.execDelay);
			}

			return { exitCode: options?.exitCode ?? 0 };
		},
	};

	return { operations, execCalls };
}

/** Collect events from an EventBus. */
function collectEvents(eventBus: EventBus, ...channels: string[]): Map<string, unknown[]> {
	const events = new Map<string, unknown[]>();
	for (const channel of channels) {
		events.set(channel, []);
		eventBus.on(channel, (data: unknown) => {
			events.get(channel)!.push(data);
		});
	}
	return events;
}

describe("executeBashWithOperations – validation lock integration", () => {
	beforeEach(() => {
		resetGlobalValidationLock();
	});

	it("does not lock non-validation commands", async () => {
		const eventBus = createEventBus();
		const events = collectEvents(
			eventBus,
			VALIDATION_LOCK_WAITING,
			VALIDATION_LOCK_ACQUIRED,
			VALIDATION_LOCK_RELEASED,
		);
		const { operations, execCalls } = createMockOperations();

		const result = await executeBashWithOperations("echo hello", "/tmp", operations, { eventBus });

		expect(result.output).toContain("mock output");
		expect(result.cancelled).toBe(false);
		expect(execCalls.length).toBe(1);
		expect(execCalls[0].command).toBe("echo hello");

		// No lock events for non-validation command
		expect(events.get(VALIDATION_LOCK_WAITING)!.length).toBe(0);
		expect(events.get(VALIDATION_LOCK_ACQUIRED)!.length).toBe(0);
		expect(events.get(VALIDATION_LOCK_RELEASED)!.length).toBe(0);
	});

	it("locks validation commands and emits events", async () => {
		const eventBus = createEventBus();
		const events = collectEvents(
			eventBus,
			VALIDATION_LOCK_WAITING,
			VALIDATION_LOCK_ACQUIRED,
			VALIDATION_LOCK_RELEASED,
		);
		const { operations } = createMockOperations();

		const result = await executeBashWithOperations("vitest", "/tmp", operations, { eventBus });

		expect(result.output).toContain("mock output");
		expect(events.get(VALIDATION_LOCK_WAITING)!.length).toBe(1);
		expect(events.get(VALIDATION_LOCK_ACQUIRED)!.length).toBe(1);
		expect(events.get(VALIDATION_LOCK_RELEASED)!.length).toBe(1);
	});

	it("locks all validation command variants", async () => {
		const eventBus = createEventBus();
		const events = collectEvents(
			eventBus,
			VALIDATION_LOCK_WAITING,
			VALIDATION_LOCK_ACQUIRED,
			VALIDATION_LOCK_RELEASED,
		);

		const validationCommands = [
			"vitest",
			"npm test",
			"npm run test",
			"pnpm test",
			"pnpm run test",
			"npm run typecheck",
			"npx tsgo --noEmit",
			"tsc --noEmit",
			"npm run build",
			"vite build",
		];

		for (const cmd of validationCommands) {
			resetGlobalValidationLock();
			const { operations } = createMockOperations();
			await executeBashWithOperations(cmd, "/tmp", operations, { eventBus });
		}

		// Each command should have emitted all three events
		const totalWaiting = events.get(VALIDATION_LOCK_WAITING)!.length;
		const totalAcquired = events.get(VALIDATION_LOCK_ACQUIRED)!.length;
		const totalReleased = events.get(VALIDATION_LOCK_RELEASED)!.length;

		expect(totalWaiting).toBe(validationCommands.length);
		expect(totalAcquired).toBe(validationCommands.length);
		expect(totalReleased).toBe(validationCommands.length);
	});

	it("prevents two validation commands from overlapping", async () => {
		resetGlobalValidationLock();
		const timeline: string[] = [];

		const slowOps: BashOperations = {
			exec: async (command, _cwd, { onData }) => {
				timeline.push(`${command}-exec-start`);
				onData(Buffer.from("output"));
				await delay(50);
				timeline.push(`${command}-exec-end`);
				return { exitCode: 0 };
			},
		};

		const fastOps: BashOperations = {
			exec: async (command, _cwd, { onData }) => {
				timeline.push(`${command}-exec-start`);
				onData(Buffer.from("output"));
				timeline.push(`${command}-exec-end`);
				return { exitCode: 0 };
			},
		};

		const p1 = executeBashWithOperations("vitest run a", "/tmp", slowOps);
		const p2 = executeBashWithOperations("vitest run b", "/tmp", fastOps);

		await Promise.all([p1, p2]);

		// p2 must not start until p1 finishes
		const idx1End = timeline.indexOf("vitest run a-exec-end");
		const idx2Start = timeline.indexOf("vitest run b-exec-start");
		expect(idx1End).toBeLessThan(idx2Start);
	});

	it("releases lock after validation command fails", async () => {
		const { operations } = createMockOperations({ shouldFail: true });

		await expect(executeBashWithOperations("vitest", "/tmp", operations)).rejects.toThrow("command failed");

		// Lock should be released — a subsequent validation command should work
		const { operations: ops2 } = createMockOperations();
		const result = await executeBashWithOperations("vitest", "/tmp", ops2);
		expect(result.output).toContain("mock output");
	});

	it("works without eventBus (no events but lock still active)", async () => {
		const { operations } = createMockOperations();

		const result = await executeBashWithOperations("npm run build", "/tmp", operations);

		expect(result.output).toContain("mock output");
		expect(result.cancelled).toBe(false);
	});
});
