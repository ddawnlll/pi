/**
 * P44.6.01 — EngineMode Contract and Mode Enum Canonicalization
 *
 * Defines explicit EngineMode values for all four engine modes:
 * write, edit, smart_write, and smart_edit.
 *
 * Runtime must never infer mode from data_source or prose.
 * The EngineMode enum together with the EngineConfig discriminated union
 * ensures mode is always explicitly declared at the call site.
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for EngineMode types.
 */
export const ENGINE_MODE_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// EngineMode Enum
// ---------------------------------------------------------------------------

/**
 * Explicit engine modes. Each mode maps to a distinct execution policy:
 *
 * - `write`: Create a new artifact. Requires target path, overwrite policy,
 *   and acceptance evidence before execution.
 * - `edit`: Modify an existing artifact. Requires resolvable target,
 *   allowed file scope, preserve constraints, and patch strategy.
 * - `smart_write`: Create a new artifact via JSON PlanSpec generation.
 *   Routes through route signal compiler to determine output schema.
 * - `smart_edit`: Modify an existing artifact via inspect/audit-then-patch.
 *   Requires audit findings before any patch is applied.
 *
 * Runtime must never infer EngineMode from data_source, prose, or
 * contextual heuristics. Mode must always be explicitly provided.
 */
export enum EngineMode {
	/**
	 * Create a new artifact with write-gate v2 policy enforcement.
	 */
	Write = "write",

	/**
	 * Modify an existing artifact with edit-scope guard enforcement.
	 */
	Edit = "edit",

	/**
	 * Create a new artifact via JSON PlanSpec generation,
	 * routed through the smart-write signal compiler.
	 */
	SmartWrite = "smart_write",

	/**
	 * Modify an existing artifact via inspect/audit-then-patch,
	 * with separate audit and patch phases.
	 */
	SmartEdit = "smart_edit",
}

// ---------------------------------------------------------------------------
// Mode Capabilities
// ---------------------------------------------------------------------------

/**
 * The high-level capability category for a mode.
 */
export type ModeCapability = "creation" | "mutation";

/**
 * Returns the capability category for the given mode.
 */
export function getModeCapability(mode: EngineMode): ModeCapability {
	switch (mode) {
		case EngineMode.Write:
		case EngineMode.SmartWrite:
			return "creation";
		case EngineMode.Edit:
		case EngineMode.SmartEdit:
			return "mutation";
	}
}

/**
 * Whether the mode is a "smart" mode (involves planning/inspection).
 */
export function isSmartMode(mode: EngineMode): boolean {
	return mode === EngineMode.SmartWrite || mode === EngineMode.SmartEdit;
}

/**
 * Whether the mode is a "simple" mode (direct write or edit).
 */
export function isSimpleMode(mode: EngineMode): boolean {
	return mode === EngineMode.Write || mode === EngineMode.Edit;
}

// ---------------------------------------------------------------------------
// Target Requirements
// ---------------------------------------------------------------------------

/**
 * Describes whether a mode requires an existing target artifact.
 */
export type TargetRequirement =
	/** Target must NOT exist (new file creation). */
	| { kind: "must_not_exist" }
	/** Target must already exist (modification). */
	| { kind: "must_exist" }
	/** Target may or may not exist (mode handles both). */
	| { kind: "optional" };

/**
 * Returns the target requirement for the given mode.
 */
export function getTargetRequirement(mode: EngineMode): TargetRequirement {
	switch (mode) {
		case EngineMode.Write:
			return { kind: "must_not_exist" };
		case EngineMode.Edit:
			return { kind: "must_exist" };
		case EngineMode.SmartWrite:
			return { kind: "optional" };
		case EngineMode.SmartEdit:
			return { kind: "must_exist" };
	}
}

// ---------------------------------------------------------------------------
// Phase Structure
// ---------------------------------------------------------------------------

/**
 * The execution phase for a mode's lifecycle.
 */
export type ExecutionPhase =
	/** Single atomic operation (write or edit). */
	| { kind: "single" }
	/** Two-phase: inspect/audit then patch. */
	| { kind: "two_phase"; auditPhase: "inspect" | "audit"; patchPhase: "patch" };

/**
 * Returns the execution phase structure for the given mode.
 */
export function getExecutionPhase(mode: EngineMode): ExecutionPhase {
	switch (mode) {
		case EngineMode.Write:
		case EngineMode.Edit:
			return { kind: "single" };
		case EngineMode.SmartWrite:
		case EngineMode.SmartEdit:
			return { kind: "two_phase", auditPhase: "inspect", patchPhase: "patch" };
	}
}

