/**
 * Diagnostic Collector - Workspace 25.E
 *
 * Collectors that build diagnostic packets from execution context:
 * - Failure classification
 * - Scheduler diagnostics
 * - Agent results
 * - Budget exceeded events
 * - Stop conditions
 * - Cooldown events
 * - General observations
 *
 * Implements:
 * - Cooldown-based rate limiting to prevent rapid re-emission
 * - Deduplication registry to suppress repeated diagnostics
 * - Placeholder evidence for missing data (no silent errors)
 */

import {
	type AgentVerdict,
	activateCooldown,
	type CooldownState,
	checkAndClearCooldown,
	createCooldownState,
	createDiagnosticPacket,
	createEvidenceEntry,
	createEvidenceGroup,
	DEFAULT_COOLDOWN_DURATION_MS,
	type DedupeState,
	type DiagnosticPacket,
	type DiagnosticType,
	type EvidenceEntry,
	type EvidenceGroup,
	type FailureData,
	type PacketSeverity,
	type SkipReason,
} from "./diagnostic-packet.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Failure context for building failure diagnostics.
 */
export interface FailureContext {
	error: string;
	workspaceTitle: string;
	diagnosticType?: DiagnosticType;
}

/**
 * Scheduler diagnostics data structure mirroring the scheduler output.
 */
export interface SchedulerDiagnostics {
	selected: string[];
	selectedWithReasons: Array<{ workspaceId: string; reason: string }>;
	skipped: SkipReason[];
	idle: { isIdle: boolean; reasons: string[] };
	capacity: {
		maxWorkers: number;
		effectiveMaxWorkers: number;
		activeWorkers: number;
		availableSlots: number;
		totalWorkspaces: number;
		pending: number;
		active: number;
		complete: number;
		blocked: number;
		failed: number;
		fileLocks: number;
		utilization: number;
		isWorktreeMode: boolean;
		resourcePressure: number;
	};
	batchIds: Map<string, string>;
}

/**
 * Agent result data for building execution diagnostics.
 */
export interface AgentResult {
	success: boolean;
	verdict: AgentVerdict;
	report: string;
	error?: string;
	logs: string[];
}

/**
 * Collector registry tracking cooldowns and dedupe states.
 */
export interface CollectorRegistry {
	cooldowns: Map<string, CooldownState>;
	dedupes: Map<string, DedupeState>;
}

/**
 * Options for creating a DiagnosticCollector.
 */
export interface DiagnosticCollectorOptions {
	defaultCooldownMs?: number;
	componentName?: string;
}

// ---------------------------------------------------------------------------
// EvidenceCollector
// ---------------------------------------------------------------------------

/**
 * Evidence collector providing convenience methods for creating
 * evidence entries from common data sources.
 */
export class EvidenceCollector {
	/**
	 * Collect evidence from a file.
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
				...(content !== undefined ? { content } : {}),
				...(lineRange !== undefined ? { lineRange } : {}),
			},
		});
	}

	/**
	 * Collect evidence from test output.
	 */
	collectFromTestOutput(
		testData: {
			testSuite: string;
			testName?: string;
			exitCode?: number;
			passed?: number;
			failed?: number;
			skipped?: number;
			stdout?: string;
		},
		description: string,
		source: string,
	): EvidenceEntry {
		return createEvidenceEntry({
			category: "test_output",
			description,
			source,
			testData,
		});
	}

	/**
	 * Collect evidence from an error.
	 */
	collectFromError(
		errorData: {
			message: string;
			errorType?: string;
			stackTrace?: string;
			exitCode?: number;
		},
		description: string,
		source: string,
	): EvidenceEntry {
		return createEvidenceEntry({
			category: "error_message",
			description,
			source,
			errorData,
		});
	}

	/**
	 * Collect evidence from a skip reason.
	 */
	collectFromSkipReason(skipReason: SkipReason, source: string): EvidenceEntry {
		return createEvidenceEntry({
			category: "scheduling_decision",
			description: `Skipped workspace ${skipReason.workspaceId}: ${skipReason.reason}`,
			source,
			schedulingData: {
				decision: "skipped",
				skipReason,
			},
		});
	}

