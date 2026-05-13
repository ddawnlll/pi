/**
 * Skill Registry & Skill Resolver - P2 Workstream 5.D
 *
 * The SkillRegistry lists and validates local skills against a manifest.
 * The SkillResolver recommends skills for workspaces based on requirements.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResourceDiagnostic } from "./diagnostics.js";
import {
	EMPTY_MANIFEST,
	type ManifestValidationResult,
	parseSkillManifest,
	type SkillManifest,
	type SkillManifestEntry,
} from "./skill-manifest.js";
import type { Skill } from "./skills.js";
import { type LoadSkillsResult, loadSkills } from "./skills.js";

const MANIFEST_FILENAME = "skill-manifest.json";

/**
 * Registry entry combining a loaded skill with its manifest metadata.
 */
export interface RegistrySkillEntry {
	/** The loaded skill */
	skill: Skill;
	/** Manifest entry (if skill was declared in manifest) */
	manifestEntry?: SkillManifestEntry;
	/** Whether this skill passes validation */
	valid: boolean;
	/** Validation messages */
	validationMessages: string[];
}

/**
 * Registry result from listing skills.
 */
export interface SkillRegistryResult {
	/** All registered skill entries */
	entries: RegistrySkillEntry[];
	/** Skills that are missing (required by manifest but not found locally) */
	missingSkills: Array<{ entry: SkillManifestEntry; reason: string }>;
	/** Diagnostics from skill loading and validation */
	diagnostics: ResourceDiagnostic[];
	/** The parsed manifest (if found) */
	manifest: SkillManifest;
	/** Manifest validation result */
	manifestValidation: ManifestValidationResult;
}

/**
 * Skill Registry
 *
 * Lists and validates local skills against a skill manifest.
 * Reads the manifest from the project config directory, loads skills
 * from local directories, and reports missing required skills.
 */
export class SkillRegistry {
	private cwd: string;
	private agentDir: string;

	/**
	 * Create a SkillRegistry.
	 *
	 * @param cwd - Working directory for project-local skills
	 * @param agentDir - Agent config directory for global skills
	 */
	constructor(cwd: string, agentDir: string) {
		this.cwd = cwd;
		this.agentDir = agentDir;
	}

	/**
	 * List and validate local skills against the manifest.
	 *
	 * @param options - Options for skill loading
	 * @param options.skillPaths - Additional skill paths to load
	 * @param options.includeDefaults - Whether to include default skill directories
	 * @returns Registry result with entries, missing skills, and diagnostics
	 */
	list(options?: { skillPaths?: string[]; includeDefaults?: boolean }): SkillRegistryResult {
		const skillPaths = options?.skillPaths ?? [];
		const includeDefaults = options?.includeDefaults ?? true;

		// Load the manifest
		const { manifest, manifestValidation } = this.loadManifest();

		// Load all local skills
		const loadResult: LoadSkillsResult = loadSkills({
			cwd: this.cwd,
			agentDir: this.agentDir,
			skillPaths,
			includeDefaults,
		});

		// Build a skill name -> Skill map
		const skillMap = new Map<string, Skill>();
		for (const skill of loadResult.skills) {
			skillMap.set(skill.name, skill);
		}

		// Build registry entries
		const entries: RegistrySkillEntry[] = [];
		const missingSkills: Array<{ entry: SkillManifestEntry; reason: string }> = [];
		const diagnostics: ResourceDiagnostic[] = [...loadResult.diagnostics];

		// Check each manifest entry against loaded skills
		const manifestSkillNames = new Set<string>();

		for (const manifestEntry of manifest.skills) {
			manifestSkillNames.add(manifestEntry.name);
			const skill = skillMap.get(manifestEntry.name);

			if (!skill) {
				// Skill declared in manifest but not found
				if (manifestEntry.required) {
					missingSkills.push({
						entry: manifestEntry,
						reason: `Required skill "${manifestEntry.name}" not found in local skills`,
					});
					diagnostics.push({
						type: "error",
						message: `Required skill "${manifestEntry.name}" is missing`,
						path: this.getManifestPath(),
					});
				} else {
					// Optional missing skill - just a warning
					diagnostics.push({
						type: "warning",
						message: `Optional skill "${manifestEntry.name}" not found in local skills`,
						path: this.getManifestPath(),
					});
				}
				continue;
			}

			// Skill found - validate it against manifest expectations
			const validationMessages: string[] = [];
			let valid = true;

			if (manifestEntry.source === "remote" && !manifest.remoteFetchEnabled) {
				validationMessages.push(`Skill "${manifestEntry.name}" declared as remote but remote fetch is disabled`);
				valid = false;
			}

			if (manifestEntry.description && skill.description !== manifestEntry.description) {
				validationMessages.push(
					`Skill "${manifestEntry.name}" description mismatch: manifest says "${manifestEntry.description}" but skill has "${skill.description}"`,
				);
			}

			entries.push({
				skill,
				manifestEntry,
				valid,
				validationMessages,
			});

			// Remove from skillMap so we can track extras
			skillMap.delete(manifestEntry.name);
		}

		// Add skills that were loaded but not in the manifest
		for (const skill of skillMap.values()) {
			entries.push({
				skill,
				valid: true,
				validationMessages: [],
			});
		}

		return {
			entries,
			missingSkills,
			diagnostics,
			manifest,
			manifestValidation,
		};
	}

