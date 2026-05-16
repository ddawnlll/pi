/**
 * Platform Shared Types - Canonical definitions
 *
 * These types form the platform contract shared across all workspaces.
 * Downstream workspaces MUST import from this module rather than
 * redefining these types locally.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Core Enums
// ---------------------------------------------------------------------------

/** Workspace execution stage (state machine) */
export enum WorkspaceStage {
	Pending = "pending",
	Active = "active",
	Complete = "complete",
	Blocked = "blocked",
	Failed = "failed",
}

/** Plan execution status */
export enum PlanExecutionStatus {
	Running = "running",
	Complete = "complete",
	Failed = "failed",
	Paused = "paused",
	Stopped = "stopped",
	Cancelled = "cancelled",
}

/** Worker execution stage */
export enum WorkerStage {
	Pending = "pending",
	Active = "active",
	Complete = "complete",
	Blocked = "blocked",
	Failed = "failed",
}

/** Capability permission level */
export enum CapabilityPermission {
	Read = "read",
	Write = "write",
	Execute = "execute",
	Admin = "admin",
}

/** Capability maturity level */
export enum CapabilityLevel {
	Core = "core",
	Extended = "extended",
	Experimental = "experimental",
}

/** Platform component identifier */
export enum PlatformComponent {
	CodingAgent = "coding-agent",
	WebServer = "web-server",
	WebUI = "web-ui",
	AgentCore = "agent-core",
	AI = "ai",
	DB = "db",
	TUI = "tui",
}

/** Audit severity level */
export enum AuditLevel {
	Info = "info",
	Warn = "warn",
	Error = "error",
	Critical = "critical",
}

/** Dependency relationship type between workspaces */
export enum DependencyType {
	Hard = "hard", // Must complete before dependent starts
	Soft = "soft", // Should complete before, but dependent can start
	Data = "data", // Data dependency (file read/write)
}

// ---------------------------------------------------------------------------
// Version & Compatibility
// ---------------------------------------------------------------------------

/** Platform version information */
export interface PlatformVersion {
	/** Semver version of the platform contract */
	version: string;
	/** Minimum compatible version required */
	minCompatibleVersion: string;
	/** Maximum supported version (null = latest) */
	maxSupportedVersion: string | null;
}

/** Compatibility specification */
export interface CompatibilitySpec {
	/** Minimum platform version required */
	platformVersion: string;
	/** Whether this is backward compatible */
	backwardCompatible: boolean;
	/** Specific component version compatibilities */
	compatibleComponents: Partial<Record<PlatformComponent, string>>;
}

// ---------------------------------------------------------------------------
// Hooks & Audit
// ---------------------------------------------------------------------------

/** Lifecycle hook definition */
export interface CapabilityHook {
	/** Hook type identifier */
	type: string;
	/** Whether this hook is required for the capability to function */
	required: boolean;
	/** Human-readable description of the hook's purpose */
	description: string;
}

/** Audit requirement specification */
export interface AuditSpec {
	/** Whether audit logging is required */
	auditRequired: boolean;
	/** Minimum severity level to audit */
	auditLevel: AuditLevel;
	/** Specific events that must be audited */
	auditedEvents: string[];
	/** Retention period in days (default: 90) */
	retentionDays: number;
}

// ---------------------------------------------------------------------------
// Capability Manifest
// ---------------------------------------------------------------------------

/** Version specification for a capability */
export interface CapabilityVersion {
	/** Current semantic version */
	current: string;
	/** Minimum version required for compatibility */
	minimum: string;
	/** Whether this is a stable API surface */
	stable: boolean;
}

/** Full capability manifest for a platform component */
export interface CapabilityManifest {
	/** Machine-readable capability name */
	name: string;
	/** Unique capability identifier */
	id: string;
	/** Human-readable description */
	description: string;
	/** Maturity level of this capability */
	level: CapabilityLevel;
	/** Version information */
	version: CapabilityVersion;
	/** Required permissions to use this capability */
	permissions: CapabilityPermission[];
	/** Compatibility information */
	compatibility: CompatibilitySpec;
	/** Lifecycle hooks this capability exposes */
	hooks: CapabilityHook[];
	/** Audit requirements */
	audit: AuditSpec;
	/** Whether this capability is currently enabled */
	enabled: boolean;
	/** Component that provides this capability */
	provider: PlatformComponent;
	/** IDs of capabilities this depends on */
	dependencies: string[];
}

// ---------------------------------------------------------------------------
// Component Manifest
// ---------------------------------------------------------------------------

/** Manifest for a single platform component */
export interface ComponentManifest {
	/** Component identifier */
	component: PlatformComponent;
	/** Component version */
	version: string;
	/** Whether the component is enabled */
	enabled: boolean;
	/** Capabilities provided by this component */
	capabilities: string[];
	/** Component dependencies (other component IDs) */
	dependencies: PlatformComponent[];
}

// ---------------------------------------------------------------------------
// Platform Manifest
// ---------------------------------------------------------------------------

/** Full platform manifest combining all components and capabilities */
export interface PlatformManifest {
	/** Platform version information */
	platform: PlatformVersion;
	/** Manifests for each platform component */
	components: ComponentManifest[];
	/** All capabilities across all components */
	capabilities: CapabilityManifest[];
}

// ---------------------------------------------------------------------------
// Manifest Validation
// ---------------------------------------------------------------------------

/** Severity of a validation issue */
export enum ValidationIssueSeverity {
	Error = "error",
	Warning = "warning",
}

/** A single validation issue */
export interface ValidationIssue {
	/** Severity level */
	severity: ValidationIssueSeverity;
	/** Issue type identifier */
	type: string;
	/** Human-readable message */
	message: string;
	/** Path to the field with the issue (dot-notation) */
	field?: string;
	/** Component or capability ID */
	source?: string;
}

/** Result of manifest validation */
export interface ManifestValidationResult {
	/** Whether the manifest passes all validation checks */
	valid: boolean;
	/** Validation issues (errors and warnings) */
	issues: ValidationIssue[];
	/** Errors only (issues with severity Error) */
	errors: ValidationIssue[];
	/** Warnings only (issues with severity Warning) */
	warnings: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Default Values
// ---------------------------------------------------------------------------

/** Default audit specification */
export const DEFAULT_AUDIT_SPEC: AuditSpec = {
	auditRequired: true,
	auditLevel: AuditLevel.Warn,
	auditedEvents: ["capability.enable", "capability.disable", "capability.change"],
	retentionDays: 90,
};

/** Current platform version */
export const CURRENT_PLATFORM_VERSION: PlatformVersion = {
	version: "1.0.0",
	minCompatibleVersion: "1.0.0",
	maxSupportedVersion: null,
};
