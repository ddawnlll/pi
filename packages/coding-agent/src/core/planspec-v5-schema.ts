/**
 * PlanSpec v5 RC1 Schema — ACCP 1.2
 *
 * Zod-based strict schema for PlanSpec v5 RC1.
 * All execution/security objects use additionalProperties: false.
 * Provides typed parsePlanSpec function.
 */

import { z } from "zod";
import type { PlanSpecV5 } from "./planspec-v5-types.js";

// =============================================================================
// Helper: strict object (no additional properties)
// =============================================================================

/**
 * Create a strict object schema that rejects unknown keys.
 */
function strictObj<T extends z.ZodRawShape>(shape: T) {
	return z.object(shape).strict();
}

// =============================================================================
// Authority
// =============================================================================

const PlanSpecExecutionState = strictObj({
	mode: z.string(),
	maxParallelWorkspaces: z.number().int().min(1).max(10),
	scaleMode: z.string().optional(),
	worktreeIsolation: z.boolean().optional(),
	integrationQueue: z.boolean().optional(),
	validationLock: z.boolean().optional(),
});

const PlanSpecCompletion = strictObj({
	requiresAcceptanceCriteria: z.boolean(),
	requiresValidationEvidence: z.boolean(),
	requiresReport: z.boolean(),
	requiresRollbackPlan: z.boolean(),
	requiresFinalVerdict: z.boolean(),
});

const PlanSpecExactCommand = strictObj({
	command: z.string(),
	reason: z.string(),
});

const PlanSpecAllowedPath = strictObj({
	pattern: z.string(),
	allowRecursive: z.boolean(),
	reason: z.string(),
});

const PlanSpecForbiddenPath = strictObj({
	pattern: z.string(),
	reason: z.string(),
});

const PlanSpecControlledDelete = strictObj({
	allowedPaths: z.array(PlanSpecAllowedPath).optional(),
	forbiddenPaths: z.array(PlanSpecForbiddenPath).optional(),
});

const PlanSpecCommandPolicy = strictObj({
	exactAllowedCommands: z.array(PlanSpecExactCommand).optional(),
	controlledDelete: PlanSpecControlledDelete.optional(),
	autoGrantLowRiskReadOnly: z.boolean().optional(),
});

const PlanSpecAuthority = strictObj({
	specification: z.string(),
	executionState: PlanSpecExecutionState,
	completion: PlanSpecCompletion,
	commands: PlanSpecCommandPolicy.optional(),
});

// =============================================================================
// Locking
// =============================================================================

const PlanSpecLocking = strictObj({
	type: z.string(),
	description: z.string(),
	maxLockAttempts: z.number().int().optional(),
	lockTimeoutMs: z.number().int().optional(),
});

// =============================================================================
// Waves
// =============================================================================

const PlanSpecWave = strictObj({
	id: z.string(),
	description: z.string(),
	workspaceRefs: z.array(z.string()),
	parallel: z.boolean(),
});

// =============================================================================
// Workspaces
// =============================================================================

const PlanSpecAcceptanceCriterion = strictObj({
	id: z.string(),
	description: z.string(),
	validationRefs: z.array(z.string()).optional(),
});

const PlanSpecWorkspaceValidation = strictObj({
	commandRefs: z.array(z.string()),
	watchModeRejected: z.boolean(),
	mustPass: z.boolean(),
	requireEvidence: z.boolean(),
});

const PlanSpecReport = strictObj({
	path: z.string(),
	description: z.string(),
});

const PlanSpecRollbackStep = strictObj({
	action: z.string(),
	description: z.string(),
});

const PlanSpecRollback = strictObj({
	steps: z.array(PlanSpecRollbackStep),
});

const PlanSpecWorkspaceCommand = strictObj({
	ref: z.string(),
	description: z.string(),
	exact: z.string(),
	cwd: z.string().optional(),
	timeout: z.number().int().optional(),
});

const PlanSpecP45Bridge = strictObj({
	implementationAllowed: z.literal(false),
	allowedFiles: z.array(z.string()).optional(),
	forbiddenPaths: z.array(z.string()).optional(),
});

const PlanSpecWorkspace = strictObj({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	dependencies: z.array(z.string()),
	waveRef: z.string().optional(),
	acceptanceCriteria: z.array(PlanSpecAcceptanceCriterion),
	validation: PlanSpecWorkspaceValidation,
	allowedFiles: z.array(z.string()).optional(),
	forbiddenFiles: z.array(z.string()).optional(),
	reports: z.array(PlanSpecReport),
	rollback: PlanSpecRollback,
	commands: z.array(PlanSpecWorkspaceCommand),
	finalValidationCommandRefs: z.array(z.string()).optional(),
	p45Bridge: PlanSpecP45Bridge.optional(),
});

// =============================================================================
// Templates
// =============================================================================

