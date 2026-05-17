/**
 * Manifest Parser
 *
 * Parses and validates extension package manifests using a Zod schema.
 * Provides typed, validated manifest objects from raw JSON or unknown input.
 */

import { z } from "zod";

// ============================================================================
// Zod Schema
// ============================================================================

/**
 * Zod schema for extension package manifests.
 *
 * Mirrors the ExtensionPackageManifest interface but is enforced by
 * Zod at runtime for robust validation.
 */
export const ExtensionPackageManifestSchema = z.object({
	/** Extension name (must be unique across all registered packages). */
	name: z
		.string()
		.min(1, "Extension name is required")
		.regex(
			/^(?:@[a-zA-Z0-9_-]+\/)?[a-zA-Z][a-zA-Z0-9_-]*$/,
			"Extension name must start with a letter and contain only letters, digits, hyphens, and underscores, optionally scoped with @scope/",
		),
	/** Semver version string (e.g. "1.2.3"). */
	version: z
		.string()
		.min(1, "Version is required")
		.regex(
			/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/,
			"Version must be a valid semver string (e.g. 1.2.3 or 1.2.3-beta.1)",
		),
	/** Human-readable description. */
	description: z.string().optional(),
	/** Package author. */
	author: z.string().optional(),
	/** SPDX license identifier. */
	license: z.string().optional(),
	/** Engine compatibility constraints. */
	engines: z
		.object({
			/** Semver range that the pi host must satisfy (e.g. ">=0.14.0"). */
			pi: z.string().optional(),
		})
		.optional(),
	/** Extension-to-extension dependencies: name -> semver range. */
	dependencies: z.record(z.string(), z.string()).optional(),
	/**
	 * Declared permissions for this extension.
	 *
	 * Permissions control what capabilities the extension is allowed to use
	 * at runtime. The PermissionGate enforces these at the point of use.
	 */
	permissions: z
		.array(
			z.object({
				/** Permission identifier (e.g. "network", "filesystem", "bash"). */
				id: z.string().min(1, "Permission id is required"),
				/** Human-readable description of what this permission grants. */
				description: z.string().optional(),
				/** Optional reason the extension needs this permission. */
				reason: z.string().optional(),
			}),
		)
		.optional(),
});

/** Inferred type from the Zod schema. */
export type ParsedExtensionPackageManifest = z.infer<typeof ExtensionPackageManifestSchema>;

// ============================================================================
// Manifest Parser
// ============================================================================

/** Error thrown when manifest validation fails. */
export class ManifestValidationError extends Error {
	/** Zod validation issues that caused the error. */
	public readonly issues: z.ZodIssue[];

	constructor(message: string, issues: z.ZodIssue[]) {
		super(message);
		this.name = "ManifestValidationError";
		this.issues = issues;
	}
}

/** Error thrown when a permission is denied. */
export class PermissionDeniedError extends Error {
	/** The permission that was denied. */
	public readonly permission: string;

	/** The extension name that was denied. */
	public readonly extensionName: string;

	constructor(permission: string, extensionName: string, message?: string) {
		super(message ?? `extension_permission_denied: '${permission}' not declared in manifest for '${extensionName}'`);
		this.name = "PermissionDeniedError";
		this.permission = permission;
		this.extensionName = extensionName;
	}
}

/**
 * Parses and validates extension package manifests using a Zod schema.
 */
export class ManifestParser {
	/**
	 * Parse and validate an unknown value as an extension package manifest.
	 *
	 * @param input - Raw manifest data (e.g. from JSON.parse or untrusted source)
	 * @returns A fully typed and validated manifest object
	 * @throws {ManifestValidationError} If the input fails schema validation
	 */
	static parse(input: unknown): ParsedExtensionPackageManifest {
		const result = ExtensionPackageManifestSchema.safeParse(input);

		if (!result.success) {
			const messages = result.error.issues.map(
				(issue) => `${issue.path.join(".")}: ${issue.message}`,
			);
			throw new ManifestValidationError(
				`Manifest validation failed:\n${messages.join("\n")}`,
				result.error.issues,
			);
		}

		return result.data;
	}

	/**
	 * Parse and validate an unknown value as an extension package manifest.
	 * Returns the validated manifest if successful, or null if validation fails.
	 */
	static safeParse(input: unknown): { success: true; data: ParsedExtensionPackageManifest } | { success: false; error: ManifestValidationError } {
		const result = ExtensionPackageManifestSchema.safeParse(input);
		if (!result.success) {
			const messages = result.error.issues.map(
				(issue) => `${issue.path.join(".")}: ${issue.message}`,
			);
			return {
				success: false,
				error: new ManifestValidationError(
					`Manifest validation failed:\n${messages.join("\n")}`,
					result.error.issues,
				),
			};
		}
		return { success: true, data: result.data };
	}
}