	/**
	 * Collect evidence from a failure classification.
	 */
	collectFromFailureClassification(classification: FailureData, source: string): EvidenceEntry {
		return createEvidenceEntry({
			category: "failure_classification",
			description: `Failure classified as ${classification.category} (confidence: ${classification.confidence})`,
			source,
			failureData: classification,
		});
	}

	/**
	 * Collect evidence from an agent result.
	 */
	collectFromAgentResult(result: AgentResult, source: string): EvidenceEntry {
		return createEvidenceEntry({
			category: "agent_report",
			description: `Agent verdict: ${result.verdict}`,
			source,
			agentReportData: {
				verdict: result.verdict,
				report: result.report,
				turns: result.logs.length,
				diffGenerated: result.success,
			},
		});
	}

	/**
	 * Collect evidence from a cooldown state.
	 */
	collectFromCooldownState(cooldownState: CooldownState, source: string): EvidenceEntry {
		const now = Date.now();
		const expiryTime = cooldownState.cooldownUntil ? new Date(cooldownState.cooldownUntil).getTime() : now;
		const remainingMs = Math.max(0, expiryTime - now);

		return createEvidenceEntry({
			category: "cooldown_state",
			description: `Cooldown ${cooldownState.isActive ? "active" : "inactive"}: ${cooldownState.cooldownReason ?? "no reason"}`,
			source,
			cooldownData: {
				isActive: cooldownState.isActive,
				reason: cooldownState.cooldownReason ?? undefined,
				expiresAt: cooldownState.cooldownUntil ?? undefined,
				remainingMs: cooldownState.isActive ? remainingMs : 0,
			},
		});
	}
}

// ---------------------------------------------------------------------------
// DiagnosticCollector
// ---------------------------------------------------------------------------

/**
 * Diagnostic collector that builds diagnostic packets from execution context.
 *
 * Features:
 * - Cooldown-based rate limiting to prevent rapid re-emission
 * - Deduplication registry to suppress repeated diagnostics
 * - Placeholder evidence for missing data (no silent errors)
 * - Failure classification from error text analysis
 */
export class DiagnosticCollector {
	private readonly evidenceCollector: EvidenceCollector;
	private readonly defaultCooldownMs: number;
	private readonly componentName: string;
	private registry: CollectorRegistry;

	constructor(options: DiagnosticCollectorOptions = {}) {
		this.evidenceCollector = new EvidenceCollector();
		this.defaultCooldownMs = options.defaultCooldownMs ?? DEFAULT_COOLDOWN_DURATION_MS;
		this.componentName = options.componentName ?? "diagnostic-collector";
		this.registry = {
			cooldowns: new Map(),
			dedupes: new Map(),
		};
	}

	/**
	 * Get the current registry for inspection.
	 */
	getRegistry(): CollectorRegistry {
		return this.registry;
	}

	/**
	 * Reset the entire registry clearing cooldowns and dedupes.
	 */
	resetRegistry(): void {
		this.registry = {
			cooldowns: new Map(),
			dedupes: new Map(),
		};
	}

	/**
	 * Suppress a dedupe ID to prevent future diagnostics with the same ID.
	 */
	suppressDedupe(dedupeId: string): void {
		this.registry.dedupes.set(dedupeId, {
			dedupeId,
			isSuppressed: true,
			occurrenceCount: 1,
		});
	}

	/**
	 * Check if a dedupe ID is suppressed.
	 */
	isDedupeSuppressed(dedupeId: string): boolean {
		const existing = this.registry.dedupes.get(dedupeId);
		return existing?.isSuppressed === true;
	}

