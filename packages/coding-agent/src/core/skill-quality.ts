/**
 * Skill Quality Metadata - P11.E
 *
 * Tracks quality metrics for installed skill packages: reliability scores,
 * test results, usage statistics, and compatibility information.
 *
 * Quality metadata is persisted as JSON and is consumable by downstream
 * API/UI workspaces for displaying skill health and reliability.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Quality Score Ranges
// ---------------------------------------------------------------------------

/**
 * Normalized reliability score from 0.0 to 1.0.
 */
export type ReliabilityScore = number;

/**
 * Human-readable reliability rating derived from score.
 */
export type ReliabilityRating = "unknown" | "low" | "medium" | "high" | "excellent";

/**
 * Map a numeric reliability score to a human-readable rating.
 */
export function scoreToRating(score: ReliabilityScore | undefined): ReliabilityRating {
	if (score === undefined || score === null) return "unknown";
	if (score >= 0.9) return "excellent";
	if (score >= 0.7) return "high";
	if (score >= 0.4) return "medium";
	return "low";
}

// ---------------------------------------------------------------------------
// Test Result
// ---------------------------------------------------------------------------

/**
 * Result of a single skill test run.
 */
export interface SkillTestResult {
	/** Test name or identifier */
	name: string;
	/** Whether the test passed */
	passed: boolean;
	/** Optional error message on failure */
	error?: string;
	/** Duration in milliseconds */
	durationMs?: number;
	/** ISO-8601 timestamp of test execution */
	timestamp: string;
}

/**
 * Aggregate test run result for a skill.
 */
export interface SkillTestRun {
	/** Skill name */
	skillName: string;
	/** Number of tests that passed */
	passed: number;
	/** Number of tests that failed */
	failed: number;
	/** Total number of tests */
	total: number;
	/** Individual test results */
	tests: SkillTestResult[];
	/** ISO-8601 timestamp */
	timestamp: string;
	/** Duration in milliseconds */
	durationMs?: number;
}

// ---------------------------------------------------------------------------
// Usage Statistics
// ---------------------------------------------------------------------------

/**
 * Usage statistics for a skill.
 */
export interface SkillUsageStats {
	/** Number of times invoked */
	invocationCount: number;
	/** Number of successful invocations */
	successCount: number;
	/** Number of failed invocations */
	failureCount: number;
	/** ISO-8601 timestamp of first use */
	firstUsed?: string;
	/** ISO-8601 timestamp of most recent use */
	lastUsed?: string;
	/** Average duration in milliseconds (if tracked) */
	avgDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Quality Record
// ---------------------------------------------------------------------------

/**
 * Complete quality metadata record for a skill.
 */
export interface SkillQualityRecord {
	/** Skill name */
	skillName: string;
	/** Skill version */
	version: string;
	/** Reliability score (0.0 - 1.0), derived from test results and usage */
	reliabilityScore: ReliabilityScore;
	/** Human-readable rating */
	reliabilityRating: ReliabilityRating;
	/** Last test run results */
	lastTestRun?: SkillTestRun;
	/** Usage statistics */
	usageStats: SkillUsageStats;
	/** ISO-8601 timestamp when quality data was last updated */
	lastUpdated: string;
	/** Whether this skill has been verified as working */
	verified: boolean;
	/** Known issues or notes */
	notes?: string[];
}

// ---------------------------------------------------------------------------
// Quality Store
// ---------------------------------------------------------------------------

/**
 * Stores and retrieves quality metadata for skills.
 *
 * Data is persisted to a JSON file in the agent config directory.
 * This enables downstream API/UI workspaces to read quality data
 * without needing to recompute it.
 */
export class SkillQualityStore {
	private readonly agentDir: string;
	private records: Map<string, SkillQualityRecord>;
	private dirty: boolean;

	/** File where quality data is persisted. */
	private static readonly QUALITY_FILE = ".pi-cache/skill-quality.json";

	constructor(agentDir: string) {
		this.agentDir = agentDir;
		this.records = new Map();
		this.dirty = false;
		this.load();
	}

	/**
	 * Get the quality record for a skill.
	 *
	 * @param skillName - Name of the skill
	 * @returns Quality record, or undefined if not found
	 */
	get(skillName: string): SkillQualityRecord | undefined {
		return this.records.get(skillName);
	}

	/**
	 * Get all quality records.
	 *
	 * @returns Array of all quality records
	 */
	getAll(): SkillQualityRecord[] {
		return Array.from(this.records.values());
	}

