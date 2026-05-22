/**
 * Reflection Types — P17.C/D/E/F shared types
 *
 * Defines the core data structures for reflection reports,
 * memory proposals, and future phase suggestions after a
 * plan execution completes.
 */

import type { MemoryType } from "../memory/types.js";
import type { ProposalType } from "../proposals/types.js";

// ---------------------------------------------------------------------------
// Execution Journal & Workspace Outcome
// ---------------------------------------------------------------------------

export interface ExecutionJournalEntry {
	timestamp: string;
	eventType: string;
	workspaceId: string;
	severity?: string;
	data: Record<string, unknown>;
}

export interface WorkspaceOutcome {
	workspaceId: string;
	status: "success" | "failure" | "retry" | "skipped" | "conflict";
	retryCount: number;
	duration: number;
	errorTypes?: string[];
	validationPassed?: boolean;
	summary?: string;
}

// ---------------------------------------------------------------------------
// Reflection Input
// ---------------------------------------------------------------------------

export interface ReflectionInput {
	planExecId: string;
	planId: string;
	planTitle?: string;
	executionJournal: ExecutionJournalEntry[];
	workspaceOutcomes: WorkspaceOutcome[];
	validationResults: ValidationResult[];
	integrationState: {
		wasDirty: boolean;
		conflicts: number;
		resolvedConflicts: number;
	};
	duration: number;
	startTime: string;
	endTime: string;
	autonomyLevel: number;
	policyStops: number;
	approvalRequests: number;
}

export interface ValidationResult {
	type: "error" | "warning" | "info";
	component: string;
	message: string;
	passed?: boolean;
	details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reflection Report
// ---------------------------------------------------------------------------

export interface ReflectionReport {
	id: string;
	planExecId: string;
	planTitle?: string;

	// Summary
	summary: string;
	whatPeopleNeedToKnow: string;

	// What happened
	whatRan: string[];
	whatWorked: string[];
	whatFailed: string[];
	whatSlowedDown: string[];

	// Metrics
	workspaceCount: number;
	successCount: number;
	failureCount: number;
	retryCount: number;
	successRate: number;
	avgRetryCount: number;
	totalDuration: number;
	validationFailures: number;

	// Memory & proposals
	memoriesToCreate: MemoryProposalSuggestion[];
	proposalsToGenerate: ProposalSuggestion[];
	futurePhaseSuggestions: FuturePhaseSuggestion[];

	// Trust
	policyStops: number;
	approvalRequests: number;
	safetyInterventions: number;

	// Metadata
	createdAt: string;
	confidence: number;
	sources: SourceRef[];
}

export interface SourceRef {
	type: "workspace" | "journal" | "validation" | "memory";
	id: string;
	description: string;
}

// ---------------------------------------------------------------------------
// Memory & Proposal Suggestions
// ---------------------------------------------------------------------------

export interface MemoryProposalSuggestion {
	type: MemoryType;
	title: string;
	content: string;
	confidence: number;
	sourceRefs: SourceRef[];
	category: "failure" | "success" | "architecture" | "process";
}

export interface ProposalSuggestion {
	type: ProposalType;
	title: string;
	description: string;
	rationale: string;
	priority: "critical" | "high" | "normal" | "low";
	evidenceIds: string[];
}

export interface FuturePhaseSuggestion {
	title: string;
	rationale: string;
	priority: "critical" | "high" | "normal" | "low";
	estimatedWorkstreams: number;
	relatedMemoryIds: string[];
	relatedObservationIds: string[];
}

// ---------------------------------------------------------------------------
// Reflection Engine Config
// ---------------------------------------------------------------------------

export interface ReflectionConfig {
	outputBaseDir: string;
	minWorkspaceCount: number;
	enableMemoryGeneration: boolean;
	enableFutureSuggestions: boolean;
	maxFutureSuggestions: number;
	sourceBackedRequired: boolean;
}
