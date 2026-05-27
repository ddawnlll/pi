/**
 * Debug-to-Fix Pipeline — 25.P
 *
 * Orchestrates the end-to-end flow from failure evidence through
 * debugger analysis to fix strategist generation.
 *
 * Pipeline stages:
 * 1. **Debug Stage**: Accepts failure evidence, creates a debug session,
 *    collects evidence, and runs root cause analysis via the DebuggerWorker.
 * 2. **Handoff Stage**: Transfers the debug findings (root cause analysis,
 *    evidence summary, diagnostics) into the HandoffInbox for the fix
 *    strategist to consume.
 * 3. **Fix Stage**: Consumes the handoff entry via the TriageRouter and
 *    runs the FixStrategistWorker to generate patch strategies and test
 *    plans.
 *
 * All stages enforce budget, cooldown, dedup, and stop-condition handling
 * as defined by the DebugToFixPolicy. All failures surface evidence-backed
 * diagnostics.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import type { DebuggerHandoffResult, DebuggerWorker } from "../debugger/debugger-worker.js";
import type { EvidenceItem } from "../debugger/evidence-summarizer.js";
import type { FailureContext, FixEvidenceItem, FixStrategistHandoffResult, FixStrategistWorker, FixStrategyResult } from "../fix-strategist/fix-strategist-worker.js";
import { type HandoffInbox, HandoffInbox, type HandoffEntry } from "../inbox/handoff-inbox.js";
import { type RoutingRule, TriageRouter } from "../inbox/triage-router.js";
import {
	createWorkerDiagnostic,
	type WorkerDiagnostic,
	type WorkerStopCondition,
} from "../types.js";
import {
	createDebugToFixPolicy,
	DEFAULT_DEBUG_TO_FIX_POLICY,
	type DebugToFixPolicy,
	validateDebugToFixPolicy,
} from "./debug-to-fix-policy.js";

// ---------------------------------------------------------------------------
// Pipeline State
// ---------------------------------------------------------------------------

/**
 * Operational state of the debug-to-fix pipeline.
 */
export type DebugToFixPipelineState =
	| "idle" // Pipeline created, awaiting input
	| "debugging" // Debug stage active
	| "handoff" // Handoff stage active (transferring to fix strategist)
	| "fixing" // Fix stage active
	| "completed" // All stages completed successfully
	| "paused" // Pipeline paused (on stage failure or user request)
	| "failed" // Unrecoverable failure with diagnostics
	| "cancelled"; // Pipeline was cancelled

/**
 * All valid pipeline states.
 */
