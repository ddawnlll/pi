/**
 * Tests for Budget & Blast-Radius Enforcer - P9.E
 *
 * Acceptance criteria:
 * 1. Max files, max lines, allowed paths, forbidden paths, and approval
 *    expiry are enforceable.
 * 2. Budget violations block execution.
 * 3. Budget summary appears in dry-run and approval artifacts.
 */

import { describe, expect, it } from "vitest";
import { BudgetViolation, createWorkspaceBudgetEnforcer } from "../src/core/budget-enforcer.js";
import { createPacketBuilder, type WorkspacePacket } from "../src/core/context-packet.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const packetBuilder = createPacketBuilder();

function createTestPacket(): WorkspacePacket {
	return packetBuilder.build({
		phaseId: "P9",
		workspaceId: "E.1",
		role: "worker",
		goal: "Test budget and blast-radius controls",
		acceptanceCriteria: [
			"Max files, max lines, allowed paths, forbidden paths, and approval expiry are enforceable",
			"Budget violations block execution",
			"Budget summary appears in dry-run and approval artifacts",
		],
		targetCommand: null,
		stateSummary: "Initial test state",
		maxInputTokens: 10000,
	});
}

// ---------------------------------------------------------------------------
// AC1: Max files, max lines, allowed paths, forbidden paths, and approval
//      expiry are enforceable
// ---------------------------------------------------------------------------

