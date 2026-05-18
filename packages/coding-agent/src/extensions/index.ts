/**
 * Extensions module entry point.
 *
 * Provides manifest parsing and permission gate for extension packages.
 */

export {
	ExtensionPackageManifestSchema,
	ManifestParser,
	ManifestValidationError,
	type ParsedExtensionPackageManifest,
	PermissionDeniedError,
} from "./manifest-parser.js";
export {
	type PermissionCheckResult,
	PermissionGate,
	PermissionGateError,
} from "./permission-gate.js";
