/**
 * Lead Agent — P38.LEAD
 *
 * The Lead Agent observes execution, classifies failures, limits blind retries,
 * issues directives, and escalates to the user when needed.
 *
 * V0 scope:
 * - read-only observer
 * - failure classifier
 * - retry loop detector
 * - directive generator
 * - user escalation creator
 * - dashboard-visible diagnosis
 *
 * The Lead Agent is directive authority, NOT state authority.
 * It must not directly mutate workspace state, bypass FSM, or disable CompletionGate.
 */

import { classifyFailure, failureClassLabel, failureClassSeverity } from "./failure-classifier.js";
import { buildFailureSignatureString, createFailureSignature } from "./failure-signature.js";
import { RetryBudgetManager } from "./retry-budget.js";
import type {
	FailureClass,
	FailureSignature,
	LeadAgentConfig,
	LeadAgentMode,
	LeadDirective,
	LeadFailureReviewInput,
	LeadObservedEvent,
	LeadReviewDecision,
	LeadReviewResult,
	RetryBudgetPolicy,
	UserEscalation,
	UserEscalationOption,
} from "./types.js";
import { DEFAULT_RETRY_BUDGET_POLICY } from "./types.js";

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

let directiveCounter = 0;
let escalationCounter = 0;

function nextDirectiveId(): string {
	return `ldir_${Date.now()}_${++directiveCounter}`;
}

function nextEscalationId(): string {
	return `esc_${Date.now()}_${++escalationCounter}`;
}

// ---------------------------------------------------------------------------
// Lead Agent
// ---------------------------------------------------------------------------

export class LeadAgent {
	private mode: LeadAgentMode;
	private budgetManager: RetryBudgetManager;
	private directives: Map<string, LeadDirective> = new Map();
	private escalations: Map<string, UserEscalation> = new Map();
	private observedSignatures: Map<string, FailureSignature> = new Map();
	private directiveAvailable: Set<string> = new Set(); // `${planExecId}:${workspaceId}`

	constructor(config?: Partial<LeadAgentConfig>) {
		this.mode = config?.mode ?? this.resolveMode();
		this.budgetManager = new RetryBudgetManager(config?.retryBudgetPolicy ?? DEFAULT_RETRY_BUDGET_POLICY);
	}

	// -------------------------------------------------------------------------
	// Public API: observe
	// -------------------------------------------------------------------------

	/**
	 * Observe a workspace event. Classification and budget tracking happen here.
	 * In dry-run mode, diagnoses are produced but retries are not blocked.
	 */
	observeEvent(event: LeadObservedEvent): void {
		// Build failure signature
		const errorMessage = event.errorMessage ?? "unknown error";
		const sig = createFailureSignature({
			workspaceId: event.workspaceId,
			planExecId: event.planExecId,
			errorMessage,
			attemptNo: event.attemptNo,
			completionGateBlockReasons: event.completionGateBlockReasons,
			lastCommand: event.lastCommand,
			lastCommandExitCode: event.lastCommandExitCode,
			failureClass: classifyFailure({
				errorMessage,
				completionGateBlockReasons: event.completionGateBlockReasons,
				commandHistory: event.commandHistory,
				lastCommand: event.lastCommand,
				lastCommandExitCode: event.lastCommandExitCode,
			}),
			existingSignature: this.getExistingSignature(event.planExecId, event.workspaceId, errorMessage),
			now: event.timestamp,
		});

		// Store signature
		const sigKey = `${event.planExecId}:${event.workspaceId}:${sig.signature}`;
		this.observedSignatures.set(sigKey, sig);

		// Track budget
		const hasDirective = this.directiveAvailable.has(`${event.planExecId}:${event.workspaceId}`);
		this.budgetManager.recordFailure(sig, hasDirective);
	}

	// -------------------------------------------------------------------------
	// Public API: review retry
	// -------------------------------------------------------------------------

