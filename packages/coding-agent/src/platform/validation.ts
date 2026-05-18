/**
 * Platform Manifest Validation
 *
 * Validates capability manifests and platform manifests against
 * the platform contract schema.
 *
 * @packageDocumentation
 */

import {
	AuditLevel,
	CapabilityLevel,
	type CapabilityManifest,
	CapabilityPermission,
	type CompatibilitySpec,
	type ManifestValidationResult,
	type PlatformManifest,
	ValidationIssueSeverity,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid capability levels */
const VALID_CAPABILITY_LEVELS: ReadonlySet<string> = new Set([
	CapabilityLevel.Core,
	CapabilityLevel.Extended,
	CapabilityLevel.Experimental,
]);

/** Valid capability permissions */
const VALID_PERMISSIONS: ReadonlySet<string> = new Set([
	CapabilityPermission.Read,
	CapabilityPermission.Write,
	CapabilityPermission.Execute,
	CapabilityPermission.Admin,
]);

/** Valid audit levels */
const VALID_AUDIT_LEVELS: ReadonlySet<string> = new Set([
	AuditLevel.Info,
	AuditLevel.Warn,
	AuditLevel.Error,
	AuditLevel.Critical,
]);

/** Simple semver regex (major.minor.patch) */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a string is a valid semver version.
 */
function isValidSemver(v: string): boolean {
	return SEMVER_RE.test(v);
}

/**
 * Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Validate a single capability manifest.
 *
 * Checks:
 * - Required fields are present
 * - Version strings are valid semver
 * - Capability level is one of the known levels
 * - Permissions are valid
 * - Compatibility is well-formed
 * - Audit spec is well-formed
 * - Dependencies reference valid capability-like IDs
 *
 * @param manifest - Capability manifest to validate
 * @returns Validation result
 */
export function validateCapabilityManifest(manifest: CapabilityManifest): ManifestValidationResult {
	const issues: Array<{
		severity: ValidationIssueSeverity;
		type: string;
		message: string;
		field?: string;
		source?: string;
	}> = [];

	const source = manifest.id || manifest.name;

	// --- Required fields ---

	if (!manifest.name || typeof manifest.name !== "string") {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Capability manifest must have a non-empty 'name' field",
			field: "name",
			source,
		});
	}

	if (!manifest.id || typeof manifest.id !== "string") {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Capability manifest must have a non-empty 'id' field",
			field: "id",
			source,
		});
	}

	if (!manifest.description || typeof manifest.description !== "string") {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Capability manifest must have a non-empty 'description' field",
			field: "description",
			source,
		});
	}

	// --- Level validation ---

	if (!VALID_CAPABILITY_LEVELS.has(manifest.level)) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "invalid_level",
			message: `Invalid capability level: "${manifest.level}". Must be one of: ${Array.from(VALID_CAPABILITY_LEVELS).join(", ")}`,
			field: "level",
			source,
		});
	}

	// --- Version validation ---

	if (!manifest.version) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Capability manifest must have a 'version' field",
			field: "version",
			source,
		});
	} else {
		if (!manifest.version.current || !isValidSemver(manifest.version.current)) {
			issues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_version",
				message: `Capability version.current must be a valid semver string, got "${manifest.version.current}"`,
				field: "version.current",
				source,
			});
		}
		if (!manifest.version.minimum || !isValidSemver(manifest.version.minimum)) {
			issues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_version",
				message: `Capability version.minimum must be a valid semver string, got "${manifest.version.minimum}"`,
				field: "version.minimum",
				source,
			});
		}
		if (
			manifest.version.current &&
			manifest.version.minimum &&
			isValidSemver(manifest.version.current) &&
			isValidSemver(manifest.version.minimum) &&
			compareSemver(manifest.version.current, manifest.version.minimum) < 0
		) {
			issues.push({
				severity: ValidationIssueSeverity.Warning,
				type: "version_mismatch",
				message: `Capability version.current (${manifest.version.current}) is less than version.minimum (${manifest.version.minimum})`,
				field: "version",
				source,
			});
		}
	}

	// --- Permissions validation ---

	if (!Array.isArray(manifest.permissions)) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "invalid_permissions",
			message: "Capability manifest 'permissions' must be an array",
			field: "permissions",
			source,
		});
	} else {
		for (const perm of manifest.permissions) {
			if (!VALID_PERMISSIONS.has(perm)) {
				issues.push({
					severity: ValidationIssueSeverity.Error,
					type: "invalid_permission",
					message: `Invalid permission: "${perm}". Must be one of: ${Array.from(VALID_PERMISSIONS).join(", ")}`,
					field: "permissions",
					source,
				});
			}
		}
	}

	// --- Compatibility validation ---

	if (!manifest.compatibility) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Capability manifest must have a 'compatibility' field",
			field: "compatibility",
			source,
		});
	} else {
		validateCompatibilitySpec(manifest.compatibility, issues, source);
	}

	// --- Hooks validation ---

	if (!Array.isArray(manifest.hooks)) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "invalid_hooks",
			message: "Capability manifest 'hooks' must be an array",
			field: "hooks",
			source,
		});
	} else {
		for (let i = 0; i < manifest.hooks.length; i++) {
			const hook = manifest.hooks[i];
			if (!hook.type || typeof hook.type !== "string") {
				issues.push({
					severity: ValidationIssueSeverity.Error,
					type: "invalid_hook",
					message: `Hook at index ${i} must have a non-empty 'type' field`,
					field: `hooks[${i}].type`,
					source,
				});
			}
			if (typeof hook.required !== "boolean") {
				issues.push({
					severity: ValidationIssueSeverity.Error,
					type: "invalid_hook",
					message: `Hook at index ${i} must have a boolean 'required' field`,
					field: `hooks[${i}].required`,
					source,
				});
			}
			if (!hook.description || typeof hook.description !== "string") {
				issues.push({
					severity: ValidationIssueSeverity.Error,
					type: "invalid_hook",
					message: `Hook at index ${i} must have a non-empty 'description' field`,
					field: `hooks[${i}].description`,
					source,
				});
			}
		}
	}

	// --- Audit validation ---

	if (!manifest.audit) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Capability manifest must have an 'audit' field",
			field: "audit",
			source,
		});
	} else {
		if (typeof manifest.audit.auditRequired !== "boolean") {
			issues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_audit",
				message: "Capability audit.auditRequired must be a boolean",
				field: "audit.auditRequired",
				source,
			});
		}
		if (!VALID_AUDIT_LEVELS.has(manifest.audit.auditLevel)) {
			issues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_audit",
				message: `Invalid audit level: "${manifest.audit.auditLevel}". Must be one of: ${Array.from(VALID_AUDIT_LEVELS).join(", ")}`,
				field: "audit.auditLevel",
				source,
			});
		}
		if (!Array.isArray(manifest.audit.auditedEvents)) {
			issues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_audit",
				message: "Capability audit.auditedEvents must be an array",
				field: "audit.auditedEvents",
				source,
			});
		}
		if (typeof manifest.audit.retentionDays !== "number" || manifest.audit.retentionDays < 0) {
			issues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_audit",
				message: `Capability audit.retentionDays must be a non-negative number, got ${manifest.audit.retentionDays}`,
				field: "audit.retentionDays",
				source,
			});
		}
	}

	// --- Dependencies validation ---

	if (!Array.isArray(manifest.dependencies)) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "invalid_dependencies",
			message: "Capability manifest 'dependencies' must be an array",
			field: "dependencies",
			source,
		});
	} else {
		for (let i = 0; i < manifest.dependencies.length; i++) {
			if (typeof manifest.dependencies[i] !== "string" || manifest.dependencies[i].length === 0) {
				issues.push({
					severity: ValidationIssueSeverity.Error,
					type: "invalid_dependency",
					message: `Dependency at index ${i} must be a non-empty string`,
					field: `dependencies[${i}]`,
					source,
				});
			}
		}
	}

	// --- Enabled field ---

	if (typeof manifest.enabled !== "boolean") {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "invalid_enabled",
			message: "Capability manifest 'enabled' must be a boolean",
			field: "enabled",
			source,
		});
	}

	return buildResult(issues);
}

