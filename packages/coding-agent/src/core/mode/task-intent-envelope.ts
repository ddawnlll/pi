/**
 * P44.6.02 — Serializable Task Intent Envelope
 *
 * A stable, serializable JSON contract that carries the natural-language
 * prompt, target artifact path, mutation intent, constraints, and
 * ambiguity signals from the user/LLM to the mode mapping pipeline.
 *
 * This envelope is the single authoritative input to the mode mapping
 * compiler (P44.6.03). It must be serializable via JSON.stringify/parse
 * without data loss.
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for TaskIntentEnvelope.
 */
export const TASK_INTENT_ENVELOPE_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Mutation Intent
// ---------------------------------------------------------------------------

/**
 * The user-declared mutation intent. This is parsed from the natural-language
 * prompt by the Input Inspector (P44.6.05) but can be supplied directly
 * when the intent is already known.
 */
export type MutationIntent =
	/** Create a new artifact. */
	| "create"
	/** Modify an existing artifact. */
	| "modify"
	/** Inspect/audit an existing artifact first, then mutate if needed. */
	| "audit_then_mutate"
	/** Route to a smart-write pipeline that determines the output. */
	| "route_then_create"
	/** Delete an artifact. */
	| "delete"
	/** No mutation — read-only or query. */
	| "read_only";

// ---------------------------------------------------------------------------
// Ambiguity Signal
// ---------------------------------------------------------------------------

/**
 * Signals that a prompt contains ambiguity that must be resolved before
 * the mode mapping pipeline can proceed deterministically.
 */
export interface AmbiguitySignal {
	/** A unique code categorizing the ambiguity. */
	code: AmbiguityCode;
	/** Human-readable description of the ambiguity. */
	message: string;
	/** The portion of the prompt that is ambiguous (if identifiable). */
	triggerPhrase?: string;
	/** Whether this ambiguity is blocking (must be resolved before proceeding). */
	blocking: boolean;
}

/**
 * Categorized ambiguity codes.
 */
export type AmbiguityCode =
	/** Target artifact path is missing or unclear. */
	| "missing_target_path"
	/** Target artifact may or may not already exist. */
	| "unclear_target_existence"
	/** Multiple possible target artifacts match. */
	| "multiple_target_candidates"
	/** Mutation intent cannot be determined from prompt. */
	| "unclear_mutation_intent"
	/** Overwrite behavior is not specified. */
	| "unclear_overwrite_policy"
	/** Which files to preserve/not modify is unclear. */
	| "unclear_preserve_constraints"
	/** Constraints are contradictory. */
	| "contradictory_constraints"
	/** Scope of work is too broad or underspecified. */
	| "underspecified_scope"
	/** Multiple interpretations of the prompt exist. */
	| "multiple_interpretations"
	/** Custom ambiguity not covered by other codes. */
	| "custom";

// ---------------------------------------------------------------------------
// Constraint
// ---------------------------------------------------------------------------

/**
 * A constraint on the execution of the task.
 */
export interface Constraint {
	/** The domain of the constraint. */
	domain: ConstraintDomain;
	/** Description of the constraint. */
	description: string;
	/** Whether the constraint is hard (must be satisfied) or soft (preference). */
	hardness: "hard" | "soft";
}

/**
 * Constraint domains.
 */
export type ConstraintDomain =
	| "path"
	| "preserve"
	| "format"
	| "style"
	| "performance"
	| "security"
	| "compatibility"
	| "scope"
	| "deadline"
	| "custom";

// ---------------------------------------------------------------------------
// TaskIntentEnvelope
// ---------------------------------------------------------------------------

/**
 * The single authoritative input to the mode mapping pipeline.
 *
 * This envelope carries everything parsed from the user's natural-language
 * prompt into a stable, serializable JSON structure. It must not carry
 * any runtime state, session references, or derived mode decisions.
 *
 * Serialization guarantee: JSON.stringify -> JSON.parse must round-trip
 * without data loss (no functions, no symbols, no undefined values).
 */
export interface TaskIntentEnvelope {
	/** Schema version for forward/backward compatibility. */
	schemaVersion: string;

	/** The raw natural-language prompt from the user or LLM. */
	rawPrompt: string;

	/**
	 * The parsed mutation intent, if deterministically resolvable.
	 * If null, the mode mapping compiler must emit an ambiguity signal
	 * and request clarification (BLOCKED_AMBIGUOUS_MODE route).
	 */
	mutationIntent: MutationIntent | null;

	/**
	 * The target artifact path(s), if specified.
	 * If null or empty, the mode mapping compiler checks the mode's
	 * target requirement to decide whether to block or proceed.
	 */
	targetPaths: string[] | null;

