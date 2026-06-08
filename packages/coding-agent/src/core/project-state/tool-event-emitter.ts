/**
 * ProjectStateToolEventEmitter — PSS-MEGA-02
 *
 * Emits precise mutation events from write/edit tool boundaries
 * and triggers projector application.
 */

import type { ProjectStateEventJournal } from "./event-journal.js";
import type { CommandClassification, ProjectStateEvent } from "./event-types.js";
import { ProjectStateProjector } from "./projector.js";
import type { ProjectStateStore } from "./store.js";

/**
 * ToolEventEmitter
 *
 * Integration seam between tool execution and the event journal/projector.
 * All methods are best-effort: failures do not break the calling tool.
 */
export class ToolEventEmitter {
	private journal: ProjectStateEventJournal;
	private projector: ProjectStateProjector;
	private store: ProjectStateStore;
	private sessionId: string;

	constructor(store: ProjectStateStore, journal: ProjectStateEventJournal, sessionId?: string) {
		this.store = store;
		this.journal = journal;
		this.projector = new ProjectStateProjector(store, journal);
		this.sessionId = sessionId ?? "unknown";
	}

	/**
	 * Emit a `file_written` event after a successful write.
	 * If oldContent is provided, computes oldHash for the event.
	 */
	emitFileWritten(path: string, newContent?: string, oldContent?: string): void {
		try {
			const newHash = newContent ? simpleHash(newContent) : undefined;
			const oldHash = oldContent ? simpleHash(oldContent) : undefined;
			const event: ProjectStateEvent = {
				type: "file_written",
				path,
				oldHash,
				newHash,
			};
			this.journal.append(event, "write_tool", { cwd: this.store.getRootDir() });
			this.projector.applyAll();
		} catch {
			// Best-effort
		}
	}

	/**
	 * Emit a `file_edited` event after a successful edit.
	 */
	emitFileEdited(path: string, newContent?: string, oldContent?: string): void {
		try {
			const newHash = newContent ? simpleHash(newContent) : undefined;
			const oldHash = oldContent ? simpleHash(oldContent) : undefined;
			const event: ProjectStateEvent = {
				type: "file_edited",
				path,
				oldHash,
				newHash,
			};
			this.journal.append(event, "edit_tool", { cwd: this.store.getRootDir() });
			this.projector.applyAll();
		} catch {
			// Best-effort
		}
	}

	/**
	 * Emit a `file_deleted` event.
	 */
	emitFileDeleted(path: string, oldContent?: string): void {
		try {
			const oldHash = oldContent ? simpleHash(oldContent) : undefined;
			const event: ProjectStateEvent = {
				type: "file_deleted",
				path,
				oldHash,
			};
			this.journal.append(event, "write_tool", { cwd: this.store.getRootDir() });
			this.projector.applyAll();
		} catch {
			// Best-effort
		}
	}

	/**
	 * Emit a `file_moved` event.
	 */
	emitFileMoved(from: string, to: string, newContent?: string, oldContent?: string): void {
		try {
			const newHash = newContent ? simpleHash(newContent) : undefined;
			const oldHash = oldContent ? simpleHash(oldContent) : undefined;
			const event: ProjectStateEvent = {
				type: "file_moved",
				from,
				to,
				oldHash,
				newHash,
			};
			this.journal.append(event, "write_tool", { cwd: this.store.getRootDir() });
			this.projector.applyAll();
		} catch {
			// Best-effort
		}
	}

	/**
	 * Emit a command_started event (before bash execution).
	 */
	emitCommandStarted(command: string, classification: CommandClassification): void {
		try {
			const event: ProjectStateEvent = {
				type: "command_started",
				command,
				classification: classification.effect,
			};
			this.journal.append(event, "bash_tool", { cwd: this.store.getRootDir() });
		} catch {
			// Best-effort
		}
	}

	/**
	 * Emit a command_completed event (after bash execution).
	 */
	emitCommandCompleted(command: string, exitCode: number, classification: CommandClassification): void {
		try {
			const event: ProjectStateEvent = {
				type: "command_completed",
				command,
				exitCode,
				classification: classification.effect,
			};
			this.journal.append(event, "bash_tool", { cwd: this.store.getRootDir() });
		} catch {
			// Best-effort
		}
	}

	/**
	 * Emit a state_marked_dirty event.
	 */
	emitStateMarkedDirty(reason: string, scope: string[]): void {
		try {
			const event: ProjectStateEvent = {
				type: "state_marked_dirty",
				reason,
				scope,
			};
			this.journal.append(event, "external", { cwd: this.store.getRootDir() });
			this.projector.applyAll();
		} catch {
			// Best-effort
		}
	}

	/**
	 * Emit a state_marked_unknown event.
	 */
	emitStateMarkedUnknown(reason: string, scope: string[]): void {
		try {
			const event: ProjectStateEvent = {
				type: "state_marked_unknown",
				reason,
				scope,
			};
			this.journal.append(event, "external", { cwd: this.store.getRootDir() });
			this.projector.applyAll();
		} catch {
			// Best-effort
		}
	}

	/**
	 * Apply any pending events now.
	 */
	applyPending(): void {
		try {
			this.projector.applyAll();
		} catch {
			// Best-effort
		}
	}

	/**
	 * Get the journal for direct access.
	 */
	getJournal(): ProjectStateEventJournal {
		return this.journal;
	}

	/**
	 * Get the projector for direct access.
	 */
	getProjector(): ProjectStateProjector {
		return this.projector;
	}
}

function simpleHash(s: string): string {
	let hash = 0;
	for (let i = 0; i < s.length; i++) {
		const char = s.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0; // Convert to 32bit integer
	}
	return Math.abs(hash).toString(16);
}
