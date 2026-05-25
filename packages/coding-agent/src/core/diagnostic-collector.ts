/**
 * Diagnostic Collector - Workspace 25.E
 *
 * Collects evidence from various execution contexts and builds
 * diagnostic packets. Bridges the failure classifier, scheduling
 * diagnostics, agent execution results, and brain observations into
 * structured diagnostic packets with evidence chains.
 *
 * Key responsibilities:
 * - Collect evidence from file system, git, test output, errors
 * - Build diagnostic packets from failure classifications
 * - Build diagnostic packets from scheduling decisions
 * - Build diagnostic packets from agent execution results
 * - Enforce budget and cooldown constraints
 * - Support deduplication via content hashing
 *
 * @packageDocumentation
 */

import * as crypto from "node:crypto";
import type { FailureClassification, FailureContext } from "../failure/failure-classifier.js";
import { createFailureClassifier } from "../failure/failure-classifier.js";
import type { FileLockConflict, IdleExplanation, SchedulerDiagnostics, SkipReason } from "./scheduler.js";
import type { AgentExecutionResult } from "./workspace-agent-executor.js";
import {
	activateCooldown,
	checkAndClearCooldown,
	createCooldownState,
	createDedupeState,
	createDiagnosticPacket,
	createEvidenceEntry,
	createEvidenceGroup,
	createPacketBudget,
	createPlaceholderEvidenceEntry,
	createStopConditionState,
	type CooldownState,
	type DedupeState,
	type DiagnosticPacket,
	type DiagnosticSeverity,
	type DiagnosticType,
	type EvidenceEntry,
	type EvidenceGroup,
	type PacketBudget,
	type StopConditionState,
	DEFAULT_COOLDOWN_DURATION_MS,
} from "./diagnostic-packet.js";

// ---------------------------------------------------------------------------
// Cooldown and Dedupe Registry
// ---------------------------------------------------------------------------

/**
 * Tracks cooldown and dedupe state across diagnostics.
 *
 * This is the runtime registry that prevents:
 * - Identical diagnostics from being re-emitted within a cooldown window
 * - Duplicate diagnostics from being emitted multiple times
 */
export interface CooldownRegistry {
	/** Cooldown state keyed by dedupe ID */
	cooldowns: Map<string, CooldownState>;
	/** Dedupe state keyed by dedupe ID */
	dedupes: Map<string, DedupeState>;
}

/**
 * Create an empty CooldownRegistry.
 */
export function createCooldownRegistry(): CooldownRegistry {
	return {
		cooldowns: new Map(),
		dedupes: new Map(),
	};
}

// ---------------------------------------------------------------------------
// Evidence Collector
// ---------------------------------------------------------------------------

/**
 * Collects evidence from various sources.
 *
 * Each method returns an EvidenceEntry that can be added to a
 * diagnostic packet's evidence group.
 */
export class EvidenceCollector {
	/**
	 * Create an evidence entry from a file path.
	 *
	 * @param filePath - Absolute or relative file path
	 * @param description - Description of the file evidence
	 * @param source - Source component name
	 * @returns Evidence entry
	 */
	collectFromFile(
		filePath: string,
		description: string,
		source: string,
		content?: string,
		lineRange?: { start: number; end: number },
	): EvidenceEntry {
		return createEvidenceEntry({
			category: "file",
			description,
			source,
			fileData: {
				filePath,
				content,
				lineRange,
			},
		});
	}

	/**
	 * Create an evidence entry from test output.
	 *
	 * @param output - Test output data
	 * @param source - Source component name
	 * @returns Evidence entry
	 */
	collectFromTestOutput(
		output: {
			testSuite?: string;
			testName?: string;
			exitCode?: number;
			passed?: number;
			failed?: number;
			skipped?: number;
			stdout?: string;
			stderr?: string;
			durationMs?: number;
		},
		description: string,
		source: string,
	): EvidenceEntry {
		return createEvidenceEntry({
			category: "test_output",
			description,
			source,
			testData: {
				testSuite: output.testSuite,
				testName: output.testName,
				exitCode: output.exitCode,
				passed: output.passed,
				failed: output.failed,
				skipped: output.skipped,
				stdout: output.stdout,
				stderr: output.stderr,
				durationMs: output.durationMs,
			},
		});
	}

