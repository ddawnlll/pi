/**
 * PlanSpec v5 RC1 Types — ACCP 1.2
 *
 * Strict JSON schema types for PlanSpec v5 RC1.
 * All execution/security objects use additionalProperties: false.
 */

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
	pattern: string;
	allowRecursive: boolean;
	reason: string;
}

export interface PlanSpecForbiddenPath {
	pattern: string;
	reason: string;
}

// =============================================================================
// Locking
// =============================================================================

export interface PlanSpecLocking {
	type: string;
	description: string;
	maxLockAttempts?: number;
	lockTimeoutMs?: number;
}

// =============================================================================
// Waves
// =============================================================================

export interface PlanSpecWave {
	id: string;
	description: string;
	workspaceRefs: string[];
	parallel: boolean;
}

// =============================================================================
// Workspaces
// =============================================================================

export interface PlanSpecWorkspace {
	id: string;
	title: string;
	description?: string;
	dependencies: string[];
	waveRef?: string;
	acceptanceCriteria: PlanSpecAcceptanceCriterion[];
	validation: PlanSpecWorkspaceValidation;
	allowedFiles?: string[];
	forbiddenFiles?: string[];
	reports: PlanSpecReport[];
	rollback: PlanSpecRollback;
	commands: PlanSpecWorkspaceCommand[];
	finalValidationCommandRefs?: string[];
	p45Bridge?: PlanSpecP45Bridge;
}

export interface PlanSpecAcceptanceCriterion {
	id: string;
	description: string;
	validationRefs?: string[];
}

export interface PlanSpecWorkspaceValidation {
	commandRefs: string[];
	watchModeRejected: boolean;
	mustPass: boolean;
	requireEvidence: boolean;
}

export interface PlanSpecReport {
	path: string;
	description: string;
}

export interface PlanSpecRollback {
	steps: PlanSpecRollbackStep[];
}

export interface PlanSpecRollbackStep {
	action: string;
	description: string;
}

export interface PlanSpecWorkspaceCommand {
	ref: string;
	description: string;
	exact: string;
	cwd?: string;
	timeout?: number;
}

export interface PlanSpecP45Bridge {
	implementationAllowed: false;
	allowedFiles?: string[];
	forbiddenPaths?: string[];
}

// =============================================================================
// Top-Level PlanSpec
// =============================================================================

export interface PlanSpecV5 {
	accpVersion: string;
	planspecVersion: string;
	taskId: string;
	taskName: string;
	executionClass: string;
	workspaceGroup: string;
	parallelizationNotes?: string;
	preferredMode?: string;
	allowProductionCodeChanges: boolean;
	allowTestCodeChanges: boolean;
	allowReportFiles: boolean;
	requireRepoInspectionFirst: boolean;
	requireValidationEvidence: boolean;
	requireRollbackPlan: boolean;
	requireFinalAccpReport: boolean;
	authority: PlanSpecAuthority;
	locking?: PlanSpecLocking;
	waves: PlanSpecWave[];
	workspaces: PlanSpecWorkspace[];
	templates: PlanSpecTemplate[];
	validationCases: PlanSpecValidationCase[];
}

export interface PlanSpecTemplate {
	id: string;
	description: string;
	content: string;
	authoritative: boolean;
}

export interface PlanSpecValidationCase {
	id: string;
	description: string;
	input: string;
	expected: PlanSpecValidationExpected;
}

export interface PlanSpecValidationExpected {
	valid: boolean;
	errorCode?: string;
}

// =============================================================================
// PlanLock
// =============================================================================

export interface PlanLock {
	accpVersion: string;
	planSpecTaskId: string;
	lockedAt: string;
	lockedBy: string;
	workspaceIds: string[];
	commandPolicyFrozen: boolean;
	schemaFrozen: boolean;
}

// =============================================================================
// Worker Packet
// =============================================================================

export interface WorkerPacket {
	accpVersion: string;
	planLockId: string;
	workspaceId: string;
	workspaceTitle: string;
	description?: string;
	acceptanceCriteria: WorkerPacketAC[];
	allowedFiles?: string[];
	forbiddenFiles?: string[];
	commands: WorkerPacketCommand[];
}

export interface WorkerPacketAC {
	id: string;
	description: string;
}

export interface WorkerPacketCommand {
	ref: string;
	description: string;
	exact: string;
	cwd?: string;
	timeout?: number;
}

// =============================================================================
// Amendment / Evidence
// =============================================================================

export interface PlanSpecAmendment {
	accpVersion: string;
	amendmentId: string;
	targetTaskId: string;
	changes: PlanSpecChange[];
}

export interface PlanSpecChange {
	field: string;
	oldValue: unknown;
	newValue: unknown;
	reason: string;
}

export interface EvidenceItem {
	id: string;
	type: string;
	timestamp: number;
	source: string;
	description: string;
	content: string;
}
