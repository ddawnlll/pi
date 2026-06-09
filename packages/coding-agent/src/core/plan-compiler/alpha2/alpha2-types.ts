/**
 * PlanSpec v5 Alpha2 Types — Canonical Compiler Types
 *
 * The authoritative type definitions for PlanSpec v5 Alpha2 (5.0.0-alpha2).
 * These types define the validated shape after schema parsing.
 */

// =============================================================================
// Core document
// =============================================================================

export interface PlanSpecV5Alpha2 {
	$schema?: string;
	planSpecVersion: "5.0.0-alpha2";
	kind: "ImplementationPlan";
	metadata: PlanSpecMetadata;
	compatibility: PlanSpecCompatibility;
	intent: PlanSpecIntent;
	authority: PlanSpecAuthority;
	enforcementRegistry: PlanSpecEnforcementRegistry;
	security: PlanSpecSecurity;
	commands?: PlanSpecCommands;
	validation?: PlanSpecValidation;
	evidence?: PlanSpecEvidence;
	brief?: PlanSpecBrief;
	locking?: PlanSpecLocking;
	migration?: PlanSpecMigration;
	p45Bridge?: PlanSpecP45Bridge;
	renderHints?: Record<string, unknown>;
	reports?: PlanSpecReports;
	waves: PlanSpecWave[];
	workspaces: PlanSpecWorkspace[];
}

// =============================================================================
// Metadata
// =============================================================================

export interface PlanSpecMetadata {
	phaseId: string;
	title: string;
	description: string;
	createdAt: string;
	updatedAt: string;
	owner: string;
	status: "draft" | "approved" | "active" | "completed" | "abandoned";
	sourceDocument?: string;
	tags?: string[];
}

// =============================================================================
// Compatibility
// =============================================================================

export interface PlanSpecCompatibility {
	runtimeContractVersion: string;
	runtimeTemplateVersion: string;
	legacyTemplateCompatible: boolean;
	generatedFromV411?: boolean;
	v411AdapterRequired?: boolean;
	notes?: string[];
}

// =============================================================================
// Intent
// =============================================================================

export interface PlanSpecIntent {
	goal: string;
	successCriteria: string[];
	outOfScope: string[];
	dependencies?: string[];
	blockers?: string[];
}

// =============================================================================
// Authority
// =============================================================================

export interface PlanSpecAuthority {
	specification: string;
	executionState: PlanSpecExecutionState;
	completion: PlanSpecCompletion;
	commands?: PlanSpecCommandPolicy;
}

export interface PlanSpecExecutionState {
	mode: string;
	maxParallelWorkspaces: number;
	scaleMode?: string;
	worktreeIsolation?: boolean;
	integrationQueue?: boolean;
	validationLock?: boolean;
}

export interface PlanSpecCompletion {
	requiresAcceptanceCriteria: boolean;
	requiresValidationEvidence: boolean;
	requiresReport: boolean;
	requiresRollbackPlan: boolean;
	requiresFinalVerdict: boolean;
}

export interface PlanSpecCommandPolicy {
	exactAllowedCommands?: PlanSpecExactCommand[];
	controlledDelete?: PlanSpecControlledDelete;
	autoGrantLowRiskReadOnly?: boolean;
}

export interface PlanSpecExactCommand {
	command: string;
	reason: string;
}

export interface PlanSpecControlledDelete {
	allowedPaths?: PlanSpecAllowedPath[];
	forbiddenPaths?: PlanSpecForbiddenPath[];
}

export interface PlanSpecAllowedPath {
	path: string;
	reason: string;
}

export interface PlanSpecForbiddenPath {
	path: string;
	reason: string;
}

// =============================================================================
// Enforcement Registry
// =============================================================================

export interface PlanSpecEnforcementRegistry {
	rules: PlanSpecEnforcementRule[];
	policies: PlanSpecEnforcementPolicy[];
}

export interface PlanSpecEnforcementRule {
	id: string;
	type: string;
	severity: "info" | "warning" | "error" | "critical";
	condition: string;
	action: string;
}

export interface PlanSpecEnforcementPolicy {
	id: string;
	name: string;
	description: string;
	ruleIds: string[];
}

// =============================================================================
// Security
// =============================================================================

export interface PlanSpecSecurity {
	selfModificationFirewall: PlanSpecSelfModFirewall;
	dataExfiltrationGuard: PlanSpecDataExfilGuard;
	secretProtection: PlanSpecSecretProtection;
	networkAccess?: PlanSpecNetworkAccess;
}

