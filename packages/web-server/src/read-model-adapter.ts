/**
 * Read Model Adapter — P42.01 Read Model Integration
 *
 * Bridges the web-server's IStateStore to the ExecutionReadModel from
 * execution-service. The adapter converts the state store's JournalEvent
 * format to the JournalEventEnvelope format expected by the read model.
 *
 * Usage:
 *   import { createReadModelAdapter } from "./read-model-adapter.js";
 *   import { createExecutionReadModel } from "@earendil-works/pi-execution-service";
 *
 *   const stateStore = getStateStore();
 *   const adapter = createReadModelAdapter(stateStore);
 *   const readModel = createExecutionReadModel(adapter);
 *
 *   const planSummary = await readModel.getPlanSummary("exec-1");
 */

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IStateStore } from "@earendil-works/pi-coding-agent";
import type { JournalEventEnvelope } from "@earendil-works/pi-execution-contracts";
import { isForbiddenPath, listArchiveFiles, readArchiveArtifact } from "./execution-archive.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Read model adapter — a state store wrapper that provides the methods
 * expected by createExecutionReadModel().
 *
 * This wraps the IStateStore from the coding-agent and converts its
 * readJournal() output to JournalEventEnvelope[] format, while also
 * delegating workspace state and plan execution summary methods.
 */
export interface ReadModelAdapter {
	getPlanExecutionSummary?(planExecutionId: string): Promise<{
		id: string;
		projectId: string;
		phase: string;
		title: string;
		status: string;
		startedAt: string;
		completedAt: string | null;
	} | null>;
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
	 * Read a file from the execution archive.
	 * The artifactPath is a relative, sandboxed path within .pi/executions/{planExecId}/.
	 * Returns null when the file is not found, forbidden, or the archive is not accessible.
	 */
	readArchiveFile?(planExecutionId: string, artifactPath: string): Promise<string | null>;

	/**
	 * Read a file from a worktree directory.
	 * The filePath is resolved relative to .pi/worktrees/{planExecId}/{workspaceId}/.
	 * Returns null when the file is not found or the worktree is not accessible.
	 */
	readWorktreeFile?(planExecutionId: string, workspaceId: string, filePath: string): Promise<string | null>;