	/**
	 * Review whether a retry should be allowed, and if so, with what directive.
	 * Called by AutonomousExecutor before scheduling a retry.
	 */
	reviewFailure(input: LeadFailureReviewInput): LeadReviewResult {
		const failureClass = classifyFailure({
			errorMessage: input.errorMessage,
			completionGateBlockReasons: input.completionGateBlockReasons,
			commandHistory: input.commandHistory,
			lastCommand: input.lastCommand,
			lastCommandExitCode: input.lastCommandExitCode,
		});

		const signature = buildFailureSignatureString({
			errorMessage: input.errorMessage,
			completionGateBlockReasons: input.completionGateBlockReasons,
			lastCommand: input.lastCommand,
		});

		const sigObj = createFailureSignature({
			workspaceId: input.workspaceId,
			planExecId: input.planExecId,
			errorMessage: input.errorMessage,
			attemptNo: input.attemptNo,
			completionGateBlockReasons: input.completionGateBlockReasons,
			lastCommand: input.lastCommand,
			lastCommandExitCode: input.lastCommandExitCode,
			failureClass,
			existingSignature: this.getExistingSignature(input.planExecId, input.workspaceId, input.errorMessage),
			now: Date.now(),
		});

		const sigKey = `${input.planExecId}:${input.workspaceId}:${sigObj.signature}`;
		this.observedSignatures.set(sigKey, sigObj);

		const hasDirective = this.directiveAvailable.has(`${input.planExecId}:${input.workspaceId}`);
		const budgetResult = this.budgetManager.recordFailure(sigObj, hasDirective);

		let decision: LeadReviewDecision;
		let directive: LeadDirective | undefined;
		let escalation: UserEscalation | undefined;

		// P38.LEAD: Blocking severity failures (FSM violations, stale completion)
		// must escalate immediately regardless of retry budget.
		const severity = failureClassSeverity(failureClass);
		if (severity === "blocking") {
			decision = "block_and_escalate_user";
			escalation = this.generateEscalation(input, failureClass, signature, sigObj);
			this.budgetManager.markEscalated(sigObj);
			this.escalations.set(escalation.escalationId, escalation);
		} else {
			switch (budgetResult.decision) {
				case "allow_retry":
					decision = "allow_retry";
					break;

				case "require_lead_review": {
					// Lead review required — issue a directive
					decision = "retry_with_directive";
					directive = this.generateDirective(input, failureClass, signature, sigObj);
					this.directives.set(directive.directiveId, directive);
					this.directiveAvailable.add(`${input.planExecId}:${input.workspaceId}`);
					this.budgetManager.markDirectiveIssued(sigObj);
					break;
				}

				case "escalate_user":
				case "blocked_escalated":
					decision = "block_and_escalate_user";
					escalation = this.generateEscalation(input, failureClass, signature, sigObj);
					this.budgetManager.markEscalated(sigObj);
					this.escalations.set(escalation.escalationId, escalation);
					break;
			}
		}

		// In dry-run mode, never block — always allow retry but record diagnosis.
		// Generate directive and escalation for diagnostic visibility even when not blocking.
		if (this.mode === "dry_run" && decision !== "allow_retry") {
			// In dry-run, ensure directive and escalation are generated for visibility
			if (!directive) {
				directive = this.generateDirective(input, failureClass, signature, sigObj);
				this.directives.set(directive.directiveId, directive);
			}
			if (!escalation) {
				escalation = this.generateEscalation(input, failureClass, signature, sigObj);
				this.escalations.set(escalation.escalationId, escalation);
			}
			return {
				decision: "allow_retry",
				failureClass,
				failureSignature: signature,
				reason: `[DRY RUN] Would ${decision}: ${budgetResult.decision}. ${failureClassLabel(failureClass)}`,
				directive,
				escalation,
				summary: `Dry run: failure classified as ${failureClass}, would take action ${decision}`,
			};
		}

		const reason = this.buildReason(decision, budgetResult, failureClass);
		return {
			decision,
			failureClass,
			failureSignature: signature,
			reason,
			directive,
			escalation,
			summary: this.buildSummary(decision, failureClass, budgetResult),
		};
	}

	// -------------------------------------------------------------------------
	// Public API: query
	// -------------------------------------------------------------------------

	/**
	 * Get the active directive for a workspace, if any.
	 */
	getDirective(planExecId: string, workspaceId: string): LeadDirective | null {
		// Find latest directive for this workspace
		let latest: LeadDirective | null = null;
		for (const d of this.directives.values()) {
			if (d.planExecId === planExecId && d.workspaceId === workspaceId) {
				if (!latest || d.createdAt > latest.createdAt) {
					latest = d;
				}
			}
		}
		return latest;
	}

