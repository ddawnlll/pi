/**
 * Permission Gate
 *
 * Enforces extension permissions at runtime. Each extension declares
 * permissions in its manifest. The PermissionGate checks these before
 * allowing access to protected capabilities.
 *
 * When a permission check fails, a hard stop error is thrown with the
 * code "extension_permission_denied".
 */

import type { ParsedExtensionPackageManifest } from "./manifest-parser.js";

// ============================================================================
// Permission Check Result
// ============================================================================

export interface PermissionCheckResult {
	/** Whether the permission is granted. */
	allowed: boolean;
	/** The permission that was checked. */
	permission: string;
	/** The extension name. */
	extensionName: string;
	/** Human-readable reason if permission was denied. */
	reason?: string;
}

// ============================================================================
// Permission Gate Error
// ============================================================================

/**
 * Error thrown when an extension requests a permission not declared in its manifest.
 *
 * This is a hard stop: the calling code should catch this error and prevent
 * the requested operation from proceeding.
 */
export class PermissionGateError extends Error {
	/** The permission that was denied. */
	public readonly permission: string;

	/** The extension name. */
	public readonly extensionName: string;

	constructor(permission: string, extensionName: string) {
		const message = `extension_permission_denied: '${permission}' not declared in manifest for '${extensionName}'`;
		super(message);
		this.name = "PermissionGateError";
		this.permission = permission;
		this.extensionName = extensionName;
	}
}

// ============================================================================
// Permission Gate
// ============================================================================

/**
 * Checks extension permissions at runtime.
 *
 * Extensions declare permissions in their manifest. The PermissionGate
 * enforces that an extension cannot use capabilities it hasn't declared.
 */
export class PermissionGate {
	/**
	 * Check whether an extension has declared a specific permission.
	 *
	 * @param manifest - The parsed extension manifest
	 * @param permission - The permission ID to check (e.g. "network", "filesystem", "bash")
	 * @returns A PermissionCheckResult indicating if access is allowed
	 */
	static check(
		manifest: ParsedExtensionPackageManifest,
		permission: string,
	): PermissionCheckResult {
		const extensionName = manifest.name;

		// If the manifest declares no permissions, all access is denied by default
		if (!manifest.permissions || manifest.permissions.length === 0) {
			return {
				allowed: false,
				permission,
				extensionName,
				reason: `extension '${extensionName}' declares no permissions`,
			};
		}

		// Check if the requested permission is in the declared list
		const declaredPermission = manifest.permissions.find(
			(p) => p.id === permission,
		);

		if (!declaredPermission) {
			return {
				allowed: false,
				permission,
				extensionName,
				reason: `permission '${permission}' not declared in manifest for '${extensionName}'`,
			};
		}

		return {
			allowed: true,
			permission,
			extensionName,
		};
	}

	/**
	 * Check whether an extension has declared a specific permission.
	 * Throws PermissionGateError (hard stop) if the permission is denied.
	 *
	 * @param manifest - The parsed extension manifest
	 * @param permission - The permission ID to check (e.g. "network", "filesystem", "bash")
	 * @throws {PermissionGateError} If the permission is not declared
	 */
	static require(
		manifest: ParsedExtensionPackageManifest,
		permission: string,
	): void {
		const result = PermissionGate.check(manifest, permission);
		if (!result.allowed) {
			throw new PermissionGateError(permission, manifest.name);
		}
	}
}
