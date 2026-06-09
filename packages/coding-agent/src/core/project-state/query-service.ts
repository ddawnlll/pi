/**
 * ProjectStateQueryService — PSS-MEGA-02
 *
 * Cached ls / rg-files / packages / git queries over project state.
 * Respects rendering budgets: compact output by default.
 * Refuses stale/unknown cache hits.
 */

import type { ProjectStateQueryResult, QueryRenderOptions } from "./event-types.js";
import { ReconcileScanner } from "./reconcile-scanner.js";
import type { ProjectStateStore } from "./store.js";

/** Default ls max items */
const DEFAULT_LS_MAX_ITEMS = 100;

/** Default rg-files max paths */
const DEFAULT_RGFILES_MAX_PATHS = 120;

/** Default max tokens in query output */
const _DEFAULT_MAX_TOKENS = 2000;

/**
 * QueryService for compact cached queries.
 */
export class QueryService {
	private store: ProjectStateStore;
	private scanner: ReconcileScanner;

	constructor(store: ProjectStateStore) {
		this.store = store;
		this.scanner = new ReconcileScanner(store);
	}

	/**
	 * Set a different store (for different root dirs).
	 */
	setStore(store: ProjectStateStore): void {
		this.store = store;
		this.scanner = new ReconcileScanner(store);
	}

	/**
	 * Cached ls query.
	 */
	ls(path: string, options?: QueryRenderOptions): ProjectStateQueryResult {
		const mode: NonNullable<QueryRenderOptions["mode"]> = options?.mode ?? "compact";
		const maxItems = options?.maxItems ?? DEFAULT_LS_MAX_ITEMS;

		const filesState = this.store.loadFilesState();
		const manifest = this.store.loadManifest();

		if (!manifest) {
			return this.fallback("Cache not available");
		}

		// Check validity — allow empty/valid states through
		if (manifest.validity.tree === "unknown") {
			// Check if we have files state — if we do, tree is implicitly known
			if (!filesState || Object.keys(filesState.files).length === 0) {
				return {
					source: "project_state_cache",
					validity: "unknown",
					summary: "No files indexed yet. Run /snapshot.",
					items: [],
					totalItems: 0,
					truncated: false,
					warnings: ["Tree state unknown"],
				};
			}
		}

		if (manifest.validity.tree === "dirty" || manifest.validity.files === "dirty") {
			const check = this.scanner.quickCheck(path);
			if (check === "missing") {
				return {
					source: "unavailable",
					validity: "dirty",
					summary: `Path not found in index or on disk`,
					truncated: false,
					warnings: ["Path not found"],
				};
			}
		}

		// Normalize path
		const normalizedPath = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
		const dir = normalizedPath || ".";

		// Get files for this directory from files state
		const items: string[] = [];
		if (filesState) {
			const prefix = dir === "." ? "" : `${dir}/`;
			for (const relPath of Object.keys(filesState.files).sort()) {
				if (dir === ".") {
					if (!relPath.includes("/")) {
						items.push(relPath);
					}
				} else if (relPath.startsWith(prefix)) {
					const suffix = relPath.slice(prefix.length);
					if (!suffix.includes("/") || mode === "full") {
						items.push(suffix);
					}
				}
			}
		}

		const totalItems = items.length;
		const truncated = items.length > maxItems && mode !== "full";
		const displayItems = truncated ? items.slice(0, maxItems) : items;
		const warnings: string[] = [];

		if (truncated) {
			warnings.push(`Showing ${maxItems} of ${totalItems} entries. Use mode=full for all.`);
		}

		const summary = `${displayItems.length} entries in ${normalizedPath || "."}`;

		return {
			source: "project_state_cache",
			validity: manifest.validity.tree,
			summary,
			items: displayItems,
			totalItems,
			truncated,
			warnings,
		};
	}

	/**
	 * Cached rg-files (file listing) query.
	 */
	rgFiles(searchPath?: string, options?: QueryRenderOptions): ProjectStateQueryResult {
		const mode: NonNullable<QueryRenderOptions["mode"]> = options?.mode ?? "summary";
		const maxPaths = options?.maxItems ?? DEFAULT_RGFILES_MAX_PATHS;

		const manifest = this.store.loadManifest();

		if (!manifest) {
			return this.fallback("File cache not available");
		}

		// Load files state — no files state means no files indexed yet
		const filesState = this.store.loadFilesState();
		if (!filesState) {
			return {
				source: "project_state_cache",
				validity: "unknown",
				summary: "No files indexed. Run /snapshot.",
				truncated: false,
				warnings: [],
			};
		}

		// Check if validity makes this unsafe
		if (manifest.validity.files === "unknown" && Object.keys(filesState.files).length > 0) {
			return {
				source: "unavailable",
				validity: "unknown",
				summary: "File state is unknown. Run /snapshot refresh.",
				truncated: false,
				warnings: ["File state unknown"],
			};
		}

		// Also check dirty
		if (manifest.validity.files === "dirty") {
			return {
				source: "unavailable",
				validity: "dirty",
				summary: "File state is dirty. Run /snapshot to refresh.",
				truncated: false,
				warnings: ["File state dirty"],
			};
		}

		// Filter files
		const prefix = searchPath ? `${searchPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")}/` : "";
		let allFiles = Object.keys(filesState.files).sort();
		if (prefix) {
			allFiles = allFiles.filter((f) => f.startsWith(prefix) || f === searchPath);
		}

		const totalItems = allFiles.length;

		// Build summary with top directory counts
		const dirCounts = new Map<string, number>();
		for (const f of allFiles) {
			const dir = f.includes("/") ? f.split("/")[0] : ".";
			dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
		}
		const dirSummary = [...dirCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([dir, count]) => `${dir}: ${count}`)
			.join(", ");

		const truncated = allFiles.length > maxPaths && mode !== "full";
		const displayItems = truncated ? allFiles.slice(0, maxPaths) : allFiles;

		const warnings: string[] = [];
		if (truncated) {
			warnings.push(`Showing ${maxPaths} of ${totalItems} paths. Use mode=full for all.`);
		}

		const summary = `${totalItems} files total. ${dirSummary}`;

		return {
			source: "project_state_cache",
			validity: manifest.validity.files,
			summary,
			items: displayItems,
			totalItems,
			truncated,
			warnings,
		};
	}