	/**
	 * List available files in the execution archive.
	 * Returns file metadata (path, size, modification time).
	 * Returns an empty array when the archive is not accessible.
	 */
	listArchiveArtifacts?(
		planExecutionId: string,
	): Promise<Array<{ path: string; size: number; modifiedAt: string | null }>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a read model adapter from an IStateStore instance.
 *
 * The adapter provides:
 *   - getJournalEvents() — converts readJournal() JournalEvent[] to JournalEventEnvelope[]
 *     with planExecutionId, eventType, payload, createdAt mapping
 *   - getWorkspaceState() — delegates directly to state store
 *   - getPlanExecutionSummary() — extracts from loadState() result
 *   - readArchiveFile() — reads files from .pi/executions/{planExecId}/ (requires workspaceRoot)
 *   - listArchiveArtifacts() — lists available files in the execution archive (requires workspaceRoot)
 *
 * NOTE: getTranscriptEvents() is NOT provided because there is no file-based
 * IWorkerTranscriptStore implementation that persists transcript events to
 * the execution archive. The read model falls back to reconstructing transcript
 * events from journal events when getTranscriptEvents() is absent, which
 * provides equivalent coverage.
 *
 * @param stateStore - The IStateStore instance from getStateStore()
 * @param workspaceRoot - Project workspace root path. Required for archive-based methods
 *   (readArchiveFile, listArchiveArtifacts). When absent, those methods return fallback values.
 * @returns A ReadModelAdapter suitable for createExecutionReadModel()
 */
export function createReadModelAdapter(stateStore: IStateStore, workspaceRoot?: string): ReadModelAdapter {
	let seqCounter = 0;

	return {
		/**
		 * Get plan execution summary from the state store.
		 * Extracts phase, title, status, timestamps from loadState().
		 */
		async getPlanExecutionSummary(planExecutionId: string) {
			try {
				const state = await stateStore.loadState(planExecutionId);
				if (!state) return null;

				return {
					id: planExecutionId,
					projectId: (state as any).projectId ?? "default",
					phase: (state as any).phase ?? "unknown",
					title: (state as any).title ?? "Unknown Plan",
					status: (state as any).status ?? "unknown",
					startedAt: (state as any).startedAt
						? new Date((state as any).startedAt).toISOString()
						: new Date().toISOString(),
					completedAt: (state as any).completedAt ? new Date((state as any).completedAt).toISOString() : null,
				};
			} catch {
				return null;
			}
		},

		/**
		 * Get workspace state from the state store.
		 */
		async getWorkspaceState(planExecutionId: string, workspaceId: string) {
			try {
				const ws = await stateStore.getWorkspaceState(planExecutionId, workspaceId);
				if (!ws) return null;

				return {
					stage: (ws as any).stage ?? "unknown",
					attempts: (ws as any).attempts ?? 0,
					startedAt: (ws as any).startedAt ?? undefined,
					completedAt: (ws as any).completedAt ?? undefined,
					error: (ws as any).error ?? undefined,
					reportPath: (ws as any).reportPath ?? undefined,
				};
			} catch {
				return null;
			}
		},

		/**
		 * Get journal events from the state store, converting to JournalEventEnvelope format.
		 *
		 * Applies optional filters (workspaceId, eventType, limit, offset) after reading
		 * all events since the state store's readJournal() doesn't support filtering.
		 */
		async getJournalEvents(
			planExecutionId: string,
			options?: {
				limit?: number;
				offset?: number;
				eventType?: string;
				workspaceId?: string;
			},
		) {
			try {
				const rawEvents = await stateStore.readJournal(planExecutionId);
				if (!rawEvents || !Array.isArray(rawEvents)) return [];

				// Convert to JournalEventEnvelope format
				let envelopes: JournalEventEnvelope[] = rawEvents.map((event, idx) => ({
					seq: String(++seqCounter),
					eventId: `event-${planExecutionId}-${idx}`,
					planExecutionId,
					workspaceId: event.workspaceId,
					eventType: event.type,
					payload: (event.data as Record<string, unknown>) ?? null,
					createdAt: new Date(event.timestamp).toISOString(),
				}));

				// Apply filters
				if (options?.workspaceId) {
					envelopes = envelopes.filter((e) => e.workspaceId === options.workspaceId);
				}
				if (options?.eventType) {
					envelopes = envelopes.filter((e) => e.eventType === options.eventType);
				}

				// Apply pagination after filtering
				const offset = options?.offset ?? 0;
				const limit = options?.limit ?? envelopes.length;
				envelopes = envelopes.slice(offset, offset + limit);

				return envelopes;
			} catch {
				return [];
			}
		},

		/**
		 * Read a file from the execution archive via the filesystem.
		 *
		 * Reads from .pi/executions/{planExecutionId}/{artifactPath} with
		 * path sandboxing via isForbiddenPath and path traversal protection
		 * provided by readArchiveArtifact().
		 *
		 * Returns null when:
		 *   - workspaceRoot is not provided
		 *   - the path violates sandbox rules
		 *   - the file does not exist
		 *   - the file is unreadable
		 */
		async readArchiveFile(planExecutionId: string, artifactPath: string): Promise<string | null> {
			if (!workspaceRoot) {
				// Archive access requires workspace root, which may not be set
				// in environments without access to the project filesystem.
				return null;
			}

			// Delegate to execution-archive with full sandbox protection
			return readArchiveArtifact(workspaceRoot, planExecutionId, artifactPath);
		},

		/**
		 * Read a file from a worktree directory.
		 *
		 * Reads from .pi/worktrees/{planExecutionId}/{workspaceId}/{filePath}
		 * with path sandboxing to prevent traversal attacks.
		 *
		 * Returns null when:
		 *   - workspaceRoot is not provided
		 *   - the path contains traversal sequences (.., ~)
		 *   - the file does not exist
		 *   - the file is unreadable
		 */
		async readWorktreeFile(planExecutionId: string, workspaceId: string, filePath: string): Promise<string | null> {
			if (!workspaceRoot) {
				return null;
			}

			// Path sandbox: block traversal attacks
			if (filePath.includes("..") || filePath.includes("~")) {
				return null;
			}

			const resolvedPath = resolve(join(workspaceRoot, ".pi", "worktrees", planExecutionId, workspaceId, filePath));
			const worktreeBase = resolve(join(workspaceRoot, ".pi", "worktrees", planExecutionId, workspaceId));

			// Ensure resolved path is within the worktree directory
			if (!resolvedPath.startsWith(`${worktreeBase}/`) && resolvedPath !== worktreeBase) {
				return null;
			}

			try {
				if (!existsSync(resolvedPath)) return null;
				const s = await stat(resolvedPath);
				if (s.isDirectory()) return null;
				// Limit file size to 5MB for read model access
				if (s.size > 5 * 1024 * 1024) return null;
				return await readFile(resolvedPath, "utf-8");
			} catch {
				return null;
			}
		},

		/**
		 * List available artifact files in the execution archive.
		 *
		 * Walks .pi/executions/{planExecutionId}/ recursively and returns
		 * artifact entries with path, size, and modification timestamp.
		 *
		 * Returns an empty array when:
		 *   - workspaceRoot is not provided
		 *   - the archive directory does not exist
		 *   - the archive directory has no files
		 */
		async listArchiveArtifacts(
			planExecutionId: string,
		): Promise<Array<{ path: string; size: number; modifiedAt: string | null }>> {
			if (!workspaceRoot) {
				return [];
			}

			try {
				const relativePaths = await listArchiveFiles(workspaceRoot, planExecutionId);
				const archiveDir = resolve(join(workspaceRoot, ".pi", "executions", planExecutionId));

				const artifacts: Array<{ path: string; size: number; modifiedAt: string | null }> = [];

				for (const relPath of relativePaths) {
					// Skip forbidden paths as defense-in-depth
					if (isForbiddenPath(relPath)) continue;

					const fullPath = join(archiveDir, relPath);
					try {
						const s = await stat(fullPath);
						artifacts.push({
							path: relPath,
							size: s.size,
							modifiedAt: s.mtime.toISOString(),
						});
					} catch {
						// skip unreadable files
					}
				}

				return artifacts;
			} catch {
				return [];
			}
		},
	};
}
