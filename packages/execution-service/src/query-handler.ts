/**
 * Execution Query Handler — P40 Platform / Agent Separation
 *
 * Facade for querying execution state through the read model.
 * External consumers (Brain, Web, UI) query state through this handler.
 */
import type {
	ChangedFileEntry,
	CommandHistoryView,
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
	PlanExecutionSummary,
	WorkerContextView,
	WorkspaceExecutionSummary,
} from "@earendil-works/pi-execution-core";
import { buildFileTreeFromEntries, getFileExt } from "@earendil-works/pi-execution-core";

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
}): ExecutionReadModel {
	return {
		async getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary> {
			if (stateStore.getPlanExecutionSummary) {
				const summary = await stateStore.getPlanExecutionSummary(planExecutionId);
				if (summary) return summary;
			}
			return {
				id: planExecutionId,
				projectId: "default",
				phase: "unknown",
				title: "Unknown Plan",
				status: "running",
				startedAt: new Date().toISOString(),
				completedAt: null,
			};
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
					};
			}
			return {
				id: workspaceId,
				planExecutionId,
				workspaceId,
				stage: "unknown",
				attempts: 0,
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

			return {
				workspaceId,
				planExecutionId,
				stage: summary.stage,
				attempts: summary.attempts,
				error: summary.error,
				startedAt: summary.startedAt,
				completedAt: summary.completedAt,
				allowedFiles: [],
				touchedFiles: [],
				activeDirectives: directives.filter((d) => d.status === "issued" || d.status === "acknowledged"),
				activeEscalations: escalations.filter((e) => e.status === "awaiting_user"),
				transcriptUrl: `/api/transcript/${planExecutionId}/${workspaceId}`,
			};
		},

		async getCommandHistory(): Promise<CommandHistoryView[]> {
			return [];
		},

		async getLeadDirectives(): Promise<LeadDirectiveView[]> {
			return [];
		},

		async getLeadEscalations(): Promise<LeadEscalationView[]> {
			return [];
		},

		async getFinalValidationStatus(): Promise<FinalValidationView> {
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
			_planExecutionId: string,
			_workspaceId: string,
			_filePath: string,
		): Promise<FileContentView | null> {
			// Default implementation returns null — file content requires
			// filesystem access that is outside the scope of the state-store
			// based read model. Consumers (e.g., web-server worktree routes)
			// should implement file content retrieval directly.
			return null;
		},

		async getFileDiff(
			_planExecutionId: string,
			_workspaceId: string,
			_filePath?: string,
			_options?: FileTreeQuery,
		): Promise<FileDiffView[]> {
			// Default implementation returns empty — diff requires git access
			// that is outside the scope of the state-store based read model.
			// Consumers (e.g., web-server worktree routes) should implement
			// diff retrieval directly.
			return [];
		},
	};
}
