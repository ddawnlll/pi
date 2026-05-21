/**
 * Decision Classifier — P15.D tests.
 *
 * Covers:
 * - Default rules classify common actions correctly
 * - Priority ordering (higher priority evaluated first)
 * - Context-aware conditions
 * - Confidence-based override
 * - Rule management (add, remove, get, set rules)
 * - Helper queries (isAutoDecide, isApprovalRequired, isNeverAutoDecide)
 * - Audit log entries
 * - Fallback behavior
 */

import { describe, expect, test } from "vitest";
import { type ClassificationContext, DecisionClassifier } from "../../../src/brain/goals/decisions.js";
import type { DecisionRule } from "../../../src/brain/goals/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultContext(overrides?: Partial<ClassificationContext>): ClassificationContext {
	return {
		autonomyLevel: 3,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Default Rules
// ---------------------------------------------------------------------------

describe("DecisionClassifier default rules", () => {
	test("auto_decide: retry_transient_failure", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("retry_transient_failure", defaultContext());
		expect(result.decisionClass).toBe("auto_decide");
		expect(result.policyRefs).toContain("auto_001");
	});

	test("auto_decide: generate_draft_proposal", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("generate_draft_proposal", defaultContext());
		expect(result.decisionClass).toBe("auto_decide");
		expect(result.policyRefs).toContain("auto_002");
	});

	test("auto_decide: create_read_only_summary", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("create_read_only_summary", defaultContext());
		expect(result.decisionClass).toBe("auto_decide");
		expect(result.policyRefs).toContain("auto_003");
	});

	test("auto_decide: low_risk_queue_reorder with low risk", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("low_risk_queue_reorder", defaultContext({ riskLevel: "low" }));
		expect(result.decisionClass).toBe("auto_decide");
		expect(result.policyRefs).toContain("auto_004");
	});

	test("approval_required: low_risk_queue_reorder with high risk (condition fail)", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("low_risk_queue_reorder", defaultContext({ riskLevel: "high" }));
		// No condition match + no unconditional rule = fallback
		expect(result.decisionClass).toBe("approval_required");
	});

	test("approval_required: execute_generated_plan", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("execute_generated_plan", defaultContext());
		expect(result.decisionClass).toBe("approval_required");
		expect(result.requiresApprovalFrom).toBe("user");
		expect(result.policyRefs).toContain("appr_001");
	});

	test("approval_required: protected_system_mutation", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("protected_system_mutation", defaultContext());
		expect(result.decisionClass).toBe("approval_required");
		expect(result.policyRefs).toContain("appr_002");
	});

	test("approval_required: memory_index_sensitive_source", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("memory_index_sensitive_source", defaultContext());
		expect(result.decisionClass).toBe("approval_required");
		expect(result.policyRefs).toContain("appr_003");
	});

	test("approval_required: architecture_change", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("architecture_change", defaultContext());
		expect(result.decisionClass).toBe("approval_required");
		expect(result.policyRefs).toContain("appr_004");
	});

	test("approval_required: extension_permission_expansion", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("extension_permission_expansion", defaultContext());
		expect(result.decisionClass).toBe("approval_required");
		expect(result.policyRefs).toContain("appr_005");
	});

	test("never_auto_decide: secret_access", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("secret_access", defaultContext());
		expect(result.decisionClass).toBe("never_auto_decide");
		expect(result.policyRefs).toContain("forbid_001");
	});

	test("never_auto_decide: destructive_cleanup", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("destructive_cleanup", defaultContext());
		expect(result.decisionClass).toBe("never_auto_decide");
		expect(result.policyRefs).toContain("forbid_002");
	});

	test("never_auto_decide: git_push", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("git_push", defaultContext());
		expect(result.decisionClass).toBe("never_auto_decide");
		expect(result.policyRefs).toContain("forbid_003");
	});

	test("never_auto_decide: irreversible_deletion", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("irreversible_deletion", defaultContext());
		expect(result.decisionClass).toBe("never_auto_decide");
		expect(result.policyRefs).toContain("forbid_004");
	});

	test("never_auto_decide: bypass_validation_gate", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("bypass_validation_gate", defaultContext());
		expect(result.decisionClass).toBe("never_auto_decide");
		expect(result.policyRefs).toContain("forbid_005");
	});
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