	/**
	 * Get all escalations for a plan.
	 */
	getEscalations(planExecId: string): UserEscalation[] {
		const result: UserEscalation[] = [];
		for (const e of this.escalations.values()) {
			if (e.planExecId === planExecId && e.status === "awaiting_user") {
				result.push(e);
			}
		}
		return result;
	}

	/**
	 * Get the latest diagnosis for a workspace.
	 */
	getDiagnosis(
		planExecId: string,
		workspaceId: string,
	): {
		failureClass: FailureClass | null;
		failureSignature: string | null;
		retryCount: number;
		directive: LeadDirective | null;
		escalation: UserEscalation | null;
		escalated: boolean;
	} {
		const directive = this.getDirective(planExecId, workspaceId);
		const escalations = this.getEscalations(planExecId);
		const workspaceEscalation = escalations.find((e) => e.workspaceId === workspaceId) ?? null;
		const budgetEntries = this.budgetManager.getBudgetSummary(planExecId, workspaceId);
		const totalRetries = budgetEntries.reduce((sum, e) => sum + e.occurrenceCount, 0);

		// Find the last observed signature
		let lastSig: FailureSignature | null = null;
		let lastFailureClass: FailureClass | null = null;
		for (const sig of this.observedSignatures.values()) {
			if (sig.planExecId === planExecId && sig.workspaceId === workspaceId) {
				if (!lastSig || sig.lastObservedAt > lastSig.lastObservedAt) {
					lastSig = sig;
					lastFailureClass = sig.failureClass;
				}
			}
		}

		return {
			failureClass: directive?.failureClass ?? lastFailureClass,
			failureSignature: directive?.failureSignature ?? lastSig?.signature ?? null,
			retryCount: totalRetries,
			directive,
			escalation: workspaceEscalation,
			escalated: budgetEntries.some((e) => e.escalated),
		};
	}

	/**
	 * Get the active mode.
	 */
	getMode(): LeadAgentMode {
		return this.mode;
	}

	/**
	 * Get the retry budget policy.
	 */
	getRetryBudgetPolicy(): RetryBudgetPolicy {
		return this.budgetManager.getPolicy();
	}

