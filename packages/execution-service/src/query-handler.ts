/**
 * Execution Query Handler — P40 Platform / Agent Separation
 *
 * Facade for querying execution state through the read model.
 * External consumers (Brain, Web, UI) query state through this handler.
 *
 * DATA SOURCE NOTES:
 * - This implementation extracts data from journal events where available.
 * - Command history, directives, and escalations are reconstructed from
 *   event payloads rather than dedicated tables.
 * - File content, diff, and dependency graph require external data sources
 *   that are not available through the journal event stream. These return
 *   explicit unavailable states with documentation about the missing source.
 */
import type {
	ArtifactEntry,
	ChangedFileEntry,
	CommandHistoryView,
	DependencyGraphNode,
	DependencyGraphView,
	ExecutionReadModel,
	FileContentView,
	FileDiffView,
	FileTreeNode,
	FileTreeQuery,
	FinalValidationView,
	JournalEventEnvelope,
	JournalQuery,
	LeadDirectiveView,
	LeadEscalationView,
	PlanExecutionStats,
	PlanExecutionSummary,
	WorkerContextView,
	WorkerTranscriptEvent,
	WorkspaceExecutionSummary,
} from "@earendil-works/pi-execution-core";
import { buildFileTreeFromEntries, getFileExt } from "@earendil-works/pi-execution-core";

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract changed file entries from worker_completed journal events.
 * The `changedFiles` field in WorkerCompletedPayload is a string[] of file paths.
 */
function extractChangedFilesFromEvents(events: JournalEventEnvelope[]): ChangedFileEntry[] {
	const seen = new Set<string>();
	const entries: ChangedFileEntry[] = [];

	for (const event of events) {
		if (event.eventType !== "worker_completed") continue;
		const payload = event.payload as Record<string, unknown> | null;
		if (!payload) continue;
		const changedFiles = payload.changedFiles as string[] | undefined;
		if (!changedFiles || !Array.isArray(changedFiles)) continue;

		for (const filePath of changedFiles) {
			if (seen.has(filePath)) continue;
			seen.add(filePath);
			entries.push({
				path: filePath,
				name: filePath.includes("/") ? filePath.split("/").pop()! : filePath,
				ext: getFileExt(filePath),
				status: "modified",
			});
		}
	}

	// Sort by path for deterministic output
	entries.sort((a, b) => a.path.localeCompare(b.path));

	return entries;
}

/**
 * Extract command history from command_started/command_finished journal events.
 * Pairs started and finished events by command+cwd to produce CommandHistoryView entries.
 */
function extractCommandHistoryFromEvents(events: JournalEventEnvelope[]): CommandHistoryView[] {
	// Map key includes runId if available to disambiguate concurrent runs of the same command.
	const startedMap = new Map<string, { command: string; cwd: string; startedAt: number; runId?: string }>();
	const history: CommandHistoryView[] = [];

	for (const event of events) {
		const payload = event.payload as Record<string, unknown> | null;
		if (!payload) continue;

		if (event.eventType === "command_started") {
			const command = payload.command as string;
			const cwd = payload.cwd as string;
			const runId = payload.runId as string | undefined;
			const startedAt = new Date(event.createdAt).getTime();
			const key = runId ? `${command}|${cwd}|${runId}` : `${command}|${cwd}`;
			startedMap.set(key, { command, cwd, startedAt, runId });
		}

		if (event.eventType === "command_finished") {
			const command = payload.command as string;
			const cwd = payload.cwd as string;
			const exitCode = payload.exitCode as number | null;
			const outputSummary = payload.outputSummary as string | undefined;
			const finishedAt = new Date(event.createdAt).getTime();
			const runId = payload.runId as string | undefined;
			const key = runId ? `${command}|${cwd}|${runId}` : `${command}|${cwd}`;

			const started = startedMap.get(key);
			if (started) {
				startedMap.delete(key);
				history.push({
					command,
					cwd,
					exitCode: exitCode ?? null,
					startedAt: started.startedAt,
					finishedAt,
					outputSummary,
				});
			}
		}
	}

	// Sort by startedAt ascending
	history.sort((a, b) => a.startedAt - b.startedAt);

	return history;
}

/**
 * Extract Lead Agent directives from lead_agent_directive_issued journal events.
 */
/**
 * Map plan event types to canonical PlanExecutionSummary status values.
 */
const PLAN_STATUS_MAP: Record<string, string> = {
	plan_completed: "complete",
	plan_failed: "failed",
	plan_cancelled: "cancelled",
	plan_stopped: "stopped",
	plan_paused: "paused",
	plan_running: "running",
	plan_resumed: "running",
	plan_awaiting_handoff: "awaiting_handoff",
};

/**
 * Map a journal event type to a transcript event type for fallback reconstruction.
 * Only events with a meaningful transcript representation are mapped; workspace
 * lifecycle, worker, command, and governance events produce transcript entries.
 */
function mapEventTypeToTranscriptType(eventType: string): string {
	const typeMap: Record<string, string> = {
		workspace_pending: "workspace_start",
		workspace_running: "worker_status",
		workspace_completed: "workspace_complete",
		workspace_failed: "workspace_failed",
		workspace_blocked: "workspace_blocked",
		workspace_cancelled: "worker_status",
		workspace_skipped: "worker_status",
		workspace_timed_out: "workspace_failed",
		workspace_paused: "worker_status",
		worker_started: "workspace_start",
		worker_completed: "workspace_complete",
		worker_failed: "workspace_failed",
		worker_cancelled: "worker_status",
		worker_timed_out: "workspace_failed",
		command_started: "tool_call",
		command_finished: "tool_call",
		governance_check_started: "validation",
		governance_approved: "validation",
		governance_rejected: "blocker",
		governance_escalated: "blocker",
		lead_agent_review_started: "blocker",
		lead_agent_directive_issued: "blocker",
		lead_agent_escalation_initiated: "blocker",
		brain_proposed: "worker_decision_summary",
		brain_approved: "validation",
		brain_rejected: "blocker",
		human_directive_issued: "blocker",
		human_directive_acknowledged: "worker_status",
		human_intervention_requested: "blocker",
		plan_started: "plan_summary",
		plan_completed: "plan_summary",
		plan_failed: "plan_summary",
		plan_paused: "plan_summary",
		plan_resumed: "plan_summary",
		plan_cancelled: "plan_summary",
		plan_stopped: "plan_summary",
	};
	return typeMap[eventType] ?? "worker_status";
}

