/**
 * Stale Area Detector — V5.05
 *
 * Identifies plan areas that have not been modified recently (stale).
 *
 * A plan area is considered stale when its associated plan file has not
 * been modified within the configured staleness threshold. Stale areas
 * may indicate stalled execution, unresolved dependencies, or plans that
 * are no longer relevant.
 *
 * The detector is purely read-only: it reads plan files from disk and
 * checks file modification timestamps. It never mutates repo state or
 * plan metadata.
 *
 * @packageDocumentation
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { EvidenceRef } from "../evidence/types.js";
import type { ScannerOptions, StalePlanArea } from "./types.js";
import { DEFAULT_SCANNER_OPTIONS } from "./types.js";

// =========================================================================
// Plan File Record
// =========================================================================

/** Metadata about a plan file found on disk. */
interface PlanFileRecord {
	/** Full path to the plan file. */
	fullPath: string;
	/** Relative path from project root. */
	relativePath: string;
	/** ISO 8601 timestamp of last modification. */
	lastModified: string;
	/** File size in bytes. */
	sizeBytes: number;
	/** Plan title extracted from file content (if parsable). */
	planName?: string;
	/** Plan status extracted from file content (if parsable). */
	status: string;
}

// =========================================================================
// Stale Area Detector
// =========================================================================

/**
 * Detects stale plan areas by scanning plan directories for files
 * that have not been modified recently.
 *
 * Scans these locations for plan files:
 * - `.pi/plans/` — Main plan storage directory
 * - `.pi/plan-factory/` — Plan factory output directory
 * - Files matching patterns like `PLANS.md`, `*.plan.md`, `plan-*.json`
 *
 * Plans are considered stale when their modification time exceeds the
 * configured staleness threshold (default: 14 days).
 */
export class StaleAreaDetector {
	private readonly projectRoot: string;
	private readonly piDir: string;
	private readonly options: Required<Omit<ScannerOptions, "projectRoot" | "piDir">>;

	/** Plan file extensions to look for. */
	private static readonly PLAN_EXTENSIONS = [".md", ".json", ".yaml", ".yml"];

	/** Plan file name patterns to recognize. */
	private static readonly PLAN_PATTERNS = [/PLANS?\.md$/i, /\.plan\.md$/i, /plan-[\w-]+\.json$/i, /[\w-]+-plan\.md$/i];

	constructor(options: ScannerOptions) {
		this.projectRoot = options.projectRoot;
		this.piDir = options.piDir ?? DEFAULT_SCANNER_OPTIONS.piDir!;
		this.options = {
			gitPath: options.gitPath ?? DEFAULT_SCANNER_OPTIONS.gitPath!,
			hotspotMinChanges: options.hotspotMinChanges ?? DEFAULT_SCANNER_OPTIONS.hotspotMinChanges!,
			hotspotCommitWindow: options.hotspotCommitWindow ?? DEFAULT_SCANNER_OPTIONS.hotspotCommitWindow!,
			riskThreshold: options.riskThreshold ?? DEFAULT_SCANNER_OPTIONS.riskThreshold!,
			largeDiffThreshold: options.largeDiffThreshold ?? DEFAULT_SCANNER_OPTIONS.largeDiffThreshold!,
			staleThresholdDays: options.staleThresholdDays ?? DEFAULT_SCANNER_OPTIONS.staleThresholdDays!,
			correlationMinFailures: options.correlationMinFailures ?? DEFAULT_SCANNER_OPTIONS.correlationMinFailures!,
			maxResults: options.maxResults ?? DEFAULT_SCANNER_OPTIONS.maxResults!,
		};
	}

	// =======================================================================
	// Public API
	// =======================================================================

	/**
	 * Scan for stale plan areas.
	 *
	 * @returns Array of stale plan areas sorted by staleness (most stale first)
	 */
	async scan(): Promise<StalePlanArea[]> {
		try {
			const planFiles = this.discoverPlanFiles();
			if (planFiles.length === 0) return [];

			const now = Date.now();
			const _staleThresholdMs = this.options.staleThresholdDays * 24 * 60 * 60 * 1000;

			const evidence: EvidenceRef = {
				type: "git_file",
				id: "stale-plan-area-scan",
				label: "Stale plan area scan",
				description: `Scanned ${planFiles.length} plan file(s) for staleness (threshold: ${this.options.staleThresholdDays} days)`,
				timestamp: new Date().toISOString(),
				confidence: 0.9,
			};

			const staleAreas: StalePlanArea[] = [];

			for (const record of planFiles) {
				const modTime = new Date(record.lastModified).getTime();
				const ageMs = now - modTime;
				const daysSinceModification = Math.floor(ageMs / (24 * 60 * 60 * 1000));

				if (daysSinceModification < this.options.staleThresholdDays) continue;

				const isVeryStale = daysSinceModification >= this.options.staleThresholdDays * 3;

				staleAreas.push({
					path: record.relativePath,
					lastModified: record.lastModified,
					daysSinceModification,
					status: record.status,
					planName: record.planName,
					severity: isVeryStale ? "warning" : "info",
					evidence: [evidence],
					summary: `Stale plan area: "${record.planName || record.relativePath}" — untouched for ${daysSinceModification} day(s) (status: ${record.status})`,
					metadata: {
						fileSize: record.sizeBytes,
						fullPath: record.fullPath,
					},
				});
			}

			// Sort by staleness descending
			staleAreas.sort((a, b) => b.daysSinceModification - a.daysSinceModification);

			return staleAreas.slice(0, this.options.maxResults);
		} catch {
			return [];
		}
	}