/**
 * Validate a compatibility specification.
 */
function validateCompatibilitySpec(
	spec: CompatibilitySpec,
	issues: Array<{
		severity: ValidationIssueSeverity;
		type: string;
		message: string;
		field?: string;
		source?: string;
	}>,
	source: string,
): void {
	if (!spec.platformVersion || !isValidSemver(spec.platformVersion)) {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "invalid_version",
			message: `Compatibility platformVersion must be a valid semver string, got "${spec.platformVersion}"`,
			field: "compatibility.platformVersion",
			source,
		});
	}
	if (typeof spec.backwardCompatible !== "boolean") {
		issues.push({
			severity: ValidationIssueSeverity.Error,
			type: "invalid_compatibility",
			message: "Compatibility backwardCompatible must be a boolean",
			field: "compatibility.backwardCompatible",
			source,
		});
	}
	if (spec.compatibleComponents !== undefined && spec.compatibleComponents !== null) {
		if (typeof spec.compatibleComponents !== "object" || Array.isArray(spec.compatibleComponents)) {
			issues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_compatibility",
				message: "Compatibility compatibleComponents must be a record (object) of component -> version mappings",
				field: "compatibility.compatibleComponents",
				source,
			});
		} else {
			for (const [component, version] of Object.entries(spec.compatibleComponents)) {
				if (typeof version !== "string" || !isValidSemver(version)) {
					issues.push({
						severity: ValidationIssueSeverity.Warning,
						type: "invalid_version",
						message: `Compatibility compatibleComponents["${component}"] must be a valid semver string, got "${version}"`,
						field: `compatibility.compatibleComponents["${component}"]`,
						source,
					});
				}
			}
		}
	}
}