/**
 * Build a human-readable summary string for a journal event,
 * used in the fallback transcript reconstruction path.
 */
function buildTranscriptEventSummary(event: JournalEventEnvelope): string {
	const payload = event.payload as Record<string, unknown> | null;

	switch (event.eventType) {
		case "workspace_completed":
			return "Workspace completed successfully";
		case "workspace_failed":
			return `Workspace failed: ${(payload?.error as string) ?? "unknown error"}`;
		case "workspace_blocked":
			return `Workspace blocked: ${(payload?.reason as string) ?? "unknown"}`;
		case "workspace_running":
			return "Workspace started execution";
		case "workspace_pending":
			return "Workspace pending";
		case "workspace_cancelled":
			return `Workspace cancelled: ${(payload?.reason as string) ?? "no reason"}`;
		case "workspace_skipped":
			return "Workspace skipped";
		case "workspace_timed_out":
			return `Workspace timed out: ${(payload?.timeoutMs as number) ?? "unknown"}ms`;
		case "workspace_paused":
			return "Workspace paused";
		case "worker_started":
			return `Worker started (attempt ${(payload?.attemptNumber as number) ?? "?"})`;
		case "worker_completed":
			return `Worker completed: ${(payload?.verdict as string) ?? "unknown"}`;
		case "worker_failed":
			return `Worker failed: ${(payload?.error as string) ?? "unknown error"}`;
		case "worker_cancelled":
			return "Worker cancelled";
		case "worker_timed_out":
			return `Worker timed out after ${(payload?.timeoutMs as number) ?? "unknown"}ms`;
		case "command_started":
			return `Command: ${(payload?.command as string) ?? "unknown"}`;
		case "command_finished":
			return `Command finished (exit ${(payload?.exitCode as number) ?? "?"})`;
		case "governance_check_started":
			return "Governance check started";
		case "governance_approved":
			return "Governance approved";
		case "governance_rejected":
			return `Governance rejected: ${(payload?.reason as string) ?? "no reason"}`;
		case "governance_escalated":
			return `Governance escalated: ${(payload?.reason as string) ?? "no reason"}`;
		case "lead_agent_review_started":
			return "Lead Agent review started";
		case "lead_agent_directive_issued":
			return `Directive: ${(payload?.summary as string) ?? ""}`;
		case "lead_agent_escalation_initiated":
			return `Escalation: ${(payload?.summary as string) ?? ""}`;
		case "brain_proposed":
			return `Brain proposal: ${(payload?.summary as string) ?? ""}`;
		case "brain_approved":
			return "Brain proposal approved";
		case "brain_rejected":
			return "Brain proposal rejected";
		case "human_directive_issued":
			return `Human directive: ${(payload?.directive as string) ?? ""}`;
		case "human_directive_acknowledged":
			return "Human directive acknowledged";
		case "human_intervention_requested":
			return `Human intervention: ${(payload?.action as string) ?? ""}`;
		case "plan_started":
			return "Plan started";
		case "plan_completed":
			return "Plan completed";
		case "plan_failed":
			return "Plan failed";
		case "plan_paused":
			return "Plan paused";
		case "plan_resumed":
			return "Plan resumed";
		case "plan_cancelled":
			return "Plan cancelled";
		case "plan_stopped":
			return "Plan stopped";
		default:
			return `Event: ${event.eventType}`;
	}
}

function extractDirectivesFromEvents(events: JournalEventEnvelope[]): LeadDirectiveView[] {
	const directives: LeadDirectiveView[] = [];
	const acknowledgedIds = new Set<string>();

	// First pass: collect acknowledged directive IDs
	for (const event of events) {
		if (event.eventType !== "lead_agent_directive_acknowledged") continue;
		const payload = event.payload as Record<string, unknown> | null;
		if (!payload) continue;
		const directiveId = payload.directiveId as string | undefined;
		if (directiveId) acknowledgedIds.add(directiveId);
	}

	// Second pass: build directive views from issued events
	for (const event of events) {
		if (event.eventType !== "lead_agent_directive_issued") continue;
		const payload = event.payload as Record<string, unknown> | null;
		if (!payload) continue;

		const directiveId = (payload.directiveId as string) ?? `directive-${event.eventId}`;
		const workspaceId = (payload.workspaceId as string) ?? event.workspaceId ?? "";
		const attemptNumber = (payload.attemptNumber as number) ?? 0;
		const severity = (payload.severity as LeadDirectiveView["severity"]) ?? "medium";
		const summary = (payload.summary as string) ?? "";
		const directive = (payload.directive as string) ?? "";
		const allowedActions = (payload.allowedActions as string[]) ?? [];
		const forbiddenActions = (payload.forbiddenActions as string[]) ?? [];
		const maxAdditionalRetries = (payload.maxAdditionalRetries as number) ?? 0;
		const escalateAfter = (payload.escalateAfter as number) ?? 0;

		const status: LeadDirectiveView["status"] = acknowledgedIds.has(directiveId) ? "acknowledged" : "issued";

		directives.push({
			workspaceId,
			directiveId,
			directiveType: "lead_agent",
			attemptNumber,
			severity,
			summary,
			directive,
			allowedActions,
			forbiddenActions,
			retryBudget: maxAdditionalRetries,
			escalateAfter,
			status,
			createdAt: event.createdAt,
		});
	}

	return directives;
}