describe("AC1: Blast-radius controls are enforceable", () => {
	describe("maxFiles enforcement", () => {
		it("should pass when file count is within maxFiles limit", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ maxFiles: 5 });
			expect(() => enforcer.checkBlastRadius("E.1", ["a.ts", "b.ts", "c.ts"], 50)).not.toThrow();
		});

		it("should pass when file count equals maxFiles limit", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ maxFiles: 3 });
			expect(() => enforcer.checkBlastRadius("E.1", ["a.ts", "b.ts", "c.ts"], 50)).not.toThrow();
		});

		it("should throw BudgetViolation when file count exceeds maxFiles limit", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ maxFiles: 2 });
			const error = enforcer.checkBlastRadius.bind(enforcer, "E.1", ["a.ts", "b.ts", "c.ts"], 50);
			expect(error).toThrow(BudgetViolation);
			expect(error).toThrow(/3 files modified exceeds max of 2/);
		});

		it("should pass when maxFiles is not set (no limit)", () => {
			const enforcer = createWorkspaceBudgetEnforcer({});
			expect(() =>
				enforcer.checkBlastRadius(
					"E.1",
					Array.from({ length: 100 }, (_, i) => `${i}.ts`),
					5000,
				),
			).not.toThrow();
		});
	});

	describe("maxLines enforcement", () => {
		it("should pass when line changes are within maxLines limit", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ maxLines: 100 });
			expect(() => enforcer.checkBlastRadius("E.1", ["a.ts"], 50)).not.toThrow();
		});

		it("should pass when line changes equal maxLines limit", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ maxLines: 50 });
			expect(() => enforcer.checkBlastRadius("E.1", ["a.ts"], 50)).not.toThrow();
		});

		it("should throw BudgetViolation when line changes exceed maxLines limit", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ maxLines: 30 });
			const error = enforcer.checkBlastRadius.bind(enforcer, "E.1", ["a.ts"], 50);
			expect(error).toThrow(BudgetViolation);
			expect(error).toThrow(/50 lines changed exceeds max of 30/);
		});

		it("should pass when maxLines is not set (no limit)", () => {
			const enforcer = createWorkspaceBudgetEnforcer({});
			expect(() => enforcer.checkBlastRadius("E.1", ["a.ts"], 99999)).not.toThrow();
		});
	});

	describe("allowedPaths enforcement", () => {
		it("should pass when all files are in allowed paths", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ allowedPaths: ["src/**/*.ts"] });
			expect(() => enforcer.checkBlastRadius("E.1", ["src/index.ts", "src/utils/helper.ts"], 30)).not.toThrow();
		});

		it("should pass when allowedPaths is not set (no restriction)", () => {
			const enforcer = createWorkspaceBudgetEnforcer({});
			expect(() => enforcer.checkBlastRadius("E.1", [".env", "node_modules/foo.js"], 10)).not.toThrow();
		});

		it("should throw BudgetViolation when a file is outside allowed paths", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ allowedPaths: ["src/**"] });
			const error = enforcer.checkBlastRadius.bind(enforcer, "E.1", ["src/main.ts", "dist/output.js"], 20);
			expect(error).toThrow(BudgetViolation);
			expect(error).toThrow(/files not in allowed paths/);
		});

		it("should support multiple allowed path patterns", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ allowedPaths: ["src/**", "tests/**"] });
			expect(() => enforcer.checkBlastRadius("E.1", ["src/main.ts", "tests/main.test.ts"], 20)).not.toThrow();
		});
	});

	describe("forbiddenPaths enforcement", () => {
		it("should pass when no files are in forbidden paths", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ forbiddenPaths: ["**/.env*", "**/secrets/**"] });
			expect(() => enforcer.checkBlastRadius("E.1", ["src/main.ts", "README.md"], 30)).not.toThrow();
		});

		it("should throw BudgetViolation when a file matches forbidden paths", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ forbiddenPaths: ["**/.env*"] });
			const error = enforcer.checkBlastRadius.bind(enforcer, "E.1", ["src/main.ts", ".env.local"], 20);
			expect(error).toThrow(BudgetViolation);
			expect(error).toThrow(/files in forbidden paths/);
		});

		it("should pass when forbiddenPaths is not set (no restriction)", () => {
			const enforcer = createWorkspaceBudgetEnforcer({});
			expect(() => enforcer.checkBlastRadius("E.1", ["/etc/passwd"], 5)).not.toThrow();
		});

		it("should support multiple forbidden path patterns", () => {
			const enforcer = createWorkspaceBudgetEnforcer({
				forbiddenPaths: ["**/*.pem", "**/*.key", "**/credentials/**"],
			});
			expect(() => enforcer.checkBlastRadius("E.1", ["src/main.ts", "tests/test.ts"], 10)).not.toThrow();
			expect(() => enforcer.checkBlastRadius("E.1", ["secrets/credentials/db.txt"], 5)).toThrow(BudgetViolation);
		});
	});

	describe("allowedPaths + forbiddenPaths combined", () => {
		it("should enforce both allowed and forbidden paths together", () => {
			const enforcer = createWorkspaceBudgetEnforcer({
				allowedPaths: ["src/**", "docs/**"],
				forbiddenPaths: ["**/*.pem", "**/secrets/**"],
			});
			// Allowed and not forbidden: passes
			expect(() => enforcer.checkBlastRadius("E.1", ["src/main.ts", "docs/README.md"], 20)).not.toThrow();
			// Forbidden path: fails
			expect(() => enforcer.checkBlastRadius("E.1", ["src/private.pem", "docs/README.md"], 10)).toThrow(
				BudgetViolation,
			);
			// Outside allowed: fails
			expect(() => enforcer.checkBlastRadius("E.1", ["node_modules/foo.js"], 10)).toThrow(BudgetViolation);
		});
	});

	describe("approvalExpiry enforcement", () => {
		it("should pass when approval is within expiry window", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ approvalExpiry: 60_000 }); // 60 seconds
			// Approval granted 10 seconds ago
			const approvedAt = Date.now() - 10_000;
			expect(() => enforcer.checkApprovalExpiry(approvedAt)).not.toThrow();
		});

		it("should throw BudgetViolation when approval has expired", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ approvalExpiry: 5_000 }); // 5 seconds
			// Approval granted 10 seconds ago
			const approvedAt = Date.now() - 10_000;
			const error = enforcer.checkApprovalExpiry.bind(enforcer, approvedAt);
			expect(error).toThrow(BudgetViolation);
			expect(error).toThrow(/Approval has expired/);
		});

		it("should pass when approvalExpiry is null (never expires)", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ approvalExpiry: null });
			// Approval granted 10 years ago
			const approvedAt = Date.now() - 365 * 24 * 60 * 60 * 1000 * 10;
			expect(() => enforcer.checkApprovalExpiry(approvedAt)).not.toThrow();
		});

		it("should pass when approvalExpiry is undefined (never expires)", () => {
			const enforcer = createWorkspaceBudgetEnforcer({});
			const approvedAt = Date.now() - 999999999;
			expect(() => enforcer.checkApprovalExpiry(approvedAt)).not.toThrow();
		});

		it("should return time remaining for non-expired approvals", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ approvalExpiry: 60_000 });
			// Very recent approval
			const approvedAt = Date.now() - 1_000;
			const remaining = enforcer.checkApprovalExpiry(approvedAt);
			expect(remaining).not.toBeNull();
			expect(remaining as number).toBeGreaterThan(50_000);
			expect(remaining as number).toBeLessThanOrEqual(60_000);
		});

		it("should return null when approvalExpiry is null (never expires)", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ approvalExpiry: null });
			expect(enforcer.checkApprovalExpiry(Date.now())).toBeNull();
		});
	});

	describe("checkPreExecution (budget + approval expiry combined)", () => {
		it("should pass when both budget and approval are valid", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ approvalExpiry: 60_000 });
			const packet = createTestPacket();
			const approvedAt = Date.now() - 1_000;
			expect(() => enforcer.checkPreExecution(packet, approvedAt)).not.toThrow();
		});

		it("should throw when budget is exceeded", () => {
			const enforcer = createWorkspaceBudgetEnforcer({});
			const packet = createTestPacket();
			// Manually set over budget
			packet.budget.estimatedInputTokens = 20000;
			packet.budget.maxInputTokens = 10000;
			expect(() => enforcer.checkPreExecution(packet)).toThrow(BudgetViolation);
		});

		it("should throw when approval has expired", () => {
			const enforcer = createWorkspaceBudgetEnforcer({ approvalExpiry: 1_000 });
			const packet = createTestPacket();
			const approvedAt = Date.now() - 10_000;
			expect(() => enforcer.checkPreExecution(packet, approvedAt)).toThrow(BudgetViolation);
		});
	});
});

