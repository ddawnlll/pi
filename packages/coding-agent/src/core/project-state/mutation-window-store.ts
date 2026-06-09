/**
 * MutationWindowStore — PSS-MEGA-02
 *
 * Manages mutation windows for unknown/ambiguous state changes.
 * Persists to .pi/project-state/mutation-windows.json.
 */

import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { atomicWriteJson, readJsonFile } from "./atomic-write.js";
import type { MutationWindow } from "./event-types.js";
import { getStateDir } from "./paths.js";

/** Mutation windows file */
const MUTATION_WINDOWS_FILE = "mutation-windows.json";

/**
 * MutationWindowStore
 *
 * Tracks open mutation windows. Mutations are used to group
 * uncertain changes (unknown commands, git ops, package ops).
 */
export class MutationWindowStore {
	private rootDir: string;
	private windowsPath: string;
	private windows: Map<string, MutationWindow>;

	constructor(rootDir: string) {
		this.rootDir = resolve(rootDir);
		this.windowsPath = join(getStateDir(this.rootDir), MUTATION_WINDOWS_FILE);
		this.windows = new Map();
		this.load();
	}

	/**
	 * Open a new mutation window.
	 */
	open(source: MutationWindow["source"], _reason: string, command?: string): MutationWindow {
		const window: MutationWindow = {
			id: randomUUID().slice(0, 12),
			source,
			startedAt: new Date().toISOString(),
			cwd: this.rootDir,
			command,
			collectedWatcherEvents: 0,
			status: "open",
		};

		this.windows.set(window.id, window);
		this.save();
		return window;
	}

	/**
	 * Close a mutation window.
	 */
	close(id: string): boolean {
		const window = this.windows.get(id);
		if (!window) return false;

		window.status = "closed";
		window.completedAt = new Date().toISOString();
		this.save();
		return true;
	}

	/**
	 * Mark a mutation window as failed.
	 */
	fail(id: string): boolean {
		const window = this.windows.get(id);
		if (!window) return false;

		window.status = "failed";
		window.completedAt = new Date().toISOString();
		this.save();
		return true;
	}

	/**
	 * Mark a mutation window as reconciling.
	 */
	setReconciling(id: string): boolean {
		const window = this.windows.get(id);
		if (!window) return false;

		window.status = "reconciling";
		this.save();
		return true;
	}

	/**
	 * Increment collected watcher events count.
	 */
	incrementCollected(id: string): void {
		const window = this.windows.get(id);
		if (window) {
			window.collectedWatcherEvents++;
			this.save();
		}
	}

	/**
	 * Get a window by ID.
	 */
	get(id: string): MutationWindow | undefined {
		return this.windows.get(id);
	}

	/**
	 * Get all open windows.
	 */
	getOpenWindows(): MutationWindow[] {
		return [...this.windows.values()].filter((w) => w.status === "open" || w.status === "reconciling");
	}

	/**
	 * Get all windows.
	 */
	getAll(): MutationWindow[] {
		return [...this.windows.values()].sort(
			(a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
		);
	}

	/**
	 * Get number of open windows.
	 */
	openCount(): number {
		return this.getOpenWindows().length;
	}

	/**
	 * Remove all completed/failed windows older than the given age in ms.
	 */
	prune(maxAgeMs: number): void {
		const now = Date.now();
		for (const [id, w] of this.windows) {
			if (w.status === "closed" || w.status === "failed") {
				const completedAt = w.completedAt ? new Date(w.completedAt).getTime() : now;
				if (now - completedAt > maxAgeMs) {
					this.windows.delete(id);
				}
			}
		}
		this.save();
	}

	/**
	 * Persist to disk.
	 */
	private save(): void {
		const data: Record<string, MutationWindow> = {};
		for (const [id, w] of this.windows) {
			data[id] = w;
		}
		atomicWriteJson(data, this.windowsPath);
	}

	/**
	 * Load from disk.
	 */
	private load(): void {
		try {
			const data = readJsonFile<Record<string, MutationWindow>>(this.windowsPath);
			if (data) {
				for (const [id, w] of Object.entries(data)) {
					this.windows.set(id, w);
				}
			}
		} catch {
			// No saved state
		}
	}
}