/**
 * Extract Lead Agent escalations from lead_agent_escalation_initiated journal events.
 */
function extractEscalationsFromEvents(events: JournalEventEnvelope[]): LeadEscalationView[] {
	const escalations: LeadEscalationView[] = [];
	const resolvedEscalations = new Map<string, { chosenOptionId: string; userResponse?: string; resolvedAt: number }>();

	// First pass: collect resolved escalation data
	for (const event of events) {
		if (event.eventType !== "lead_agent_escalation_resolved") continue;
		const payload = event.payload as Record<string, unknown> | null;
		if (!payload) continue;
		const escalationId = payload.escalationId as string | undefined;
		if (!escalationId) continue;
		resolvedEscalations.set(escalationId, {
			chosenOptionId: (payload.chosenOptionId as string) ?? "",
			userResponse: payload.userResponse as string | undefined,
			resolvedAt: new Date(event.createdAt).getTime(),
		});
	}

	// Second pass: build escalation views
	for (const event of events) {
		if (event.eventType !== "lead_agent_escalation_initiated") continue;
		const payload = event.payload as Record<string, unknown> | null;
		if (!payload) continue;

		const escalationId = (payload.escalationId as string) ?? `escalation-${event.eventId}`;
		const planExecutionId = event.planExecutionId;
		const workspaceId = (payload.workspaceId as string) ?? event.workspaceId ?? "";
		const severity = (payload.severity as LeadEscalationView["severity"]) ?? "medium";
		const title = (payload.title as string) ?? "";
		const summary = (payload.summary as string) ?? "";
		const whatHappened = (payload.whatHappened as string) ?? "";
		const whyStuck = (payload.whyStuck as string) ?? "";
		const options = (payload.options as LeadEscalationView["options"]) ?? [];
		const recommendedOptionId = (payload.recommendedOptionId as string) ?? "";
		const evidenceRefs = (payload.evidenceRefs as string[]) ?? [];
		const logsToInspect = (payload.logsToInspect as string[]) ?? [];

		const resolved = resolvedEscalations.get(escalationId);
		let status: LeadEscalationView["status"];
		if (resolved) {
			status = "resolved";
		} else {
			status = "awaiting_user";
		}

		escalations.push({
			escalationId,
			planExecutionId,
			workspaceId,
			severity,
			title,
			summary,
			whatHappened,
			whyStuck,
			options,
			recommendedOptionId,
			evidenceRefs,
			logsToInspect,
			status,
			userChoice: resolved?.chosenOptionId,
			userResponse: resolved?.userResponse,
			createdAt: event.createdAt,
			resolvedAt: resolved ? new Date(resolved.resolvedAt).toISOString() : undefined,
		});
	}

	return escalations;
}

/**
 * Compute plan stats from journal events.
 */
function computePlanStatsFromEvents(
	planExecutionId: string,
	events: JournalEventEnvelope[],
	statePlanSummary: PlanExecutionSummary | null,
): PlanExecutionStats {
	if (events.length === 0 && !statePlanSummary) {
		return {
			planExecutionId,
			totalWorkspaces: 0,
			completedWorkspaces: 0,
			failedWorkspaces: 0,
			blockedWorkspaces: 0,
			runningWorkspaces: 0,
			pendingWorkspaces: 0,
			cancelledWorkspaces: 0,
			skippedWorkspaces: 0,
			durationMs: null,
			computedAt: new Date().toISOString(),
			dataSource: "unavailable",
		};
	}

	let totalWorkspaces = 0;
	let earliestStart: number | null = null;
	let latestCompletion: number | null = null;

	// Track the LATEST event type per workspace for terminal state counting
	const workspaceLatest = new Map<string, { eventType: string; seq: number }>();

	for (const event of events) {
		const eventSeq = Number.parseInt(event.seq, 10) || 0;

		switch (event.eventType) {
			case "plan_started": {
				const payload = event.payload as Record<string, unknown> | null;
				totalWorkspaces = (payload?.totalWorkspaces as number) ?? totalWorkspaces;
				break;
			}
			case "workspace_completed":
			case "workspace_failed":
			case "workspace_blocked":
			case "workspace_running":
			case "workspace_pending":
			case "workspace_cancelled":
			case "workspace_skipped":
			case "workspace_timed_out": {
				if (event.workspaceId) {
					const existing = workspaceLatest.get(event.workspaceId);
					if (!existing || eventSeq > existing.seq) {
						workspaceLatest.set(event.workspaceId, { eventType: event.eventType, seq: eventSeq });
					}
				}
				// Track timing
				const ts = new Date(event.createdAt).getTime();
				if (event.eventType === "workspace_running" || event.eventType === "workspace_pending") {
					if (earliestStart === null || ts < earliestStart) earliestStart = ts;
				}
				if (event.eventType === "workspace_completed" || event.eventType === "workspace_failed") {
					if (latestCompletion === null || ts > latestCompletion) latestCompletion = ts;
				}
				break;
			}
			case "worker_started": {
				const wsPayload = event.payload as Record<string, unknown> | null;
				const ts = wsPayload?.timestamp
					? new Date(wsPayload.timestamp as number).getTime()
					: new Date(event.createdAt).getTime();
				if (earliestStart === null || ts < earliestStart) earliestStart = ts;
				break;
			}
		}
	}

	// Count terminal states from latest event per workspace
	let completedWorkspaces = 0;
	let failedWorkspaces = 0;
	let blockedWorkspaces = 0;
	let runningWorkspaces = 0;
	let pendingWorkspaces = 0;
	let cancelledWorkspaces = 0;
	let skippedWorkspaces = 0;

	for (const [, latest] of workspaceLatest) {
		switch (latest.eventType) {
			case "workspace_completed":
				completedWorkspaces++;
				break;
			case "workspace_failed":
				failedWorkspaces++;
				break;
			case "workspace_blocked":
				blockedWorkspaces++;
				break;
			case "workspace_running":
				runningWorkspaces++;
				break;
			case "workspace_pending":
				pendingWorkspaces++;
				break;
			case "workspace_cancelled":
				cancelledWorkspaces++;
				break;
			case "workspace_skipped":
				skippedWorkspaces++;
				break;
			default:
				break;
		}
	}

	// When plan_started event is missing (totalWorkspaces === 0 from events),
	// derive totalWorkspaces from the workspace count instead of returning 0.
	const resolvedTotalWorkspaces =
		totalWorkspaces ||
		completedWorkspaces +
			failedWorkspaces +
			blockedWorkspaces +
			runningWorkspaces +
			pendingWorkspaces +
			cancelledWorkspaces +
			skippedWorkspaces;

	const durationMs: number | null =
		earliestStart !== null && latestCompletion !== null ? latestCompletion - earliestStart : null;

	const dataSource: PlanExecutionStats["dataSource"] =
		events.length > 0 ? "events" : statePlanSummary ? "state-store" : "unavailable";

	return {
		planExecutionId,
		totalWorkspaces: resolvedTotalWorkspaces,
		completedWorkspaces,
		failedWorkspaces,
		blockedWorkspaces,
		runningWorkspaces,
		pendingWorkspaces,
		cancelledWorkspaces,
		skippedWorkspaces,
		durationMs,
		computedAt: new Date().toISOString(),
		dataSource,
	};
}

