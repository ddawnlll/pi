/**
 * Plan Factory Types — P17.A
 *
 * Defines the core data structures for converting approved proposals
 * into executable phase plans (markdown + JSON contract).
 *
 * Every plan factory output includes workstream definitions, a dependency
 * graph, batch layout, and validation results.
 */

import type { RiskLevel } from "../proposals/types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PlanFactoryConfig {
	/** Output directory for generated phase markdown files. */
	outputDir: string;
	/** Output directory for JSON execution contracts. */
	contractDir: string;
	/** Maximum number of workstreams per phase (default: 8). */
	maxWorkstreams: number;
	/** Master template version to use (default: "2.5.1"). */
	templateVersion: string;
	/** Whether to validate output before returning (default: true). */
	validateBeforeReturn: boolean;
	/** Whether to enable LLM content generation in plan sections (default: true). */
	enableLLMContent: boolean;
}

// ---------------------------------------------------------------------------
// Input & Output
// ---------------------------------------------------------------------------

export interface PlanFactoryInput {
	/** ID of the proposal to convert. */
	proposalId: string;
	/** Optional goal ID for alignment. */
	goalId?: string;
	/** Priority override. */
	priority?: "critical" | "high" | "normal" | "low";
	/** Master template version override. */
	masterTemplateVersion?: string;
	/** Optional user notes/overrides for plan generation. */
	userNotes?: string;
}

export interface PlanFactoryOutput {
	/** Generated phase ID (e.g., "P21"). */
	phaseId: string;
	/** Generated phase title (e.g., "Retry Budget"). */
	phaseTitle: string;
	/** Full path to the generated markdown file. */
	markdownPath: string;
	/** JSON execution contract. */
	jsonContract: PlanExecutionContract;
	/** Workstream definitions. */
	workstreams: WorkstreamDef[];
	/** Batch layout: arrays of workstream IDs per batch. */
	batches: string[][];
	/** ISO 8601 generation timestamp. */
	generatedAt: string;
	/** Confidence score 0-1 based on evidence completeness. */
	confidence: number;
	/** Validation results. */
	validationResults: ValidationResult2[];
}

export interface PlanExecutionContract {
	/** Schema version (e.g., "2.5.1"). */
	contractVersion: string;
	/** Phase identification. */
	phase: { id: string; title: string };
	/** Workstream definitions. */
	workstreams: WorkstreamDef[];
	/** Dependency edges. */
	dependencies: Array<{ from: string; to: string; type: "blocking" | "informational" }>;
	/** Batch layout. */
	batches: string[][];
	/** Selected scale mode. */
	scaleMode: string;
	/** Whether integration queue is required. */
	integrationQueue: boolean;
	/** Whether worktree isolation is required. */
	worktreeIsolation: boolean;
	/** Arbitrary metadata. */
	metadata: Record<string, unknown>;
}

export interface WorkstreamDef {
	/** Unique workstream ID (e.g., "P21.A"). */
	id: string;
	/** Human-readable title. */
	title: string;
	/** One-line goal statement. */
	goal: string;
	/** Acceptance criteria checklist. */
	acceptanceCriteria: string[];
	/** IDs of workstreams this depends on. */
	dependencies: string[];
	/** File glob patterns this workstream touches. */
	fileScope: string[];
	/** Isolation notes for the executor. */
	isolationNotes: string;
	/** Queue priority. */
	queuePriority: "critical" | "high" | "normal" | "low";
	/** Risk level. */
	riskLevel: RiskLevel;
}

export interface ValidationResult2 {
	type: "error" | "warning" | "info";
	component: "markdown" | "contract" | "workstream" | "dependency";
	message: string;
	details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Proposal Analysis
// ---------------------------------------------------------------------------

export interface ProposalAnalysis {
	/** Descriptive scope string. */
	scope: string;
	/** Estimated number of workstreams needed. */
	estimatedWorkstreams: number;
	/** Systems that will be affected. */
	affectedSystems: string[];
	/** Overall risk level. */
	risk: RiskLevel;
	/** How strong the evidence backing is (0-1). */
	evidenceQuality: number;
}
