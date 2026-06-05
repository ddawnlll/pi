import type { StateAuthorityToken } from "./types.js";

export function createStateAuthorityToken(attemptId: string, controllerId: string): StateAuthorityToken {
	return { attemptId, controllerId, issuedAt: Date.now() };
}