/**
 * Extract dependency graph from plan_started event payload.
 * Falls back to available state store data.
 */
/**
 * Stage ordering for deriving current stage of a workspace from its events.
 * Higher number = more recent/relevant stage.
 */
const WORKSPACE_STAGE_ORDER: Record<string, { score: number; stage: string }> = {
	workspace_timed_out: { score: 10, stage: "TimedOut" },
	workspace_failed: { score: 9, stage: "Failed" },
	workspace_blocked: { score: 8, stage: "Blocked" },
	workspace_cancelled: { score: 7, stage: "Cancelled" },
	workspace_skipped: { score: 6, stage: "Skipped" },
	workspace_completed: { score: 5, stage: "Complete" },
	workspace_running: { score: 4, stage: "Running" },
	workspace_pending: { score: 3, stage: "Pending" },
	workspace_paused: { score: 2, stage: "Paused" },
};

function extractDependencyGraphFromEvents(
	planExecutionId: string,
	events: JournalEventEnvelope[],
): DependencyGraphView {
	// Build workspace → latest stage map from ALL workspace events.
	const stageMap = new Map<string, { score: number; stage: string }>();

	for (const event of events) {
		if (!event.workspaceId) continue;
		const order = WORKSPACE_STAGE_ORDER[event.eventType];
		if (!order) continue;

		const existing = stageMap.get(event.workspaceId);
		if (!existing || order.score > existing.score) {
			stageMap.set(event.workspaceId, { score: order.score, stage: order.stage });
		}
	}

	// Find plan_started event
	const planStarted = events.find((e) => e.eventType === "plan_started");

	if (!planStarted || !planStarted.payload) {
		// Try to reconstruct from workspace events
		const workspaceIds = new Set<string>();
		const dependencyMap = new Map<string, string[]>();
		const batchMap = new Map<string, number>();

		for (const event of events) {
			if (!event.workspaceId) continue;
			const wsPayload = event.payload as Record<string, unknown> | null;

			switch (event.eventType) {
				case "workspace_pending":
				case "workspace_running":
				case "workspace_completed":
				case "workspace_failed":
				case "workspace_blocked":
				case "workspace_cancelled":
				case "workspace_skipped":
				case "workspace_timed_out":
				case "workspace_paused": {
					const wsId = event.workspaceId;
					workspaceIds.add(wsId);
					// Extract dependencies from payload if available
					if (wsPayload?.dependencies && Array.isArray(wsPayload.dependencies)) {
						dependencyMap.set(wsId, wsPayload.dependencies as string[]);
					}
					if (!dependencyMap.has(wsId)) {
						dependencyMap.set(wsId, []);
					}
					if (wsPayload?.batch !== undefined) {
						batchMap.set(wsId, wsPayload.batch as number);
					}
					break;
				}
			}
		}

		if (workspaceIds.size === 0) {
			return {
				planExecutionId,
				nodes: [],
				totalBatches: 0,
				dataAvailability: {
					available: false,
					reason:
						"No workspace events found in journal. Plan data source (plan_started event payload or state store) is not available through this read model.",
				},
			};
		}

		const nodes: DependencyGraphNode[] = Array.from(workspaceIds).map((id) => ({
			id,
			dependsOn: dependencyMap.get(id) ?? [],
			batch: batchMap.get(id) ?? 0,
			stage: stageMap.get(id)?.stage ?? "unknown",
		}));

		const totalBatches = nodes.length > 0 ? Math.max(...nodes.map((n) => n.batch)) + 1 : 0;

		return {
			planExecutionId,
			nodes,
			totalBatches,
			dataAvailability: {
				available: true,
				reason:
					"Reconstructed from workspace stage events; batch/dependency data may be incomplete without plan_started event.",
			},
		};
	}

	const payload = planStarted.payload as Record<string, unknown>;
	const workspacePayloads = payload.workspaces as
		| Array<{
				id: string;
				title?: string;
				dependencies?: string[];
				batch?: number;
		  }>
		| undefined;

	if (!workspacePayloads || !Array.isArray(workspacePayloads)) {
		return {
			planExecutionId,
			nodes: [],
			totalBatches: 0,
			dataAvailability: {
				available: false,
				reason:
					"Plan started event exists but contains no workspace array in its payload. The plan_started event must include a 'workspaces' field with workspace definitions.",
			},
		};
	}

	const nodes: DependencyGraphNode[] = workspacePayloads.map((ws) => ({
		id: ws.id,
		title: ws.title,
		dependsOn: ws.dependencies ?? [],
		batch: ws.batch ?? 0,
		stage: stageMap.get(ws.id)?.stage ?? "Pending",
	}));

	const totalBatches = nodes.length > 0 ? Math.max(...nodes.map((n) => n.batch)) + 1 : 0;

	return {
		planExecutionId,
		nodes,
		totalBatches,
		dataAvailability: { available: true },
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Extract a single file's diff from a unified diff patch.
 * Returns a FileDiffView for the matching file, or null if not found.
 */
function extractFileDiffFromPatch(patchContent: string, targetFilePath: string): FileDiffView | null {
	const lines = patchContent.split("\n");
	let inTarget = false;
	let found = false;
	const diffLines: string[] = [];
	let additions = 0;
	let deletions = 0;

	for (const line of lines) {
		// Track which file we're in based on diff headers
		const fileHeaderMatch = line.match(/^diff --git a\/(.*) b\/(.*)/);
		if (fileHeaderMatch) {
			// If we were accumulating diffs for the target file and hit a new file header,
			// the target file's diff is complete — return it immediately.
			if (found) {
				return {
					path: targetFilePath,
					status: "modified",
					diff: diffLines.join("\n"),
					additions,
					deletions,
					truncated: false,
				};
			}
			inTarget = fileHeaderMatch[2] === targetFilePath;
			found = inTarget;
			if (inTarget) {
				diffLines.push(line);
			}
			continue;
		}

		if (inTarget) {
			diffLines.push(line);
			if (line.startsWith("+") && !line.startsWith("+++")) additions++;
			if (line.startsWith("-") && !line.startsWith("---")) deletions++;
		}
	}

	if (diffLines.length === 0) return null;

	return {
		path: targetFilePath,
		status: "modified",
		diff: diffLines.join("\n"),
		additions,
		deletions,
		truncated: false,
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createExecutionReadModel(stateStore: {
	getPlanExecutionSummary?(planExecutionId: string): Promise<PlanExecutionSummary | null>;
	getWorkspaceState?(
		planExecutionId: string,
		workspaceId: string,
	): Promise<{
		stage: string;
		attempts: number;
		startedAt?: number;
		completedAt?: number;
		error?: string;
		reportPath?: string;
	} | null>;
	getJournalEvents?(
		planExecutionId: string,
		options?: {
			limit?: number;
			offset?: number;
			eventType?: string;
			workspaceId?: string;
		},
	): Promise<JournalEventEnvelope[]>;
	/**
	 * Optional transcript store for reading workspace transcript events.
	 * If provided, enables the getTranscript() read model method.
	 */
	getTranscriptEvents?(planExecutionId: string, workspaceId: string): Promise<WorkerTranscriptEvent[]>;
	/**
	 * Optional: list artifact files from the execution archive.
	 * If provided, enables getArtifacts() to return real data.
	 * Each entry is a relative path within .pi/executions/{planExecId}/.
	 */
	listArchiveArtifacts?(
		planExecutionId: string,
	): Promise<Array<{ path: string; size: number; modifiedAt: string | null }>>;
	/**
	 * Optional: read a file from the execution archive.
	 * If provided, enables getFileContent() and getFileDiff() to
	 * read from archived workspace files (e.g. diff.patch, packet.md).
	 * The artifactPath must be a relative, sandboxed path within
	 * the execution archive directory.
	 */
	readArchiveFile?(planExecutionId: string, artifactPath: string): Promise<string | null>;
	/**
	 * Optional: read a file from the worktree directory.
	 * If provided, enables getFileContent() and getFileDiff() to
	 * read directly from worktree files when archive access fails.
	 * Paths are resolved relative to the worktree root:
	 * .pi/worktrees/{planExecId}/{workspaceId}/
	 */
	readWorktreeFile?(planExecutionId: string, workspaceId: string, filePath: string): Promise<string | null>;
}): ExecutionReadModel {
	/**
	 * Fetch all journal events for a plan execution, with caching for shared use.
	 * This prevents multiple independent reads in methods that call each other.
	 */
	const eventCache = new Map<string, JournalEventEnvelope[]>();

	async function getEvents(planExecutionId: string): Promise<JournalEventEnvelope[]> {
		if (!stateStore.getJournalEvents) return [];
		const cached = eventCache.get(planExecutionId);
		if (cached) return cached;
		const events = await stateStore.getJournalEvents(planExecutionId);
		eventCache.set(planExecutionId, events);
		return events;
	}

	return {
		async getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary> {
			if (stateStore.getPlanExecutionSummary) {
				const summary = await stateStore.getPlanExecutionSummary(planExecutionId);
				if (summary) return summary;
			}

			// Try to reconstruct from plan_started event
			const events = await getEvents(planExecutionId);
			const planStarted = events.find((e) => e.eventType === "plan_started");
			if (planStarted?.payload) {
				const p = planStarted.payload as Record<string, unknown>;
				const planCompleted = events.find((e) => e.eventType === "plan_completed");
				const planFailed = events.find((e) => e.eventType === "plan_failed");
				const planCancelled = events.find((e) => e.eventType === "plan_cancelled");
				const planStopped = events.find((e) => e.eventType === "plan_stopped");
				const terminalEvent = planCompleted ?? planFailed ?? planCancelled ?? planStopped;
				return {
					id: planExecutionId,
					projectId: (p.projectId as string) ?? "default",
					phase: (p.phase as string) ?? "unknown",
					title: (p.title as string) ?? "Unknown Plan",
					status: terminalEvent
						? (PLAN_STATUS_MAP[terminalEvent.eventType] ?? terminalEvent.eventType.replace("plan_", ""))
						: "running",
					startedAt: planStarted.createdAt,
					completedAt: terminalEvent?.createdAt ?? null,
					dataAvailability: {
						available: true,
						reason: "Reconstructed from plan_started journal event; state store summary was not available.",
					},
				};
			}

			// No plan data available from any source.
			// Return explicit unavailable state so consumers know the data
			// is a fallback wrapper, not a real plan summary.
			return {
				id: planExecutionId,
				projectId: "default",
				phase: "unknown",
				title: "Unknown Plan",
				status: "unknown",
				startedAt: "",
				completedAt: null,
				dataAvailability: {
					available: false,
					reason:
						"No plan_started event or state store summary found. Plan summary cannot be determined from available data sources.",
				},
			};
		},

		async getPlanStats(planExecutionId: string): Promise<PlanExecutionStats> {
			const events = await getEvents(planExecutionId);
			const planSummary = stateStore.getPlanExecutionSummary
				? await stateStore.getPlanExecutionSummary(planExecutionId)
				: null;
			return computePlanStatsFromEvents(planExecutionId, events, planSummary);
		},

		async getDependencyGraph(planExecutionId: string): Promise<DependencyGraphView> {
			const events = await getEvents(planExecutionId);
			return extractDependencyGraphFromEvents(planExecutionId, events);
		},

		async getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary> {
			if (stateStore.getWorkspaceState) {
				const state = await stateStore.getWorkspaceState(planExecutionId, workspaceId);
				if (state)
					return {
						id: workspaceId,
						planExecutionId,
						workspaceId,
						stage: state.stage,
						attempts: state.attempts,
						startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : undefined,
						completedAt: state.completedAt ? new Date(state.completedAt).toISOString() : undefined,
						error: state.error,
						reportPath: state.reportPath,
						dataAvailability: { available: true },
					};
			}

			// Fallback: reconstruct from workspace events
			const events = await getEvents(planExecutionId);
			const wsEvents = events.filter((e) => e.workspaceId === workspaceId);
			if (wsEvents.length > 0) {
				// Map event types to WorkspaceExecutionStage names.
				// These are canonical stage names used across the execution platform.
				const eventToStage: Record<string, string> = {
					workspace_pending: "Pending",
					workspace_running: "Running",
					workspace_completed: "Complete",
					workspace_failed: "Failed",
					workspace_blocked: "Blocked",
					workspace_cancelled: "Cancelled",
					workspace_skipped: "Skipped",
					workspace_timed_out: "TimedOut",
					workspace_paused: "Paused",
				};

				const terminalStages = new Set(["Complete", "Failed", "Cancelled", "Skipped", "TimedOut"]);

				// Track per-sequence-number stage, use highest seq for latest
				let latestStage = "unknown";
				let latestSeq = -1;
				let attempts = 0;
				let startedAt: string | undefined;
				let completedAt: string | undefined;
				let error: string | undefined;

				for (const event of wsEvents) {
					const seq = Number.parseInt(event.seq, 10) || 0;
					const stage = eventToStage[event.eventType];
					if (stage) {
						// Only update if this event has a higher sequence number
						// (more recent in the event stream)
						if (seq > latestSeq) {
							latestSeq = seq;
							latestStage = stage;
						}
					}
					if (event.eventType === "worker_started") {
						attempts++;
					}
					if (event.eventType === "worker_failed" && event.payload) {
						const p = event.payload as Record<string, unknown>;
						error = (p.error as string) ?? error;
					}
					if (!startedAt) startedAt = event.createdAt;
					completedAt = event.createdAt; // Track most recent
				}

				return {
					id: workspaceId,
					planExecutionId,
					workspaceId,
					stage: latestStage,
					attempts,
					startedAt,
					completedAt: terminalStages.has(latestStage) ? completedAt : undefined,
					error,
					dataAvailability: { available: true },
				};
			}

			return {
				id: workspaceId,
				planExecutionId,
				workspaceId,
				stage: "unknown",
				attempts: 0,
				dataAvailability: {
					available: false,
					reason:
						"No state store workspace state or journal events found for this workspace. Cannot determine workspace summary.",
				},
			};
		},

		async listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]> {
			if (stateStore.getJournalEvents) return stateStore.getJournalEvents(planExecutionId, options);
			return [];
		},

		async getWorkerContext(planExecutionId: string, workspaceId: string): Promise<WorkerContextView> {
			const summary = await this.getWorkspaceSummary(planExecutionId, workspaceId);
			const directives = await this.getLeadDirectives(planExecutionId, workspaceId);
			const escalations = await this.getLeadEscalations(planExecutionId, workspaceId);

			// Extract goal/role from workspace-level events if available
			const wsEvents = stateStore.getJournalEvents
				? await stateStore.getJournalEvents(planExecutionId, { workspaceId })
				: [];

			let goal: string | undefined;
			let role: string | undefined;
			let humanDirective: string | undefined;

			for (const event of wsEvents) {
				if (!event.payload) continue;
				const p = event.payload as Record<string, unknown>;

				// Extract goal from workspace definition if embedded in plan_started context
				if (event.eventType === "plan_started" && p.workspaces) {
					const workspaces = p.workspaces as Array<Record<string, unknown>>;
					const wsDef = workspaces.find((w: Record<string, unknown>) => w.id === workspaceId);
					if (wsDef) {
						goal = (wsDef.goal as string) ?? (wsDef.title as string) ?? goal;
						role = (wsDef.role as string) ?? (wsDef.agentRole as string) ?? role;
					}
				}

				// Extract human directive from human_directive_issued events
				if (event.eventType === "human_directive_issued") {
					humanDirective = (p.directive as string) ?? humanDirective;
				}
			}

			// Extract last command from command history
			let lastCommand: string | undefined;
			const commandHistory = extractCommandHistoryFromEvents(wsEvents);
			if (commandHistory.length > 0) {
				lastCommand = commandHistory[commandHistory.length - 1].command;
			}

			// Log summary: extract last meaningful output from command events
			let logSummary: string | undefined;
			const outputEvents = wsEvents.filter((e) => e.eventType === "command_finished" && e.payload).slice(-3);
			if (outputEvents.length > 0) {
				const summaries = outputEvents
					.map((e) => (e.payload as Record<string, unknown>).outputSummary as string | undefined)
					.filter(Boolean);
				if (summaries.length > 0) {
					logSummary = summaries.join("\n");
				}
			}

			// Try to enrich with archive data if available
			let touchedFiles: Array<{ path: string; change: "created" | "modified" | "deleted" }> = [];
			let rolePacketContent: string | undefined;

			if (stateStore.readArchiveFile) {
				// Try loading files-touched.json from archive
				const filesTouchedRaw = await stateStore.readArchiveFile(
					planExecutionId,
					`workspaces/${workspaceId}/files-touched.json`,
				);
				if (filesTouchedRaw !== null) {
					try {
						touchedFiles = JSON.parse(filesTouchedRaw) as Array<{
							path: string;
							change: "created" | "modified" | "deleted";
						}>;
					} catch {
						// Invalid JSON, leave as empty
					}
				}

				// Try loading packet.md from archive
				const rawPacket = await stateStore.readArchiveFile(planExecutionId, `workspaces/${workspaceId}/packet.md`);
				rolePacketContent = rawPacket ?? undefined;
			}

			return {
				workspaceId,
				planExecutionId,
				stage: summary.stage,
				attempts: summary.attempts,
				error: summary.error,
				startedAt: summary.startedAt,
				completedAt: summary.completedAt,
				goal,
				role,
				rolePacketContent,
				// Build a brief context summary from the packet if available
				contextPacketSummary: rolePacketContent
					? rolePacketContent
							.split("\n")
							.filter((l) => l.trim().length > 0)
							.slice(0, 10)
							.join("\n")
					: undefined,
				// Allowed files are not tracked in the read model directly.
				// The web-server worker-context-routes.ts extracts them from
				// the workspace definition in the state store.
				allowedFiles: [],
				touchedFiles,
				lastCommand,
				logSummary,
				activeDirectives: directives.filter((d) => d.status === "issued" || d.status === "acknowledged"),
				activeEscalations: escalations.filter((e) => e.status === "awaiting_user"),
				humanDirective,
				transcriptUrl: `/api/transcript/${planExecutionId}/${workspaceId}`,
			};
		},

		async getCommandHistory(planExecutionId: string, workspaceId: string): Promise<CommandHistoryView[]> {
			const events = stateStore.getJournalEvents
				? await stateStore.getJournalEvents(planExecutionId, { workspaceId })
				: [];

			return extractCommandHistoryFromEvents(events);
		},

		async getLeadDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]> {
			const events = stateStore.getJournalEvents
				? await stateStore.getJournalEvents(planExecutionId, { workspaceId })
				: [];

			return extractDirectivesFromEvents(events);
		},

		async getLeadEscalations(planExecutionId: string, workspaceId: string): Promise<LeadEscalationView[]> {
			const events = stateStore.getJournalEvents
				? await stateStore.getJournalEvents(planExecutionId, { workspaceId })
				: [];

			return extractEscalationsFromEvents(events);
		},

		async getFinalValidationStatus(planExecutionId: string, workspaceId: string): Promise<FinalValidationView> {
			// Fetch all governance events for the workspace individually, since
			// state store getJournalEvents may not support comma-separated eventType filters.
			const governanceEvents: JournalEventEnvelope[] = [];
			const governanceTypes = ["governance_approved", "governance_rejected", "governance_escalated"];

			if (stateStore.getJournalEvents) {
				// Try fetching by workspace first, then filter by event type in memory.
				const workspaceEvents = await stateStore.getJournalEvents(planExecutionId, {
					workspaceId,
				});
				governanceEvents.push(...workspaceEvents.filter((e) => governanceTypes.includes(e.eventType)));
			}

			if (governanceEvents.length === 0) {
				return {
					required: true,
					passed: null,
					blocked: false,
					blockReasons: [],
				};
			}

			// Sort by seq to find the latest event
			governanceEvents.sort((a, b) => Number.parseInt(a.seq, 10) - Number.parseInt(b.seq, 10));
			const latestEvent = governanceEvents[governanceEvents.length - 1];

			if (latestEvent.eventType === "governance_approved") {
				return {
					required: true,
					passed: true,
					blocked: false,
					blockReasons: [],
				};
			}

			if (latestEvent.eventType === "governance_rejected" && latestEvent.payload) {
				const p = latestEvent.payload as Record<string, unknown>;
				return {
					required: true,
					passed: false,
					blocked: true,
					blockReasons: [(p.reason as string) ?? "Governance rejected"],
				};
			}

			if (latestEvent.eventType === "governance_escalated" && latestEvent.payload) {
				const p = latestEvent.payload as Record<string, unknown>;
				return {
					required: true,
					passed: null,
					blocked: true,
					blockReasons: [(p.reason as string) ?? "Governance escalated"],
				};
			}

			return {
				required: true,
				passed: null,
				blocked: false,
				blockReasons: [],
			};
		},

		// -------------------------------------------------------------------
		// File Tree Read Model (P41.06)
		// -------------------------------------------------------------------

		async getChangedFiles(planExecutionId: string, workspaceId: string): Promise<ChangedFileEntry[]> {
			// Query worker_completed events for this workspace and extract changed files
			const events = stateStore.getJournalEvents
				? await stateStore.getJournalEvents(planExecutionId, {
						workspaceId,
						eventType: "worker_completed",
					})
				: [];

			return extractChangedFilesFromEvents(events);
		},

		async getFileTree(
			planExecutionId: string,
			workspaceId: string,
			options?: FileTreeQuery,
		): Promise<FileTreeNode[]> {
			const entries = await this.getChangedFiles(planExecutionId, workspaceId);
			if (entries.length === 0) return [];

			if (options?.flat) {
				// Return as flat list of tree nodes (files only, no directories)
				return entries.map(
					(e): FileTreeNode => ({
						path: e.path,
						name: e.name,
						ext: e.ext,
						status: e.status,
						isDir: false,
						additions: e.additions,
						deletions: e.deletions,
					}),
				);
			}

			return buildFileTreeFromEntries(entries);
		},

		async getFileContent(
			planExecutionId: string,
			workspaceId: string,
			filePath: string,
		): Promise<FileContentView | null> {
			// Path sandbox check
			if (filePath.includes("..") || filePath.includes("~")) {
				return null;
			}

			// Try the execution archive first (where snapshots may be stored).
			if (stateStore.readArchiveFile) {
				const safePath = `workspaces/${workspaceId}/${filePath}`;
				const content = await stateStore.readArchiveFile(planExecutionId, safePath);
				if (content !== null) {
					return {
						path: filePath,
						content,
						isBinary: false,
						size: Buffer.byteLength(content, "utf-8"),
						language: getFileExt(filePath) || undefined,
					};
				}
			}

			// Fallback: read directly from the worktree directory.
			if (stateStore.readWorktreeFile) {
				const content = await stateStore.readWorktreeFile(planExecutionId, workspaceId, filePath);
				if (content !== null) {
					return {
						path: filePath,
						content,
						isBinary: false,
						size: Buffer.byteLength(content, "utf-8"),
						language: getFileExt(filePath) || undefined,
					};
				}
			}

			// File content retrieval requires filesystem access to worktree
			// directories or a snapshot store (ISnapshotArtifactStore). The
			// journal event stream does not contain file content.
			//
			// To enable file content through the read model, provide
			// readArchiveFile() or readWorktreeFile() in the state store.
			return null;
		},

		async getFileDiff(
			planExecutionId: string,
			workspaceId: string,
			filePath?: string,
			options?: FileTreeQuery,
		): Promise<FileDiffView[]> {
			let diffContent: string | null = null;

			// Try the execution archive first.
			if (stateStore.readArchiveFile) {
				const diffPath = `workspaces/${workspaceId}/diff.patch`;
				diffContent = await stateStore.readArchiveFile(planExecutionId, diffPath);
			}

			// Fallback: try the worktree diff.patch.
			if (diffContent === null && stateStore.readWorktreeFile) {
				diffContent = await stateStore.readWorktreeFile(planExecutionId, workspaceId, "diff.patch");
			}

			if (diffContent !== null) {
				const lines = diffContent.split("\n");
				let additions = 0;
				let deletions = 0;
				for (const line of lines) {
					if (line.startsWith("+") && !line.startsWith("+++")) additions++;
					if (line.startsWith("-") && !line.startsWith("---")) deletions++;
				}

				// Apply maxDiffLines truncation
				const maxLines = options?.maxDiffLines;
				const truncated = maxLines !== undefined && lines.length > maxLines;
				const truncatedDiff = truncated ? `${lines.slice(0, maxLines).join("\n")}\n... (truncated)` : diffContent;

				if (filePath) {
					// Return only the diff for a specific file.
					const fileDiff = extractFileDiffFromPatch(diffContent, filePath);
					if (!fileDiff) return [];
					const fileLines = fileDiff.diff.split("\n");
					if (maxLines !== undefined && fileLines.length > maxLines) {
						fileDiff.diff = `${fileLines.slice(0, maxLines).join("\n")}\n... (truncated)`;
						fileDiff.truncated = true;
					}
					return [fileDiff];
				}
				return [
					{
						path: `workspaces/${workspaceId}/diff.patch`,
						status: "modified",
						diff: truncatedDiff,
						additions,
						deletions,
						truncated,
					},
				];
			}

			// No diff data available from any source.
			// Consumers that need diff content should provide readArchiveFile()
			// or readWorktreeFile() in the state store implementation.
			return [];
		},

		// -------------------------------------------------------------------
		// Transcript
		// -------------------------------------------------------------------

		async getTranscript(planExecutionId: string, workspaceId: string): Promise<WorkerTranscriptEvent[]> {
			if (stateStore.getTranscriptEvents) {
				return stateStore.getTranscriptEvents(planExecutionId, workspaceId);
			}
			// Fallback: try to reconstruct from journal events
			// by filtering worker-level system events and creating
			// a minimal transcript view. This is a best-effort reconstruction
			// since the full transcript pipeline requires a proper transcript store.
			const events = await getEvents(planExecutionId);
			const wsEvents = events.filter((e) => e.workspaceId === workspaceId);
			if (wsEvents.length === 0) return [];

			return wsEvents.map((e) => ({
				type: mapEventTypeToTranscriptType(e.eventType) as WorkerTranscriptEvent["type"],
				timestamp: new Date(e.createdAt).getTime(),
				workspaceId: e.workspaceId ?? workspaceId,
				summary: buildTranscriptEventSummary(e),
				data: (e.payload as Record<string, unknown>) ?? undefined,
			}));
		},

		// -------------------------------------------------------------------
		// Artifacts
		// -------------------------------------------------------------------

		async getArtifacts(planExecutionId: string): Promise<ArtifactEntry[]> {
			// Try to list artifacts from the execution archive via the state store.
			if (stateStore.listArchiveArtifacts) {
				const archiveArtifacts = await stateStore.listArchiveArtifacts(planExecutionId);
				return archiveArtifacts.map((a) => ({
					path: a.path,
					size: a.size,
					modifiedAt: a.modifiedAt,
					dataAvailability: { available: true },
				}));
			}

			// Artifact listing requires filesystem access to the execution
			// archive directory (.pi/executions/{planExecId}/). The journal
			// event stream does not contain artifact metadata.
			//
			// Consumers that need artifact listing should use the dedicated
			// artifact API endpoint:
			//   GET /api/artifacts/:planExecId
			// which provides sandboxed listing with path validation.
			//
			// See artifact-routes.ts for the web-server implementation.
			//
			// To enable artifact listing through the read model, provide
			// listArchiveArtifacts() in the state store implementation.
			return [];
		},
	};
}