	/**
	 * Create an evidence entry from an error message.
	 *
	 * @param error - Error data
	 * @param source - Source component name
	 * @returns Evidence entry
	 */
	collectFromError(
		error: {
			message: string;
			errorType?: string;
			stackTrace?: string;
			exitCode?: number;
			code?: string;
		},
		description: string,
		source: string,
	): EvidenceEntry {
		return createEvidenceEntry({
			category: "error_message",
			description,
			source,
			errorData: {
				message: error.message,
				errorType: error.errorType,
				stackTrace: error.stackTrace,
				exitCode: error.exitCode,
				code: error.code,
			},
		});
	}

	/**
	 * Create an evidence entry from a scheduling skip reason.
	 *
	 * @param skipReason - The skip reason from scheduler diagnostics
	 * @param source - Source component name
	 * @returns Evidence entry
	 */
	collectFromSkipReason(skipReason: SkipReason, source: string): EvidenceEntry {
		return createEvidenceEntry({
			category: "scheduling_decision",
			description: `Skipped: ${skipReason.category} - ${skipReason.reason}`,
			source,
			schedulingData: {
				workspaceId: skipReason.workspaceId,
				decision: "skipped",
				skipReason,
			},
		});
	}

	/**
	 * Create an evidence entry from a failure classification.
	 *
	 * @param classification - Failure classification
	 * @param source - Source component name
	 * @returns Evidence entry
	 */
	collectFromFailureClassification(
		classification: FailureClassification,
		source: string,
	): EvidenceEntry {
		return createEvidenceEntry({
			category: "failure_classification",
			description: `Failure: ${classification.category} (confidence: ${Math.round(classification.confidence * 100)}%)`,
			source,
			failureData: {
				category: classification.category,
				confidence: classification.confidence,
				recoverable: classification.recoverable,
				details: classification.details,
			},
		});
	}

	/**
	 * Create an evidence entry from an agent execution result.
	 *
	 * @param result - Agent execution result
	 * @param source - Source component name
	 * @returns Evidence entry
	 */
	collectFromAgentResult(result: AgentExecutionResult, source: string): EvidenceEntry {
		return createEvidenceEntry({
			category: "agent_report",
			description: `Agent ${result.verdict}: ${result.report.slice(0, 200)}`,
			source,
			agentReportData: {
				verdict: result.verdict,
				report: result.report,
			},
		});
	}

	/**
	 * Create a cooldown state evidence entry.
	 *
	 * @param state - Cooldown state
	 * @param source - Source component name
	 * @returns Evidence entry
	 */
	collectFromCooldownState(state: CooldownState, source: string): EvidenceEntry {
		return createEvidenceEntry({
			category: "cooldown_state",
			description: state.isActive
				? `Cooldown active: ${state.cooldownReason} (${Math.round(state.remainingMs / 1000)}s remaining)`
				: "Cooldown inactive",
			source,
			cooldownData: {
				isActive: state.isActive,
				reason: state.cooldownReason ?? "No reason specified",
				expiresAt: state.cooldownUntil,
				remainingMs: state.remainingMs,
			},
		});
	}
}

// ---------------------------------------------------------------------------
// Diagnostic Collector
// ---------------------------------------------------------------------------

/**
 * Configuration for the Diagnostic Collector.
 */
export interface DiagnosticCollectorConfig {
	/** Default cooldown duration in milliseconds */
	defaultCooldownMs?: number;
	/** Maximum evidence entries per packet */
	maxEvidenceEntries?: number;
	/** Maximum evidence groups per packet */
	maxEvidenceGroups?: number;
	/** Maximum packet size in bytes */
	maxPacketSizeBytes?: number;
	/** Component name used as source for generated evidence */
	componentName?: string;
}

/**
 * Default diagnostic collector configuration.
 */
export const DEFAULT_DIAGNOSTIC_COLLECTOR_CONFIG: DiagnosticCollectorConfig = {
	defaultCooldownMs: DEFAULT_COOLDOWN_DURATION_MS,
	maxEvidenceEntries: 50,
	maxEvidenceGroups: 10,
	maxPacketSizeBytes: 1_000_000,
	componentName: "diagnostic-collector",
};

