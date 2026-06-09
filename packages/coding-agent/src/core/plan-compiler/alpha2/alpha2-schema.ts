/**
 * PlanSpec v5 Alpha2 Strict Schema — Zod-based validation
 *
 * Every object uses .strict() to reject unknown properties.
 * All required fields are enforced.
 */

import { z } from "zod";

// =============================================================================
// Helpers
// =============================================================================

function strictObj<T extends z.ZodRawShape>(shape: T) {
	return z.object(shape).strict();
}

// =============================================================================
// Primitive schemas
// =============================================================================

const alpha2Version = z.literal("5.0.0-alpha2");
const implKind = z.literal("ImplementationPlan");

const statusEnum = z.enum(["draft", "approved", "active", "completed", "abandoned"]);
const taskTypeEnum = z.enum(["implementation", "validation", "refactor", "test", "documentation", "migration"]);
const priorityEnum = z.enum(["low", "medium", "high", "critical"]);
const commandPolicyEnum = z.enum(["strict", "moderate", "permissive"]);
const evidenceModeEnum = z.enum(["automatic", "manual", "hybrid"]);
const hashAlgoEnum = z.enum(["sha256", "sha512"]);
const reportFormatEnum = z.enum(["markdown", "json", "html"]);
const isolationEnum = z.enum(["full", "partial", "none"]);
const severityEnum = z.enum(["info", "warning", "error", "critical"]);
const taskFileOpEnum = z.enum(["create", "modify", "delete", "move"]);
const artifactTypeEnum = z.enum(["file", "report", "metric", "log"]);

// =============================================================================
// Metadata
// =============================================================================