const PlanSpecTemplate = strictObj({
	id: z.string(),
	description: z.string(),
	content: z.string(),
	authoritative: z.boolean(),
});

// =============================================================================
// Validation Cases
// =============================================================================

const PlanSpecValidationExpected = strictObj({
	valid: z.boolean(),
	errorCode: z.string().optional(),
});

const PlanSpecValidationCase = strictObj({
	id: z.string(),
	description: z.string(),
	input: z.string(),
	expected: PlanSpecValidationExpected,
});

// =============================================================================
// Top-Level PlanSpec
// =============================================================================

export const PlanSpecV5Schema = strictObj({
	accpVersion: z.string(),
	planspecVersion: z.literal("5.0.0"),
	taskId: z.string(),
	taskName: z.string(),
	executionClass: z.string(),
	workspaceGroup: z.string(),
	parallelizationNotes: z.string().optional(),
	preferredMode: z.string().optional(),
	allowProductionCodeChanges: z.boolean(),
	allowTestCodeChanges: z.boolean(),
	allowReportFiles: z.boolean(),
	requireRepoInspectionFirst: z.boolean(),
	requireValidationEvidence: z.boolean(),
	requireRollbackPlan: z.boolean(),
	requireFinalAccpReport: z.boolean(),
	authority: PlanSpecAuthority,
	locking: PlanSpecLocking.optional(),
	waves: z.array(PlanSpecWave),
	workspaces: z.array(PlanSpecWorkspace),
	templates: z.array(PlanSpecTemplate),
	validationCases: z.array(PlanSpecValidationCase),
});

// =============================================================================
// PlanLock Schema
// =============================================================================

export const PlanLockSchema = strictObj({
	accpVersion: z.string(),
	planSpecTaskId: z.string(),
	lockedAt: z.string(),
	lockedBy: z.string(),
	workspaceIds: z.array(z.string()),
	commandPolicyFrozen: z.boolean(),
	schemaFrozen: z.boolean(),
});

// =============================================================================
// Worker Packet Schema
// =============================================================================

export const WorkerPacketACSchema = strictObj({
	id: z.string(),
	description: z.string(),
});

export const WorkerPacketCommandSchema = strictObj({
	ref: z.string(),
	description: z.string(),
	exact: z.string(),
	cwd: z.string().optional(),
	timeout: z.number().int().optional(),
});

export const WorkerPacketSchema = strictObj({
	accpVersion: z.string(),
	planLockId: z.string(),
	workspaceId: z.string(),
	workspaceTitle: z.string(),
	description: z.string().optional(),
	acceptanceCriteria: z.array(WorkerPacketACSchema),
	allowedFiles: z.array(z.string()).optional(),
	forbiddenFiles: z.array(z.string()).optional(),
	commands: z.array(WorkerPacketCommandSchema),
});

// =============================================================================
// Amendment Schema
// =============================================================================

export const PlanSpecChangeSchema = strictObj({
	field: z.string(),
	oldValue: z.unknown(),
	newValue: z.unknown(),
	reason: z.string(),
});

export const PlanSpecAmendmentSchema = strictObj({
	accpVersion: z.string(),
	amendmentId: z.string(),
	targetTaskId: z.string(),
	changes: z.array(PlanSpecChangeSchema),
});

// =============================================================================
// Evidence Item Schema
// =============================================================================

export const EvidenceItemSchema = strictObj({
	id: z.string(),
	type: z.string(),
	timestamp: z.number(),
	source: z.string(),
	description: z.string(),
	content: z.string(),
});

// =============================================================================
// Parse function
// =============================================================================

export type PlanSpecV5ParseResult = {
	success: boolean;
	data?: PlanSpecV5;
	errors?: string[];
	errorCode?: string;
};

/**
 * Parse and validate a PlanSpec v5 JSON string.
 * Rejects non-JSON input (Markdown) with a typed error.
 *
 * @param input - The input string
 * @returns Parse result
 */
export function parsePlanSpecV5(input: string): PlanSpecV5ParseResult {
	if (!input || input.trim().length === 0) {
		return { success: false, errors: ["Input is empty"], errorCode: "E_EMPTY_INPUT" };
	}

	const trimmed = input.trim();

	// Reject Markdown input
	if (trimmed.startsWith("#") || trimmed.startsWith("<") || !trimmed.startsWith("{")) {
		return {
			success: false,
			errors: [
				"Input is not JSON: appears to be Markdown or other non-JSON format. PlanSpec v5 requires JSON input.",
			],
			errorCode: "E_NOT_JSON",
		};
	}

	// Parse JSON
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (e) {
		return {
			success: false,
			errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
			errorCode: "E_MALFORMED_JSON",
		};
	}

	// Validate against schema
	const result = PlanSpecV5Schema.safeParse(parsed);
	if (!result.success) {
		const errors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
		return { success: false, errors, errorCode: "E_SCHEMA_INVALID" };
	}

	return { success: true, data: result.data };
}