/**
 * Diagnostic Collector.
 *
 * Builds diagnostic packets from various execution contexts.
 * Enforces budget, cooldown, and deduplication constraints.
 */
export class DiagnosticCollector {
	private config: DiagnosticCollectorConfig;
	private registry: CooldownRegistry;
	private failureClassifier: ReturnType<typeof createFailureClassifier>;
	private evidenceCollector: EvidenceCollector;

	constructor(config?: DiagnosticCollectorConfig) {
		this.config = { ...DEFAULT_DIAGNOSTIC_COLLECTOR_CONFIG, ...config };
		this.registry = createCooldownRegistry();
		this.failureClassifier = createFailureClassifier();
		this.evidenceCollector = new EvidenceCollector();
	}

	/**
	 * Build a diagnostic packet from a failure.
	 *
	 * @param failureContext - The failure context
	 * @param workspaceId - Workspace ID
	 * @param planExecutionId - Optional plan execution ID
	 * @returns Diagnostic packet, or null if suppressed by cooldown/dedupe
	 */
	buildFromFailure(
		failureContext: FailureContext,
		workspaceId: string,
		planExecutionId?: string,
	): DiagnosticPacket | null {
		const source = this.config.componentName ?? "diagnostic-collector";

		// Classify the failure
		const classification = this.failureClassifier.classify(failureContext);

		// Check deduplication
		const dedupeId = crypto
			.createHash("sha256")
			.update(JSON.stringify({ type: "failure", workspaceId, category: classification.category }))
			.digest("hex");

		if (this.isDedupeSuppressed(dedupeId)) {
			return null;
		}

		// Check cooldown
		if (this.isCooldownActive(dedupeId)) {
			return null;
		}

		// Build evidence
		const classificationEvidence = this.evidenceCollector.collectFromFailureClassification(classification, source);

		const errorEvidence = this.evidenceCollector.collectFromError(
			{
				message: failureContext.error,
				errorType: classification.category,
			},
			`Error: ${failureContext.error.slice(0, 200)}`,
			source,
		);

		const evidenceGroup = createEvidenceGroup("Failure Classification", [
			classificationEvidence,
			errorEvidence,
		]);

		// Determine severity from failure category
		const severity = this.failureToSeverity(classification);

		// Determine diagnostic type
		const diagnosticType: DiagnosticType = classification.recoverable ? "execution_incomplete" : "failure";

		// Build the packet
		const packet = createDiagnosticPacket({
			severity,
			diagnosticType,
			workspaceId,
			planExecutionId,
			title: `Failure in workspace ${workspaceId}: ${classification.category}`,
			description: classification.details
				? `Workspace ${workspaceId} failed with ${classification.category}: ${classification.details}`
				: `Workspace ${workspaceId} failed with ${classification.category}`,
			evidence: [evidenceGroup],
			failureClassification: classification,
			cooldownDurationMs: this.config.defaultCooldownMs,
			dedupeId,
		});

		// Activate cooldown
		this.activateCooldown(dedupeId, `Failure diagnostic for workspace ${workspaceId}`);
		this.recordDedupe(dedupeId);

		return packet;
	}