	/**
	 * Package query.
	 */
	packages(options?: QueryRenderOptions): ProjectStateQueryResult {
		const packageState = this.store.loadPackageState();
		const manifest = this.store.loadManifest();

		if (!packageState || !manifest) {
			return this.fallback("Package state not available");
		}

		// Packages query — treat saved state as available even if manifest says unknown
		// The manifest validity only tracks post-snapshot changes, not baseline state

		const lines: string[] = [];
		lines.push(`Package manager: ${packageState.packageManager}`);

		if (Object.keys(packageState.packageFiles).length > 0) {
			lines.push("Package files:");
			for (const [relPath, entry] of Object.entries(packageState.packageFiles)) {
				const scriptCount = Object.keys(entry.scripts).length;
				const name = entry.name ?? "(unnamed)";
				lines.push(`  ${relPath}: ${name} (${scriptCount} scripts)`);
				if (options?.mode === "full") {
					for (const [name, script] of Object.entries(entry.scripts)) {
						lines.push(`    ${name}: ${script}`);
					}
				}
			}
		}

		lines.push(`Lockfiles: ${packageState.lockfiles.length > 0 ? packageState.lockfiles.join(", ") : "none"}`);
		lines.push(
			`Test frameworks: ${packageState.testFrameworkHints.length > 0 ? packageState.testFrameworkHints.join(", ") : "none"}`,
		);
		lines.push(`Config files: ${packageState.configFiles.length}`);

		return {
			source: "project_state_cache",
			validity: manifest.validity.packages ?? "unknown",
			summary: lines.join("\n"),
			truncated: false,
			warnings: [],
		};
	}

	/**
	 * Git state query.
	 */
	git(options?: QueryRenderOptions): ProjectStateQueryResult {
		const gitState = this.store.loadGitState();
		const manifest = this.store.loadManifest();

		if (!gitState || !manifest) {
			return this.fallback("Git state not available");
		}

		if (manifest.validity.git === "unknown") {
			// Git state available even if manifest says unknown
			// Manifest validity tracks post-snapshot changes
		}

		const maxItems = options?.maxItems ?? 10;
		const lines: string[] = [];

		if (gitState.isGitRepo) {
			lines.push(`Branch: ${gitState.branch ?? "(unknown)"}`);
			lines.push(`HEAD: ${gitState.headSha?.slice(0, 12) ?? "(unknown)"}`);
			lines.push(`Dirty files: ${gitState.dirtyFiles.length}`);
			lines.push(`Untracked files: ${gitState.untrackedFiles.length}`);
			lines.push(`Staged files: ${gitState.stagedFiles.length}`);

			if (gitState.dirtyFiles.length > 0) {
				const showFiles = gitState.dirtyFiles.slice(0, maxItems);
				lines.push(`Modified (${showFiles.length} shown):`);
				for (const f of showFiles) {
					lines.push(`  ${f}`);
				}
				if (gitState.dirtyFiles.length > maxItems) {
					lines.push(`  ... and ${gitState.dirtyFiles.length - maxItems} more`);
				}
			}

			if (gitState.untrackedFiles.length > 0) {
				const showFiles = gitState.untrackedFiles.slice(0, maxItems);
				lines.push(`Untracked (${showFiles.length} shown):`);
				for (const f of showFiles) {
					lines.push(`  ${f}`);
				}
				if (gitState.untrackedFiles.length > maxItems) {
					lines.push(`  ... and ${gitState.untrackedFiles.length - maxItems} more`);
				}
			}
		} else {
			lines.push("Not a git repository");
		}

		return {
			source: "project_state_cache",
			validity: manifest.validity.git ?? "unknown",
			summary: lines.join("\n"),
			truncated: false,
			warnings: [],
		};
	}

	// ============================================================================
	// Fallback
	// ============================================================================

	private fallback(message: string): ProjectStateQueryResult {
		return {
			source: "unavailable",
			validity: "unknown",
			summary: message,
			truncated: false,
			warnings: [message],
		};
	}
}