	/**
	 * Validate that all required skills are present.
	 *
	 * @param options - Options for skill loading
	 * @returns True if all required skills are present
	 */
	validate(options?: { skillPaths?: string[]; includeDefaults?: boolean }): {
		valid: boolean;
		missingRequired: Array<{ entry: SkillManifestEntry; reason: string }>;
	} {
		const result = this.list(options);
		return {
			valid: result.missingSkills.length === 0,
			missingRequired: result.missingSkills,
		};
	}

	/**
	 * Get the path to the skill manifest file.
	 *
	 * @returns Path to skill-manifest.json
	 */
	getManifestPath(): string {
		// Check project config dir first
		const projectManifest = join(this.cwd, ".pi", MANIFEST_FILENAME);
		if (existsSync(projectManifest)) {
			return projectManifest;
		}

		// Fall back to agent dir
		const agentManifest = join(this.agentDir, MANIFEST_FILENAME);
		if (existsSync(agentManifest)) {
			return agentManifest;
		}

		// Default to project config path (even if it doesn't exist)
		return projectManifest;
	}

	/**
	 * Load the skill manifest from the project or agent config directory.
	 *
	 * @returns Parsed manifest and validation result
	 */
	private loadManifest(): { manifest: SkillManifest; manifestValidation: ManifestValidationResult } {
		const manifestPath = this.getManifestPath();

		if (!existsSync(manifestPath)) {
			// No manifest found - return empty manifest
			return {
				manifest: EMPTY_MANIFEST,
				manifestValidation: { valid: true, errors: [], warnings: [] },
			};
		}

		try {
			const content = readFileSync(manifestPath, "utf-8");
			const { manifest, validation: manifestValidation } = parseSkillManifest(content);
			return { manifest, manifestValidation };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to read skill manifest";
			return {
				manifest: EMPTY_MANIFEST,
				manifestValidation: {
					valid: false,
					errors: [{ type: "invalid_field", message, field: "root" }],
					warnings: [],
				},
			};
		}
	}
}

/**
 * Skill recommendation for a workspace.
 */
export interface SkillRecommendation {
	/** Recommended skill */
	skill: Skill;
	/** Reason for recommendation */
	reason: string;
	/** Relevance score (0-1) */
	relevance: number;
}

/**
 * Skill Resolver
 *
 * Recommends skills for workspaces based on:
 * - Workspace capabilities and file patterns
 * - Keyword matching between workspace description and skill descriptions
 * - Required skills from the manifest
 */