const PlanSpecMetadata = strictObj({
	phaseId: z.string(),
	title: z.string(),
	description: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	owner: z.string(),
	status: statusEnum,
	sourceDocument: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

// =============================================================================
// Compatibility
// =============================================================================

const PlanSpecCompatibility = strictObj({
	runtimeContractVersion: z.string(),
	runtimeTemplateVersion: z.string(),
	legacyTemplateCompatible: z.boolean(),
	generatedFromV411: z.boolean().optional(),
	v411AdapterRequired: z.boolean().optional(),
	notes: z.array(z.string()).optional(),
});

// =============================================================================
// Intent
// =============================================================================

const PlanSpecIntent = strictObj({
	goal: z.string(),
	successCriteria: z.array(z.string()),
	outOfScope: z.array(z.string()),
	dependencies: z.array(z.string()).optional(),
	blockers: z.array(z.string()).optional(),
});

// =============================================================================
// Authority
// =============================================================================

const PlanSpecExecutionStateSchema = strictObj({
	mode: z.string(),
	maxParallelWorkspaces: z.number().int().min(1).max(10),
	scaleMode: z.string().optional(),
	worktreeIsolation: z.boolean().optional(),
	integrationQueue: z.boolean().optional(),
	validationLock: z.boolean().optional(),
});

const PlanSpecCompletionSchema = strictObj({
	requiresAcceptanceCriteria: z.boolean(),
	requiresValidationEvidence: z.boolean(),
	requiresReport: z.boolean(),
	requiresRollbackPlan: z.boolean(),
	requiresFinalVerdict: z.boolean(),
});

const PlanSpecExactCommandSchema = strictObj({
	command: z.string(),
	reason: z.string(),
});

const PlanSpecAllowedPathSchema = strictObj({
	path: z.string(),
	reason: z.string(),
});

const PlanSpecForbiddenPathSchema = strictObj({
	path: z.string(),
	reason: z.string(),
});

const PlanSpecControlledDeleteSchema = strictObj({
	allowedPaths: z.array(PlanSpecAllowedPathSchema).optional(),
	forbiddenPaths: z.array(PlanSpecForbiddenPathSchema).optional(),
});

const PlanSpecCommandPolicySchema = strictObj({
	exactAllowedCommands: z.array(PlanSpecExactCommandSchema).optional(),
	controlledDelete: PlanSpecControlledDeleteSchema.optional(),
	autoGrantLowRiskReadOnly: z.boolean().optional(),
});

const PlanSpecAuthority = strictObj({
	specification: z.string(),
	executionState: PlanSpecExecutionStateSchema,
	completion: PlanSpecCompletionSchema,
	commands: PlanSpecCommandPolicySchema.optional(),
});

// =============================================================================
// Enforcement Registry
// =============================================================================

const PlanSpecEnforcementRule = strictObj({
	id: z.string(),
	type: z.string(),
	severity: severityEnum,
	condition: z.string(),
	action: z.string(),
});

const PlanSpecEnforcementPolicy = strictObj({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	ruleIds: z.array(z.string()),
});

const PlanSpecEnforcementRegistry = strictObj({
	rules: z.array(PlanSpecEnforcementRule),
	policies: z.array(PlanSpecEnforcementPolicy),
});

// =============================================================================
// Security
// =============================================================================

const PlanSpecSelfModFirewall = strictObj({
	enabled: z.boolean(),
	protectedPaths: z.array(z.string()),
	allowListedFiles: z.array(z.string()).optional(),
	requireExplicitApproval: z.boolean(),
});

const PlanSpecDataExfilGuard = strictObj({
	enabled: z.boolean(),
	sensitivePatterns: z.array(z.string()).optional(),
	blockedDestinations: z.array(z.string()).optional(),
});

const PlanSpecSecretProtection = strictObj({
	enabled: z.boolean(),
	secretPatterns: z.array(z.string()).optional(),
	maskInLogs: z.boolean(),
});

const PlanSpecNetworkAccess = strictObj({
	allowedDomains: z.array(z.string()).optional(),
	blockedDomains: z.array(z.string()).optional(),
	proxyRequired: z.boolean().optional(),
});

const PlanSpecSecurity = strictObj({
	selfModificationFirewall: PlanSpecSelfModFirewall,
	dataExfiltrationGuard: PlanSpecDataExfilGuard,
	secretProtection: PlanSpecSecretProtection,
	networkAccess: PlanSpecNetworkAccess.optional(),
});

// =============================================================================
// Commands
// =============================================================================

const PlanSpecCommands = strictObj({
	policy: commandPolicyEnum,
	allowedCommands: z.array(z.string()).optional(),
	blockedCommands: z.array(z.string()).optional(),
	timeoutSeconds: z.number().positive().optional(),
	maxOutputBytes: z.number().positive().optional(),
});

// =============================================================================
// Validation
// =============================================================================

const PlanSpecPreValidation = strictObj({
	checks: z.array(z.string()),
	timeoutSeconds: z.number().positive().optional(),
});

const PlanSpecPostValidation = strictObj({
	checks: z.array(z.string()),
	timeoutSeconds: z.number().positive().optional(),
	requiredForCompletion: z.boolean(),
});

const PlanSpecValidation = strictObj({
	preValidation: PlanSpecPreValidation.optional(),
	postValidation: PlanSpecPostValidation.optional(),
	continuousValidation: z.boolean().optional(),
	failFast: z.boolean().optional(),
});

// =============================================================================
// Evidence
// =============================================================================

const PlanSpecEvidence = strictObj({
	captureMode: evidenceModeEnum,
	types: z.array(z.string()),
	storageLocation: z.string().optional(),
	retentionDays: z.number().int().positive().optional(),
});

// =============================================================================
// Brief
// =============================================================================

const PlanSpecBrief = strictObj({
	summary: z.string(),
	keyChanges: z.array(z.string()),
	risks: z.array(z.string()),
	mitigations: z.array(z.string()),
});

// =============================================================================
// Locking
// =============================================================================

const PlanSpecLocking = strictObj({
	enabled: z.boolean(),
	hashAlgorithm: hashAlgoEnum,
	includeTimestamp: z.boolean(),
	signatureRequired: z.boolean().optional(),
});

// =============================================================================
// Migration
// =============================================================================

const PlanSpecMigration = strictObj({
	fromVersion: z.string().optional(),
	breakingChanges: z.array(z.string()),
	adaptationSteps: z.array(z.string()),
	rollbackStrategy: z.string().optional(),
});

// =============================================================================
// P45 Bridge
// =============================================================================

const PlanSpecP45Bridge = strictObj({
	enabled: z.boolean(),
	artifactSafety: z.boolean(),
	mutationTracking: z.boolean(),
	commitGating: z.boolean(),
});

// =============================================================================
// Reports
// =============================================================================

const PlanSpecReports = strictObj({
	format: reportFormatEnum,
	includeMetrics: z.boolean(),
	includeTimeline: z.boolean(),
	includeDiffSummary: z.boolean(),
});

// =============================================================================
// Tasks (inside waves)
// =============================================================================

const PlanSpecTaskFile = strictObj({
	path: z.string(),
	operation: taskFileOpEnum,
	sourcePath: z.string().optional(),
	content: z.string().optional(),
});

const PlanSpecTaskExecutionPolicySchema = strictObj({
	mode: commandPolicyEnum.optional(),
	allowedCommands: z.array(z.string()).optional(),
	timeoutSeconds: z.number().positive().optional(),
	maxRetries: z.number().int().nonnegative().optional(),
});

const PlanSpecTaskValidation = strictObj({
	preCheck: z.array(z.string()).optional(),
	postCheck: z.array(z.string()).optional(),
	requiresHumanApproval: z.boolean().optional(),
});

const PlanSpecTaskArtifact = strictObj({
	type: artifactTypeEnum,
	path: z.string().optional(),
	name: z.string(),
	description: z.string().optional(),
});

const PlanSpecTask = strictObj({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	type: taskTypeEnum,
	workspaceId: z.string().optional(),
	files: z.array(PlanSpecTaskFile).optional(),
	acceptanceCriteria: z.array(z.string()),
	dependencies: z.array(z.string()).optional(),
	estimatedMinutes: z.number().positive().optional(),
	priority: priorityEnum,
	executionPolicy: PlanSpecTaskExecutionPolicySchema.optional(),
	validation: PlanSpecTaskValidation.optional(),
	artifacts: z.array(PlanSpecTaskArtifact).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

// =============================================================================
// Waves
// =============================================================================

const PlanSpecWave = strictObj({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	order: z.number().int().nonnegative(),
	tasks: z.array(PlanSpecTask),
	dependencies: z.array(z.string()).optional(),
	estimatedDurationMinutes: z.number().positive().optional(),
});

// =============================================================================
// Workspaces
// =============================================================================

const PlanSpecWorkspace = strictObj({
	id: z.string(),
	name: z.string(),
	rootDir: z.string(),
	canEdit: z.array(z.string()),
	canRead: z.array(z.string()).optional(),
	isolationLevel: isolationEnum.optional(),
});

// =============================================================================
// Top-level Alpha2 schema
// =============================================================================

export const PlanSpecV5Alpha2Schema = strictObj({
	$schema: z.string().optional(),
	planSpecVersion: alpha2Version,
	kind: implKind,
	metadata: PlanSpecMetadata,
	compatibility: PlanSpecCompatibility,
	intent: PlanSpecIntent,
	authority: PlanSpecAuthority,
	enforcementRegistry: PlanSpecEnforcementRegistry,
	security: PlanSpecSecurity,
	commands: PlanSpecCommands.optional(),
	validation: PlanSpecValidation.optional(),
	evidence: PlanSpecEvidence.optional(),
	brief: PlanSpecBrief.optional(),
	locking: PlanSpecLocking.optional(),
	migration: PlanSpecMigration.optional(),
	p45Bridge: PlanSpecP45Bridge.optional(),
	renderHints: z.record(z.string(), z.unknown()).optional(),
	reports: PlanSpecReports.optional(),
	waves: z.array(PlanSpecWave),
	workspaces: z.array(PlanSpecWorkspace),
});
