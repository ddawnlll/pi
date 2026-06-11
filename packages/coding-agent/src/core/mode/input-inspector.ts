/**
 * P44.6.05 — Input Inspector for Write/Edit Intent
 *
 * Classifies natural-language prompts into one of four intent categories:
 * creation, scoped_mutation, audit_then_mutate, or route_then_create.
 *
 * The inspector uses deterministic rules (keyword analysis, pattern matching)
 * to classify prompts. It does NOT use LLM inference for classification.
 * The LLM is only used to provide the raw prompt that the inspector analyzes.
 *
 * Contract Schema: 4.1.1
 */

import type { ModeDiagnostic } from "./mode-diagnostic.js";
import {
	addAmbiguity,
	createTaskIntentEnvelope,
	setMutationIntent,
	type TaskIntentEnvelope,
} from "./task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Inspection Result
// ---------------------------------------------------------------------------

/**
 * The result of inspecting a raw prompt.
 */
export interface InspectionResult {
	/**
	 * The populated TaskIntentEnvelope with parsed intent, paths, and signals.
	 */
	envelope: TaskIntentEnvelope;

	/**
	 * Diagnostics from the inspection process.
	 */
	diagnostics: ModeDiagnostic[];

	/**
	 * Whether inspection was successful (no blocking issues).
	 */
	success: boolean;
}

// ---------------------------------------------------------------------------
// Pattern Definitions
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate a create/write intent.
 */
const CREATE_PATTERNS = [
	/\b(create|make|generate|write|new|add)\b/i,
	/\b(create|make|generate|write)\s+(a\s+|an\s+|the\s+)?(file|component|function|class|module|page|route|api|endpoint|controller|service|test)\b/i,
	/\binitialize\b/i,
	/\bbootstrap\b/i,
	/\bscaffold\b/i,
];

/**
 * Patterns that indicate an edit/modify intent.
 */
const EDIT_PATTERNS = [
	/\b(edit|modify|update|change|fix|improve|refactor|rewrite|replace|patch)\b/i,
	/\b(edit|modify|update|change|fix)\s+(the\s+|this\s+)?(file|component|function|class|module|page|route|api)\b/i,
	/\b(change|replace|update)\s+(import|export|type|interface|implementation)\b/i,
	/\brefactor\b/i,
	/\brewrite\b/i,
	/\brefactor\s+(the\s+|this\s+)?/i,
];

/**
 * Patterns that indicate an audit-then-mutate (smart edit) intent.
 */
const AUDIT_THEN_MUTATE_PATTERNS = [
	/\baudit\s+(and\s+)?(fix|repair|update|improve|patch)\b/i,
	/\binspect\s+(and\s+)?(fix|repair|update|improve|patch)\b/i,
	/\breview\s+(and\s+)?(fix|repair|update|improve|patch)\b/i,
	/\banalyze\s+(and\s+)?(fix|repair|update|improve|patch)\b/i,
	/\bcheck\s+(for\s+)?(issues|problems|bugs|errors)\s+(and\s+)?(fix|repair|update)\b/i,
	/\bsmart.?edit\b/i,
	/\baudit.?then.?mutate\b/i,
];

/**
 * Patterns that indicate a route-then-create (smart write) intent.
 */
const ROUTE_THEN_CREATE_PATTERNS = [
	/\b(plan|design|architect|spec)\s+(and\s+)?(create|generate|write|implement)\b/i,
	/\bsmart.?write\b/i,
	/\broute.?then.?create\b/i,
	/\bgenerate\s+(a\s+|an\s+)?(plan|spec|schema|blueprint|design)\b/i,
	/\bcreate\s+(a\s+|an\s+)?(plan|spec|schema|blueprint|design)\s+(for|of)\b/i,
];

/**
 * Patterns for extracting target file paths.
 */
const TARGET_PATH_PATTERNS = [
	/\b(src\/[^\s,]+)/gi,
	/\b(packages\/[^\s,]+)/gi,
	/\b(lib\/[^\s,]+)/gi,
	/\b(app\/[^\s,]+)/gi,
	/\b([^\s]+\.(ts|js|tsx|jsx|json|css|html|yaml|yml|md))\b/gi,
];

/**
 * Patterns for detecting ambiguity signals.
 */
const AMBIGUITY_PATTERNS: Array<{
	code:
		| "missing_target_path"
		| "unclear_target_existence"
		| "unclear_mutation_intent"
		| "multiple_interpretations"
		| "unclear_overwrite_policy";
	pattern: RegExp;
	message: string;
	blocking: boolean;
}> = [
	{
		code: "unclear_mutation_intent",
		pattern: /\b(do\s+(something|this|that|work)|handle|process|deal\s+with)\b/i,
		message:
			"Mutation intent is unclear from the prompt. Specify whether this is a create, edit, or audit operation.",
		blocking: true,
	},
	{
		code: "multiple_interpretations",
		pattern: /\b(maybe|perhaps|either|or\s+something|something\s+like)\b/i,
		message: "Prompt contains multiple possible interpretations.",
		blocking: true,
	},
	{
		code: "unclear_overwrite_policy",
		pattern: /\b(overwrite|replace|override)(\s+\w+)?\s+(existing|current|old)\b/i,
		message: "Prompt mentions overwriting but no explicit overwrite policy was specified.",
		blocking: false,
	},
];

