/**
 * ProjectStateHooks — PSS-MEGA-02.1
 *
 * Lightweight runtime hooks that wire the Project State event infrastructure
 * into real tool boundaries (write, edit, bash).
 *
 * All methods are best-effort: they never throw and never break the calling tool.
 * If .pi/project-state does not exist or event append fails, hooks silently degrade.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { classifyCommand } from "./project-state/bash-classifier.js";
import { ProjectStateEventJournal } from "./project-state/event-journal.js";
import type { CommandClassification } from "./project-state/event-types.js";
import { MutationWindowStore } from "./project-state/mutation-window-store.js";
import { getStateDir } from "./project-state/paths.js";
import { ReconcileScanner } from "./project-state/reconcile-scanner.js";
import { ProjectStateStore } from "./project-state/store.js";
import { ToolEventEmitter } from "./project-state/tool-event-emitter.js";

// ============================================================================
// Cache
// ============================================================================

/**
 * Check if a project state exists for the given root directory.
 */
function stateExists(rootDir: string): boolean {
	try {
		const store = new ProjectStateStore(rootDir);
		return store.hasAnyState();
	} catch {
		return false;
	}
}

/**
 * Create an emitter for a root directory if state exists.
 */
function getEmitter(rootDir: string): ToolEventEmitter | null {
	try {
		const store = new ProjectStateStore(rootDir);
		if (!store.hasAnyState()) return null;
		const journal = new ProjectStateEventJournal(rootDir);
		return new ToolEventEmitter(store, journal);
	} catch {
		return null;
	}
}

// ============================================================================
// Hash helper (simple string hash)
// ============================================================================

function simpleHash(s: string): string {
	let hash = 0;
	for (let i = 0; i < s.length; i++) {
		const char = s.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0;
	}
	return Math.abs(hash).toString(16);
}

// ============================================================================
// Write hook
// ============================================================================

/**
 * Called after a successful file write.
 * @param rootDir The project root directory
 * @param relPath The repo-relative file path
 * @param newContent The content that was written
 * @param oldContent The content that was replaced (undefined if new file)
 */
export function afterFileWrite(rootDir: string, relPath: string, newContent: string, oldContent?: string): void {
	const emitter = getEmitter(rootDir);
	if (!emitter) return;
	emitter.emitFileWritten(relPath, newContent, oldContent);
}

// ============================================================================
// Edit hook
// ============================================================================

/**
 * Called after a successful file edit.
 * @param rootDir The project root directory
 * @param relPath The repo-relative file path
 * @param newContent The content after edit
 * @param oldContent The content before edit
 */
export function afterFileEdit(rootDir: string, relPath: string, newContent: string, oldContent: string): void {
	const emitter = getEmitter(rootDir);
	if (!emitter) return;
	emitter.emitFileEdited(relPath, newContent, oldContent);
}

// ============================================================================
// Bash hooks
// ============================================================================

export interface BashClassificationResult {
	classification: CommandClassification;
	/** Whether a mutation window was opened */
	mutationWindowId?: string;
}

/**
 * Called before a bash command executes.
 * Classifies the command and opens a mutation window if required.
 * Returns the classification result so the caller can use it for after-hook.
 */
export function beforeBashCommand(rootDir: string, command: string, cwd: string): BashClassificationResult {
	try {
		const classification = classifyCommand(command);

		// Emit command_started event
		const emitter = getEmitter(rootDir);
		if (emitter) {
			emitter.emitCommandStarted(command, classification);
		}

		let mutationWindowId: string | undefined;

		// Open mutation window if required
		if (classification.requiresMutationWindow) {
			try {
				const mw = new MutationWindowStore(rootDir);
				const window = mw.open(
					classification.effect === "git_state_mutation"
						? "git_operation"
						: classification.effect === "package_state_mutation"
							? "package_operation"
							: "bash_unknown",
					classification.reason,
					command,
				);
				mutationWindowId = window.id;

				// Mark state dirty/unknown
				if (emitter) {
					const scope = affectedScopes(classification);
					if (classification.confidence === "low") {
						emitter.emitStateMarkedUnknown(`Unknown bash command: ${command.slice(0, 80)}`, scope);
					} else {
						emitter.emitStateMarkedDirty(`Bash mutation: ${classification.reason}`, scope);
					}
				}
			} catch {
				// Best-effort
			}
		}

		return { classification, mutationWindowId };
	} catch {
		// Best-effort: return safe default
		return {
			classification: {
				effect: "unknown_global_mutation",
				confidence: "low",
				requiresMutationWindow: false,
				requiresReconcile: "bounded_tree",
				reason: "Classification error (fallback)",
			},
		};
	}
}

