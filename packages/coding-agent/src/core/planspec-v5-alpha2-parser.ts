/**
 * PlanSpec V5 Alpha2 Parser
 *
 * Parses and validates PlanSpec v5 Alpha2 (5.0.0-alpha2) JSON documents.
 * Supports ImplementationPlan kind with waves/workspaces structure.
 */

import type { PlanSpecV5Alpha2 } from "./planspec-v5-alpha2-types.js";

// =============================================================================
// Validation Errors
// =============================================================================

export interface PlanSpecParseError {
	path: string;
	message: string;
	code: "missing_field" | "invalid_type" | "invalid_value" | "duplicate_id" | "circular_dependency";
}

// =============================================================================
// Parse Result
// =============================================================================

export interface PlanSpecParseResult {
	valid: boolean;
	spec?: PlanSpecV5Alpha2;
	errors: PlanSpecParseError[];
	warnings: string[];
}

// =============================================================================
// Parser
// =============================================================================

/**
 * Parse a PlanSpec V5 Alpha2 document from raw JSON string.
 * Uses loose validation — checks structural integrity but not every field.
 */
export function parsePlanSpecV5Alpha2(rawJson: string): PlanSpecParseResult {
	const errors: PlanSpecParseError[] = [];
	const warnings: string[] = [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch (e) {
		return {
			valid: false,
			errors: [{ path: "$", message: `Invalid JSON: ${(e as Error).message}`, code: "invalid_type" }],
			warnings,
		};
	}

	if (!parsed || typeof parsed !== "object") {
		return {
			valid: false,
			errors: [{ path: "$", message: "Root must be an object", code: "invalid_type" }],
			warnings,
		};
	}

	const spec = parsed as Record<string, unknown>;

	// Validate planSpecVersion
	if (spec.planSpecVersion !== "5.0.0-alpha2") {
		errors.push({
			path: "$.planSpecVersion",
			message: `Expected "5.0.0-alpha2", got "${spec.planSpecVersion}"`,
			code: "invalid_value",
		});
	}

	// Validate kind
	if (spec.kind !== "ImplementationPlan") {
		errors.push({
			path: "$.kind",
			message: `Expected "ImplementationPlan", got "${spec.kind}"`,
			code: "invalid_value",
		});
	}

	// Check for core required fields (loose mode)
	const coreFields = ["metadata", "intent", "authority", "waves", "workspaces"];
	for (const field of coreFields) {
		if (!(field in spec)) {
			errors.push({
				path: `$.${field}`,
				message: `Missing required field: ${field}`,
				code: "missing_field",
			});
		}
	}

	// Validate waves is array
	if (Array.isArray(spec.waves)) {
		checkDuplicateIds(spec.waves, "id", "$.waves", errors);
	} else if ("waves" in spec) {
		errors.push({ path: "$.waves", message: "waves must be an array", code: "invalid_type" });
	}

	// Validate workspaces is array
	if (Array.isArray(spec.workspaces)) {
		checkDuplicateIds(spec.workspaces, "id", "$.workspaces", errors);
	} else if ("workspaces" in spec) {
		errors.push({ path: "$.workspaces", message: "workspaces must be an array", code: "invalid_type" });
	}

	const valid = errors.length === 0;

	return {
		valid,
		spec: valid ? (spec as unknown as PlanSpecV5Alpha2) : undefined,
		errors,
		warnings,
	};
}

// =============================================================================
// Validators
// =============================================================================

function checkDuplicateIds(items: unknown[], idField: string, pathPrefix: string, errors: PlanSpecParseError[]): void {
	const seen = new Set<string>();
	for (let i = 0; i < items.length; i++) {
		const item = items[i] as Record<string, unknown>;
		const id = item[idField] as string;
		if (seen.has(id)) {
			errors.push({
				path: `${pathPrefix}[${i}].${idField}`,
				message: `Duplicate ${idField}: ${id}`,
				code: "duplicate_id",
			});
		}
		seen.add(id);
	}
}
