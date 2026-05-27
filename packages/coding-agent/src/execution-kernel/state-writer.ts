import type { AttemptState, AttemptTransitionResult, StateAuthorityToken } from "./types.js";

export interface StateWriter {
	transition(
		token: StateAuthorityToken,
		nextState: AttemptState,
		expectedVersion: number,
	): Promise<AttemptTransitionResult>;
}