describe("fallback behavior", () => {
	test("unknown action defaults to approval_required", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("unknown_action", defaultContext());
		expect(result.decisionClass).toBe("approval_required");
		expect(result.policyRefs).toEqual([]);
		expect(result.confidence).toBe(0.5);
		expect(result.rationale).toContain("unknown_action");
	});
});

// ---------------------------------------------------------------------------
// Priority Ordering
// ---------------------------------------------------------------------------

describe("priority ordering", () => {
	test("higher priority rule evaluated first", () => {
		const dc = new DecisionClassifier();
		// Replace rules with overlapping actions
		dc.setRules([
			{
				id: "high_pri",
				action: "some_action",
				decisionClass: "never_auto_decide",
				priority: 500,
				description: "High priority: block",
			},
			{
				id: "low_pri",
				action: "some_action",
				decisionClass: "auto_decide",
				priority: 100,
				description: "Low priority: allow",
			},
		]);
		const result = dc.classifyWithContext("some_action", defaultContext());
		expect(result.decisionClass).toBe("never_auto_decide");
		expect(result.policyRefs).toContain("high_pri");
	});
});

// ---------------------------------------------------------------------------
// Condition Evaluation
// ---------------------------------------------------------------------------

describe("condition evaluation", () => {
	test("rule with matching condition is applied", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "cond_test",
			action: "conditional_action",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Only when system is idle",
			conditions: [{ field: "systemState", operator: "eq", value: "idle" }],
		});
		const result = dc.classifyWithContext("conditional_action", defaultContext({ systemState: "idle" }));
		expect(result.decisionClass).toBe("auto_decide");
	});

	test("rule with non-matching condition falls through", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "cond_test",
			action: "conditional_action",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Only when system is idle",
			conditions: [{ field: "systemState", operator: "eq", value: "idle" }],
		});
		const result = dc.classifyWithContext("conditional_action", defaultContext({ systemState: "executing" }));
		expect(result.decisionClass).toBe("approval_required");
	});

	test("rule without conditions matches regardless", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "no_cond",
			action: "unconditional_action",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Always allowed",
		});
		const result = dc.classifyWithContext("unconditional_action", defaultContext({ systemState: "executing" }));
		expect(result.decisionClass).toBe("auto_decide");
	});

	test("classify (without context) ignores conditions", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "cond_test",
			action: "conditional_action",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Only when system is idle",
			conditions: [{ field: "systemState", operator: "eq", value: "idle" }],
		});
		// classify() ignores conditions, so it should match even without the condition
		const result = dc.classify("conditional_action", defaultContext({ systemState: "executing" }));
		expect(result.decisionClass).toBe("auto_decide");
	});

	test("neq operator", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "neq_test",
			action: "action",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Not when critical",
			conditions: [{ field: "riskLevel", operator: "neq", value: "critical" }],
		});
		expect(dc.classifyWithContext("action", defaultContext({ riskLevel: "low" })).decisionClass).toBe("auto_decide");
		expect(dc.classifyWithContext("action", defaultContext({ riskLevel: "critical" })).decisionClass).toBe(
			"approval_required",
		);
	});

	test("in operator", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "in_test",
			action: "action",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Allowed risks",
			conditions: [{ field: "riskLevel", operator: "in", value: ["low", "medium"] }],
		});
		expect(dc.classifyWithContext("action", defaultContext({ riskLevel: "low" })).decisionClass).toBe("auto_decide");
		expect(dc.classifyWithContext("action", defaultContext({ riskLevel: "high" })).decisionClass).toBe(
			"approval_required",
		);
	});

	test("contains operator", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "contains_test",
			action: "action",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Affects memory",
			conditions: [{ field: "affectedArea", operator: "contains", value: "memory" }],
		});
		expect(dc.classifyWithContext("action", defaultContext({ affectedArea: "memory_core" })).decisionClass).toBe(
			"auto_decide",
		);
		expect(dc.classifyWithContext("action", defaultContext({ affectedArea: "filesystem" })).decisionClass).toBe(
			"approval_required",
		);
	});
});

