import { describe, expect, it } from "vitest";
import { createStateAuthorityToken } from "../../src/execution-kernel/state-authority.js";
import type { StateWriter } from "../../src/execution-kernel/state-writer.js";

describe("state-writer", () => {
	it("transition requires StateAuthorityToken", async () => {
		const writer: StateWriter = {
			async transition(token, _nextState, _expectedVersion) {
				if (!token || !token.attemptId || !token.controllerId || !token.issuedAt) {
					throw new Error("invalid token");
				}
				return { state: "SUCCEEDED", version: 2, deadlineAt: null };
			},
		};

		const token = createStateAuthorityToken("a1", "c1");
		await expect(writer.transition(token, "SUCCEEDED", 1)).resolves.not.toThrow();
	});

	it("rejects transition with incomplete token", async () => {
		const writer: StateWriter = {
			async transition(token, _nextState, _expectedVersion) {
				if (!token || !token.attemptId || !token.controllerId || !token.issuedAt) {
					throw new Error("invalid token");
				}
				return { state: "SUCCEEDED", version: 2, deadlineAt: null };
			},
		};

		const fakeToken = { attemptId: "a1", controllerId: "c1" } as any;
		await expect(writer.transition(fakeToken, "SUCCEEDED", 1)).rejects.toThrow("invalid token");
	});
});