// ---------------------------------------------------------------------------
// AC2: Budget violations block execution
// ---------------------------------------------------------------------------

describe("AC2: Budget violations block execution", () => {
	it("should throw BudgetViolation when estimated tokens exceed max tokens", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		packet.budget.estimatedInputTokens = 20000;
		packet.budget.maxInputTokens = 10000;

		expect(() => enforcer.checkBudget(packet)).toThrow(BudgetViolation);
	});

	it("should pass when estimated tokens are within max tokens", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		packet.budget.estimatedInputTokens = 5000;
		packet.budget.maxInputTokens = 10000;

		expect(() => enforcer.checkBudget(packet)).not.toThrow();
	});

	it("should pass when estimated tokens equal max tokens (boundary)", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		packet.budget.estimatedInputTokens = 10000;
		packet.budget.maxInputTokens = 10000;

		expect(() => enforcer.checkBudget(packet)).not.toThrow();
	});

	it("should return the packet when budget check passes (fluent API)", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		const result = enforcer.checkBudget(packet);
		expect(result).toBe(packet);
	});

	it("should have the correct violation type for budget violations", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		packet.budget.estimatedInputTokens = 99999;
		packet.budget.maxInputTokens = 100;

		try {
			enforcer.checkBudget(packet);
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(BudgetViolation);
			expect((error as BudgetViolation).violationType).toBe("budget");
			expect((error as BudgetViolation).details).toContain("over budget");
		}
	});

	it("should have the correct violation type for blast-radius violations", () => {
		const enforcer = createWorkspaceBudgetEnforcer({ maxFiles: 1 });

		try {
			enforcer.checkBlastRadius("E.1", ["a.ts", "b.ts"], 10);
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(BudgetViolation);
			expect((error as BudgetViolation).violationType).toBe("blast_radius");
		}
	});
});

// ---------------------------------------------------------------------------
// AC3: Budget summary appears in dry-run and approval artifacts
// ---------------------------------------------------------------------------