// ---------------------------------------------------------------------------
// Confidence Override
// ---------------------------------------------------------------------------

describe("confidence override", () => {
	test("auto_decide with high confidence stays auto_decide", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("retry_transient_failure", defaultContext({ confidence: 0.9 }));
		expect(result.decisionClass).toBe("auto_decide");
	});

	test("auto_decide with low confidence downgrades to approval_required", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("retry_transient_failure", defaultContext({ confidence: 0.5 }));
		expect(result.decisionClass).toBe("approval_required");
		expect(result.rationale).toContain("Downgraded from auto_decide");
		expect(result.confidence).toBe(0.5);
	});

	test("exact threshold is NOT downgraded (>= threshold)", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("retry_transient_failure", defaultContext({ confidence: 0.85 }));
		expect(result.decisionClass).toBe("auto_decide");
	});

	test("approval_required is not affected by confidence", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("execute_generated_plan", defaultContext({ confidence: 0.3 }));
		expect(result.decisionClass).toBe("approval_required");
	});

	test("never_auto_decide is not affected by confidence", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("secret_access", defaultContext({ confidence: 0.9 }));
		expect(result.decisionClass).toBe("never_auto_decide");
	});

	test("setAutoDecideConfidenceThreshold changes threshold", () => {
		const dc = new DecisionClassifier();
		dc.setAutoDecideConfidenceThreshold(0.9);
		// 0.85 is now below the new threshold
		const result = dc.classifyWithContext("retry_transient_failure", defaultContext({ confidence: 0.85 }));
		expect(result.decisionClass).toBe("approval_required");
		expect(dc.getAutoDecideConfidenceThreshold()).toBe(0.9);
	});

	test("default threshold is 0.85", () => {
		const dc = new DecisionClassifier();
		expect(dc.getAutoDecideConfidenceThreshold()).toBe(0.85);
	});
});

// ---------------------------------------------------------------------------
// Rule Management
// ---------------------------------------------------------------------------

describe("rule management", () => {
	test("addRule adds a new rule", () => {
		const dc = new DecisionClassifier();
		const initialCount = dc.getRules().length;
		dc.addRule({
			id: "custom_rule",
			action: "custom_action",
			decisionClass: "auto_decide",
			priority: 50,
			description: "Custom rule",
		});
		expect(dc.getRules().length).toBe(initialCount + 1);
	});

	test("removeRule removes existing rule", () => {
		const dc = new DecisionClassifier();
		dc.addRule({
			id: "temp_rule",
			action: "temp_action",
			decisionClass: "auto_decide",
			priority: 50,
			description: "Temporary",
		});
		expect(dc.removeRule("temp_rule")).toBe(true);
		expect(dc.removeRule("non_existent")).toBe(false);
	});

	test("setRules replaces all rules", () => {
		const dc = new DecisionClassifier();
		const newRules: DecisionRule[] = [
			{
				id: "only_rule",
				action: "only_action",
				decisionClass: "never_auto_decide",
				priority: 999,
				description: "Only rule",
			},
		];
		dc.setRules(newRules);
		expect(dc.getRules().length).toBe(1);
		expect(dc.getRules()[0].id).toBe("only_rule");
		// Default rules are gone
		const result = dc.classifyWithContext("retry_transient_failure", defaultContext());
		expect(result.decisionClass).toBe("approval_required"); // fallback
	});

	test("getRules returns a copy", () => {
		const dc = new DecisionClassifier();
		const rules = dc.getRules();
		rules.length = 0; // mutate the copy
		expect(dc.getRules().length).toBeGreaterThan(0); // original unaffected
	});
});

// ---------------------------------------------------------------------------
// Helper Queries
// ---------------------------------------------------------------------------