export class SkillResolver {
	private registry: SkillRegistry;

	/**
	 * Create a SkillResolver.
	 *
	 * @param cwd - Working directory
	 * @param agentDir - Agent config directory
	 */
	constructor(cwd: string, agentDir: string) {
		this.registry = new SkillRegistry(cwd, agentDir);
	}

	/**
	 * Recommend skills for a workspace.
	 *
	 * @param workspace - Workspace specification with id, title, and optional capabilities
	 * @param options - Options for skill loading
	 * @returns Recommended skills sorted by relevance
	 */
	recommend(
		workspace: { id: string; title: string; keywords?: string[] },
		options?: {
			skillPaths?: string[];
			includeDefaults?: boolean;
		},
	): SkillRecommendation[] {
		const result = this.registry.list(options);
		const recommendations: SkillRecommendation[] = [];

		// Collect keywords from workspace title and explicit keywords
		const workspaceKeywords = this.extractKeywords(workspace.title);
		if (workspace.keywords) {
			workspaceKeywords.push(...workspace.keywords.map((k) => k.toLowerCase()));
		}

		for (const entry of result.entries) {
			if (!entry.valid) {
				continue;
			}

			const skillKeywords = this.extractKeywords(entry.skill.description);
			const skillNameKeywords = this.extractKeywords(entry.skill.name);

			// Calculate relevance score
			let relevance = 0;
			const matchReasons: string[] = [];

			// Check for required skills from manifest
			if (entry.manifestEntry?.required) {
				relevance = 1.0;
				matchReasons.push("Required by manifest");
			}

			// Keyword matching
			if (relevance < 1.0) {
				for (const wk of workspaceKeywords) {
					for (const sk of [...skillKeywords, ...skillNameKeywords]) {
						if (wk === sk) {
							relevance += 0.3;
							matchReasons.push(`Keyword match: "${wk}"`);
						} else if (sk.includes(wk) || wk.includes(sk)) {
							relevance += 0.1;
							matchReasons.push(`Partial keyword match: "${wk}" ~ "${sk}"`);
						}
					}
				}
			}

			// Cap relevance at 1.0
			relevance = Math.min(relevance, 1.0);

			// Only recommend if there's some relevance
			if (relevance > 0) {
				recommendations.push({
					skill: entry.skill,
					reason: matchReasons.length > 0 ? matchReasons.join("; ") : "Available skill",
					relevance,
				});
			}
		}

		// Sort by relevance descending
		recommendations.sort((a, b) => b.relevance - a.relevance);

		return recommendations;
	}

	/**
	 * Get the underlying SkillRegistry.
	 *
	 * @returns The skill registry
	 */
	getRegistry(): SkillRegistry {
		return this.registry;
	}

	/**
	 * Extract lowercase keywords from a text string.
	 *
	 * Splits on whitespace and punctuation, filters out common stop words
	 * and very short tokens.
	 *
	 * @param text - Text to extract keywords from
	 * @returns Array of lowercase keywords
	 */
	private extractKeywords(text: string): string[] {
		const stopWords = new Set([
			"a",
			"an",
			"the",
			"and",
			"or",
			"but",
			"in",
			"on",
			"at",
			"to",
			"for",
			"of",
			"with",
			"by",
			"from",
			"is",
			"are",
			"was",
			"were",
			"be",
			"been",
			"being",
			"have",
			"has",
			"had",
			"do",
			"does",
			"did",
			"will",
			"would",
			"could",
			"should",
			"may",
			"might",
			"this",
			"that",
			"these",
			"those",
		]);

		return text
			.toLowerCase()
			.replace(/[()[]{},.;:!?]/g, " ")
			.split(/[^a-z0-9-]+/)
			.filter((token) => token.length > 1 && !stopWords.has(token));
	}
}
