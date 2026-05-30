import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("packages/coding-agent/src/core/autonomous-executor.ts", "utf-8");

describe("stale_success_after_continue_is_ignored", () => {
	it("guards completion transitions with fresh DB state before the router", () => {
		const guardIndex = source.indexOf("const preTransitionStale");
		const completeTransitionIndex = source.indexOf("WorkspaceStage.Complete", guardIndex);

		expect(guardIndex).toBeGreaterThan(-1);
		expect(completeTransitionIndex).toBeGreaterThan(guardIndex);
		expect(source).toContain("await this.isAttemptStale(planExecutionId, workspace.id, currentAttemptNo)");
		expect(source).toContain("stale_attempt_completion_ignored");
		expect(source).toContain("illegal_transition_prevented_before_router");
	});
});
