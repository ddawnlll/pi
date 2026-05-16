/**
 * Platform Module
 *
 * Canonical platform types, capability manifests, and shared contracts.
 * All downstream workspaces MUST import platform types from this module
 * instead of redefining them locally.
 *
 * @packageDocumentation
 */

// Core types and enums
export {
	AuditLevel,
	CapabilityLevel,
	CapabilityPermission,
	DependencyType,
	PlanExecutionStatus,
	PlatformComponent,
	PlatformVersion,
	WorkerStage,
	WorkspaceStage,
	ValidationIssueSeverity,
	type AuditSpec,
	type CapabilityHook,
	type CapabilityManifest,
	type CapabilityVersion,
	type CompatibilitySpec,
	type ComponentManifest,
	type ManifestValidationResult,
	type PlatformManifest,
	type ValidationIssue,
	// Defaults
	CURRENT_PLATFORM_VERSION,
	DEFAULT_AUDIT_SPEC,
} from "./types.js";

// Validation
export {
	validateCapabilityManifest,
	validatePlatformManifest,
} from "./validation.js";
