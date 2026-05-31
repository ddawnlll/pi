import type { AttemptState, HandoffQueueRow } from "./types.js";

export function planCompletionPredicate(
	workspaces: Array<{ required: boolean; state: AttemptState; handoff?: HandoffQueueRow | null }>,
	options?: { finalValidationFailed?: boolean },
): AttemptState {
	if (workspaces.some((w) => w.required && w.handoff && w.handoff.required && w.handoff.status !== "complete")) {
		return "HANDOFF_REQUIRED";
	}
	if (options?.finalValidationFailed) return "FAILED_FINAL";
	if (workspaces.some((w) => w.required && w.state === "FAILED_FINAL")) return "FAILED_FINAL";
	if (workspaces.every((w) => !w.required || w.state === "SUCCEEDED")) return "FINAL_VALIDATION";
	return "RUNNING";
}