export interface PlanSpecSelfModFirewall {
	enabled: boolean;
	protectedPaths: string[];
	allowListedFiles?: string[];
	requireExplicitApproval: boolean;
}

export interface PlanSpecDataExfilGuard {
	enabled: boolean;
	sensitivePatterns?: string[];
	blockedDestinations?: string[];
}

export interface PlanSpecSecretProtection {
	enabled: boolean;
	secretPatterns?: string[];
	maskInLogs: boolean;
}

export interface PlanSpecNetworkAccess {
	allowedDomains?: string[];
	blockedDomains?: string[];
	proxyRequired?: boolean;
}

// =============================================================================
// Commands
// =============================================================================

export interface PlanSpecCommands {
	policy: "strict" | "moderate" | "permissive";
	allowedCommands?: string[];
	blockedCommands?: string[];
	timeoutSeconds?: number;
	maxOutputBytes?: number;
}

// =============================================================================
// Validation
// =============================================================================

export interface PlanSpecValidation {
	preValidation?: PlanSpecPreValidation;
	postValidation?: PlanSpecPostValidation;
	continuousValidation?: boolean;
	failFast?: boolean;
}

export interface PlanSpecPreValidation {
	checks: string[];
	timeoutSeconds?: number;
}

export interface PlanSpecPostValidation {
	checks: string[];
	timeoutSeconds?: number;
	requiredForCompletion: boolean;
}

// =============================================================================
// Evidence
// =============================================================================

export interface PlanSpecEvidence {
	captureMode: "automatic" | "manual" | "hybrid";
	types: string[];
	storageLocation?: string;
	retentionDays?: number;
}

// =============================================================================
// Brief
// =============================================================================

export interface PlanSpecBrief {
	summary: string;
	keyChanges: string[];
	risks: string[];
	mitigations: string[];
}

// =============================================================================
// Locking
// =============================================================================

export interface PlanSpecLocking {
	enabled: boolean;
	hashAlgorithm: "sha256" | "sha512";
	includeTimestamp: boolean;
	signatureRequired?: boolean;
}

// =============================================================================
// Migration
// =============================================================================

export interface PlanSpecMigration {
	fromVersion?: string;
	breakingChanges: string[];
	adaptationSteps: string[];
	rollbackStrategy?: string;
}

// =============================================================================
// P45 Bridge
// =============================================================================

export interface PlanSpecP45Bridge {
	enabled: boolean;
	artifactSafety: boolean;
	mutationTracking: boolean;
	commitGating: boolean;
}

// =============================================================================
// Reports
// =============================================================================

export interface PlanSpecReports {
	format: "markdown" | "json" | "html";
	includeMetrics: boolean;
	includeTimeline: boolean;
	includeDiffSummary: boolean;
}

// =============================================================================
// Waves
// =============================================================================

export interface PlanSpecWave {
	id: string;
	title: string;
	description: string;
	order: number;
	tasks: PlanSpecTask[];
	dependencies?: string[];
	estimatedDurationMinutes?: number;
}

// =============================================================================
// Workspaces
// =============================================================================

export interface PlanSpecWorkspace {
	id: string;
	name: string;
	rootDir: string;
	canEdit: string[];
	canRead?: string[];
	isolationLevel?: "full" | "partial" | "none";
}

// =============================================================================
// Tasks
// =============================================================================

export interface PlanSpecTask {
	id: string;
	title: string;
	description: string;
	type: "implementation" | "validation" | "refactor" | "test" | "documentation" | "migration";
	workspaceId?: string;
	files?: PlanSpecTaskFile[];
	acceptanceCriteria: string[];
	dependencies?: string[];
	estimatedMinutes?: number;
	priority: "low" | "medium" | "high" | "critical";
	executionPolicy?: PlanSpecTaskExecutionPolicy;
	validation?: PlanSpecTaskValidation;
	artifacts?: PlanSpecTaskArtifact[];
	metadata?: Record<string, unknown>;
}

export interface PlanSpecTaskFile {
	path: string;
	operation: "create" | "modify" | "delete" | "move";
	sourcePath?: string;
	content?: string;
}

export interface PlanSpecTaskExecutionPolicy {
	mode?: "strict" | "moderate" | "permissive";
	allowedCommands?: string[];
	timeoutSeconds?: number;
	maxRetries?: number;
}

export interface PlanSpecTaskValidation {
	preCheck?: string[];
	postCheck?: string[];
	requiresHumanApproval?: boolean;
}

export interface PlanSpecTaskArtifact {
	type: "file" | "report" | "metric" | "log";
	path?: string;
	name: string;
	description?: string;
}