	/**
	 * Clear all state for a plan.
	 */
	clearPlan(planExecId: string): void {
		this.budgetManager.clearPlan(planExecId);
		for (const key of Array.from(this.observedSignatures.keys())) {
			if (key.startsWith(`${planExecId}:`)) {
				this.observedSignatures.delete(key);
			}
		}
		for (const key of Array.from(this.directiveAvailable)) {
			if (key.startsWith(`${planExecId}:`)) {
				this.directiveAvailable.delete(key);
			}
		}
		for (const d of Array.from(this.directives.values())) {
			if (d.planExecId === planExecId) {
				this.directives.delete(d.directiveId);
			}
		}
		for (const e of Array.from(this.escalations.values())) {
			if (e.planExecId === planExecId) {
				this.escalations.delete(e.escalationId);
			}
		}
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private resolveMode(): LeadAgentMode {
		const env = process.env.PI_LEAD_AGENT_ENABLED;
		if (env === "true" || env === "1") return "enforcement";
		const dryRun = process.env.PI_LEAD_AGENT_DRY_RUN;
		if (dryRun === "true" || dryRun === "1") return "dry_run";
		return "disabled";
	}

	private getExistingSignature(
		planExecId: string,
		workspaceId: string,
		errorMessage: string,
	): FailureSignature | undefined {
		const signature = buildFailureSignatureString({ errorMessage });
		const sigKey = `${planExecId}:${workspaceId}:${signature}`;
		return this.observedSignatures.get(sigKey);
	}

	private buildReason(
		decision: LeadReviewDecision,
		budget: ReturnType<RetryBudgetManager["recordFailure"]> extends infer R ? R : never,
		failureClass: FailureClass,
	): string {
		switch (decision) {
			case "allow_retry":
				return `Retry allowed (attempt ${budget.occurrenceCount}, ${budget.retriesBeforeEscalation} remaining before escalation)`;
			case "retry_with_directive":
				return `Lead directive required — ${failureClassLabel(failureClass)} (occurrence ${budget.occurrenceCount})`;
			case "block_and_escalate_user":
				return `Retry budget exhausted — ${failureClassLabel(failureClass)} (occurrence ${budget.occurrenceCount})`;
			case "open_repair_workspace":
				return `Repair workspace recommended — ${failureClassLabel(failureClass)}`;
			case "handoff_required":
				return `Handoff required — ${failureClassLabel(failureClass)}`;
		}
	}

	private buildSummary(
		decision: LeadReviewDecision,
		failureClass: FailureClass,
		budget: { occurrenceCount: number },
	): string {
		const label = failureClassLabel(failureClass);
		return `Lead Agent ${decision}: ${label} (×${budget.occurrenceCount})`;
	}

	/**
	 * Generate a detailed LeadDirective for a workspace failure.
	 */
	private generateDirective(
		input: LeadFailureReviewInput,
		failureClass: FailureClass,
		signature: string,
		sigObj: FailureSignature,
	): LeadDirective {
		const directiveText = this.buildDirectiveText(input, failureClass);
		const { allowedActions, forbiddenActions } = this.resolveActions(failureClass);

		return {
			directiveId: nextDirectiveId(),
			planExecId: input.planExecId,
			workspaceId: input.workspaceId,
			attemptNo: input.attemptNo,
			createdAt: Date.now(),
			severity: failureClassSeverity(failureClass),
			failureClass,
			failureSignature: signature,
			summary: `${failureClassLabel(failureClass)} — repeated ${sigObj.occurrenceCount} times`,
			directive: directiveText,
			allowedActions,
			forbiddenActions,
			retryBudget: {
				maxAdditionalRetries: 1,
				escalateAfter: 1,
				totalRetriesObserved: sigObj.occurrenceCount,
			},
			status: "issued",
		};
	}

	/**
	 * Build the directive text based on the failure class.
	 */
	private buildDirectiveText(_input: LeadFailureReviewInput, failureClass: FailureClass): string {
		switch (failureClass) {
			case "target_command_not_executed":
				return [
					"Do not retry the same implementation strategy.",
					"The failure is a completion gate / command evidence issue, not a codegen failure.",
					"",
					"Required actions:",
					"1. Verify the target test file exists on disk.",
					"2. Check whether any bash/exec command was recorded in CompletionGate commandHistory.",
					"3. If command wiring is missing, implement command recording in CompletionGate.",
					"4. If the test command path is wrong for package cwd, fix the path.",
					"5. If validation should be deferred, move it to the final validation workspace.",
					"",
					"Forbidden:",
					"- Do not disable CompletionGate.",
					"- Do not mark the workspace complete without validation evidence.",
					"- Do not repeat the same code changes from previous attempts.",
				].join("\n");

			case "command_history_missing":
				return [
					"No commands were recorded in the CompletionGate commandHistory.",
					"",
					"Required actions:",
					"1. Check whether the bash/exec tools call CompletionGate recordCommand().",
					"2. Verify command recording is wired in workspace-agent-executor.",
					"3. Record all commands run during implementation.",
					"",
					"Forbidden:",
					"- Do not retry code changes without fixing command recording.",
				].join("\n");

			case "test_file_missing":
				return [
					"The target test file does not exist on disk.",
					"",
					"Required actions:",
					"1. Create the missing test file before retrying.",
					"2. OR move the test to the final validation workspace.",
				].join("\n");

			case "wrong_test_path":
				return [
					"The test command path does not match the package working directory.",
					"",
					"Required actions:",
					"1. Determine the correct package-relative command.",
					"2. Use --prefix or cd to the correct package directory.",
					"3. Update the targetCommand to use the correct path.",
				].join("\n");

			case "no_tests_found_exit_zero":
				return [
					"The test command matched no test files and exited 0 — this is not a pass.",
					"",
					"Required actions:",
					"1. Correct the test command path to match the actual test file location.",
					"2. Use a package-prefix command (--prefix or cd).",
					"3. Verify the test file exists before running.",
					"4. Do not accept exit code 0 from 'No test files found' as validation passed.",
				].join("\n");

			case "completion_gate_blocked":
				return [
					"The CompletionGate is blocking workspace completion.",
					"",
					"Required actions:",
					"1. Inspect the completion gate block reasons.",
					"2. Do not retry code changes — the issue is a gate condition.",
					"3. Resolve the blocking condition before retrying implementation.",
				].join("\n");

			case "stale_attempt_completion":
				return [
					"A stale attempt completion was detected.",
					"",
					"Required actions:",
					"1. Do not make PENDING -> SUCCEEDED legal.",
					"2. Ensure stale completion guard reads DB truth before TransitionRouter.",
					"3. Check stop/continue flow and stale attempt detection.",
				].join("\n");

			case "illegal_attempt_transition":
				return [
					"An illegal FSM transition was attempted.",
					"",
					"Required actions:",
					"1. Do not force illegal state transitions.",
					"2. Check the transition path and use legal transitions.",
					"3. Inspect the stop/continue/retry flow for race conditions.",
				].join("\n");

			case "memory_limit_or_process_killed":
				return [
					"The process was killed due to a memory limit.",
					"",
					"Required actions:",
					"1. Use a low-memory command variant (--maxWorkers=1).",
					"2. Split tests into smaller batches.",
					"3. Reduce the test scope to avoid OOM.",
				].join("\n");

			default:
				return [
					"Do not retry the same strategy without investigation.",
					"",
					"Required actions:",
					"1. Diagnose the root cause.",
					"2. Change the approach before retrying.",
					"3. Escalate to user if the cause is unclear.",
				].join("\n");
		}
	}

	/**
	 * Resolve allowed and forbidden actions based on the failure class.
	 */
	private resolveActions(failureClass: FailureClass): {
		allowedActions: LeadDirective["allowedActions"];
		forbiddenActions: LeadDirective["forbiddenActions"];
	} {
		const allowed: Set<LeadDirective["allowedActions"][number]> = new Set();
		const forbidden: Set<LeadDirective["forbiddenActions"][number]> = new Set();

		// Always forbidden
		forbidden.add("disable_completion_gate");
		forbidden.add("mark_complete_without_validation");
		forbidden.add("bypass_completion_gate");
		forbidden.add("disable_validation");

		switch (failureClass) {
			case "target_command_not_executed":
			case "command_history_missing":
			case "completion_gate_blocked":
				allowed.add("inspect_file");
				allowed.add("fix_command_wiring");
				allowed.add("change_validation_command");
				allowed.add("defer_validation");
				allowed.add("move_to_final_validation");
				allowed.add("request_user_escalation");
				break;

			case "test_file_missing":
				allowed.add("create_missing_test");
				allowed.add("move_to_final_validation");
				allowed.add("request_user_escalation");
				break;

			case "wrong_test_path":
			case "no_tests_found_exit_zero":
				allowed.add("fix_command_path");
				allowed.add("change_validation_command");
				allowed.add("request_user_escalation");
				break;

			case "stale_attempt_completion":
			case "illegal_attempt_transition":
			case "attempt_cache_retry_bug":
				forbidden.add("make_pending_to_succeeded_legal");
				forbidden.add("make_succeeded_to_running_legal");
				allowed.add("inspect_file");
				allowed.add("request_user_escalation");
				break;

			default:
				allowed.add("retry_with_same_strategy");
				allowed.add("request_user_escalation");
				break;
		}

		return {
			allowedActions: Array.from(allowed),
			forbiddenActions: Array.from(forbidden),
		};
	}

	/**
	 * Generate a user escalation object.
	 */
	private generateEscalation(
		input: LeadFailureReviewInput,
		failureClass: FailureClass,
		signature: string,
		sigObj: FailureSignature,
	): UserEscalation {
		const options = this.buildEscalationOptions(failureClass, input);
		const recommendedOption = options[0]?.id ?? "handoff_required";

		return {
			escalationId: nextEscalationId(),
			planExecId: input.planExecId,
			workspaceId: input.workspaceId,
			severity: failureClassSeverity(failureClass) === "blocking" ? "blocking" : "high",
			title: `Workspace ${input.workspaceId} is stuck: ${failureClassLabel(failureClass)}`,
			summary: `The workspace failed ${sigObj.occurrenceCount} times with the same failure signature: ${signature}. Automated retry budget is exhausted.`,
			whatHappened: `The worker agent repeatedly encountered: ${input.errorMessage}`,
			whyTheWorkerIsStuck: `${failureClassLabel(failureClass)}. ${this.buildStuckExplanation(failureClass, input)}`,
			options,
			recommendedOptionId: recommendedOption,
			logsToInspect: [],
			evidenceRefs: [
				`failureClass: ${failureClass}`,
				`failureSignature: ${signature}`,
				`attemptNo: ${input.attemptNo}`,
				...(input.completionGateBlockReasons ?? []).map((r) => `gateReason: ${r}`),
				input.lastCommand ? `lastCommand: ${input.lastCommand}` : null,
				input.lastCommandExitCode !== null ? `exitCode: ${input.lastCommandExitCode}` : null,
			].filter(Boolean) as string[],
			createdAt: Date.now(),
			status: "awaiting_user",
		};
	}

	/**
	 * Build escalation options based on the failure class.
	 */
	private buildEscalationOptions(failureClass: FailureClass, _input: LeadFailureReviewInput): UserEscalationOption[] {
		switch (failureClass) {
			case "target_command_not_executed":
			case "command_history_missing":
				return [
					{
						id: "fix_command_wiring",
						label: "Fix CompletionGate command recording wiring",
						risk: "medium",
						description: "Ensure bash/exec tools record commands into CompletionGate.",
					},
					{
						id: "defer_validation",
						label: "Move this test to final validation workspace",
						risk: "medium",
						description: "Skip heavy validation in implementation workspace.",
					},
					{
						id: "handoff_required",
						label: "Stop and create manual handoff",
						risk: "safe",
						description: "Stop execution and let a human resolve.",
					},
				];

			case "test_file_missing":
				return [
					{
						id: "create_test_file",
						label: "Create the missing test file",
						risk: "low",
						description: "Create a test file for the implementation.",
					},
					{
						id: "skip_validation",
						label: "Skip this validation check",
						risk: "medium",
						description: "Proceed without this specific validation.",
					},
					{
						id: "handoff_required",
						label: "Stop and create manual handoff",
						risk: "safe",
					},
				];

			case "no_tests_found_exit_zero":
				return [
					{
						id: "fix_command_path",
						label: "Fix the test command path",
						risk: "low",
						description: "Correct the package-relative test command.",
					},
					{
						id: "defer_validation",
						label: "Move validation to final workspace",
						risk: "medium",
					},
					{
						id: "handoff_required",
						label: "Stop and create manual handoff",
						risk: "safe",
					},
				];

			case "stale_attempt_completion":
			case "illegal_attempt_transition":
			case "attempt_cache_retry_bug":
				return [
					{
						id: "restart_workspace",
						label: "Restart workspace with a fresh attempt",
						risk: "low",
						description: "Clear attempt cache and start fresh.",
					},
					{
						id: "handoff_required",
						label: "Stop and create manual handoff",
						risk: "safe",
						description: "FSM-level issues need human review.",
					},
				];

			default:
				return [
					{
						id: "retry",
						label: "Retry with modified strategy",
						risk: "low",
					},
					{
						id: "handoff_required",
						label: "Stop and create manual handoff",
						risk: "safe",
						description: "Unknown failures need human review.",
					},
				];
		}
	}

	private buildStuckExplanation(failureClass: FailureClass, input: LeadFailureReviewInput): string {
		switch (failureClass) {
			case "target_command_not_executed":
				return "The CompletionGate requires evidence that the target test command was executed, but no command was recorded in the gate registry.";
			case "command_history_missing":
				return "The CompletionGate commandHistory is empty, meaning no bash/exec calls were recorded.";
			case "no_tests_found_exit_zero":
				return "The test command matched no test files and exited 0, which is deceptively treated as a pass.";
			case "stale_attempt_completion":
				return "A stale worker completed after the workspace was terminalized, causing an illegal FSM transition.";
			default:
				return `The worker encountered: ${input.errorMessage.slice(0, 200)}`;
		}
	}
}

/**
 * Create a Lead Agent instance with optional configuration overrides.
 */
export function createLeadAgent(config?: Partial<LeadAgentConfig>): LeadAgent {
	return new LeadAgent(config);
}