describe("AC3: Budget summary appears in dry-run and approval artifacts", () => {
	it("should build a budget summary with all fields", () => {
		const enforcer = createWorkspaceBudgetEnforcer({
			maxFiles: 10,
			maxLines: 500,
			allowedPaths: ["src/**"],
			forbiddenPaths: ["**/.env*"],
			approvalExpiry: 300_000,
		});
		const packet = createTestPacket();
		const summary = enforcer.buildBudgetSummary(packet);

		expect(summary.maxInputTokens).toBe(10000);
		expect(summary.estimatedInputTokens).toBeGreaterThan(0);
		expect(summary.maxFiles).toBe(10);
		expect(summary.maxLines).toBe(500);
		expect(summary.allowedPaths).toEqual(["src/**"]);
		expect(summary.forbiddenPaths).toEqual(["**/.env*"]);
		expect(summary.approvalExpiry).toBe(300_000);
	});

	it("should indicate withinBudget when tokens are within limit", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		const summary = enforcer.buildBudgetSummary(packet);
		expect(summary.withinBudget).toBe(true);
	});

	it("should indicate over budget when tokens exceed limit", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		packet.budget.estimatedInputTokens = 99999;
		packet.budget.maxInputTokens = 100;
		const summary = enforcer.buildBudgetSummary(packet);
		expect(summary.withinBudget).toBe(false);
	});

	it("should use defaults when no packet is provided", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const summary = enforcer.buildBudgetSummary();
		expect(summary.maxInputTokens).toBe(12000);
		expect(summary.estimatedInputTokens).toBe(0);
		expect(summary.withinBudget).toBe(true);
	});

	it("should mark blast radius as ok by default", () => {
		const enforcer = createWorkspaceBudgetEnforcer({ maxFiles: 5 });
		const summary = enforcer.buildBudgetSummary();
		expect(summary.blastRadiusOk).toBe(true);
	});

	it("should use empty arrays for unset allowed/forbidden paths", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const summary = enforcer.buildBudgetSummary();
		expect(summary.allowedPaths).toEqual([]);
		expect(summary.forbiddenPaths).toEqual([]);
	});

	it("should use null for unset approval expiry", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const summary = enforcer.buildBudgetSummary();
		expect(summary.approvalExpiry).toBeNull();
	});

	it("should format a human-readable budget summary string", () => {
		const enforcer = createWorkspaceBudgetEnforcer({
			maxFiles: 5,
			maxLines: 200,
			allowedPaths: ["src/**"],
			forbiddenPaths: ["**/.env*"],
			approvalExpiry: 60_000,
		});
		const packet = createTestPacket();
		const summary = enforcer.buildBudgetSummary(packet);
		const formatted = enforcer.formatBudgetSummary(summary);

		// Should contain all the key sections
		expect(formatted).toContain("Budget & Blast-Radius Summary");
		expect(formatted).toContain("Token Budget");
		expect(formatted).toContain("Blast-Radius Controls");
		expect(formatted).toContain("Max Input Tokens");
		expect(formatted).toContain("Max Files");
		expect(formatted).toContain("Max Lines");
		expect(formatted).toContain("Allowed Paths");
		expect(formatted).toContain("Forbidden Paths");
		expect(formatted).toContain("Approval Expiry");
		expect(formatted).toContain("WITHIN BUDGET");
		expect(formatted).toContain("PASS");
	});

	it("should show OVER BUDGET in the formatted summary when over budget", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const packet = createTestPacket();
		packet.budget.estimatedInputTokens = 99999;
		packet.budget.maxInputTokens = 100;
		const summary = enforcer.buildBudgetSummary(packet);
		const formatted = enforcer.formatBudgetSummary(summary);
		expect(formatted).toContain("OVER BUDGET (BLOCKED)");
	});

	it("should show proper defaults when no limits are set", () => {
		const enforcer = createWorkspaceBudgetEnforcer({});
		const summary = enforcer.buildBudgetSummary();
		const formatted = enforcer.formatBudgetSummary(summary);
		expect(formatted).toContain("No limit");
		expect(formatted).toContain("All (no restriction)");
		expect(formatted).toContain("Never");
	});
});

// ---------------------------------------------------------------------------
// Configuration management
// ---------------------------------------------------------------------------

describe("BudgetEnforcer configuration management", () => {
	it("should allow partial updates to blast-radius config", () => {
		const enforcer = createWorkspaceBudgetEnforcer({ maxFiles: 5 });
		expect(enforcer.getBlastRadiusConfig().maxFiles).toBe(5);

		enforcer.updateBlastRadiusConfig({ maxLines: 200 });
		expect(enforcer.getBlastRadiusConfig().maxFiles).toBe(5);
		expect(enforcer.getBlastRadiusConfig().maxLines).toBe(200);
	});

	it("should allow partial updates to budget config", () => {
		const enforcer = createWorkspaceBudgetEnforcer({}, { maxInputTokens: 5000 });
		expect(enforcer.getBudgetConfig().maxInputTokens).toBe(5000);

		enforcer.updateBudgetConfig({ maxInputTokens: 10000 });
		expect(enforcer.getBudgetConfig().maxInputTokens).toBe(10000);
	});

	it("should use defaults when creating with no config", () => {
		const enforcer = createWorkspaceBudgetEnforcer();
		expect(enforcer.getBlastRadiusConfig().maxFiles).toBeUndefined();
		expect(enforcer.getBudgetConfig().maxInputTokens).toBe(12000);
	});

	it("should return readonly config snapshots", () => {
		const enforcer = createWorkspaceBudgetEnforcer({ maxFiles: 3 });
		const config = enforcer.getBlastRadiusConfig();
		expect(config.maxFiles).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Workspace schema integration validation
// ---------------------------------------------------------------------------

describe("BudgetViolation error", () => {
	it("should have the correct name", () => {
		const error = new BudgetViolation("budget", "test error");
		expect(error.name).toBe("BudgetViolation");
	});

	it("should set violationType correctly", () => {
		const budgetError = new BudgetViolation("budget", "budget exceeded");
		expect(budgetError.violationType).toBe("budget");

		const blastError = new BudgetViolation("blast_radius", "too many files");
		expect(blastError.violationType).toBe("blast_radius");
	});

	it("should set details from message when not provided", () => {
		const error = new BudgetViolation("budget", "budget exceeded");
		expect(error.details).toBe("budget exceeded");
	});

	it("should allow custom details", () => {
		const error = new BudgetViolation("budget", "budget exceeded", "Detailed explanation");
		expect(error.details).toBe("Detailed explanation");
	});
});