	/**
	 * Whether the target artifact(s) are expected to exist.
	 * - true: target must exist (edit, smart_edit)
	 * - false: target must not exist (write)
	 * - null: existence is unknown or unspecified
	 */
	targetExists: boolean | null;

	/**
	 * Overwrite policy for write operations.
	 * If null, the system must determine the policy from context
	 * or request clarification.
	 */
	overwritePolicy: "fail_if_exists" | "allow" | "require_confirmation" | "append_only" | null;

	/**
	 * Constraints on the execution.
	 */
	constraints: Constraint[];

	/**
	 * Ambiguity signals detected during parsing.
	 * If non-empty, the mode mapping pipeline should surface these
	 * as diagnostics before proceeding.
	 */
	ambiguities: AmbiguitySignal[];

	/**
	 * Additional structured metadata from the prompt parser.
	 * Carries prompt-specific signals that don't fit into the
	 * standard fields above.
	 */
	metadata: Record<string, unknown>;

	/**
	 * The timestamp when this envelope was created (epoch ms).
	 */
	timestamp: number;

	/**
	 * An optional correlation ID for tracing this envelope through
	 * the mode mapping pipeline.
	 */
	correlationId?: string;
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a TaskIntentEnvelope from a raw prompt with default values.
 * All parsed fields start as null/empty and must be filled by the
 * Input Inspector or direct API caller.
 */
export function createTaskIntentEnvelope(rawPrompt: string, correlationId?: string): TaskIntentEnvelope {
	return {
		schemaVersion: TASK_INTENT_ENVELOPE_SCHEMA_VERSION,
		rawPrompt,
		mutationIntent: null,
		targetPaths: null,
		targetExists: null,
		overwritePolicy: null,
		constraints: [],
		ambiguities: [],
		metadata: {},
		timestamp: Date.now(),
		correlationId,
	};
}

/**
 * Serialize a TaskIntentEnvelope to a JSON string.
 * Guaranteed to produce a valid string that can be deserialized.
 */
export function serializeTaskIntentEnvelope(envelope: TaskIntentEnvelope): string {
	return JSON.stringify(envelope);
}

/**
 * Deserialize a JSON string back to a TaskIntentEnvelope.
 * Returns null if parsing fails or the result is structurally invalid.
 */
export function deserializeTaskIntentEnvelope(json: string): TaskIntentEnvelope | null {
	try {
		const parsed = JSON.parse(json);
		return validateTaskIntentEnvelope(parsed) ? (parsed as TaskIntentEnvelope) : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an unknown value is a structurally valid TaskIntentEnvelope.
 * This checks required field types without exhaustively verifying every
 * nested field. For strict schema validation, use a JSON Schema validator.
 */
export function validateTaskIntentEnvelope(value: unknown): value is TaskIntentEnvelope {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	// Required fields must be present with correct types
	if (typeof obj.schemaVersion !== "string") return false;
	if (typeof obj.rawPrompt !== "string") return false;
	if (obj.mutationIntent !== null && typeof obj.mutationIntent !== "string") return false;
	if (obj.targetPaths !== null && !Array.isArray(obj.targetPaths)) return false;
	if (obj.targetExists !== null && typeof obj.targetExists !== "boolean") return false;
	if (!Array.isArray(obj.constraints)) return false;
	if (!Array.isArray(obj.ambiguities)) return false;
	if (typeof obj.metadata !== "object" || obj.metadata === null) return false;
	if (typeof obj.timestamp !== "number") return false;

	return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the envelope has any blocking ambiguities.
 */
export function hasBlockingAmbiguities(envelope: TaskIntentEnvelope): boolean {
	return envelope.ambiguities.some((a) => a.blocking);
}

/**
 * Check whether the envelope has a deterministically resolvable
 * mutation intent (i.e., it is not null).
 */
export function hasResolvedIntent(envelope: TaskIntentEnvelope): boolean {
	return envelope.mutationIntent !== null;
}

/**
 * Add an ambiguity signal to the envelope.
 * Returns a new envelope reference — does NOT mutate the original.
 */
export function addAmbiguity(envelope: TaskIntentEnvelope, signal: AmbiguitySignal): TaskIntentEnvelope {
	return {
		...envelope,
		ambiguities: [...envelope.ambiguities, signal],
	};
}

/**
 * Add a constraint to the envelope.
 * Returns a new envelope reference — does NOT mutate the original.
 */
export function addConstraint(envelope: TaskIntentEnvelope, constraint: Constraint): TaskIntentEnvelope {
	return {
		...envelope,
		constraints: [...envelope.constraints, constraint],
	};
}

/**
 * Set the mutation intent on the envelope.
 * Returns a new envelope reference — does NOT mutate the original.
 */
export function setMutationIntent(envelope: TaskIntentEnvelope, intent: MutationIntent): TaskIntentEnvelope {
	return {
		...envelope,
		mutationIntent: intent,
	};
}
