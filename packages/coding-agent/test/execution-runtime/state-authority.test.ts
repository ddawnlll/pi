import { describe, expect, it } from "vitest";
import { createStateAuthorityToken } from "../../src/execution-runtime/state-authority.js";

describe("state-authority", () => {
	it("creates token with attemptId and controllerId", () => {
		const token = createStateAuthorityToken("a1", "c1");
		expect(token.attemptId).toBe("a1");
		expect(token.controllerId).toBe("c1");
		expect(typeof token.issuedAt).toBe("number");
	});

	it("each token has unique issuedAt", () => {
		const t1 = createStateAuthorityToken("a1", "c1");
		const t2 = createStateAuthorityToken("a1", "c1");
		expect(t2.issuedAt).toBeGreaterThanOrEqual(t1.issuedAt);
	});

	it("creates token only through exported helper", () => {
		const token = createStateAuthorityToken("a1", "c1");
		expect(token.attemptId).toBe("a1");
		expect(token.controllerId).toBe("c1");
	});
});