	/**
	 * Check and clear the cooldown for a workspace, returning true
	 * if the diagnostic should be emitted (not on cooldown).
	 */
	private checkCooldown(workspaceId: string): boolean {
		const existing = this.registry.cooldowns.get(workspaceId);
		if (!existing) {
			return true;
		}

		const cleared = checkAndClearCooldown(existing);

		// If cooldown is still active after check, suppress emission
		if (cleared.isActive) {
			this.registry.cooldowns.set(workspaceId, cleared);
			return false;
		}

		// Cooldown expired, remove it
		this.registry.cooldowns.delete(workspaceId);
		return true;
	}

	/**
	 * Activate cooldown for a workspace after emitting a diagnostic.
	 */
	private activateCooldown(workspaceId: string, reason: string, durationMs?: number): void {
		const existing = this.registry.cooldowns.get(workspaceId);
		const base =
			existing ??
			createCooldownState({
				durationMs: durationMs ?? this.defaultCooldownMs,
			});
		// Ensure duration is respected even if a previously configured state had a different duration
		const state = durationMs ? { ...base, durationMs } : base;
		const activated = activateCooldown(state, reason);
		this.registry.cooldowns.set(workspaceId, activated);
	}

	// -----------------------------------------------------------------------
	// Classification helpers
	// -----------------------------------------------------------------------

	/**
	 * Classify an error string into a failure category.
	 */
	private classifyFailure(error: string, _workspaceTitle: string): FailureData {
		const lower = error.toLowerCase();

		if (lower.includes("assertionerror") || lower.includes("fail ") || lower.includes("\n  ")) {
			return {
				category: "test",
				confidence: 0.9,
				recoverable: true,
				details: "Test failure detected from assertion error or FAIL marker",
			};
		}

		if (lower.includes("merge conflict") || lower.includes("<<<<<<")) {
			return {
				category: "merge_conflict",
				confidence: 0.95,
				recoverable: true,
				details: "Merge conflict detected in workspace files",
			};
		}

		if (lower.includes("typeerror") || lower.includes("referenceerror") || lower.includes("syntaxerror")) {
			return {
				category: "runtime",
				confidence: 0.85,
				recoverable: true,
				details: `Runtime error: ${error.substring(0, 200)}`,
			};
		}

		if (
			lower.includes("build") ||
			lower.includes("compile") ||
			lower.includes("webpack") ||
			lower.includes("esbuild") ||
			lower.includes("tsc")
		) {
			return {
				category: "build",
				confidence: 0.8,
				recoverable: true,
				details: "Build/compile error detected",
			};
		}

		if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
			return {
				category: "timeout",
				confidence: 0.9,
				recoverable: true,
				details: "Operation timed out",
			};
		}

		if (
			lower.includes("network") ||
			lower.includes("econnrefused") ||
			lower.includes("econnreset") ||
			lower.includes("enotfound")
		) {
			return {
				category: "network",
				confidence: 0.85,
				recoverable: true,
				details: "Network error detected",
			};
		}

		if (lower.includes("permission") || lower.includes("eacces") || lower.includes("eperm")) {
			return {
				category: "permission",
				confidence: 0.9,
				recoverable: false,
				details: "Permission error detected",
			};
		}

