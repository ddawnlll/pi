/**
 * Tests for Token Metering Core - P1 Workstream 7.A
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	estimateTokensFromMessage,
	estimateTokensFromMessages,
	estimateTokensFromString,
	TokenUsageRecorder,
} from "../src/token-metering.js";
import type { AgentMessage } from "../src/types.js";

describe("Token Metering Core", () => {
	describe("estimateTokensFromString", () => {
		it("should estimate tokens using chars/4 heuristic", () => {
			expect(estimateTokensFromString("")).toBe(0);
			expect(estimateTokensFromString("test")).toBe(1); // 4 chars / 4 = 1
			expect(estimateTokensFromString("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> 3
			expect(estimateTokensFromString("a".repeat(100))).toBe(25); // 100 / 4 = 25
		});

		it("should round up fractional tokens", () => {
			expect(estimateTokensFromString("abc")).toBe(1); // 3 / 4 = 0.75 -> 1
			expect(estimateTokensFromString("abcde")).toBe(2); // 5 / 4 = 1.25 -> 2
		});
	});

	describe("estimateTokensFromMessage", () => {
		it("should estimate tokens for user message with string content", () => {
			const message: AgentMessage = {
				role: "user",
				content: "hello world",
				timestamp: Date.now(),
			};
			expect(estimateTokensFromMessage(message)).toBe(3); // 11 / 4 = 2.75 -> 3
		});

		it("should estimate tokens for user message with array content", () => {
			const message: AgentMessage = {
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{ type: "text", text: "world" },
				],
				timestamp: Date.now(),
			};
			expect(estimateTokensFromMessage(message)).toBe(3); // 10 / 4 = 2.5 -> 3
		});

		it("should estimate tokens for user message with image", () => {
			const message: AgentMessage = {
				role: "user",
				content: [
					{ type: "text", text: "test" },
					{ type: "image", data: "base64data", mimeType: "image/png" },
				],
				timestamp: Date.now(),
			};
			// 4 chars + 4800 (image) = 4804 / 4 = 1201
			expect(estimateTokensFromMessage(message)).toBe(1201);
		});

		it("should estimate tokens for assistant message", () => {
			const message: AgentMessage = {
				role: "assistant",
				content: [
					{ type: "text", text: "response text" },
					{ type: "thinking", thinking: "internal thoughts" },
				],
				api: "openai-completions",
				provider: "openai",
				model: "gpt-4",
				usage: {
					input: 10,
					output: 20,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 30,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			};
			// "response text" (13) + "internal thoughts" (17) = 30 / 4 = 7.5 -> 8
			expect(estimateTokensFromMessage(message)).toBe(8);
		});

		it("should estimate tokens for assistant message with tool call", () => {
			const message: AgentMessage = {
				role: "assistant",
				content: [
					{ type: "text", text: "calling tool" },
					{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "file.ts" } },
				],
				api: "openai-completions",
				provider: "openai",
				model: "gpt-4",
				usage: {
					input: 10,
					output: 20,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 30,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			};
			// "calling tool" (12) + "read" (4) + '{"path":"file.ts"}' (19) = 35 / 4 = 8.75 -> 9
			expect(estimateTokensFromMessage(message)).toBe(9);
		});

		it("should estimate tokens for tool result message", () => {
			const message: AgentMessage = {
				role: "toolResult",
				content: [{ type: "text", text: "file contents here" }],
				toolCallId: "call_1",
				toolName: "read",
				isError: false,
				timestamp: Date.now(),
			};
			// 18 / 4 = 4.5 -> 5
			expect(estimateTokensFromMessage(message)).toBe(5);
		});

		it("should estimate tokens for bash execution message", () => {
			const message: AgentMessage = {
				role: "bashExecution",
				command: "ls -la",
				output: "file1.txt\nfile2.txt",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: Date.now(),
			};
			// "ls -la" (6) + "file1.txt\nfile2.txt" (22) = 28 / 4 = 7
			expect(estimateTokensFromMessage(message)).toBe(7);
		});

		it("should estimate tokens for compaction summary message", () => {
			const message: AgentMessage = {
				role: "compactionSummary",
				summary: "Summary of previous conversation",
				tokensBefore: 1000,
				timestamp: Date.now(),
			};
			// 32 / 4 = 8
			expect(estimateTokensFromMessage(message)).toBe(8);
		});

		it("should return 0 for unknown message types", () => {
			const message = {
				role: "unknown",
			} as unknown as AgentMessage;
			expect(estimateTokensFromMessage(message)).toBe(0);
		});
	});

	describe("estimateTokensFromMessages", () => {
		it("should sum tokens from multiple messages", () => {
			const messages: AgentMessage[] = [
				{
					role: "user",
					content: "hello",
					timestamp: Date.now(),
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "world" }],
					api: "openai-completions",
					provider: "openai",
					model: "gpt-4",
					usage: {
						input: 5,
						output: 5,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 10,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				},
			];
			// "hello" (5) + "world" (5) = 10 / 4 = 2.5 -> 3
			expect(estimateTokensFromMessages(messages)).toBe(3);
		});

		it("should return 0 for empty array", () => {
			expect(estimateTokensFromMessages([])).toBe(0);
		});
	});

	describe("TokenUsageRecorder", () => {
		let recorder: TokenUsageRecorder;

		beforeEach(() => {
			recorder = new TokenUsageRecorder();
		});

		it("should record estimated usage", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			const usage = recorder.getUsage("req-1");

			expect(usage).toBeDefined();
			expect(usage?.estimatedInput).toBe(100);
			expect(usage?.model).toBe("gpt-4");
			expect(usage?.provider).toBe("openai");
			expect(usage?.role).toBe("worker");
			expect(usage?.requestId).toBe("req-1");
			expect(usage?.actualInput).toBeUndefined();
			expect(usage?.actualOutput).toBeUndefined();
		});

		it("should record actual usage after estimate", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.recordActual("req-1", 95, 50, 145);

			const usage = recorder.getUsage("req-1");
			expect(usage?.estimatedInput).toBe(100);
			expect(usage?.actualInput).toBe(95);
			expect(usage?.actualOutput).toBe(50);
			expect(usage?.totalTokens).toBe(145);
		});

		it("should record actual usage without prior estimate", () => {
			recorder.recordActual("req-1", 95, 50, 145);

			const usage = recorder.getUsage("req-1");
			expect(usage?.estimatedInput).toBe(0);
			expect(usage?.actualInput).toBe(95);
			expect(usage?.actualOutput).toBe(50);
			expect(usage?.totalTokens).toBe(145);
		});

		it("should return undefined for non-existent request", () => {
			expect(recorder.getUsage("non-existent")).toBeUndefined();
		});

		it("should get all usage records", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.recordEstimate("req-2", 200, "claude-3", "anthropic", "lead");

			const allUsage = recorder.getAllUsage();
			expect(allUsage).toHaveLength(2);
			expect(allUsage.map((u) => u.requestId)).toContain("req-1");
			expect(allUsage.map((u) => u.requestId)).toContain("req-2");
		});

		it("should clear all usage", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.clear();

			expect(recorder.getAllUsage()).toHaveLength(0);
			expect(recorder.getUsage("req-1")).toBeUndefined();
		});

		it("should calculate total estimated input", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.recordEstimate("req-2", 200, "claude-3", "anthropic", "lead");

			expect(recorder.getTotalEstimatedInput()).toBe(300);
		});

		it("should calculate total actual input", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.recordActual("req-1", 95, 50);
			recorder.recordEstimate("req-2", 200, "claude-3", "anthropic", "lead");
			recorder.recordActual("req-2", 190, 60);

			expect(recorder.getTotalActualInput()).toBe(285);
		});

		it("should calculate total actual output", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.recordActual("req-1", 95, 50);
			recorder.recordEstimate("req-2", 200, "claude-3", "anthropic", "lead");
			recorder.recordActual("req-2", 190, 60);

			expect(recorder.getTotalActualOutput()).toBe(110);
		});

		it("should handle missing actual values in totals", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.recordEstimate("req-2", 200, "claude-3", "anthropic", "lead");
			recorder.recordActual("req-2", 190, 60);

			expect(recorder.getTotalActualInput()).toBe(190);
			expect(recorder.getTotalActualOutput()).toBe(60);
		});

		it("should use unknown role by default", () => {
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai");
			const usage = recorder.getUsage("req-1");

			expect(usage?.role).toBe("unknown");
		});
	});

	describe("AC Verification - 7.A Token Metering Core", () => {
		it("AC: prompt token estimate available before request", () => {
			const messages: AgentMessage[] = [
				{
					role: "user",
					content: "test prompt",
					timestamp: Date.now(),
				},
			];
			const estimate = estimateTokensFromMessages(messages);
			expect(estimate).toBeGreaterThan(0);
		});

		it("AC: provider usage can be recorded when present", () => {
			const recorder = new TokenUsageRecorder();
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			recorder.recordActual("req-1", 95, 50, 145);

			const usage = recorder.getUsage("req-1");
			expect(usage?.actualInput).toBe(95);
			expect(usage?.actualOutput).toBe(50);
		});

		it("AC: missing provider usage does not crash", () => {
			const recorder = new TokenUsageRecorder();
			recorder.recordEstimate("req-1", 100, "gpt-4", "openai", "worker");
			// No actual usage recorded

			expect(() => recorder.getUsage("req-1")).not.toThrow();
			const usage = recorder.getUsage("req-1");
			expect(usage?.actualInput).toBeUndefined();
		});
	});
});