// ---------------------------------------------------------------------------
// Discriminated Union — EngineConfig
// ---------------------------------------------------------------------------

/**
 * Mode-specific configuration payloads discriminated by `mode`.
 *
 * Each variant carries only the fields relevant to its mode.
 * This prevents mode fields from being used in the wrong context.
 */
export type EngineConfig = WriteConfig | EditConfig | SmartWriteConfig | SmartEditConfig;

/**
 * Configuration for `write` mode.
 */
export interface WriteConfig {
	readonly mode: EngineMode.Write;
	/** Path to the new artifact. Must not already exist. */
	targetPath: string;
	/** Overwrite policy if target somehow exists. */
	overwritePolicy: OverwritePolicy;
}

/**
 * Configuration for `edit` mode.
 */
export interface EditConfig {
	readonly mode: EngineMode.Edit;
	/** Path to the existing artifact. Must resolve to an existing file. */
	targetPath: string;
	/** Preserve constraints — what must not change. */
	preserveConstraints?: string[];
}

/**
 * Configuration for `smart_write` mode.
 */
export interface SmartWriteConfig {
	readonly mode: EngineMode.SmartWrite;
	/** Optional target path hint. If absent, route compiler determines output. */
	targetPath?: string;
	/** Schema kind for JSON PlanSpec output. */
	outputSchema: "planspec_v5" | "artifact" | "report";
}

/**
 * Configuration for `smart_edit` mode.
 */
export interface SmartEditConfig {
	readonly mode: EngineMode.SmartEdit;
	/** Path to the existing artifact. Must resolve to an existing file. */
	targetPath: string;
	/** Audit scope — what to inspect. */
	auditScope: string[];
}

// ---------------------------------------------------------------------------
// Supporting Types
// ---------------------------------------------------------------------------

/**
 * Overwrite policy for write operations when the target already exists.
 */
export type OverwritePolicy =
	/** Fail if target already exists. */
	| "fail_if_exists"
	/** Allow overwrite. */
	| "allow"
	/** Require explicit user confirmation before overwriting. */
	| "require_confirmation"
	/** Only append to existing content. */
	| "append_only";

// ---------------------------------------------------------------------------
// Mode Validation
// ---------------------------------------------------------------------------

/**
 * Check if an EngineConfig is valid for its declared mode.
 *
 * Accepts a broad input type to allow test objects without
 * the exact readonly discriminant matching.
 */
export function validateEngineConfig(config: {
	readonly mode: string;
	readonly targetPath?: string;
	readonly overwritePolicy?: string;
	readonly outputSchema?: string;
	readonly auditScope?: readonly string[];
}): string[] {
	const errors: string[] = [];

	switch (config.mode) {
		case EngineMode.Write: {
			if (!config.targetPath) {
				errors.push("Write config requires targetPath");
			}
			break;
		}
		case EngineMode.Edit: {
			if (!config.targetPath) {
				errors.push("Edit config requires targetPath");
			}
			break;
		}
		case EngineMode.SmartWrite: {
			if (
				config.outputSchema !== "planspec_v5" &&
				config.outputSchema !== "artifact" &&
				config.outputSchema !== "report"
			) {
				errors.push(`SmartWrite config has invalid outputSchema: ${config.outputSchema}`);
			}
			break;
		}
		case EngineMode.SmartEdit: {
			if (!config.targetPath) {
				errors.push("SmartEdit config requires targetPath");
			}
			if (!config.auditScope || config.auditScope.length === 0) {
				errors.push("SmartEdit config requires at least one auditScope entry");
			}
			break;
		}
	}

	return errors;
}

// ---------------------------------------------------------------------------
// Mode Registry
// ---------------------------------------------------------------------------

/**
 * All valid EngineMode values in a readonly array.
 */
export const ALL_ENGINE_MODES: readonly EngineMode[] = [
	EngineMode.Write,
	EngineMode.Edit,
	EngineMode.SmartWrite,
	EngineMode.SmartEdit,
] as const;

/**
 * Human-readable labels for each mode.
 */
export const ENGINE_MODE_LABELS: Record<EngineMode, string> = {
	[EngineMode.Write]: "Write",
	[EngineMode.Edit]: "Edit",
	[EngineMode.SmartWrite]: "Smart Write",
	[EngineMode.SmartEdit]: "Smart Edit",
};

/**
 * Returns `true` if the given value is a valid EngineMode.
 */
export function isEngineMode(value: unknown): value is EngineMode {
	return (
		value === EngineMode.Write ||
		value === EngineMode.Edit ||
		value === EngineMode.SmartWrite ||
		value === EngineMode.SmartEdit
	);
}