describe("helper queries", () => {
	test("isAutoDecide returns true for auto actions", () => {
		const dc = new DecisionClassifier();
		expect(dc.isAutoDecide("retry_transient_failure", defaultContext())).toBe(true);
		expect(dc.isAutoDecide("secret_access", defaultContext())).toBe(false);
	});

	test("isApprovalRequired returns true for approval actions", () => {
		const dc = new DecisionClassifier();
		expect(dc.isApprovalRequired("execute_generated_plan", defaultContext())).toBe(true);
		expect(dc.isApprovalRequired("retry_transient_failure", defaultContext())).toBe(false);
	});

	test("isNeverAutoDecide returns true for forbidden actions", () => {
		const dc = new DecisionClassifier();
		expect(dc.isNeverAutoDecide("secret_access", defaultContext())).toBe(true);
		expect(dc.isNeverAutoDecide("retry_transient_failure", defaultContext())).toBe(false);
	});

	test("helpers work without context argument", () => {
		const dc = new DecisionClassifier();
		expect(dc.isAutoDecide("retry_transient_failure")).toBe(true);
		expect(dc.isApprovalRequired("execute_generated_plan")).toBe(true);
		expect(dc.isNeverAutoDecide("secret_access")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

describe("audit log", () => {
	test("classify produces an audit entry", () => {
		const dc = new DecisionClassifier();
		dc.classifyWithContext("retry_transient_failure", defaultContext());
		const log = dc.getAuditLog();
		expect(log.length).toBe(1);
		expect(log[0].action).toBe("retry_transient_failure");
		expect(log[0].decisionClass).toBe("auto_decide");
		expect(log[0].matchedRule).toBe("auto_001");
		expect(log[0].id).toBeDefined();
		expect(log[0].timestamp).toBeDefined();
	});

	test("multiple classifications produce multiple audit entries", () => {
		const dc = new DecisionClassifier();
		dc.classifyWithContext("retry_transient_failure", defaultContext());
		dc.classifyWithContext("secret_access", defaultContext());
		dc.classifyWithContext("unknown_action", defaultContext());
		expect(dc.getAuditLog().length).toBe(3);
	});

	test("clearAuditLog empties the log", () => {
		const dc = new DecisionClassifier();
		dc.classifyWithContext("retry_transient_failure", defaultContext());
		dc.clearAuditLog();
		expect(dc.getAuditLog().length).toBe(0);
	});

	test("getAuditLog returns a copy", () => {
		const dc = new DecisionClassifier();
		dc.classifyWithContext("retry_transient_failure", defaultContext());
		const log = dc.getAuditLog();
		log.length = 0;
		expect(dc.getAuditLog().length).toBe(1);
	});

	test("fallback creates audit entry with matchedRule 'fallback'", () => {
		const dc = new DecisionClassifier();
		dc.classifyWithContext("unknown_action", defaultContext());
		const log = dc.getAuditLog();
		expect(log[0].matchedRule).toBe("fallback");
		expect(log[0].decisionClass).toBe("approval_required");
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("action name is case-sensitive", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("Retry_Transient_Failure", defaultContext());
		expect(result.decisionClass).toBe("approval_required"); // fallback, no match
	});

	test("multiple rules with same priority — first added wins", () => {
		const dc = new DecisionClassifier();
		dc.setRules([
			{
				id: "first",
				action: "tie_action",
				decisionClass: "auto_decide",
				priority: 100,
				description: "First",
			},
			{
				id: "second",
				action: "tie_action",
				decisionClass: "never_auto_decide",
				priority: 100,
				description: "Second",
			},
		]);
		// After sort (stable sort), 'first' was added first so it's first in array
		const result = dc.classifyWithContext("tie_action", defaultContext());
		expect(result.policyRefs).toContain("first");
	});

	test("output fields are populated correctly", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("secret_access", defaultContext());
		expect(result.action).toBe("secret_access");
		expect(result.decisionClass).toBe("never_auto_decide");
		expect(result.confidence).toBe(1.0);
		expect(result.policyRefs).toEqual(["forbid_001"]);
		expect(result.rationale).toBe("Access secrets");
		expect(result.autonomyLevel).toBe(3);
		expect(result.requiresApprovalFrom).toBeUndefined();
	});

	test("approval_required includes requiresApprovalFrom", () => {
		const dc = new DecisionClassifier();
		const result = dc.classifyWithContext("execute_generated_plan", defaultContext());
		expect(result.requiresApprovalFrom).toBe("user");
	});
});