	// =======================================================================
	// Plan File Discovery
	// =======================================================================

	/**
	 * Discover plan files across standard plan directory locations.
	 */
	private discoverPlanFiles(): PlanFileRecord[] {
		const records: PlanFileRecord[] = [];

		// Scan known plan directories
		const planDirs = [
			join(this.projectRoot, this.piDir, "plans"),
			join(this.projectRoot, this.piDir, "plan-factory"),
		];

		for (const dir of planDirs) {
			if (!existsSync(dir)) continue;
			const files = this.scanDirectory(dir);
			records.push(...files);
		}

		// Also scan root for plan files
		const rootPlanFiles = this.scanRootForPlanFiles();
		records.push(...rootPlanFiles);

		return records;
	}

	/**
	 * Recursively scan a directory for plan files.
	 */
	private scanDirectory(dirPath: string, relativePrefix: string = ""): PlanFileRecord[] {
		const records: PlanFileRecord[] = [];

		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = join(dirPath, entry.name);
				const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

				if (entry.isDirectory()) {
					// Recurse into subdirectories (max 2 levels)
					if (relativePrefix.split("/").length < 3) {
						const subRecords = this.scanDirectory(fullPath, relativePath);
						records.push(...subRecords);
					}
				} else if (entry.isFile() && this.isPlanFile(entry.name)) {
					const planFile = this.readPlanFile(fullPath, relativePath);
					if (planFile) {
						records.push(planFile);
					}
				}
			}
		} catch {
			// Permission errors or non-existent directories are non-fatal
		}

		return records;
	}

	/**
	 * Scan the project root for plan files.
	 */
	private scanRootForPlanFiles(): PlanFileRecord[] {
		const records: PlanFileRecord[] = [];

		try {
			const entries = readdirSync(this.projectRoot, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isFile()) continue;

				// Look for root-level plan files
				if (
					entry.name === "PLANS.md" ||
					entry.name === "PLAN.md" ||
					entry.name.endsWith(".plan.md") ||
					(entry.name.includes("plan") && StaleAreaDetector.PLAN_EXTENSIONS.includes(extname(entry.name)))
				) {
					const fullPath = join(this.projectRoot, entry.name);
					const planFile = this.readPlanFile(fullPath, entry.name);
					if (planFile) {
						records.push(planFile);
					}
				}
			}
		} catch {
			// Non-fatal
		}

		return records;
	}

	/**
	 * Check if a filename matches recognized plan file patterns.
	 */
	private isPlanFile(filename: string): boolean {
		const ext = extname(filename);
		if (!StaleAreaDetector.PLAN_EXTENSIONS.includes(ext)) return false;

		for (const pattern of StaleAreaDetector.PLAN_PATTERNS) {
			if (pattern.test(filename)) return true;
		}

		// Fallback: any file in plans/ directory with a recognized extension
		return true;
	}

	/**
	 * Read a plan file and extract its metadata.
	 */
	private readPlanFile(fullPath: string, relativePath: string): PlanFileRecord | null {
		try {
			if (!existsSync(fullPath)) return null;

			const stats = statSync(fullPath);
			const lastModified = stats.mtime.toISOString();

			// Read the first few lines to extract plan name/status
			let planName: string | undefined;
			let status = "unknown";

			try {
				const content = readFileSync(fullPath, "utf-8").slice(0, 2000);
				const lines = content.split("\n").slice(0, 20);

				// Try to extract title from markdown heading
				for (const line of lines) {
					const titleMatch = line.match(/^#\s+(.+)/);
					if (titleMatch && !planName) {
						planName = titleMatch[1].trim();
					}

					// Try to extract status from JSON or frontmatter
					const statusMatch = line.match(/["']?status["']?\s*[:=]\s*["']([^"']+)["']/);
					if (statusMatch) {
						status = statusMatch[1];
					}

					// Also try markdown bold status patterns
					const mdStatusMatch = line.match(/\*\*Status\*\*:\s*(.+)/i);
					if (mdStatusMatch) {
						status = mdStatusMatch[1].trim();
					}
				}
			} catch {
				// Non-fatal; use defaults
			}

			// Derive plan name from filename if not found in content
			if (!planName) {
				planName = basename(relativePath, extname(relativePath))
					.replace(/[-_]/g, " ")
					.replace(/\b\w/g, (c) => c.toUpperCase());
			}

			return {
				fullPath,
				relativePath,
				lastModified,
				sizeBytes: stats.size,
				planName,
				status,
			};
		} catch {
			return null;
		}
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a StaleAreaDetector instance.
 *
 * @param options - Scanner options including project root
 * @returns A new StaleAreaDetector
 */
export function createStaleAreaDetector(options: ScannerOptions): StaleAreaDetector {
	return new StaleAreaDetector(options);
}