	/**
	 * Build a diagnostic packet from scheduler diagnostics.
	 *
	 * @param schedulerDiagnostics - The scheduler diagnostic output
	 * @param workspaceId - Workspace ID (or "system" for global diagnostics)
	 * @returns Diagnostic packet
	 */
	buildFromSchedulerDiagnostics(
		schedulerDiagnostics: SchedulerDiagnostics,
		workspaceId: string,
	): DiagnosticPacket {
		const source = this.config.componentName ?? "diagnostic-collector";
		const groups: EvidenceGroup[] = [];

		// Evidence: selected workspaces
		if (schedulerDiagnostics.selected.length > 0) {
			const selectedEntries = schedulerDiagnostics.selected.map((wsId) =>
				createEvidenceEntry({
					category: "scheduling_decision",
					description: `Selected: ${wsId}`,
					source,
					schedulingData: { workspaceId: wsId, decision: "selected" },
				}),
			);
			groups.push(createEvidenceGroup("Selected Workspaces", selectedEntries));
		}

		// Evidence: skipped workspaces
		if (schedulerDiagnostics.skipped.length > 0) {
			const skipEntries = schedulerDiagnostics.skipped.map((skip) =>
				this.evidenceCollector.collectFromSkipReason(skip, source),
			);
			groups.push(createEvidenceGroup("Skipped Workspaces", skipEntries));
		}

		// Evidence: idle explanation
		if (schedulerDiagnostics.idle.isIdle) {
			const idleEntries = schedulerDiagnostics.idle.reasons.map((reason, i) =>
				createEvidenceEntry({
					category: "scheduling_decision",
					description: `Idle reason ${i + 1}: ${reason}`,
					source,
					schedulingData: { workspaceId: "system", decision: "idle" },
				}),
			);
			groups.push(createEvidenceGroup("Scheduler Idle", idleEntries));
		}

		// Evidence: capacity snapshot
		const cap = schedulerDiagnostics.capacity;
		const capacityEntry = createEvidenceEntry({
			category: "scheduling_decision",
			description: `Capacity: ${cap.activeWorkers}/${cap.maxWorkers} workers active, ${cap.availableSlots} slots available`,
			source,
			data: {
				maxWorkers: cap.maxWorkers,
				activeWorkers: cap.activeWorkers,
				availableSlots: cap.availableSlots,
				utilization: cap.utilization,
				resourcePressure: cap.resourcePressure,
				fileLocks: cap.fileLocks,
			},
		});
		groups.push(createEvidenceGroup("Capacity Snapshot", [capacityEntry]));

		// Determine severity and type
		let severity: DiagnosticSeverity = "info";
		let diagnosticType: DiagnosticType = "observation";

		if (schedulerDiagnostics.idle.isIdle) {
			severity = "warning";
			diagnosticType = "idle";
		}

		if (schedulerDiagnostics.skipped.some((s) => s.category === "file_lock")) {
			severity = "warning";
		}

		if (schedulerDiagnostics.capacity.utilization >= 0.9) {
			severity = "warning";
		}

		if (schedulerDiagnostics.capacity.resourcePressure > 0.8) {
			severity = "warning";
			diagnosticType = "resource_pressure";
		}

		return createDiagnosticPacket({
			severity,
			diagnosticType,
			workspaceId,
			title: `Scheduler diagnostic for workspace ${workspaceId}`,
			description: `Scheduler evaluated ${schedulerDiagnostics.capacity.totalWorkspaces} workspaces: ${schedulerDiagnostics.selected.length} selected, ${schedulerDiagnostics.skipped.length} skipped`,
			evidence: groups,
			schedulingDiagnostics: schedulerDiagnostics,
		});
	}

	/**
	 * Build a diagnostic packet from an agent execution result.
	 *
	 * @param result - Agent execution result
	 * @param workspaceId - Workspace ID
	 * @param planExecutionId - Optional plan execution ID
	 * @returns Diagnostic packet, or null if suppressed by cooldown/dedupe
	 */
	buildFromAgentResult(
		result: AgentExecutionResult,
		workspaceId: string,
		planExecutionId?: string,
	): DiagnosticPacket | null {
		const source = this.config.componentName ?? "diagnostic-collector";

		const dedupeId = crypto
			.createHash("sha256")
			.update(JSON.stringify({ type: "agent_result", workspaceId, verdict: result.verdict }))
			.digest("hex");

		if (this.isDedupeSuppressed(dedupeId)) {
			return null;
		}

		if (this.isCooldownActive(dedupeId)) {
			return null;
		}

		// Build evidence
		const agentEvidence = this.evidenceCollector.collectFromAgentResult(result, source);

		// If failed, classify and add failure evidence
		let failureClassification: FailureClassification | undefined;
		const allEntries: EvidenceEntry[] = [agentEvidence];

		if (result.verdict === "FAILED" && result.error) {
			const context = { error: result.error, workspaceTitle: workspaceId };
			const classification = this.failureClassifier.classify(context);
			failureClassification = classification;

			const failureEvidence = this.evidenceCollector.collectFromFailureClassification(classification, source);
			allEntries.push(failureEvidence);

			const errorEvidence = this.evidenceCollector.collectFromError(
				{ message: result.error },
				`Execution error: ${result.error.slice(0, 200)}`,
				source,
			);
			allEntries.push(errorEvidence);
		}

		const evidenceGroup = createEvidenceGroup("Agent Execution", allEntries);

		// Determine severity and type
		let severity: DiagnosticSeverity;
		let diagnosticType: DiagnosticType;

		switch (result.verdict) {
			case "COMPLETE":
				severity = "info";
				diagnosticType = "execution_complete";
				break;
			case "BLOCKED":
				severity = "warning";
				diagnosticType = "block";
				break;
			case "FAILED":
				severity = "error";
				diagnosticType = "failure";
				break;
		}

		const packet = createDiagnosticPacket({
			severity,
			diagnosticType,
			workspaceId,
			planExecutionId,
			title: `Agent execution result for workspace ${workspaceId}: ${result.verdict}`,
			description: result.error
				? `Agent execution ${result.verdict}: ${result.error.slice(0, 300)}`
				: `Agent execution ${result.verdict}`,
			evidence: [evidenceGroup],
			failureClassification,
			cooldownDurationMs: this.config.defaultCooldownMs,
			dedupeId,
		});

		// Activate cooldown
		this.activateCooldown(dedupeId, `Agent execution diagnostic for workspace ${workspaceId}`);
		this.recordDedupe(dedupeId);

		return packet;
	}

