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
	type AuditSpec,
	type CapabilityHook,
	CapabilityLevel,
	type CapabilityManifest,
	CapabilityPermission,
	type CapabilityVersion,
	type CompatibilitySpec,
	type ComponentManifest,
	// Defaults
	CURRENT_PLATFORM_VERSION,
	DEFAULT_AUDIT_SPEC,
	DependencyType,
	type ManifestValidationResult,
	PlanExecutionStatus,
	PlatformComponent,
	type PlatformManifest,
	PlatformVersion,
	type ValidationIssue,
	ValidationIssueSeverity,
	WorkerStage,
	WorkspaceStage,
} from "./types.js";

// Validation
export {
	validateCapabilityManifest,
	validatePlatformManifest,
} from "./validation.js";
