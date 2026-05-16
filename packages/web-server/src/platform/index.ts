/**
 * Platform Module (Web Server)
 *
 * Re-exports shared platform types from the canonical coding-agent module.
 * No platform enums or types should be redefined locally.
 *
 * @packageDocumentation
 */

export {
	AuditLevel,
	CapabilityLevel,
	CapabilityPermission,
	CURRENT_PLATFORM_VERSION,
	DEFAULT_AUDIT_SPEC,
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
	validateCapabilityManifest,
	validatePlatformManifest,
} from "@earendil-works/pi-coding-agent";