	/**
	 * Build a diagnostic packet for a budget exceeded event.
	 *
	 * @param workspaceId - Workspace ID
	 * @param budgetDescription - Description of the budget that was exceeded
	 * @param metadata - Additional metadata
	 * @returns Diagnostic packet
	 */
	buildFromBudgetExceeded(
		workspaceId: string,
		budgetDescription: string,
		metadata?: Record<string, unknown>,
	): DiagnosticPacket {
		const source = this.config.componentName ?? "diagnostic-collector";

		const budgetEntry = createEvidenceEntry({
			category: "budget_snapshot",
			description: budgetDescription,
			source,
			data: metadata ?? {},
		});

		const evidenceGroup = createEvidenceGroup("Budget Exceeded", [budgetEntry]);

		return createDiagnosticPacket({
			severity: "error",
			diagnosticType: "budget_exceeded",
			workspaceId,
			title: `Budget exceeded for workspace ${workspaceId}`,
			description: budgetDescription,
			evidence: [evidenceGroup],
			metadata,
		});
	}

	/**
	 * Build a diagnostic packet for a stop condition being triggered.
	 *
	 * @param workspaceId - Workspace ID
	 * @param condition - The stop condition that triggered
	 * @param detail - Human-readable detail
	 * @param metadata - Additional metadata
	 * @returns Diagnostic packet
	 */
	buildFromStopCondition(
		workspaceId: string,
		condition: string,
		detail: string,
		metadata?: Record<string, unknown>,
	): DiagnosticPacket {
		const source = this.config.componentName ?? "diagnostic-collector";

		const stopEntry = createEvidenceEntry({
			category: "log_output",
			description: `Stop condition triggered: ${condition}`,
			source,
			data: { condition, detail, ...metadata },
		});

		const evidenceGroup = createEvidenceGroup("Stop Condition", [stopEntry]);

		return createDiagnosticPacket({
			severity: "warning",
			diagnosticType: "stop_condition_triggered",
			workspaceId,
			title: `Stop condition triggered for workspace ${workspaceId}`,
			description: detail,
			evidence: [evidenceGroup],
			stopCondition: createStopConditionState({
				triggered: true,
				condition,
				detail,
				metadata: metadata ?? {},
			}),
			metadata: metadata ?? {},
		});
	}

	/**
	 * Build a diagnostic packet for a cooldown active event.
	 *
	 * @param workspaceId - Workspace ID
	 * @param reason - Reason for cooldown
	 * @param remainingMs - Remaining cooldown time
	 * @returns Diagnostic packet
	 */
	buildFromCooldown(
		workspaceId: string,
		reason: string,
		remainingMs: number,
	): DiagnosticPacket {
		const source = this.config.componentName ?? "diagnostic-collector";

		const cooldownState = createCooldownState({
			isActive: true,
			cooldownReason: reason,
			remainingMs,
			durationMs: this.config.defaultCooldownMs ?? DEFAULT_COOLDOWN_DURATION_MS,
		});

		const cooldownEntry = this.evidenceCollector.collectFromCooldownState(cooldownState, source);
		const evidenceGroup = createEvidenceGroup("Cooldown Active", [cooldownEntry]);

		// Create the base packet, then patch its cooldown to reflect the active state
		const packet = createDiagnosticPacket({
			severity: "info",
			diagnosticType: "cooldown_active",
			workspaceId,
			title: `Cooldown active for workspace ${workspaceId}`,
			description: reason,
			evidence: [evidenceGroup],
			cooldownDurationMs: cooldownState.durationMs,
		});

		// Override the cooldown state to reflect the actual active cooldown
		packet.cooldown = cooldownState;

		return packet;
	}