		// Default fallback: unknown
		return {
			category: "unknown",
			confidence: 0.5,
			recoverable: true,
			details: `Unclassified error: ${error.substring(0, 200)}`,
		};
	}

	/**
	 * Determine severity from failure classification.
	 */
	private severityFromFailure(classification: FailureData): PacketSeverity {
		if (classification.category === "merge_conflict") {
			return "critical";
		}
		if (classification.category === "permission") {
			return "critical";
		}
		if (classification.category === "build") {
			return "error";
		}
		if (classification.category === "test") {
			return "error";
		}
		if (classification.category === "runtime") {
			return "error";
		}
		if (classification.category === "timeout") {
			return "warning";
		}
		if (classification.category === "network") {
			return "warning";
		}
		return "error";
	}

	// -----------------------------------------------------------------------
	// Builders
	// -----------------------------------------------------------------------

	/**
	 * Build a diagnostic packet from a failure context.
	 *
	 * Classifies the error, creates evidence, and applies cooldown/dedupe.
	 * Returns null if suppressed by cooldown.
	 *
	 * @param failure - Failure context
	 * @param workspaceId - Workspace identifier
	 * @returns Diagnostic packet or null if suppressed
	 */
	buildFromFailure(failure: FailureContext, workspaceId: string): DiagnosticPacket | null {
		// Check cooldown
		if (!this.checkCooldown(workspaceId)) {
			return null;
		}

		const classification = this.classifyFailure(failure.error, failure.workspaceTitle);
		const severity = this.severityFromFailure(classification);

		// Create evidence from error
		const errorEntry = this.evidenceCollector.collectFromError(
			{
				message: failure.error.substring(0, 500),
				errorType: classification.category === "build" ? "BuildError" : "Error",
			},
			failure.error.substring(0, 200),
			"failure-classifier",
		);

		const classificationEntry = this.evidenceCollector.collectFromFailureClassification(
			classification,
			this.componentName,
		);

		const group = createEvidenceGroup("Failure Evidence", [errorEntry, classificationEntry]);

		const diagnosticType: DiagnosticType =
			failure.diagnosticType ?? (classification.category === "merge_conflict" ? "block" : "failure");

		const packet = createDiagnosticPacket({
			severity,
			diagnosticType,
			workspaceId,
			title: `Failure: ${failure.workspaceTitle}`,
			description: failure.error.substring(0, 500),
			evidence: [group],
			failureClassification: classification,
			cooldownDurationMs: this.defaultCooldownMs,
		});

		// Check dedupe suppression
		if (this.isDedupeSuppressed(packet.dedupe.dedupeId)) {
			return null;
		}

		// Activate cooldown
		this.activateCooldown(workspaceId, `Failure diagnostic emitted for ${workspaceId}`);

		return packet;
	}

	/**
	 * Build a diagnostic packet from scheduler diagnostics.
	 *
	 * Analyzes capacity, selected/skipped workspaces, and idle state
	 * to produce a resource pressure or observation diagnostic.
	 *
	 * @param diagnostics - Scheduler diagnostics data
	 * @param workspaceId - Workspace identifier
	 * @returns Diagnostic packet
	 */
	buildFromSchedulerDiagnostics(diagnostics: SchedulerDiagnostics, workspaceId: string): DiagnosticPacket {
		const evidenceGroups: EvidenceGroup[] = [];

		// Selected workspaces evidence
		if (diagnostics.selectedWithReasons.length > 0) {
			const selectedEntries = diagnostics.selectedWithReasons.map((s) =>
				createEvidenceEntry({
					category: "scheduling_decision",
					description: `Selected ${s.workspaceId}: ${s.reason}`,
					source: "scheduler",
					schedulingData: { decision: "selected" },
				}),
			);
			evidenceGroups.push(createEvidenceGroup("Selected Workspaces", selectedEntries));
		}

		// Skipped workspaces evidence
		if (diagnostics.skipped.length > 0) {
			const skippedEntries = diagnostics.skipped.map((s) =>
				this.evidenceCollector.collectFromSkipReason(s, "scheduler"),
			);
			evidenceGroups.push(createEvidenceGroup("Skipped Workspaces", skippedEntries));
		}

		// Scheduler idle evidence
		const idleEntries: EvidenceEntry[] = diagnostics.idle.reasons.map((reason) =>
			createEvidenceEntry({
				category: "scheduling_decision",
				description: `Idle reason: ${reason}`,
				source: "scheduler",
				schedulingData: { decision: "idle" },
			}),
		);

		if (idleEntries.length > 0) {
			evidenceGroups.push(createEvidenceGroup("Scheduler Idle", idleEntries));
		}

		// Capacity evidence
		const capacityEntry = createEvidenceEntry({
			category: "system_state",
			description: `Capacity: ${diagnostics.capacity.activeWorkers}/${diagnostics.capacity.maxWorkers} workers active, ${diagnostics.capacity.availableSlots} slots available`,
			source: "scheduler",
			data: diagnostics.capacity as unknown as Record<string, unknown>,
		});
		evidenceGroups.push(createEvidenceGroup("Scheduler Capacity", [capacityEntry]));

		// Determine diagnostic type and severity from resource pressure
		let diagnosticType: DiagnosticType = "observation";
		let severity: PacketSeverity = "info";

		if (diagnostics.capacity.resourcePressure >= 0.8) {
			diagnosticType = "resource_pressure";
			severity = "warning";
		}

		// Create the packet
		const packet = createDiagnosticPacket({
			severity,
			diagnosticType,
			workspaceId,
			title: `Scheduler diagnostics for ${workspaceId}`,
			description: `Scheduler capacity: ${diagnostics.capacity.activeWorkers}/${diagnostics.capacity.maxWorkers} workers (utilization: ${(diagnostics.capacity.utilization * 100).toFixed(0)}%)`,
			evidence: evidenceGroups,
		});

		return packet;
	}

	/**
	 * Build a diagnostic packet from an agent execution result.
	 *
	 * @param result - Agent execution result
	 * @param workspaceId - Workspace identifier
	 * @param planExecutionId - Optional plan execution identifier
	 * @returns Diagnostic packet or null if suppressed by cooldown
	 */
	buildFromAgentResult(result: AgentResult, workspaceId: string, planExecutionId?: string): DiagnosticPacket | null {
		// Check cooldown
		if (!this.checkCooldown(workspaceId)) {
			return null;
		}

		let diagnosticType: DiagnosticType;
		let severity: PacketSeverity;
		const evidenceGroups: EvidenceGroup[] = [];

		// Agent report evidence
		const agentEntry = this.evidenceCollector.collectFromAgentResult(result, this.componentName);
		evidenceGroups.push(createEvidenceGroup("Agent Report", [agentEntry]));

		// Logs evidence (if any)
		if (result.logs.length > 0) {
			const logEntries = result.logs.map((log, i) =>
				createEvidenceEntry({
					category: "log_output",
					description: log,
					source: "agent",
					data: { index: i },
				}),
			);
			evidenceGroups.push(createEvidenceGroup("Execution Logs", logEntries));
		}

		let failureClassification: FailureData | undefined;

		if (result.success && result.verdict === "COMPLETE") {
			diagnosticType = "execution_complete";
			severity = "info";
		} else if (result.verdict === "BLOCKED") {
			diagnosticType = "block";
			severity = "warning";

			if (result.error) {
				const errorEntry = this.evidenceCollector.collectFromError(
					{ message: result.error },
					result.error,
					this.componentName,
				);
				evidenceGroups.push(createEvidenceGroup("Block Reason", [errorEntry]));
			}
		} else {
			diagnosticType = "failure";
			severity = "error";

			if (result.error) {
				const errorEntry = this.evidenceCollector.collectFromError(
					{ message: result.error },
					result.error,
					this.componentName,
				);
				evidenceGroups.push(createEvidenceGroup("Error Details", [errorEntry]));

				// Classify the error for failure context
				failureClassification = this.classifyFailure(result.error, workspaceId);
				const classificationEntry = this.evidenceCollector.collectFromFailureClassification(
					failureClassification,
					this.componentName,
				);
				evidenceGroups.push(createEvidenceGroup("Failure Classification", [classificationEntry]));
			}
		}

		const packet = createDiagnosticPacket({
			severity,
			diagnosticType,
			workspaceId,
			title: `Agent result: ${result.verdict} for ${workspaceId}`,
			description: result.report,
			evidence: evidenceGroups,
			cooldownDurationMs: this.defaultCooldownMs,
			planExecutionId,
			failureClassification,
		});

		// Check dedupe suppression
		if (this.isDedupeSuppressed(packet.dedupe.dedupeId)) {
			return null;
		}

		// Activate cooldown after any emission to prevent rapid re-emission
		this.activateCooldown(workspaceId, `Agent ${result.verdict} for ${workspaceId}`);

		return packet;
	}

	/**
	 * Build a diagnostic packet for budget exceeded.
	 *
	 * @param workspaceId - Workspace identifier
	 * @param description - Description of budget exceeded
	 * @param budgetInfo - Budget usage information
	 * @returns Diagnostic packet
	 */
	buildFromBudgetExceeded(
		workspaceId: string,
		description: string,
		budgetInfo: { used: number; max: number; ratio: number },
	): DiagnosticPacket {
		const budgetEntry = createEvidenceEntry({
			category: "budget_snapshot",
			description: `Budget exceeded: used ${budgetInfo.used} of ${budgetInfo.max} (${(budgetInfo.ratio * 100).toFixed(0)}%)`,
			source: "budget-enforcer",
			data: budgetInfo as unknown as Record<string, unknown>,
		});

		const group = createEvidenceGroup("Budget Exceeded", [budgetEntry]);

		return createDiagnosticPacket({
			severity: "error",
			diagnosticType: "budget_exceeded",
			workspaceId,
			title: `Budget exceeded for ${workspaceId}`,
			description,
			evidence: [group],
		});
	}

	/**
	 * Build a diagnostic packet for a stop condition.
	 *
	 * @param workspaceId - Workspace identifier
	 * @param condition - Stop condition name
	 * @param detail - Detail about the stop condition
	 * @returns Diagnostic packet
	 */
	buildFromStopCondition(workspaceId: string, condition: string, detail: string): DiagnosticPacket {
		const stopEntry = createEvidenceEntry({
			category: "log_output",
			description: `Stop condition triggered: ${condition}`,
			source: "stop-condition-handler",
			data: { condition, detail },
		});

		const group = createEvidenceGroup("Stop Condition", [stopEntry]);

		return createDiagnosticPacket({
			severity: "warning",
			diagnosticType: "stop_condition_triggered",
			workspaceId,
			title: `Stop condition triggered: ${condition}`,
			description: detail,
			evidence: [group],
			stopCondition: {
				triggered: true,
				condition,
				detail,
			},
		});
	}

	/**
	 * Build a diagnostic packet for cooldown active.
	 *
	 * @param workspaceId - Workspace identifier
	 * @param reason - Reason for cooldown
	 * @param remainingMs - Remaining cooldown in milliseconds
	 * @returns Diagnostic packet
	 */
	buildFromCooldown(workspaceId: string, reason: string, remainingMs: number): DiagnosticPacket {
		const expiresAt = new Date(Date.now() + remainingMs).toISOString();

		const cooldownEntry = this.evidenceCollector.collectFromCooldownState(
			{
				isActive: true,
				cooldownUntil: expiresAt,
				cooldownReason: reason,
				remainingMs,
				durationMs: remainingMs,
				emitCount: 1,
			},
			this.componentName,
		);

		const group = createEvidenceGroup("Cooldown Active", [cooldownEntry]);

		return createDiagnosticPacket({
			severity: "info",
			diagnosticType: "cooldown_active",
			workspaceId,
			title: `Cooldown active for ${workspaceId}`,
			description: reason,
			evidence: [group],
		});
	}

	/**
	 * Build a diagnostic packet from a general observation.
	 *
	 * @param workspaceId - Workspace identifier
	 * @param title - Short title
	 * @param description - Detailed description
	 * @param evidence - Evidence groups
	 * @param severity - Severity level (default: info)
	 * @returns Diagnostic packet
	 */
	buildObservation(
		workspaceId: string,
		title: string,
		description: string,
		evidence: EvidenceGroup[],
		severity: PacketSeverity = "info",
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
}

/**
 * Create a DiagnosticCollector with the given options.
 *
 * @param options - Collector options
 * @returns A new DiagnosticCollector
 */
export function createDiagnosticCollector(options: DiagnosticCollectorOptions = {}): DiagnosticCollector {
	return new DiagnosticCollector(options);
}
