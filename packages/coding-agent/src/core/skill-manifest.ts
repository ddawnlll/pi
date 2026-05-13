/**
 * Local Skill Manifest Format - P2 Workstream 5.D
 *
 * Defines the schema for a local skill manifest (skill-manifest.json),
 * which enumerates skills available in a project or workspace and
 * specifies which skills are required for operation.
 */

/**
 * A single skill entry in the manifest.
 */
export interface SkillManifestEntry {
	/** Skill name (must match the skill directory name / frontmatter name) */
	name: string;
	/** Short human-readable description */
	description?: string;
	/** Whether this skill is required for doctor validation */
	required?: boolean;
	/** Skill source type */
	source: SkillSource;
	/** Remote URL (only used when source is "remote") */
	url?: string;
	/** Version constraint (semver string, optional) */
	version?: string;
}

/**
 * Skill source type.
 * - "local": skill is discovered from local filesystem
 * - "builtin": skill is bundled with the agent
 * - "remote": skill is fetched from a remote registry (disabled by default)
 */
export type SkillSource = "local" | "builtin" | "remote";

/**
 * Local skill manifest format.
 *
 * Place a `skill-manifest.json` in the project's config directory
 * (e.g., `.pi/skill-manifest.json`) to declare expected skills.
 */
export interface SkillManifest {
	/** Manifest format version */
	version: 1;
	/** List of skill entries */
	skills: SkillManifestEntry[];
	/** Whether remote skill fetching is enabled (default: false) */
	remoteFetchEnabled?: boolean;
	/** Optional project name */
	projectName?: string;
}

/**
 * Manifest validation error.
 */
export interface ManifestValidationError {
	/** Error type */
	type: "missing_field" | "invalid_field" | "invalid_version" | "remote_not_enabled" | "duplicate_skill";
	/** Human-readable message */
	message: string;
	/** Skill name (if applicable) */
	skillName?: string;
	/** Field path (if applicable) */
	field?: string;
}

/**
 * Manifest validation result.
 */
export interface ManifestValidationResult {
	/** Whether the manifest is valid */
	valid: boolean;
	/** Validation errors */
	errors: ManifestValidationError[];
	/** Validation warnings */
	warnings: ManifestValidationError[];
}

/**
 * Validate a skill manifest.
 *
 * Checks:
 * - Required fields (version, skills)
 * - Version must be 1
 * - Each skill entry must have name and source
 * - No duplicate skill names
 * - Remote skills require remoteFetchEnabled
 * - Name format validation (lowercase, hyphens, digits)
 *
 * @param manifest - Manifest to validate
 * @returns Validation result
 */
export function validateSkillManifest(manifest: Partial<SkillManifest>): ManifestValidationResult {
	const errors: ManifestValidationError[] = [];
	const warnings: ManifestValidationError[] = [];

	if (manifest.version === undefined) {
		errors.push({ type: "missing_field", message: "Manifest version is required", field: "version" });
	} else if (manifest.version !== 1) {
		errors.push({
			type: "invalid_version",
			message: `Manifest version must be 1, got ${manifest.version}`,
			field: "version",
		});
	}

	if (!manifest.skills) {
		errors.push({ type: "missing_field", message: "Manifest skills array is required", field: "skills" });
	} else {
		const seenNames = new Set<string>();
		for (const [index, skill] of manifest.skills.entries()) {
			if (!skill.name) {
				errors.push({
					type: "missing_field",
					message: `Skill at index ${index} is missing name`,
					field: `skills[${index}].name`,
				});
				continue;
			}

			if (seenNames.has(skill.name)) {
				errors.push({
					type: "duplicate_skill",
					message: `Duplicate skill name: "${skill.name}"`,
					skillName: skill.name,
				});
			}
			seenNames.add(skill.name);

			if (!/^[a-z0-9-]+$/.test(skill.name)) {
				errors.push({
					type: "invalid_field",
					message: `Skill name "${skill.name}" contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`,
					skillName: skill.name,
					field: `skills[${index}].name`,
				});
			}

			if (skill.name.startsWith("-") || skill.name.endsWith("-")) {
				errors.push({
					type: "invalid_field",
					message: `Skill name "${skill.name}" must not start or end with a hyphen`,
					skillName: skill.name,
					field: `skills[${index}].name`,
				});
			}

			if (skill.name.includes("--")) {
				errors.push({
					type: "invalid_field",
					message: `Skill name "${skill.name}" must not contain consecutive hyphens`,
					skillName: skill.name,
					field: `skills[${index}].name`,
				});
			}

			if (skill.name.length > 64) {
				errors.push({
					type: "invalid_field",
					message: `Skill name "${skill.name}" exceeds 64 characters`,
					skillName: skill.name,
					field: `skills[${index}].name`,
				});
			}

			if (!skill.source) {
				errors.push({
					type: "missing_field",
					message: `Skill "${skill.name}" is missing source`,
					skillName: skill.name,
					field: `skills[${index}].source`,
				});
			} else if (!["local", "builtin", "remote"].includes(skill.source)) {
				errors.push({
					type: "invalid_field",
					message: `Skill "${skill.name}" has invalid source: "${skill.source}" (must be "local", "builtin", or "remote")`,
					skillName: skill.name,
					field: `skills[${index}].source`,
				});
			}

			if (skill.source === "remote" && !manifest.remoteFetchEnabled) {
				errors.push({
					type: "remote_not_enabled",
					message: `Skill "${skill.name}" uses remote source but remoteFetchEnabled is not set to true`,
					skillName: skill.name,
					field: `skills[${index}].source`,
				});
			}

			if (skill.source === "remote" && !skill.url) {
				warnings.push({
					type: "missing_field",
					message: `Remote skill "${skill.name}" should have a url field`,
					skillName: skill.name,
					field: `skills[${index}].url`,
				});
			}

			if (skill.source !== "remote" && skill.url) {
				warnings.push({
					type: "invalid_field",
					message: `Non-remote skill "${skill.name}" has a url field that will be ignored`,
					skillName: skill.name,
					field: `skills[${index}].url`,
				});
			}
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}

/**
 * Default empty manifest.
 */
export const EMPTY_MANIFEST: SkillManifest = {
	version: 1,
	skills: [],
	remoteFetchEnabled: false,
};

/**
 * Parse a skill manifest from JSON string.
 *
 * Returns the parsed manifest and validation result.
 * On parse failure, returns EMPTY_MANIFEST with a validation error.
 *
 * @param json - JSON string to parse
 * @returns Parsed manifest and validation result
 */
export function parseSkillManifest(json: string): { manifest: SkillManifest; validation: ManifestValidationResult } {
	let parsed: Partial<SkillManifest>;
	try {
		parsed = JSON.parse(json);
	} catch {
		const validation: ManifestValidationResult = {
			valid: false,
			errors: [{ type: "invalid_field", message: "Invalid JSON in skill manifest", field: "root" }],
			warnings: [],
		};
		return { manifest: EMPTY_MANIFEST, validation };
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		const validation: ManifestValidationResult = {
			valid: false,
			errors: [{ type: "invalid_field", message: "Skill manifest must be a JSON object", field: "root" }],
			warnings: [],
		};
		return { manifest: EMPTY_MANIFEST, validation };
	}

	const validation = validateSkillManifest(parsed);
	if (!validation.valid) {
		return { manifest: EMPTY_MANIFEST, validation };
	}

	return {
		manifest: {
			version: parsed.version!,
			skills: parsed.skills!,
			remoteFetchEnabled: parsed.remoteFetchEnabled ?? false,
			projectName: parsed.projectName,
		},
		validation,
	};
}
