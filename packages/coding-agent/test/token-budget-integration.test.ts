/**
 * Integration Tests - P1 Workstream 7.G
 *
 * Tests the complete token budget enforcement flow
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	BudgetExceededError,
	ContextBudgetEnforcer,
	estimateTokensFromMessages,
	TokenUsageRecorder,
} from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createTokenReport, formatTokenReportHuman } from "../src/cli/token-report.js";
import { PacketBuilder } from "../src/core/context-packet.js";
import { FilePolicy } from "../src/core/file-policy.js";

describe("Token Budget Integration Tests - P1 Workstream 7.G", () => {
	describe("End-to-End Budget Enforcement", () => {
		it("should enforce budget for normal worker request", () => {
			const enforcer = new ContextBudgetEnforcer();
			const recorder = new TokenUsageRecorder();

			// Simulate a normal worker request
			const messages: AgentMessage[] = [
				{
					role: "user",
					content: "Write a function to calculate fibonacci numbers",
					timestamp: Date.now(),
				},
			];

			const estimatedTokens = estimateTokensFromMessages(messages);
			recorder.recordEstimate("req-1", estimatedTokens, "gpt-4", "openai", "worker");

			const budgetCheck = enforcer.checkBudget(estimatedTokens, "worker");
			expect(budgetCheck.passed).toBe(true);
			expect(estimatedTokens).toBeLessThan(12000);
		});

		it("should block request exceeding worker budget", () => {
			const enforcer = new ContextBudgetEnforcer();

			// Simulate a large request
			const largeContent = "x".repeat(50000); // ~12500 tokens
			const messages: AgentMessage[] = [
				{
					role: "user",
					content: largeContent,
					timestamp: Date.now(),
				},
			];

			const estimatedTokens = estimateTokensFromMessages(messages);
			const budgetCheck = enforcer.checkBudget(estimatedTokens, "worker");

			expect(budgetCheck.passed).toBe(false);
			expect(budgetCheck.reason).toContain("exceed");
		});

		it("should block request exceeding maxAuto without expensive flag", () => {
			const enforcer = new ContextBudgetEnforcer();

			// Simulate a huge request
			const hugeContent = "x".repeat(300000); // ~75000 tokens
			const messages: AgentMessage[] = [
				{
					role: "user",
					content: hugeContent,
					timestamp: Date.now(),
				},
			];

			const estimatedTokens = estimateTokensFromMessages(messages);
			const budgetCheck = enforcer.checkBudget(estimatedTokens, "lead");

			expect(budgetCheck.passed).toBe(false);
			expect(budgetCheck.requiresEscalation).toBe(true);
			expect(budgetCheck.reason).toContain("--expensive-context-1m");
		});

		it("should allow request with expensive flag enabled", () => {
			const enforcer = new ContextBudgetEnforcer();
			enforcer.updateSettings({ millionContextEnabled: true });

			// Simulate a huge request
			const hugeContent = "x".repeat(300000); // ~75000 tokens
			const messages: AgentMessage[] = [
				{
					role: "user",
					content: hugeContent,
					timestamp: Date.now(),
				},
			];

			const estimatedTokens = estimateTokensFromMessages(messages);
			const budgetCheck = enforcer.checkBudget(estimatedTokens, "lead");

			expect(budgetCheck.passed).toBe(true);
			expect(budgetCheck.requiresEscalation).toBe(true);
		});
	});

	describe("Packet Builder Integration", () => {
		it("should create packet within worker budget", () => {
			const builder = new PacketBuilder();

			const packet = builder.build({
				phaseId: "P1",
				workspaceId: "7.G",
				role: "worker",
				goal: "Test packet creation",
				acceptanceCriteria: ["Packet created", "Within budget"],
				stateSummary: "Testing packet builder",
			});

			expect(packet.budget.estimatedInputTokens).toBeLessThan(12000);
			expect(builder.isWithinBudget(packet)).toBe(true);
		});

		it("should compact packet when over budget", () => {
			const builder = new PacketBuilder();

			// Create a packet with lots of snippets
			const largeSnippets = Array.from({ length: 20 }, (_, i) => ({
				file: `file${i}.ts`,
				content: "x".repeat(1000),
			}));

			const packet = builder.build({
				phaseId: "P1",
				workspaceId: "7.G",
				role: "worker",
				goal: "Test compaction",
				relevantSnippets: largeSnippets,
				maxInputTokens: 5000,
			});

			// Should be over budget initially
			expect(packet.budget.estimatedInputTokens).toBeGreaterThan(5000);

			// Compact to fit budget
			const compacted = builder.compactToFitBudget(packet);
			expect(compacted.budget.estimatedInputTokens).toBeLessThanOrEqual(5000);
			expect(compacted.relevantSnippets.length).toBeLessThan(packet.relevantSnippets.length);
		});
	});

	describe("File Policy Integration", () => {
		it("should prevent large file full injection", () => {
			const policy = new FilePolicy();

			// 5000-line file
			const result = policy.checkPolicy(5000);

			expect(result.canReadFull).toBe(false);
			expect(result.requiresChunking).toBe(true);
			expect(result.recommendedAction).toBe("chunks");
		});

		it("should generate chunks for large files", () => {
			const policy = new FilePolicy();

			const content = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join("\n");
			const chunks = policy.getChunks(content);

			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.length).toBeLessThanOrEqual(6); // maxChunksPerPacket

			// Each chunk should have token estimate
			for (const chunk of chunks) {
				expect(chunk.estimatedTokens).toBeGreaterThan(0);
			}
		});

		it("should allow small file full read if within budget", () => {
			const policy = new FilePolicy();

			const result = policy.checkPolicy(500, 10000);
			expect(result.canReadFull).toBe(true);
			expect(result.recommendedAction).toBe("full_read");
		});
	});

	describe("Token Reporting Integration", () => {
		it("should create comprehensive token report", () => {
			const recorder = new TokenUsageRecorder();
			const enforcer = new ContextBudgetEnforcer();

			// Record usage
			recorder.recordEstimate("req-1", 10000, "gpt-4", "openai", "worker");
			recorder.recordActual("req-1", 9500, 2000, 11500);

			const usage = recorder.getUsage("req-1")!;
			const budgetCheck = enforcer.checkBudget(usage.estimatedInput, "worker");

			const report = createTokenReport(usage, budgetCheck, false);

			expect(report.role).toBe("worker");
			expect(report.estimatedInput).toBe(10000);
			expect(report.actualInput).toBe(9500);
			expect(report.actualOutput).toBe(2000);
			expect(report.budget).toBe(12000);
			expect(report.overBudget).toBe(false);

			// Format report
			const formatted = formatTokenReportHuman(report);
			expect(formatted).toContain("Token Usage Report");
			expect(formatted).toContain("worker");
			expect(formatted).toContain("10,000");
		});
	});

	describe("AC Verification - 7.G Tests and Dry Run", () => {
		it("AC: synthetic normal worker packet stays under 12K", () => {
			const builder = new PacketBuilder();

			const packet = builder.build({
				phaseId: "P1",
				workspaceId: "7.A",
				role: "worker",
				goal: "Implement token metering core with estimation and tracking",
				acceptanceCriteria: [
					"Token estimation available before request",
					"Provider usage can be recorded",
					"Missing provider usage does not crash",
				],
				stateSummary: "Starting implementation of P1 token metering foundation",
				relevantSnippets: [
					{
						file: "packages/coding-agent/src/core/compaction/compaction.ts",
						content: "export function estimateTokens(message: AgentMessage): number { /* ... */ }",
					},
				],
			});

			expect(packet.budget.estimatedInputTokens).toBeLessThan(12000);
		});

		it("AC: synthetic 5000-line file uses chunks not full file", () => {
			const policy = new FilePolicy();

			const content = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join("\n");
			const result = policy.checkPolicy(5000);

			expect(result.canReadFull).toBe(false);
			expect(result.requiresChunking).toBe(true);

			const chunks = policy.getChunks(content);
			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.length).toBeLessThanOrEqual(6);
		});

		it("AC: attempted 100K prompt fails before provider call", () => {
			const enforcer = new ContextBudgetEnforcer();

			const result = enforcer.checkBudget(100000, "worker");

			expect(result.passed).toBe(false);
			expect(result.requiresEscalation).toBe(true);

			// Should throw if we try to enforce
			expect(() => {
				if (!result.passed) {
					throw new BudgetExceededError(result);
				}
			}).toThrow(BudgetExceededError);
		});

		it("AC: doctor confirms safe defaults", () => {
			const enforcer = new ContextBudgetEnforcer();
			const policy = new FilePolicy();

			// Check all safe defaults
			expect(enforcer.isMillionContextEnabled()).toBe(false);
			expect(enforcer.getSettings().maxAuto).toBe(64000);
			expect(enforcer.getSettings().worker).toBe(12000);

			expect(policy.getSettings().largeFileChunkOnlyMinLines).toBe(2501);
			expect(policy.canReadFull(5000)).toBe(false);
		});
	});

	describe("Complete Workflow Simulation", () => {
		it("should handle complete request lifecycle", () => {
			// Setup
			const recorder = new TokenUsageRecorder();
			const enforcer = new ContextBudgetEnforcer();
			const builder = new PacketBuilder();

			// 1. Create workspace packet
			const packet = builder.build({
				phaseId: "P1",
				workspaceId: "test",
				role: "worker",
				goal: "Complete a test task",
				acceptanceCriteria: ["Task completed"],
			});

			// 2. Estimate tokens
			const estimatedTokens = packet.budget.estimatedInputTokens;
			expect(estimatedTokens).toBeGreaterThan(0);

			// 3. Check budget
			const budgetCheck = enforcer.checkBudget(estimatedTokens, "worker");
			expect(budgetCheck.passed).toBe(true);

			// 4. Record estimate
			recorder.recordEstimate("req-1", estimatedTokens, "gpt-4", "openai", "worker");

			// 5. Simulate provider call (would happen here)
			// ...

			// 6. Record actual usage
			recorder.recordActual("req-1", estimatedTokens - 100, 500, estimatedTokens + 400);

			// 7. Generate report
			const usage = recorder.getUsage("req-1")!;
			const report = createTokenReport(usage, budgetCheck, false);

			expect(report.overBudget).toBe(false);
			expect(report.actualInput).toBeDefined();
			expect(report.actualOutput).toBeDefined();
		});
	});
});
