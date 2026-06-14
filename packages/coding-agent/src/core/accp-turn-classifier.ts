/**
 * ACCP Turn Classifier (P49.14AA)
 *
 * Determines whether an assistant message is a casual conversation,
 * clarification, ACCP-governed task, or completion-bearing response.
 *
 * This classifier is used BEFORE applying required-mode missing-YAML
 * diagnostics so that casual greetings do not trigger false-positive
 * ACCP_REQUIRED_BUT_NO_YAML_OUTPUT failures.
 *
 * ## Design
 *
 * - Deterministic heuristic — no LLM calls.
 * - Uses keyword/routing patterns, active workspace/task state, and
 *   completion claim phrases.
 * - Does NOT distinguish by user message alone; considers both the
 *   user message (intent) and the assistant response (output).
 *
 * @packageDocumentation
 */

/** Turn classification result. */
export type AccpTurnClass =
	| "casual_conversation"
	| "clarification_or_question"
	| "accp_governed_task"
	| "completion_bearing_response";

/** Input to the classifier. */
export interface AccpTurnClassifierInput {
	/** The user's message text, if available. */
	userMessage: string;
	/** The assistant's output text (the concatenated text blocks). */
	assistantOutput: string;
	/** Whether there is an active ACCP task envelope (picker was used). */
	hasTaskEnvelope: boolean;
	/** Whether the session has active tools / is executing a task. */
	hasActiveTools: boolean;
	/** Whether we are in completion or promotion flow. */
	isCompletionClaim: boolean;
	/** Current ACCP mode. */
	accpMode: "off" | "warn" | "required";
}

/** Guided-turn keywords that suggest a governed task intent. */
const GOVERNED_TASK_TRIGGERS = [
	"audit",
	"verify",
	"inspect",
	"analyze",
	"implement",
	"execute",
	"run",
	"compile",
	"build",
	"generate",
	"produce",
	"create",
	"fix",
	"repair",
	"patch",
	"validate",
	"test",
	"promote",
	"deploy",
	"release",
	"complete",
	"finish",
];

/** Completion-claim phrases in assistant output. */
const COMPLETION_CLAIM_PHRASES = [
	"done",
	"implemented",
	"tests pass",
	"tests passed",
	"ready to promote",
	"ready to deploy",
	"workspace complete",
	"feature is complete",
	"the fix is complete",
	"all done",
	"PASS",
	"RESULT: PASS",
	"status: pass",
	"verdict: pass",
	"no blockers",
	"no blocking findings",
];

/** Casual conversation patterns (user side). */
const CASUAL_USER_PATTERNS = [
	/^(hi|hello|hey|yo|sup)\b/i,
	/^(thanks|thank you|ty|thx)\b/i,
	/^what can you do\b/i,
	/^(ok|okay|sure|alright|got it)\b/i,
	/^(good|great|nice|awesome)\b/i,
	/^(how are you|what's up|whats up)\b/i,
	/^(bye|goodbye|see you|later)\b/i,
];

/** Clarification patterns (assistant side — questions). */
const CLARIFICATION_QUESTION_PATTERNS = [
	/which\s+(file|report|mode|type|option)/i,
	/\?(?!\s*(done|complete|pass))/i, // question mark that's not a completion marker
	/do you want/i,
	/please choose/i,
	/should I/i,
	/can you clarify/i,
	/not clear/i,
];

/**
 * Classify an assistant turn for ACCP diagnostic purposes.
 *
 * Returns one of four classifications. Callers should use this result
 * to decide whether to emit ACCP_REQUIRED_BUT_NO_YAML_OUTPUT.
 *
 * @param input - The classifier input (user message, assistant output, session state).
 * @returns The determined turn class.
 */
export function classifyAccpTurn(input: AccpTurnClassifierInput): AccpTurnClass {
	const { userMessage, assistantOutput, hasTaskEnvelope, hasActiveTools, isCompletionClaim, accpMode } = input;

	// 1. If user message is clearly casual (greeting, thanks, ok), classify as casual
	if (CASUAL_USER_PATTERNS.some((p) => p.test(userMessage.trim()))) {
		// But only if assistant output doesn't look like a task response
		if (!assistantOutputContainsGovernedIndicators(assistantOutput)) {
			return "casual_conversation";
		}
	}

	// 2. If assistant output is a question or seeks clarification
	if (CLARIFICATION_QUESTION_PATTERNS.some((p) => p.test(assistantOutput)) && !hasActiveTools) {
		return "clarification_or_question";
	}

	// 3. If this is a completion/promotion claim
	if (isCompletionClaim || COMPLETION_CLAIM_PHRASES.some((p) => assistantOutput.toLowerCase().includes(p))) {
		// If assistant output contains actual ACCP markers, it's a proper completion
		if (assistantOutput.includes("accp_version:") || assistantOutput.includes("source_format:")) {
			return "accp_governed_task"; // Will compile normally
		}
		return "completion_bearing_response";
	}

	// 4. If there is an ACCP task envelope, this is likely a governed task
	if (hasTaskEnvelope || hasActiveTools) {
		return "accp_governed_task";
	}

	// 5. If user message contains governed task keywords
	if (GOVERNED_TASK_TRIGGERS.some((t) => userMessage.toLowerCase().includes(t))) {
		return "accp_governed_task";
	}

	// 6. If the assistant output is very short and conversational, treat as casual
	if (assistantOutput.length < 80 && !assistantOutput.includes("\n")) {
		return "casual_conversation";
	}

	// 7. In required mode with no strong signal, prefer governed task over silence
	//    (warn mode can default to casual; required mode should be more strict)
	if (accpMode === "required") {
		// Check if assistant output contains anything task-like
		if (assistantOutputContainsGovernedIndicators(assistantOutput)) {
			return "accp_governed_task";
		}
		// Short single-line responses are still likely casual
		if (assistantOutput.length < 150 && !assistantOutput.includes(":")) {
			return "casual_conversation";
		}
		return "accp_governed_task";
	}

	// 8. Default: for warn/off mode, be lenient
	return "casual_conversation";
}

/**
 * Check if assistant output contains indicators of a governed task response.
 */
function assistantOutputContainsGovernedIndicators(output: string): boolean {
	const lower = output.toLowerCase();
	// ACCP markers
	if (lower.includes("accp_version") || lower.includes("source_format") || lower.includes("report_type")) {
		return true;
	}
	// Structured output indicators
	if (lower.includes("evidence:") || lower.includes("findings:") || lower.includes("analysis:")) {
		return true;
	}
	// Governance keywords
	if (
		lower.includes("compilation result") ||
		lower.includes("gate verdict") ||
		lower.includes("blocking finding") ||
		lower.includes("diagnostic")
	) {
		return true;
	}
	return false;
}
