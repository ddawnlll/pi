/**
 * Extensions module entry point.
 *
 * Provides manifest parsing and permission gate for extension packages.
 */

export {
	ExtensionPackageManifestSchema,
	ManifestParser,
	ManifestValidationError,
	PermissionDeniedError,
	type ParsedExtensionPackageManifest,
} from "./manifest-parser.js";
export {
	PermissionGate,
	PermissionGateError,
	type PermissionCheckResult,
} from "./permission-gate.js";