/**
 * Called after a bash command completes.
 * Emits command_completed and closes/fails the mutation window.
 */
export type BashCommandOutcomeStatus = "completed" | "failed" | "aborted" | "timeout" | "spawn_error" | "unknown_error";

export interface BashCommandOutcome {
	exitCode?: number | null;
	status: BashCommandOutcomeStatus;
	errorMessage?: string;
	signal?: string;
	durationMs?: number;
}

/**
 * Called after a bash command completes, fails, times out, or aborts.
 * Guarantees cleanup: mutation window close/fail and event emission.
 *
 * @param rootDir Project root
 * @param command The resolved command string
 * @param exitCodeOrOutcome Exit code (number) or full outcome object
 * @param classification From beforeBashCommand
 * @param mutationWindowId From beforeBashCommand (optional)
 */
export function afterBashCommand(
	rootDir: string,
	command: string,
	exitCodeOrOutcome: number | BashCommandOutcome,
	classification: CommandClassification,
	mutationWindowId?: string,
): void {
	// Normalize outcome — accept both number (legacy) and full outcome object
	const outcome: BashCommandOutcome =
		typeof exitCodeOrOutcome === "number"
			? { exitCode: exitCodeOrOutcome, status: exitCodeOrOutcome === 0 ? "completed" : "failed" }
			: exitCodeOrOutcome;

	const exitCode = outcome.exitCode ?? (outcome.status === "completed" ? 0 : -1);

	try {
		const emitter = getEmitter(rootDir);
		if (emitter) {
			emitter.emitCommandCompleted(command, exitCode, classification);
		}

		// Close or fail mutation window
		if (mutationWindowId) {
			try {
				const mw = new MutationWindowStore(rootDir);
				const window = mw.get(mutationWindowId);
				if (window) {
					const isSuccess =
						outcome.status === "completed" || (outcome.status === "failed" && outcome.exitCode === 0);
					if (isSuccess) {
						mw.setReconciling(mutationWindowId);
						if (classification.affectedPaths && classification.affectedPaths.length > 0) {
							try {
								const store = new ProjectStateStore(rootDir);
								const scanner = new ReconcileScanner(store);
								const scanResult = scanner.reconcile({
									rootDir,
									candidatePaths: classification.affectedPaths,
									level:
										classification.requiresReconcile === "parent_dirs"
											? "parent_dirs"
											: classification.requiresReconcile === "bounded_tree"
												? "bounded_tree"
												: "path",
								});
								if (scanResult.exceededLimit) {
									mw.fail(mutationWindowId);
								} else {
									mw.close(mutationWindowId);
								}
							} catch {
								mw.fail(mutationWindowId);
							}
						} else {
							mw.close(mutationWindowId);
						}
					} else {
						mw.fail(mutationWindowId);
					}
				}
			} catch {
				// Best-effort
			}
		}
	} catch {
		// Best-effort
	}
}

// ============================================================================
// Helpers
// ============================================================================

function affectedScopes(classification: CommandClassification): string[] {
	switch (classification.effect) {
		case "no_state_change":
			return [];
		case "path_local_mutation":
		case "tree_mutation":
			return ["tree", "files"];
		case "package_state_mutation":
			return ["packages", "tree"];
		case "git_state_mutation":
			return ["git", "tree", "files"];
		case "unknown_global_mutation":
		case "dangerous_destructive_mutation":
			return ["tree", "files", "packages", "git"];
	}
	return ["tree", "files"];
}