/**
 * Validate a full platform manifest.
 *
 * Validates:
 * - Each capability manifest
 * - Referential integrity of capability dependencies
 * - No duplicate capability IDs
 * - Platform version is valid
 *
 * @param manifest - Platform manifest to validate
 * @returns Validation result
 */
export function validatePlatformManifest(manifest: PlatformManifest): ManifestValidationResult {
	const allIssues: Array<{
		severity: ValidationIssueSeverity;
		type: string;
		message: string;
		field?: string;
		source?: string;
	}> = [];

	// --- Platform version ---

	if (!manifest.platform) {
		allIssues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Platform manifest must have a 'platform' field",
			field: "platform",
		});
	} else {
		const pv = manifest.platform;
		if (!pv.version || !isValidSemver(pv.version)) {
			allIssues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_version",
				message: `Platform version must be a valid semver string, got "${pv.version}"`,
				field: "platform.version",
			});
		}
		if (!pv.minCompatibleVersion || !isValidSemver(pv.minCompatibleVersion)) {
			allIssues.push({
				severity: ValidationIssueSeverity.Error,
				type: "invalid_version",
				message: `Platform minCompatibleVersion must be a valid semver string, got "${pv.minCompatibleVersion}"`,
				field: "platform.minCompatibleVersion",
			});
		}
	}

	// --- Components ---

	if (!Array.isArray(manifest.components)) {
		allIssues.push({
			severity: ValidationIssueSeverity.Error,
			type: "missing_field",
			message: "Platform manifest must have a 'components' array",
			field: "components",
		});
	}

	// --- Collect capability IDs ---

	const capabilityIds = new Set<string>();
	for (const cap of manifest.capabilities) {
		if (cap.id) {
			capabilityIds.add(cap.id);
		}
	}

	// --- Validate each capability ---

	const seenIds = new Set<string>();
	for (let i = 0; i < manifest.capabilities.length; i++) {
		const cap = manifest.capabilities[i];
		const capResult = validateCapabilityManifest(cap);
		allIssues.push(...capResult.issues);

		// Check for duplicate IDs
		if (cap.id) {
			if (seenIds.has(cap.id)) {
				allIssues.push({
					severity: ValidationIssueSeverity.Error,
					type: "duplicate_id",
					message: `Duplicate capability ID: "${cap.id}"`,
					field: `capabilities[${i}].id`,
					source: cap.id,
				});
			}
			seenIds.add(cap.id);
		}

		// Check dependency references
		if (Array.isArray(cap.dependencies)) {
			for (const depId of cap.dependencies) {
				if (!capabilityIds.has(depId)) {
					allIssues.push({
						severity: ValidationIssueSeverity.Warning,
						type: "invalid_dependency",
						message: `Capability "${cap.id}" depends on unknown capability "${depId}"`,
						field: `capabilities[${i}].dependencies`,
						source: cap.id,
					});
				}
			}
		}
	}

	return buildResult(allIssues);
}

/**
 * Build a ManifestValidationResult from a list of issues.
 */
function buildResult(
	issues: Array<{
		severity: ValidationIssueSeverity;
		type: string;
		message: string;
		field?: string;
		source?: string;
	}>,
): ManifestValidationResult {
	const errors = issues.filter((i) => i.severity === ValidationIssueSeverity.Error);
	const warnings = issues.filter((i) => i.severity === ValidationIssueSeverity.Warning);
	return {
		valid: errors.length === 0,
		issues,
		errors,
		warnings,
	};
}
