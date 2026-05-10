/**
 * Tests for Context Budget Configuration - P1 Workstream 7.B
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	BudgetExceededError,
	ContextBudgetEnforcer,
	type ContextBudgetSettings,
	createBudgetEnforcer,
	DEFAULT_CONTEXT_BUDGETS,
} from "../src/context-budget.js";

describe("Context Budget Configuration", () => {
	describe("DEFAULT_CONTEXT_BUDGETS", () => {
		it("should have safe default values from P1 spec", () => {
			expect(DEFAULT_CONTEXT_BUDGETS.flash).toBe(4000);
			expect(DEFAULT_CONTEXT_BUDGETS.worker).toBe(12000);
			expect(DEFAULT_CONTEXT_BUDGETS.lead).toBe(24000);
			expect(DEFAULT_CONTEXT_BUDGETS.reviewer).toBe(16000);
			expect(DEFAULT_CONTEXT_BUDGETS.debug).toBe(24000);
			expect(DEFAULT_CONTEXT_BUDGETS.maxAuto).toBe(64000);
			expect(DEFAULT_CONTEXT_BUDGETS.millionContextEnabled).toBe(false);
			expect(DEFAULT_CONTEXT_BUDGETS.expensiveContextFlag).toBe("--expensive-context-1m");
		});
	});

	describe("ContextBudgetEnforcer", () => {
		let enforcer: ContextBudgetEnforcer;

		beforeEach(() => {
			enforcer = new ContextBudgetEnforcer();
		});

		describe("getBudgetForRole", () => {
			it("should return correct budget for each role", () => {
				expect(enforcer.getBudgetForRole("flash")).toBe(4000);
				expect(enforcer.getBudgetForRole("worker")).toBe(12000);
				expect(enforcer.getBudgetForRole("lead")).toBe(24000);
				expect(enforcer.getBudgetForRole("reviewer")).toBe(16000);
				expect(enforcer.getBudgetForRole("debug")).toBe(24000);
			});

			it("should return worker budget for unknown role", () => {
				expect(enforcer.getBudgetForRole("unknown")).toBe(12000);
			});
		});

		describe("checkBudget", () => {
			it("should pass when tokens are within budget", () => {
				const result = enforcer.checkBudget(10000, "worker");
				expect(result.passed).toBe(true);
				expect(result.estimatedTokens).toBe(10000);
				expect(result.budgetLimit).toBe(12000);
				expect(result.role).toBe("worker");
				expect(result.requiresEscalation).toBe(false);
			});

			it("should fail when tokens exceed role budget", () => {
				const result = enforcer.checkBudget(15000, "worker");
				expect(result.passed).toBe(false);
				expect(result.estimatedTokens).toBe(15000);
				expect(result.budgetLimit).toBe(12000);
				expect(result.role).toBe("worker");
				expect(result.reason).toContain("exceed");
				expect(result.reason).toContain("worker budget");
			});

			it("should fail when tokens exceed maxAuto without 1M context enabled", () => {
				const result = enforcer.checkBudget(70000, "lead");
				expect(result.passed).toBe(false);
				expect(result.estimatedTokens).toBe(70000);
				expect(result.budgetLimit).toBe(64000);
				expect(result.requiresEscalation).toBe(true);
				expect(result.reason).toContain("max automatic context");
				expect(result.reason).toContain("--expensive-context-1m");
			});

			it("should pass when tokens exceed maxAuto with 1M context enabled", () => {
				enforcer.updateSettings({ millionContextEnabled: true });
				const result = enforcer.checkBudget(70000, "lead");
				expect(result.passed).toBe(true);
				expect(result.requiresEscalation).toBe(true);
			});

			it("should use worker budget for unknown role", () => {
				const result = enforcer.checkBudget(10000, "unknown");
				expect(result.passed).toBe(true);
				expect(result.budgetLimit).toBe(12000);
			});

			it("should handle edge case at exact budget limit", () => {
				const result = enforcer.checkBudget(12000, "worker");
				expect(result.passed).toBe(true);
			});

			it("should handle edge case at exact maxAuto limit", () => {
				const result = enforcer.checkBudget(64000, "lead");
				expect(result.passed).toBe(true);
				expect(result.requiresEscalation).toBe(false);
			});
		});

		describe("requiresEscalation", () => {
			it("should return false when tokens are below maxAuto", () => {
				expect(enforcer.requiresEscalation(50000)).toBe(false);
			});

			it("should return true when tokens exceed maxAuto", () => {
				expect(enforcer.requiresEscalation(70000)).toBe(true);
			});

			it("should return false at exact maxAuto limit", () => {
				expect(enforcer.requiresEscalation(64000)).toBe(false);
			});
		});

		describe("isMillionContextEnabled", () => {
			it("should return false by default", () => {
				expect(enforcer.isMillionContextEnabled()).toBe(false);
			});

			it("should return true when enabled", () => {
				enforcer.updateSettings({ millionContextEnabled: true });
				expect(enforcer.isMillionContextEnabled()).toBe(true);
			});
		});

		describe("updateSettings", () => {
			it("should update partial settings", () => {
				enforcer.updateSettings({ worker: 15000 });
				expect(enforcer.getBudgetForRole("worker")).toBe(15000);
				expect(enforcer.getBudgetForRole("flash")).toBe(4000); // unchanged
			});

			it("should update multiple settings", () => {
				enforcer.updateSettings({
					worker: 15000,
					flash: 5000,
					millionContextEnabled: true,
				});
				expect(enforcer.getBudgetForRole("worker")).toBe(15000);
				expect(enforcer.getBudgetForRole("flash")).toBe(5000);
				expect(enforcer.isMillionContextEnabled()).toBe(true);
			});
		});

		describe("getSettings", () => {
			it("should return current settings", () => {
				const settings = enforcer.getSettings();
				expect(settings.worker).toBe(12000);
				expect(settings.flash).toBe(4000);
				expect(settings.millionContextEnabled).toBe(false);
			});

			it("should return a copy (not mutable)", () => {
				const settings = enforcer.getSettings();
				(settings as ContextBudgetSettings).worker = 99999;
				expect(enforcer.getBudgetForRole("worker")).toBe(12000);
			});
		});
	});

	describe("BudgetExceededError", () => {
		it("should create error with result", () => {
			const result = {
				passed: false,
				estimatedTokens: 15000,
				budgetLimit: 12000,
				role: "worker" as const,
				reason: "Budget exceeded",
				requiresEscalation: false,
			};
			const error = new BudgetExceededError(result);
			expect(error.result).toBe(result);
			expect(error.message).toBe("Budget exceeded");
			expect(error.name).toBe("BudgetExceededError");
		});

		it("should use custom message if provided", () => {
			const result = {
				passed: false,
				estimatedTokens: 15000,
				budgetLimit: 12000,
				role: "worker" as const,
				requiresEscalation: false,
			};
			const error = new BudgetExceededError(result, "Custom error message");
			expect(error.message).toBe("Custom error message");
		});
	});

	describe("createBudgetEnforcer", () => {
		it("should create enforcer with default settings", () => {
			const enforcer = createBudgetEnforcer();
			expect(enforcer.getBudgetForRole("worker")).toBe(12000);
		});

		it("should create enforcer with custom settings", () => {
			const enforcer = createBudgetEnforcer({ worker: 15000, flash: 5000 });
			expect(enforcer.getBudgetForRole("worker")).toBe(15000);
			expect(enforcer.getBudgetForRole("flash")).toBe(5000);
			expect(enforcer.getBudgetForRole("lead")).toBe(24000); // default
		});
	});

	describe("AC Verification - 7.B Context Budget Configuration", () => {
		it("AC: worker prompt over 12K is blocked by default", () => {
			const enforcer = new ContextBudgetEnforcer();
			const result = enforcer.checkBudget(13000, "worker");
			expect(result.passed).toBe(false);
		});

		it("AC: max_auto over 64K is blocked by default", () => {
			const enforcer = new ContextBudgetEnforcer();
			const result = enforcer.checkBudget(70000, "lead");
			expect(result.passed).toBe(false);
			expect(result.requiresEscalation).toBe(true);
		});

		it("AC: 1M context requires explicit expensive flag", () => {
			const enforcer = new ContextBudgetEnforcer();
			expect(enforcer.isMillionContextEnabled()).toBe(false);
			const result = enforcer.checkBudget(100000, "lead");
			expect(result.passed).toBe(false);
			expect(result.reason).toContain("--expensive-context-1m");
		});

		it("AC: all budget values come from config", () => {
			const customSettings = {
				flash: 5000,
				worker: 15000,
				lead: 30000,
				reviewer: 20000,
				debug: 25000,
				maxAuto: 70000,
				millionContextEnabled: false,
				expensiveContextFlag: "--custom-flag",
			};
			const enforcer = new ContextBudgetEnforcer(customSettings);
			expect(enforcer.getBudgetForRole("flash")).toBe(5000);
			expect(enforcer.getBudgetForRole("worker")).toBe(15000);
			expect(enforcer.getBudgetForRole("lead")).toBe(30000);
			expect(enforcer.getBudgetForRole("reviewer")).toBe(20000);
			expect(enforcer.getBudgetForRole("debug")).toBe(25000);
			expect(enforcer.getSettings().maxAuto).toBe(70000);
		});
	});
});
