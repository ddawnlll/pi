import { describe, expect, it } from "vitest";
import type { Proposal } from "../src/core/proposal-inbox.js";
import { validateProposalForControllerAction } from "../src/core/proposal-inbox.js";

describe("P29 proposal inbox validation", () => {
	it("rejects missing proposal", () => {
		expect(validateProposalForControllerAction(undefined)).toEqual({ ok: false, error: "Proposal not found" });
	});

	it("rejects non-approved proposal", () => {
		const proposal = {
			id: "prop-1",
			title: "x",
			phase: "P1",
			status: "pending",
			evidence: { plannerOutput: {} as any, queue: { title: "q", phase: "P1", workspaces: [] } as any },
			auditTrail: [],
			submittedAt: Date.now(),
		} satisfies Proposal;
		expect(validateProposalForControllerAction(proposal).ok).toBe(false);
	});

	it("accepts approved proposal with workspace evidence", () => {
		const proposal = {
			id: "prop-2",
			title: "x",
			phase: "P1",
			status: "approved",
			evidence: {
				plannerOutput: {} as any,
				queue: {
					title: "q",
					phase: "P1",
					workspaces: [{ id: "w1", title: "t", dependencies: [], roleBudget: "worker", maxRetries: 1 }],
				} as any,
			},
			auditTrail: [],
			submittedAt: Date.now(),
		} satisfies Proposal;
		expect(validateProposalForControllerAction(proposal)).toEqual({ ok: true });
	});
});