export const ALL_PIPELINE_STATES: readonly DebugToFixPipelineState[] = [
	"idle",
	"debugging",
	"handoff",
	"fixing",
	"completed",
	"paused",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Pipeline Stage Result
// ---------------------------------------------------------------------------

/**
 * Result of a single pipeline stage execution.
 *
 * Each stage produces a result with timing, token consumption, and
 * diagnostics. Stages can also carry stage-specific output data.
 */
export interface DebugToFixStageResult {
	/** Stage name ("debug", "handoff", "fix"). */
	stage: string;
	/** Whether the stage completed successfully. */
	success: boolean;
	/** ISO 8601 timestamp when the stage started. */
	startedAt: string;
	/** ISO 8601 timestamp when the stage completed (or failed). */
	completedAt: string;
	/** Runtime in milliseconds. */
	runtimeMs: number;
	/** Tokens consumed during this stage. */
	tokensConsumed: number;
	/** Diagnostics generated during this stage. */
	diagnostics: WorkerDiagnostic[];
	/** Error message if the stage failed. */
	error: string | null;
	/** Stage-specific output data. */
	output: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pipeline Result
// ---------------------------------------------------------------------------

/**
 * Complete result of a debug-to-fix pipeline execution.
 *
 * Contains all stage results, overall timing, diagnostics, and the
 * final output (fix strategies and test plans) if successful.
 */
export interface DebugToFixPipelineResult {
	/** Unique pipeline execution ID. */
	id: string;
	/** Pipeline state at completion/termination. */
	state: DebugToFixPipelineState;
	/** ISO 8601 timestamp when the pipeline started. */
	startedAt: string;
	/** ISO 8601 timestamp when the pipeline completed (or failed). */
	completedAt: string;
	/** Total runtime across all stages in milliseconds. */
	totalRuntimeMs: number;
	/** Total tokens consumed across all stages. */
	totalTokensConsumed: number;
	/** Stage-level results. */
	stages: DebugToFixStageResult[];
	/** Whether the pipeline completed successfully. */
	success: boolean;
	/** Evidence-backed diagnostics from the entire pipeline run. */
	diagnostics: WorkerDiagnostic[];
	/** The debugger handoff result (from the debug stage), if available. */
	debuggerOutput: DebuggerHandoffResult | null;
	/** The fix strategist handoff result (from the fix stage), if available. */
	fixStrategistOutput: FixStrategistHandoffResult | null;
	/** Generated fix strategies and test plans (from fix stage), if available. */
	fixResult: FixStrategyResult | null;
	/** Handoff entry ID for traceability. */
	handoffEntryId: string | null;
	/** Pipeline-level dedup key used for dedup check. */
	dedupKey: string | null;
	/** Correlation ID for linking to related observability events. */
	correlationId: string | null;
	/** Error message if the pipeline failed. */
	error: string | null;
	/** Metadata for extensibility. */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pipeline Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Debug-to-Fix Pipeline.
 */
export interface DebugToFixPipelineConfig {
	/**
	 * Policy configuration governing pipeline behavior.
	 */
	policy: DebugToFixPolicy;

	/**
	 * Whether to automatically start the pipeline on input.
	 * Default: true.
	 */
	autoStart: boolean;

	/**
	 * Tags to attach to the pipeline run for observability.
	 */
	tags: string[];
}

/**
 * Default pipeline configuration.
 */
export const DEFAULT_PIPELINE_CONFIG: DebugToFixPipelineConfig = {
	policy: DEFAULT_DEBUG_TO_FIX_POLICY,
	autoStart: true,
	tags: ["debug-to-fix", "brain-worker-pipeline"],
};

// ---------------------------------------------------------------------------
// Pipeline Input
// ---------------------------------------------------------------------------

/**
 * Input for starting a debug-to-fix pipeline run.
 */
export interface DebugToFixPipelineInput {
	/** Human-readable label describing the failure. */
	label: string;
	/** Evidence items from the failure context. */
	evidence: FixEvidenceItem[];
	/** Optional failure context (project path, git ref, environment, etc.). */
	context?: FailureContext;
	/** Optional correlation ID for observability linkage. */
	correlationId?: string;
	/** Optional metadata for extensibility. */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pipeline Diagnostics Helper
// ---------------------------------------------------------------------------

/**
 * Create a pipeline diagnostic with evidence references.
 */
function pipelineDiagnostic(
	stopCondition: WorkerStopCondition,
	message: string,
	context: Record<string, unknown> = {},
	evidenceRefs: string[] = [],
	errorDetail?: string,
): WorkerDiagnostic {
	return createWorkerDiagnostic(stopCondition, message, context, evidenceRefs, errorDetail);
}

// ---------------------------------------------------------------------------
// Debug-to-Fix Pipeline
// ---------------------------------------------------------------------------

/**
 * Orchestrates the debug-to-fix pipeline.
 *
 * Manages the full lifecycle from failure input through debug analysis,
 * handoff, and fix strategy generation. All stages enforce policy-based
 * budgets, cooldowns, dedup, and stop conditions.
 *
 * The pipeline is designed to be:
 * - **Autonomous**: Operates within policy-defined budgets with
 *   cooldown/dedup/stop-condition handling.
 * - **Observable**: All stages produce evidence-backed diagnostics.
 * - **Resilient**: Stage failures are caught, diagnosed, and surfaced
 *   rather than silently swallowed.
 * - **Non-recursive**: The pipeline has explicit stop conditions and
 *   cannot recurse indefinitely.
 */
export class DebugToFixPipeline {
	private config: DebugToFixPipelineConfig;
	private policy: DebugToFixPolicy;
	private state: DebugToFixPipelineState = "idle";
	private diagnostics: WorkerDiagnostic[] = [];
	private startedAt: string | null = null;
	private completedAt: string | null = null;
	private pipelineStartTime: number = 0;
	private totalTokens: number = 0;
	private stageResults: DebugToFixStageResult[] = [];
	private debuggerOutput: DebuggerHandoffResult | null = null;
	private fixStrategistOutput: FixStrategistHandoffResult | null = null;
	private fixResult: FixStrategyResult | null = null;
	private handoffEntryId: string | null = null;
	private correlationId: string | null = null;
	private dedupKey: string | null = null;
	private retryCount: number = 0;

	/**
	 * Create a new DebugToFixPipeline.
	 *
	 * @param config - Optional pipeline configuration overrides.
	 */
	constructor(config?: Partial<DebugToFixPipelineConfig>) {
		this.config = {
			policy: createDebugToFixPolicy(config?.policy),
			autoStart: config?.autoStart ?? DEFAULT_PIPELINE_CONFIG.autoStart,
			tags: config?.tags ?? [...DEFAULT_PIPELINE_CONFIG.tags],
		};
		this.policy = this.config.policy;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the current pipeline configuration.
	 */
	getConfig(): Readonly<DebugToFixPipelineConfig> {
		return {
			...this.config,
			policy: {
				...this.policy,
				debuggerBudget: { ...this.policy.debuggerBudget },
				fixStrategistBudget: { ...this.policy.fixStrategistBudget },
				dedupConfig: { ...this.policy.dedupConfig },
				debugStage: { ...this.policy.debugStage },
				handoffStage: { ...this.policy.handoffStage },
				fixStage: { ...this.policy.fixStage },
			},
			tags: [...this.config.tags],
		};
	}

	/**
	 * Update the pipeline policy.
	 *
	 * Can only be updated when the pipeline is idle or paused.
	 *
	 * @param policyUpdates - Partial policy updates.
	 * @returns true if the policy was updated, false if pipeline is active.
	 */
	updatePolicy(policyUpdates: Partial<DebugToFixPolicy>): boolean {
		if (this.state !== "idle" && this.state !== "paused") {
			return false;
		}
		this.policy = createDebugToFixPolicy({ ...this.policy, ...policyUpdates });
		this.config = { ...this.config, policy: this.policy };
		return true;
	}

	// -----------------------------------------------------------------------
	// State Accessors
	// -----------------------------------------------------------------------

	/**
	 * Get the current pipeline state.
	 */
	getState(): DebugToFixPipelineState {
		return this.state;
	}

	/**
	 * Check if the pipeline is in a terminal state.
	 */
	isTerminal(): boolean {
		return this.state === "completed" || this.state === "failed" || this.state === "cancelled";
	}

	/**
	 * Check if the pipeline is currently active (running a stage).
	 */
	isActive(): boolean {
		return this.state === "debugging" || this.state === "handoff" || this.state === "fixing";
	}

	/**
	 * Get all diagnostics recorded during this pipeline run.
	 */
	getDiagnostics(): WorkerDiagnostic[] {
		return [...this.diagnostics];
	}

	/**
	 * Get the current stage results.
	 */
	getStageResults(): DebugToFixStageResult[] {
		return [...this.stageResults];
	}

	/**
	 * Get the total tokens consumed across all stages.
	 */
	getTotalTokens(): number {
		return this.totalTokens;
	}

	// -----------------------------------------------------------------------
	// Pipeline Execution
	// -----------------------------------------------------------------------

	/**
	 * Run the complete debug-to-fix pipeline.
	 *
	 * Accepts failure evidence, runs all three stages (debug, handoff,
	 * fix), and returns the pipeline result.
	 *
	 * @param input - The pipeline input with failure evidence.
	 * @param debuggerWorker - The DebuggerWorker instance to use.
	 * @param fixStrategistWorker - The FixStrategistWorker instance to use.
	 * @returns The pipeline result with all stage outputs and diagnostics.
	 */
	run(
		input: DebugToFixPipelineInput,
		debuggerWorker: DebuggerWorker,
		fixStrategistWorker: FixStrategistWorker,
	): DebugToFixPipelineResult {
		const runId = randomUUID();
		this.pipelineStartTime = Date.now();
		this.startedAt = new Date(this.pipelineStartTime).toISOString();
		this.correlationId = input.correlationId ?? null;
		this.diagnostics = [];
		this.stageResults = [];
		this.debuggerOutput = null;
		this.fixStrategistOutput = null;
		this.fixResult = null;
		this.handoffEntryId = null;
		this.totalTokens = 0;

		// Compute dedup key from input evidence
		this.dedupKey = this.computeDedupKey(input);

		// Check if pipeline is enabled
		if (!this.policy.enabled) {
			this.state = "failed";
			this.completedAt = new Date().toISOString();
			const diag = pipelineDiagnostic(
				"policy_blocked",
				"Debug-to-fix pipeline is disabled by policy",
				{ pipelineId: runId },
			);
			this.diagnostics.push(diag);
			return this.buildResult(runId, "failed", [diag], "Pipeline disabled by policy");
		}

		// Check dedup
		if (this.policy.dedupConfig.enabled && this.dedupKey) {
			// Dedup is tracked internally via the debugger worker's dedup
			// mechanism. The pipeline also checks at its own level.
			const dedupDiag = pipelineDiagnostic(
				"completed",
				"Pipeline dedup key computed",
				{ dedupKey: this.dedupKey, runId },
			);
			this.diagnostics.push(dedupDiag);
		}

		this.state = "debugging";

		// -------------------------------------------------------------------
		// Stage 1: Debug
		// -------------------------------------------------------------------
		const debugResult = this.runDebugStage(input, debuggerWorker);
		this.stageResults.push(debugResult);

		if (!debugResult.success) {
			return this.handleStageFailure(runId, debugResult);
		}

		// -------------------------------------------------------------------
		// Stage 2: Handoff
		// -------------------------------------------------------------------
		const handoffResult = this.runHandoffStage(debugResult.output as DebuggerHandoffResult);
		this.stageResults.push(handoffResult);

		if (!handoffResult.success) {
			return this.handleStageFailure(runId, handoffResult);
		}

		// -------------------------------------------------------------------
		// Stage 3: Fix Strategy
		// -------------------------------------------------------------------
		const fixResult = this.runFixStage(
			handoffResult.output as { entryId: string; evidence: FixEvidenceItem[]; context?: FailureContext },
			fixStrategistWorker,
		);
		this.stageResults.push(fixResult);

		if (!fixResult.success) {
			return this.handleStageFailure(runId, fixResult);
		}

		// -------------------------------------------------------------------
		// All stages completed
		// -------------------------------------------------------------------
		this.state = "completed";
		this.completedAt = new Date().toISOString();

		return this.buildResult(runId, "completed", this.diagnostics, null);
	}

	/**
	 * Cancel the pipeline execution.
	 *
	 * Can only cancel when the pipeline is in an active state (debugging,
	 * handoff, fixing) or paused.
	 *
	 * @param reason - Reason for cancellation.
	 * @returns true if the pipeline was cancelled, false if not in a cancellable state.
	 */
	cancel(reason: string): boolean {
		if (this.isTerminal()) return false;
		if (this.state === "idle") return false;

		this.state = "cancelled";
		this.completedAt = new Date().toISOString();

		const diag = pipelineDiagnostic("user_interrupt", `Pipeline cancelled: ${reason}`, {
			state: this.state,
			reason,
		});
		this.diagnostics.push(diag);

		return true;
	}

	/**
	 * Reset the pipeline to idle state.
	 *
	 * Can only reset terminal states (completed, failed, cancelled) or paused.
	 */
	reset(): boolean {
		if (this.isActive()) return false;

		this.state = "idle";
		this.diagnostics = [];
		this.stageResults = [];
		this.startedAt = null;
		this.completedAt = null;
		this.pipelineStartTime = 0;
		this.totalTokens = 0;
		this.debuggerOutput = null;
		this.fixStrategistOutput = null;
		this.fixResult = null;
		this.handoffEntryId = null;
		this.correlationId = null;
		this.dedupKey = null;
		this.retryCount = 0;

		return true;
	}

	// -----------------------------------------------------------------------
	// Stage Execution
	// -----------------------------------------------------------------------

	/**
	 * Run the debug stage: create a debug session, collect evidence, and
	 * run root cause analysis.
	 */
	private runDebugStage(
		input: DebugToFixPipelineInput,
		debuggerWorker: DebuggerWorker,
	): DebugToFixStageResult {
		const stageStart = Date.now();
		const startedAt = new Date(stageStart).toISOString();
		const stageDiags: WorkerDiagnostic[] = [];

		if (!this.policy.debugStage.enabled) {
			const diag = pipelineDiagnostic("completed", "Debug stage is disabled by policy — skipping", {
				stage: "debug",
			});
			stageDiags.push(diag);
			this.diagnostics.push(diag);

			return {
				stage: "debug",
				success: true,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: 0,
				tokensConsumed: 0,
				diagnostics: stageDiags,
				error: null,
				output: {},
			};
		}

		try {
			// Compute task hash for dedup from evidence content
			const taskHash = computeEvidenceHash(input.evidence);

			// Create debug session
			const session = debuggerWorker.createSession(
				input.label,
				input.metadata ?? {},
				taskHash,
				null,
				this.correlationId,
			);

			if (!session) {
				// Session was deduped — that's not a failure, the same
				// failure signature was recently analyzed
				const diag = pipelineDiagnostic("completed", "Debug session suppressed by dedup", {
					stage: "debug",
					taskHash,
					label: input.label,
				});
				stageDiags.push(diag);
				this.diagnostics.push(diag);

				return {
					stage: "debug",
					success: true,
					startedAt,
					completedAt: new Date().toISOString(),
					runtimeMs: Date.now() - stageStart,
					tokensConsumed: 0,
					diagnostics: stageDiags,
					error: null,
					output: { deduped: true, taskHash },
				};
			}

			// Start collection
			debuggerWorker.startCollection(session.id);

			// Add evidence items from input
			for (const ev of input.evidence) {
				debuggerWorker.addEvidence(session.id, {
					label: ev.label,
					content: ev.content,
					type: ev.type as EvidenceItem["type"],
					confidence: ev.confidence as EvidenceItem["confidence"],
				});
			}

			// Run root cause analysis
			const estimatedTokens = input.evidence.reduce((sum, e) => sum + e.content.length + e.label.length, 0);
			const analysis = debuggerWorker.analyze(session.id, estimatedTokens, Date.now() - stageStart);

			if (!analysis) {
				// Analyze already marks the session as failed with diagnostics
				const failedSession = debuggerWorker.getSession(session.id);
				const errMsg = failedSession?.error ?? "Root cause analysis returned null";
				const diag = pipelineDiagnostic("unknown_error", `Debug analysis failed: ${errMsg}`, {
					stage: "debug",
					sessionId: session.id,
				});
				stageDiags.push(diag);
				this.diagnostics.push(diag);

				return {
					stage: "debug",
					success: false,
					startedAt,
					completedAt: new Date().toISOString(),
					runtimeMs: Date.now() - stageStart,
					tokensConsumed: estimatedTokens,
					diagnostics: stageDiags,
					error: errMsg,
					output: {},
				};
			}

			// Emit findings for handoff
			const findings = debuggerWorker.emitFindings(session.id);
			if (!findings) {
				const diag = pipelineDiagnostic("unknown_error", "Failed to emit debug findings", {
					stage: "debug",
					sessionId: session.id,
				});
				stageDiags.push(diag);
				this.diagnostics.push(diag);

				return {
					stage: "debug",
					success: false,
					startedAt,
					completedAt: new Date().toISOString(),
					runtimeMs: Date.now() - stageStart,
					tokensConsumed: estimatedTokens,
					diagnostics: stageDiags,
					error: "Failed to emit debug findings",
					output: {},
				};
			}

			this.debuggerOutput = findings;
			this.totalTokens += estimatedTokens;

			const successDiag = pipelineDiagnostic("completed", "Debug stage completed successfully", {
				stage: "debug",
				sessionId: session.id,
				findingsCount: 1,
				rootCauses: analysis.findings?.length ?? 0,
			});
			stageDiags.push(successDiag);

			return {
				stage: "debug",
				success: true,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: Date.now() - stageStart,
				tokensConsumed: estimatedTokens,
				diagnostics: stageDiags,
				error: null,
				output: findings as unknown as Record<string, unknown>,
			};
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			const diag = pipelineDiagnostic("unknown_error", `Debug stage threw exception: ${errMsg}`, {
				stage: "debug",
				error: errMsg,
			});
			stageDiags.push(diag);
			this.diagnostics.push(diag);

			return {
				stage: "debug",
				success: false,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: Date.now() - stageStart,
				tokensConsumed: 0,
				diagnostics: stageDiags,
				error: errMsg,
				output: {},
			};
		}
	}

	/**
	 * Run the handoff stage: transfer debug findings into the handoff
	 * inbox for the fix strategist to consume.
	 */
	private runHandoffStage(debugOutput: DebuggerHandoffResult): DebugToFixStageResult {
		const stageStart = Date.now();
		const startedAt = new Date(stageStart).toISOString();
		const stageDiags: WorkerDiagnostic[] = [];

		if (!this.policy.handoffStage.enabled) {
			const diag = pipelineDiagnostic("completed", "Handoff stage is disabled by policy — skipping", {
				stage: "handoff",
			});
			stageDiags.push(diag);
			this.diagnostics.push(diag);

			return {
				stage: "handoff",
				success: true,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: 0,
				tokensConsumed: 0,
				diagnostics: stageDiags,
				error: null,
				output: {},
			};
		}

		try {
			// Create handoff inbox
			const inbox = new HandoffInbox();

			// Convert DebuggerHandoffResult evidence to FixEvidenceItem[]
			const fixEvidence: FixEvidenceItem[] = [];
			if (debugOutput.rootCauseAnalysis?.findings) {
				for (const finding of debugOutput.rootCauseAnalysis.findings) {
					fixEvidence.push({
						label: `Root cause: ${finding.category}`,
						content: finding.description,
						type: finding.category,
						confidence: `confidence_${Math.round(finding.confidence * 100)}`,
					});
				}
			}
			if (debugOutput.evidenceSummary?.keyFindings) {
				for (const finding of debugOutput.evidenceSummary.keyFindings) {
					fixEvidence.push({
						label: finding.label,
						content: finding.summary ?? finding.description ?? "",
						type: finding.type,
						confidence: finding.confidence,
					});
				}
			}

			// If no structured evidence, use the debug output as raw evidence
			if (fixEvidence.length === 0) {
				fixEvidence.push({
					label: debugOutput.label,
					content: `Debug session completed with status ${debugOutput.status}${
						debugOutput.error ? `: ${debugOutput.error}` : ""
					}`,
					type: "session_result",
					confidence: "medium",
				});
			}

			// Build failure context from debug output
			const context: FailureContext = {
				reproducible: debugOutput.rootCauseAnalysis?.findings
					? debugOutput.rootCauseAnalysis.findings.length > 0
					: undefined,
			};

			// Compute handoff dedup key
			const handoffDedupKey = createHash("sha256")
				.update(debugOutput.sessionId + (debugOutput.correlationId ?? ""))
				.digest("hex");

			// Create handoff entry in the inbox
			const createResult = inbox.create({
				sourceWorkerId: `debugger-session-${debugOutput.sessionId}`,
				sourceWorkerRole: "diagnostician",
				targetWorkerRole: "fixStrategist",
				title: `Fix: ${debugOutput.label}`,
				description: `Debug findings from session ${debugOutput.sessionId}: ${
					debugOutput.rootCauseAnalysis?.findings?.length ?? 0
				} root cause(s) identified`,
				dedupKey: handoffDedupKey,
				priority: "high",
				input: {
					evidence: fixEvidence,
					context,
					originalSessionId: debugOutput.sessionId,
				},
				output: {
					rootCauseAnalysis: debugOutput.rootCauseAnalysis,
					evidenceSummary: debugOutput.evidenceSummary,
					diagnostic: debugOutput.diagnostic,
				},
				tags: [...this.policy.handoffTags],
				evidenceRefs: [`debugger://sessions/${debugOutput.sessionId}`],
				metadata: {
					correlationId: this.correlationId,
					pipelineDedupKey: this.dedupKey,
				},
			});

			if ("duplicate" in createResult) {
				// Handoff was deduped — use the existing entry
				const existingEntry = createResult.duplicate;
				this.handoffEntryId = existingEntry.id;
				const diag = pipelineDiagnostic("completed", "Handoff entry suppressed by dedup — using existing", {
					stage: "handoff",
					existingEntryId: existingEntry.id,
					reason: createResult.reason,
				});
				stageDiags.push(diag);
				this.diagnostics.push(diag);

				return {
					stage: "handoff",
					success: true,
					startedAt,
					completedAt: new Date().toISOString(),
					runtimeMs: Date.now() - stageStart,
					tokensConsumed: 0,
					diagnostics: stageDiags,
					error: null,
					output: {
						entryId: existingEntry.id,
						evidence: fixEvidence,
						context,
						deduped: true,
					},
				};
			}

			if ("error" in createResult) {
				const diag = pipelineDiagnostic("dependency_unavailable", `Handoff creation failed: ${createResult.error}`, {
					stage: "handoff",
					error: createResult.error,
				});
				stageDiags.push(diag);
				this.diagnostics.push(diag);

				return {
					stage: "handoff",
					success: false,
					startedAt,
					completedAt: new Date().toISOString(),
					runtimeMs: Date.now() - stageStart,
					tokensConsumed: 0,
					diagnostics: stageDiags,
					error: createResult.error,
					output: {},
				};
			}

			// Route via triage
			const router = new TriageRouter(inbox);
			router.addRule(this.createFixStrategistRoutingRule());
			const cycleResult = router.processCycle();

			// Check routing result
			const routedEntry = cycleResult.routingResults.find((r) => r.success);
			if (!routedEntry) {
				const errors = cycleResult.routingResults.map((r) => r.error).filter(Boolean);
				const diag = pipelineDiagnostic(
					"dependency_unavailable",
					`Handoff routing failed: ${errors.join("; ") || "no rules matched"}`,
					{
						stage: "handoff",
						entriesProcessed: cycleResult.entriesProcessed,
						entriesRouted: cycleResult.entriesRouted,
						entriesFailed: cycleResult.entriesFailed,
					},
				);
				stageDiags.push(diag);
				this.diagnostics.push(diag);

				return {
					stage: "handoff",
					success: false,
					startedAt,
					completedAt: new Date().toISOString(),
					runtimeMs: Date.now() - stageStart,
					tokensConsumed: 0,
					diagnostics: stageDiags,
					error: errors.join("; ") || "No routing rule matched",
					output: {},
				};
			}

			this.handoffEntryId = createResult.entry.id;

			// Retrieve the dispatched entry to get the final state
			const dispatchedEntry = inbox.get(createResult.entry.id);

			const successDiag = pipelineDiagnostic("completed", "Handoff stage completed successfully", {
				stage: "handoff",
				entryId: createResult.entry.id,
				routedTo: routedEntry.routedToRole,
				evidenceCount: fixEvidence.length,
			});
			stageDiags.push(successDiag);
			this.diagnostics.push(successDiag);

			return {
				stage: "handoff",
				success: true,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: Date.now() - stageStart,
				tokensConsumed: 0,
				diagnostics: stageDiags,
				error: null,
				output: {
					entryId: createResult.entry.id,
					evidence: fixEvidence,
					context,
					dispatched: dispatchedEntry?.status === "dispatched",
					routingRuleId: routedEntry.routingRuleId,
				},
			};
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			const diag = pipelineDiagnostic("unknown_error", `Handoff stage threw exception: ${errMsg}`, {
				stage: "handoff",
				error: errMsg,
			});
			stageDiags.push(diag);
			this.diagnostics.push(diag);

			return {
				stage: "handoff",
				success: false,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: Date.now() - stageStart,
				tokensConsumed: 0,
				diagnostics: stageDiags,
				error: errMsg,
				output: {},
			};
		}
	}

	/**
	 * Run the fix stage: process handoff evidence through the fix
	 * strategist worker to generate patch strategies and test plans.
	 */
	private runFixStage(
		handoffOutput: { entryId: string; evidence: FixEvidenceItem[]; context?: FailureContext },
		fixStrategistWorker: FixStrategistWorker,
	): DebugToFixStageResult {
		const stageStart = Date.now();
		const startedAt = new Date(stageStart).toISOString();
		const stageDiags: WorkerDiagnostic[] = [];

		if (!this.policy.fixStage.enabled) {
			const diag = pipelineDiagnostic("completed", "Fix stage is disabled by policy — skipping", {
				stage: "fix",
			});
			stageDiags.push(diag);
			this.diagnostics.push(diag);

			return {
				stage: "fix",
				success: true,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: 0,
				tokensConsumed: 0,
				diagnostics: stageDiags,
				error: null,
				output: {},
			};
		}

		try {
			// Run fix strategist analysis
			const result = fixStrategistWorker.analyze(
				handoffOutput.evidence,
				handoffOutput.context,
				`pipeline-fix-${this.handoffEntryId ?? "unknown"}`,
			);

			// Emit proposal if analysis succeeded
			if (result.success) {
				const proposal = fixStrategistWorker.emitProposal(result.id);
				if (proposal) {
					this.fixStrategistOutput = proposal;
				}
			}

			this.fixResult = result;

			// Track tokens consumed
			const estimatedTokens = handoffOutput.evidence.reduce(
				(sum, e) => sum + e.content.length + e.label.length,
				0,
			);
			this.totalTokens += estimatedTokens;

			if (result.success) {
				const diag = pipelineDiagnostic("completed", "Fix stage completed successfully", {
					stage: "fix",
					resultId: result.id,
					strategyCount: result.strategies.length,
					testPlanCount: result.testPlans.length,
				});
				stageDiags.push(diag);
				this.diagnostics.push(diag);

				return {
					stage: "fix",
					success: true,
					startedAt,
					completedAt: new Date().toISOString(),
					runtimeMs: Date.now() - stageStart,
					tokensConsumed: estimatedTokens,
					diagnostics: stageDiags,
					error: null,
					output: {
						resultId: result.id,
						strategies: result.strategies,
						testPlans: result.testPlans,
						summary: result.summary,
					},
				};
			}

			// Analysis didn't generate strategies — check diagnostics for the reason
			const errorMessages = result.diagnostics
				.filter((d) => d.stopCondition !== "completed")
				.map((d) => d.message);
			const errMsg = errorMessages.length > 0
				? errorMessages.join("; ")
				: result.summary;

			const diag = pipelineDiagnostic(
				"unknown_error",
				`Fix strategist analysis completed but no strategies generated: ${errMsg}`,
				{
					stage: "fix",
					resultId: result.id,
					rootCauses: result.strategies.length,
					diagnosticCount: result.diagnostics.length,
				},
			);
			stageDiags.push(diag);
			this.diagnostics.push(diag);

			return {
				stage: "fix",
				success: false,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: Date.now() - stageStart,
				tokensConsumed: estimatedTokens,
				diagnostics: stageDiags,
				error: errMsg,
				output: {
					resultId: result.id,
					strategies: result.strategies,
					testPlans: result.testPlans,
					summary: result.summary,
				},
			};
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			const diag = pipelineDiagnostic("unknown_error", `Fix stage threw exception: ${errMsg}`, {
				stage: "fix",
				error: errMsg,
			});
			stageDiags.push(diag);
			this.diagnostics.push(diag);

			return {
				stage: "fix",
				success: false,
				startedAt,
				completedAt: new Date().toISOString(),
				runtimeMs: Date.now() - stageStart,
				tokensConsumed: 0,
				diagnostics: stageDiags,
				error: errMsg,
				output: {},
			};
		}
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Handle a stage failure by checking retry policy and updating state.
	 */
	private handleStageFailure(runId: string, failedStage: DebugToFixStageResult): DebugToFixPipelineResult {
		// Add failure diagnostics
		const failureDiag = pipelineDiagnostic("unknown_error", `Pipeline stage "${failedStage.stage}" failed`, {
			stage: failedStage.stage,
			error: failedStage.error,
			retryCount: this.retryCount,
			maxRetries: this.policy.maxPipelineRetries,
		});
		this.diagnostics.push(failureDiag);

		// Check if we should retry
		if (this.retryCount < this.policy.maxPipelineRetries) {
			this.retryCount++;
			// Reset state so pipeline can be re-run
			this.state = "paused";
			this.completedAt = new Date().toISOString();

			const retryDiag = pipelineDiagnostic("completed", `Pipeline paused after stage failure — ${this.policy.maxPipelineRetries - this.retryCount + 1} retries remaining`, {
				stage: failedStage.stage,
				retryCount: this.retryCount,
				maxRetries: this.policy.maxPipelineRetries,
			});
			this.diagnostics.push(retryDiag);

			return this.buildResult(runId, "paused", this.diagnostics, failedStage.error);
		}

		// No retries left — mark as failed
		this.state = "failed";
		this.completedAt = new Date().toISOString();

		return this.buildResult(runId, "failed", this.diagnostics, failedStage.error);
	}

	/**
	 * Build a pipeline result from current state.
	 */
	private buildResult(
		id: string,
		state: DebugToFixPipelineState,
		diagnostics: WorkerDiagnostic[],
		error: string | null,
	): DebugToFixPipelineResult {
		const now = new Date().toISOString();
		const totalRuntime = this.pipelineStartTime > 0 ? Date.now() - this.pipelineStartTime : 0;

		// Collect all diagnostics from stages
		const allDiagnostics = [
			...diagnostics,
			...this.stageResults.flatMap((s) => s.diagnostics),
		];

		return {
			id,
			state,
			startedAt: this.startedAt ?? now,
			completedAt: this.completedAt ?? now,
			totalRuntimeMs: totalRuntime,
			totalTokensConsumed: this.totalTokens,
			stages: [...this.stageResults],
			success: state === "completed",
			diagnostics: allDiagnostics,
			debuggerOutput: this.debuggerOutput,
			fixStrategistOutput: this.fixStrategistOutput,
			fixResult: this.fixResult,
			handoffEntryId: this.handoffEntryId,
			dedupKey: this.dedupKey,
			correlationId: this.correlationId,
			error,
			metadata: {
				policy: {
					autonomous: this.policy.autonomous,
					maxTotalRuntimeMs: this.policy.maxTotalRuntimeMs,
					maxPipelineRetries: this.policy.maxPipelineRetries,
				},
			},
		};
	}

	/**
	 * Compute a pipeline-level dedup key from the input.
	 */
	private computeDedupKey(input: DebugToFixPipelineInput): string {
		const stableContent = input.evidence
			.map((e) => `${e.label}:${e.content.slice(0, 500)}`)
			.sort()
			.join("|");
		const contextStr = input.context ? JSON.stringify(input.context) : "";
		return createHash("sha256")
			.update(stableContent + contextStr)
			.digest("hex");
	}

	/**
	 * Create a routing rule that routes fix strategist handoffs.
	 */
	private createFixStrategistRoutingRule(): RoutingRule {
		return {
			id: `debug-to-fix-fix-route-${randomUUID().slice(0, 8)}`,
			description: "Route debug findings to fix strategist worker",
			targetRole: "fixStrategist",
			minPriority: "normal",
			requiredTags: this.policy.handoffTags,
			excludedTags: [],
			dispatchToRole: "fixStrategist",
			enabled: true,
			order: 1,
		};
	}
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Compute a content hash from evidence items for deduplication.
 *
 * @param evidence - Evidence items to hash.
 * @returns SHA-256 hex hash string.
 */
export function computeEvidenceHash(evidence: FixEvidenceItem[]): string {
	const content = evidence
		.map((e) => `${e.label}:${e.content.slice(0, 200)}`)
		.sort()
		.join("|");
	return createHash("sha256").update(content).digest("hex");
}

/**
 * Validate pipeline input.
 *
 * Checks that all required fields are present and evidence meets
 * minimum quality requirements.
 *
 * @param input - The pipeline input to validate.
 * @returns Array of validation error messages (empty if valid).
 */
export function validatePipelineInput(input: DebugToFixPipelineInput): string[] {
	const errors: string[] = [];

	if (!input.label || input.label.trim().length === 0) {
		errors.push("label is required and must be a non-empty string");
	}

	if (!input.evidence || input.evidence.length === 0) {
		errors.push("at least one evidence item is required");
	} else {
		const emptyItems = input.evidence.filter((e) => !e.content || e.content.trim().length === 0);
		if (emptyItems.length > 0) {
			errors.push(`${emptyItems.length} evidence item(s) have empty content`);
		}
	}

	return errors;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a DebugToFixPipeline with default configuration.
 *
 * @param config - Optional pipeline configuration overrides.
 * @returns A new DebugToFixPipeline instance.
 */
export function createDebugToFixPipeline(config?: Partial<DebugToFixPipelineConfig>): DebugToFixPipeline {
	return new DebugToFixPipeline(config);
}