	/**
	 * Build a diagnostic packet for a general observation.
	 *
	 * @param workspaceId - Workspace ID
	 * @param title - Diagnostic title
	 * @param description - Diagnostic description
	 * @param evidence - Evidence groups
	 * @param severity - Severity level
	 * @returns Diagnostic packet
	 */
	buildObservation(
		workspaceId: string,
		title: string,
		description: string,
		evidence: EvidenceGroup[],
		severity: DiagnosticSeverity = "info",
	): DiagnosticPacket {
		return createDiagnosticPacket({
			severity,
			diagnosticType: "observation",
			workspaceId,
			title,
			description,
			evidence,
		});
	}

	// -----------------------------------------------------------------------
	// Cooldown & Dedupe Management
	// -----------------------------------------------------------------------

	/**
	 * Check whether a dedupe ID is currently suppressed.
	 */
	isDedupeSuppressed(dedupeId: string): boolean {
		const state = this.registry.dedupes.get(dedupeId);
		return state?.isSuppressed ?? false;
	}

	/**
	 * Check whether a dedupe ID has an active cooldown.
	 */
	isCooldownActive(dedupeId: string): boolean {
		const state = this.registry.cooldowns.get(dedupeId);
		if (!state) return false;
		const checked = checkAndClearCooldown(state);
		this.registry.cooldowns.set(dedupeId, checked);
		return checked.isActive;
	}

	/**
	 * Activate cooldown for a dedupe ID.
	 */
	activateCooldown(dedupeId: string, reason: string): void {
		const existing = this.registry.cooldowns.get(dedupeId) ?? createCooldownState({
			durationMs: this.config.defaultCooldownMs ?? DEFAULT_COOLDOWN_DURATION_MS,
		});
		this.registry.cooldowns.set(dedupeId, activateCooldown(existing, reason));
	}

	/**
	 * Record a deduplication occurrence.
	 */
	recordDedupe(dedupeId: string): void {
		const existing = this.registry.dedupes.get(dedupeId);
		if (existing) {
			this.registry.dedupes.set(dedupeId, {
				...existing,
				occurrenceCount: existing.occurrenceCount + 1,
			});
		} else {
			this.registry.dedupes.set(dedupeId, createDedupeState(dedupeId));
		}
	}

	/**
	 * Suppress a dedupe ID (mark as duplicate, future packets will be rejected).
	 */
	suppressDedupe(dedupeId: string): void {
		this.registry.dedupes.set(dedupeId, createDedupeState(dedupeId, { isSuppressed: true }));
	}

	/**
	 * Clear cooldown for a dedupe ID.
	 */
	clearCooldown(dedupeId: string): void {
		this.registry.cooldowns.delete(dedupeId);
	}

	/**
	 * Reset all cooldowns and dedupes.
	 */
	resetRegistry(): void {
		this.registry.cooldowns.clear();
		this.registry.dedupes.clear();
	}

	/**
	 * Get the current cooldown registry (for inspection/diagnostics).
	 */
	getRegistry(): CooldownRegistry {
		return this.registry;
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Map a failure classification to a diagnostic severity.
	 */
	private failureToSeverity(classification: FailureClassification): DiagnosticSeverity {
		switch (classification.category) {
			case "merge_conflict":
			case "permission":
				return "critical";
			case "build":
			case "test":
			case "runtime":
				return "error";
			case "network":
			case "timeout":
			case "lint":
			case "type":
				return "warning";
			case "review":
			case "unknown":
				return "warning";
			default:
				return "error";
		}
	}
}

/**
 * Create a DiagnosticCollector with default configuration.
 */
export function createDiagnosticCollector(config?: DiagnosticCollectorConfig): DiagnosticCollector {
	return new DiagnosticCollector(config);
}