// ---------------------------------------------------------------------------
// Intent Classification
// ---------------------------------------------------------------------------

/**
 * Classify a prompt into an intent category based on pattern matching.
 * Returns the mutation intent string or null if undetermined.
 */
function classifyIntent(prompt: string): "create" | "modify" | "audit_then_mutate" | "route_then_create" | null {
	// Check more specific patterns first
	if (matchesAny(AUDIT_THEN_MUTATE_PATTERNS, prompt)) {
		return "audit_then_mutate";
	}

	if (matchesAny(ROUTE_THEN_CREATE_PATTERNS, prompt)) {
		return "route_then_create";
	}

	// Check for combined create/edit patterns
	const hasCreate = matchesAny(CREATE_PATTERNS, prompt);
	const hasEdit = matchesAny(EDIT_PATTERNS, prompt);

	if (hasCreate && !hasEdit) {
		return "create";
	}

	if (hasEdit && !hasCreate) {
		return "modify";
	}

	// Ambiguous — both or neither
	return null;
}

/**
 * Check if any pattern matches the prompt.
 */
function matchesAny(patterns: RegExp[], prompt: string): boolean {
	return patterns.some((pattern) => pattern.test(prompt));
}

/**
 * Extract all target file paths from the prompt.
 */
function extractTargetPaths(prompt: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();

	for (const pattern of TARGET_PATH_PATTERNS) {
		const matches = prompt.matchAll(pattern);
		for (const match of matches) {
			const path = match[1].trim();
			if (!seen.has(path)) {
				seen.add(path);
				paths.push(path);
			}
		}
	}

	return paths;
}

/**
 * Detect ambiguity signals from the prompt.
 */
function detectAmbiguities(
	prompt: string,
	intent: string | null,
	paths: string[],
): Array<{
	code:
		| "missing_target_path"
		| "unclear_target_existence"
		| "unclear_mutation_intent"
		| "multiple_interpretations"
		| "unclear_overwrite_policy";
	message: string;
	blocking: boolean;
	triggerPhrase?: string;
}> {
	const signals: Array<{
		code:
			| "missing_target_path"
			| "unclear_target_existence"
			| "unclear_mutation_intent"
			| "multiple_interpretations"
			| "unclear_overwrite_policy";
		message: string;
		blocking: boolean;
		triggerPhrase?: string;
	}> = [];

	// Check for missing target path when intent requires one
	if (intent && intent !== "route_then_create" && paths.length === 0) {
		signals.push({
			code: "missing_target_path",
			message: `No target file path found in the prompt for ${intent} intent.`,
			blocking: true,
		});
	}

	// Check for unclear mutation intent
	if (!intent) {
		signals.push({
			code: "unclear_mutation_intent",
			message: "Cannot determine mutation intent from the prompt.",
			blocking: true,
		});
	}

	// Check pattern-based ambiguity signals
	for (const ap of AMBIGUITY_PATTERNS) {
		const match = prompt.match(ap.pattern);
		if (match) {
			signals.push({
				code: ap.code,
				message: ap.message,
				blocking: ap.blocking,
				triggerPhrase: match[0],
			});
		}
	}

	return signals;
}

// ---------------------------------------------------------------------------
// Main Inspector
// ---------------------------------------------------------------------------

/**
 * Inspect a raw natural-language prompt and produce a TaskIntentEnvelope
 * with classified intent, extracted target paths, and ambiguity signals.
 *
 * This function is fully deterministic. The LLM may provide the raw prompt,
 * but the LLM must NOT authorize runtime state or make mode decisions.
 * All classification is done by deterministic pattern matching.
 */
export function inspectPrompt(rawPrompt: string, correlationId?: string): InspectionResult {
	const envelope = createTaskIntentEnvelope(rawPrompt, correlationId);
	const diagnostics: ModeDiagnostic[] = [];

	// Step 1: Classify intent
	const intent = classifyIntent(rawPrompt);

	// Step 2: Extract target paths
	const paths = extractTargetPaths(rawPrompt);

	// Step 3: Detect ambiguities
	const ambiguities = detectAmbiguities(rawPrompt, intent, paths);

	// Step 4: Populate envelope
	let populated = envelope;
	if (intent) {
		populated = setMutationIntent(populated, intent);
	}
	populated.targetPaths = paths.length > 0 ? paths : null;
	populated.targetExists = null; // Inspector cannot determine existence — delegated to Target Artifact Resolver

	for (const amb of ambiguities) {
		populated = addAmbiguity(populated, {
			code: amb.code,
			message: amb.message,
			triggerPhrase: amb.triggerPhrase,
			blocking: amb.blocking,
		});
	}

	// Step 5: Produce diagnostics
	const hasBlockingAmb = ambiguities.some((a) => a.blocking);

	if (hasBlockingAmb) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_AMBIGUOUS_INPUT",
			message: "Input prompt contains blocking ambiguities. See envelope.ambiguities for details.",
		});
	}

	if (!intent) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_AMBIGUOUS_MODE",
			message:
				"Cannot deterministically classify the mutation intent from the prompt. " +
				"Please clarify whether this is a create/write, edit/modify, audit-then-mutate (smart edit), or route-then-create (smart write) operation.",
		});
	}

	return {
		envelope: populated,
		diagnostics,
		success: !hasBlockingAmb && intent !== null,
	};
}