	/**
	 * Update the quality record for a skill.
	 *
	 * @param record - Quality record to store
	 */
	set(record: SkillQualityRecord): void {
		this.records.set(record.skillName, record);
		this.dirty = true;
	}

	/**
	 * Remove the quality record for a skill.
	 *
	 * @param skillName - Name of the skill
	 */
	delete(skillName: string): void {
		this.records.delete(skillName);
		this.dirty = true;
	}

	/**
	 * Record a test run result and update quality metrics.
	 *
	 * @param testRun - Test run result
	 * @param version - Skill version
	 */
	recordTestRun(testRun: SkillTestRun, version: string): void {
		const existing = this.records.get(testRun.skillName);
		const passed = testRun.passed;
		const total = testRun.total;
		const passRate = total > 0 ? passed / total : 0;

		// Reliability is a weighted combination of test pass rate and usage success rate
		const usageStats = existing?.usageStats ?? {
			invocationCount: 0,
			successCount: 0,
			failureCount: 0,
		};
		const usageSuccessRate =
			usageStats.invocationCount > 0 ? usageStats.successCount / usageStats.invocationCount : 0;

		// Weight: 60% tests, 40% usage
		const reliabilityScore = Math.min(1.0, Math.max(0.0, passRate * 0.6 + usageSuccessRate * 0.4));

		const record: SkillQualityRecord = {
			skillName: testRun.skillName,
			version,
			reliabilityScore,
			reliabilityRating: scoreToRating(reliabilityScore),
			lastTestRun: testRun,
			usageStats,
			lastUpdated: new Date().toISOString(),
			verified: passRate >= 0.8 && usageSuccessRate >= 0.8,
			notes: existing?.notes,
		};

		this.records.set(testRun.skillName, record);
		this.dirty = true;
	}

	/**
	 * Record a skill invocation result for usage tracking.
	 *
	 * @param skillName - Name of the skill
	 * @param version - Skill version
	 * @param success - Whether the invocation succeeded
	 * @param durationMs - Duration in milliseconds
	 */
	recordInvocation(skillName: string, version: string, success: boolean, durationMs?: number): void {
		const existing = this.records.get(skillName);
		const usageStats: SkillUsageStats = existing?.usageStats ?? {
			invocationCount: 0,
			successCount: 0,
			failureCount: 0,
		};

		usageStats.invocationCount++;
		if (success) {
			usageStats.successCount++;
		} else {
			usageStats.failureCount++;
		}
		if (durationMs !== undefined) {
			const prevAvg = usageStats.avgDurationMs ?? 0;
			usageStats.avgDurationMs =
				usageStats.invocationCount > 1
					? (prevAvg * (usageStats.invocationCount - 1) + durationMs) / usageStats.invocationCount
					: durationMs;
		}
		if (!usageStats.firstUsed) {
			usageStats.firstUsed = new Date().toISOString();
		}
		usageStats.lastUsed = new Date().toISOString();

		// Recompute reliability score
		const testRun = existing?.lastTestRun;
		const passRate = testRun && testRun.total > 0 ? testRun.passed / testRun.total : 0;
		const usageSuccessRate =
			usageStats.invocationCount > 0 ? usageStats.successCount / usageStats.invocationCount : 0;
		const reliabilityScore = Math.min(1.0, Math.max(0.0, passRate * 0.6 + usageSuccessRate * 0.4));

		const record: SkillQualityRecord = {
			skillName,
			version,
			reliabilityScore,
			reliabilityRating: scoreToRating(reliabilityScore),
			lastTestRun: testRun,
			usageStats,
			lastUpdated: new Date().toISOString(),
			verified: passRate >= 0.8 && usageSuccessRate >= 0.8,
			notes: existing?.notes,
		};

		this.records.set(skillName, record);
		this.dirty = true;
	}

	/**
	 * Persist quality data to disk.
	 */
	save(): void {
		if (!this.dirty) return;
		const qualityDir = join(this.agentDir, ".pi-cache");
		if (!existsSync(qualityDir)) {
			mkdirSync(qualityDir, { recursive: true });
		}
		try {
			const data = JSON.stringify(this.getAll(), null, 2);
			writeFileSync(join(this.agentDir, SkillQualityStore.QUALITY_FILE), data, "utf-8");
			this.dirty = false;
		} catch {
			// Persist silently; data will be retried on next save
		}
	}

	/**
	 * Load quality data from disk.
	 */
	private load(): void {
		try {
			const qualityFile = join(this.agentDir, SkillQualityStore.QUALITY_FILE);
			if (existsSync(qualityFile)) {
				const raw = readFileSync(qualityFile, "utf-8");
				const records: SkillQualityRecord[] = JSON.parse(raw);
				for (const record of records) {
					this.records.set(record.skillName, record);
				}
			}
		} catch {
			// Start with empty records
		}
		this.dirty = false;
	}

