/**
 * Live Command Log / Terminal Stream tests — P41.05
 *
 * Tests for:
 * - InMemoryCommandLogStream pub/sub
 * - CommandLogEntry structure and sequencing
 * - Multiple plan subscriptions
 * - Clear/unsubscribe operations
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandLogEntry, CommandLogSubscriber } from "../src/command-log-stream.js";
import { InMemoryCommandLogStream } from "../src/command-log-stream.js";

describe("InMemoryCommandLogStream", () => {
	let logStream: InMemoryCommandLogStream;

	beforeEach(() => {
		logStream = new InMemoryCommandLogStream();
	});

	// -----------------------------------------------------------------------
	// Subscribe / Unsubscribe
	// -----------------------------------------------------------------------

	describe("subscribe / unsubscribe", () => {
		it("should deliver entries to a subscriber", () => {
			const received: CommandLogEntry[] = [];

			logStream.subscribe("exec-1", (entry) => {
				received.push(entry);
			});

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stdout",
				data: "PASS",
				offset: 0,
				runId: "run-1",
			});

			expect(received).toHaveLength(1);
			expect(received[0].data).toBe("PASS");
			expect(received[0].seq).toBe(1);
			expect(received[0].timestamp).toBeGreaterThan(0);
		});

		it("should not deliver entries to unsubscribed subscribers", () => {
			const received: CommandLogEntry[] = [];

			const unsub = logStream.subscribe("exec-1", (entry) => {
				received.push(entry);
			});

			unsub();

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stdout",
				data: "PASS",
				offset: 0,
			});

			expect(received).toHaveLength(0);
		});

		it("should handle multiple subscribers for the same plan", () => {
			const received1: CommandLogEntry[] = [];
			const received2: CommandLogEntry[] = [];

			logStream.subscribe("exec-1", (e) => received1.push(e));
			logStream.subscribe("exec-1", (e) => received2.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "echo hello",
				cwd: "/project",
				stream: "stdout",
				data: "hello",
				offset: 0,
			});

			expect(received1).toHaveLength(1);
			expect(received2).toHaveLength(1);
		});

		it("should isolate subscribers per plan execution", () => {
			const receivedExec1: CommandLogEntry[] = [];
			const receivedExec2: CommandLogEntry[] = [];

			logStream.subscribe("exec-1", (e) => receivedExec1.push(e));
			logStream.subscribe("exec-2", (e) => receivedExec2.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd-a",
				cwd: "/project",
				stream: "stdout",
				data: "output-a",
				offset: 0,
			});

			expect(receivedExec1).toHaveLength(1);
			expect(receivedExec2).toHaveLength(0);
		});

		it("should return unsubscribe function from subscribe", () => {
			const received: CommandLogEntry[] = [];
			const sub: CommandLogSubscriber = (e) => received.push(e);

			const unsub = logStream.subscribe("exec-1", sub);
			expect(typeof unsub).toBe("function");

			// Should have 1 subscriber
			expect(logStream.subscriberCount("exec-1")).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Sequencing
	// -----------------------------------------------------------------------

	describe("sequencing", () => {
		it("should assign incrementing seq numbers across all commands", () => {
			const received: CommandLogEntry[] = [];

			// Use wildcard subscriber to capture all plan output
			logStream.subscribe("*", (e) => received.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd-1",
				cwd: "/project",
				stream: "stdout",
				data: "output-1",
				offset: 0,
			});

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd-1",
				cwd: "/project",
				stream: "stdout",
				data: "output-2",
				offset: 7,
			});

			logStream.emitOutput({
				planExecutionId: "exec-2",
				workspaceId: "ws-2",
				command: "cmd-2",
				cwd: "/other",
				stream: "stderr",
				data: "error output",
				offset: 0,
			});

			expect(received).toHaveLength(3);
			expect(received[0].seq).toBe(1);
			expect(received[1].seq).toBe(2);
			expect(received[2].seq).toBe(3);
		});
	});

	// -----------------------------------------------------------------------
	// Wildcard subscriber
	// -----------------------------------------------------------------------

	describe("wildcard subscriber", () => {
		it("should deliver all plan execution output to '*' subscriber", () => {
			const received: CommandLogEntry[] = [];

			logStream.subscribe("*", (e) => received.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd-a",
				cwd: "/project",
				stream: "stdout",
				data: "output-a",
				offset: 0,
			});

			logStream.emitOutput({
				planExecutionId: "exec-2",
				workspaceId: "ws-2",
				command: "cmd-b",
				cwd: "/other",
				stream: "stderr",
				data: "output-b",
				offset: 0,
			});

			expect(received).toHaveLength(2);
			expect(received[0].planExecutionId).toBe("exec-1");
			expect(received[1].planExecutionId).toBe("exec-2");
		});

		it("should deliver to both plan-specific and wildcard subscribers", () => {
			const planReceived: CommandLogEntry[] = [];
			const wildReceived: CommandLogEntry[] = [];

			logStream.subscribe("exec-1", (e) => planReceived.push(e));
			logStream.subscribe("*", (e) => wildReceived.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd",
				cwd: "/project",
				stream: "stdout",
				data: "out",
				offset: 0,
			});

			expect(planReceived).toHaveLength(1);
			expect(wildReceived).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// Clear operations
	// -----------------------------------------------------------------------

	describe("clear operations", () => {
		it("should clear all subscribers for a plan execution", () => {
			const received: CommandLogEntry[] = [];

			logStream.subscribe("exec-1", (e) => received.push(e));

			logStream.clearPlan("exec-1");

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd",
				cwd: "/project",
				stream: "stdout",
				data: "out",
				offset: 0,
			});

			expect(received).toHaveLength(0);
		});

		it("should clear all subscribers across all plans", () => {
			const received1: CommandLogEntry[] = [];
			const received2: CommandLogEntry[] = [];

			logStream.subscribe("exec-1", (e) => received1.push(e));
			logStream.subscribe("exec-2", (e) => received2.push(e));

			logStream.clearAll();

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd",
				cwd: "/project",
				stream: "stdout",
				data: "out",
				offset: 0,
			});

			expect(received1).toHaveLength(0);
			expect(received2).toHaveLength(0);
		});

		it("should report correct subscriber counts after unsubscribe", () => {
			const sub: CommandLogSubscriber = () => {};

			logStream.subscribe("exec-1", sub);
			expect(logStream.subscriberCount("exec-1")).toBe(1);

			logStream.unsubscribe("exec-1", sub);
			expect(logStream.subscriberCount("exec-1")).toBe(0);
			expect(logStream.activePlanCount).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Entry shape
	// -----------------------------------------------------------------------

	describe("entry shape", () => {
		it("should set final flag when provided", () => {
			const received: CommandLogEntry[] = [];

			logStream.subscribe("*", (e) => received.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stdout",
				data: "Tests complete",
				offset: 100,
				final: true,
			});

			expect(received[0].final).toBe(true);
		});

		it("should populate runId when provided", () => {
			const received: CommandLogEntry[] = [];

			logStream.subscribe("*", (e) => received.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stdout",
				data: "output",
				offset: 0,
				runId: "run-42",
			});

			expect(received[0].runId).toBe("run-42");
		});

		it("should handle stderr output", () => {
			const received: CommandLogEntry[] = [];

			logStream.subscribe("*", (e) => received.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stderr",
				data: "Error: test failed",
				offset: 0,
			});

			expect(received[0].stream).toBe("stderr");
		});

		it("should auto-assign timestamp on emit", () => {
			const received: CommandLogEntry[] = [];
			const before = Date.now();

			logStream.subscribe("*", (e) => received.push(e));

			logStream.emitOutput({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				command: "cmd",
				cwd: "/project",
				stream: "stdout",
				data: "out",
				offset: 0,
			});

			const after = Date.now();
			expect(received[0].timestamp).toBeGreaterThanOrEqual(before);
			expect(received[0].timestamp).toBeLessThanOrEqual(after);
		});
	});

	// -----------------------------------------------------------------------
	// Subscriber error resilience
	// -----------------------------------------------------------------------

	describe("error resilience", () => {
		it("should not throw when a subscriber throws", () => {
			const received: CommandLogEntry[] = [];

			logStream.subscribe("exec-1", () => {
				throw new Error("subscriber error");
			});
			logStream.subscribe("exec-1", (e) => received.push(e));

			expect(() => {
				logStream.emitOutput({
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					command: "cmd",
					cwd: "/project",
					stream: "stdout",
					data: "out",
					offset: 0,
				});
			}).not.toThrow();

			// Second subscriber should still receive the entry
			expect(received).toHaveLength(1);
		});
	});
});