	/**
	 * Export quality data in a format suitable for API/UI consumption.
	 *
	 * @returns Serializable quality data object
	 */
	exportForApi(): SkillQualityApiResponse {
		return {
			timestamp: new Date().toISOString(),
			skills: this.getAll().map((record) => ({
				skillName: record.skillName,
				version: record.version,
				reliabilityScore: record.reliabilityScore,
				reliabilityRating: record.reliabilityRating,
				verified: record.verified,
				lastUpdated: record.lastUpdated,
				totalInvocations: record.usageStats.invocationCount,
				successRate:
					record.usageStats.invocationCount > 0
						? Math.round((record.usageStats.successCount / record.usageStats.invocationCount) * 100)
						: 0,
				avgDurationMs: record.usageStats.avgDurationMs,
				lastTestPassRate:
					record.lastTestRun && record.lastTestRun.total > 0
						? Math.round((record.lastTestRun.passed / record.lastTestRun.total) * 100)
						: undefined,
				notes: record.notes?.length ? record.notes : undefined,
			})),
			summary: this.computeSummary(),
		};
	}

	/**
	 * Compute summary statistics across all skills.
	 */
	private computeSummary(): SkillQualitySummary {
		const all = this.getAll();
		const verified = all.filter((r) => r.verified).length;
		const avgReliability = all.length > 0 ? all.reduce((sum, r) => sum + r.reliabilityScore, 0) / all.length : 0;
		const totalInvocations = all.reduce((sum, r) => sum + r.usageStats.invocationCount, 0);

		return {
			totalSkills: all.length,
			verifiedSkills: verified,
			averageReliabilityScore: Math.round(avgReliability * 100) / 100,
			totalInvocations,
		};
	}
}

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

/**
 * Skill quality data formatted for API/UI consumption.
 */
export interface SkillQualityApiEntry {
	skillName: string;
	version: string;
	reliabilityScore: number;
	reliabilityRating: ReliabilityRating;
	verified: boolean;
	lastUpdated: string;
	totalInvocations: number;
	successRate: number;
	avgDurationMs?: number;
	lastTestPassRate?: number;
	notes?: string[];
}

/**
 * Summary statistics for API/UI.
 */
export interface SkillQualitySummary {
	totalSkills: number;
	verifiedSkills: number;
	averageReliabilityScore: number;
	totalInvocations: number;
}

/**
 * Full API response for skill quality data.
 */
export interface SkillQualityApiResponse {
	timestamp: string;
	skills: SkillQualityApiEntry[];
	summary: SkillQualitySummary;
}

/**
 * Format quality data as a human-readable table (for CLI).
 *
 * @param records - Quality records to format
 * @returns Formatted table string
 */
export function formatSkillQualityTable(records: SkillQualityRecord[]): string {
	if (records.length === 0) {
		return "No skill quality data available.";
	}

	const lines: string[] = [];
	lines.push("Skill Quality Report");
	lines.push("=".repeat(72));
	lines.push("");
	lines.push(
		`${"Skill".padEnd(24)} ${"Version".padEnd(12)} ${"Reliability".padEnd(14)} ${"Tests".padEnd(10)} ${"Invocations"}`,
	);
	lines.push("-".repeat(72));

	for (const record of records) {
		const name = record.skillName.padEnd(24).slice(0, 24);
		const ver = record.version.padEnd(12).slice(0, 12);
		const reliability = `${record.reliabilityRating} (${Math.round(record.reliabilityScore * 100)}%)`.padEnd(14);
		const tests = record.lastTestRun
			? `${record.lastTestRun.passed}/${record.lastTestRun.total}`.padEnd(10)
			: "-".padEnd(10);
		const invocations = `${record.usageStats.invocationCount}`;
		lines.push(`${name} ${ver} ${reliability} ${tests} ${invocations}`);
	}

	lines.push("-".repeat(72));
	const summary = records.reduce(
		(acc, r) => ({
			verified: acc.verified + (r.verified ? 1 : 0),
			avgScore: acc.avgScore + r.reliabilityScore,
		}),
		{ verified: 0, avgScore: 0 },
	);
	const avgScore = records.length > 0 ? Math.round((summary.avgScore / records.length) * 100) : 0;
	lines.push(`Total: ${records.length} skills, ${summary.verified} verified, avg reliability: ${avgScore}%`);

	return lines.join("\n");
}
