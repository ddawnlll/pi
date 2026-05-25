/**
 * Evidence Model - Workspace 25.E
 *
 * Evidence model types and utilities for the diagnostic packet system.
 * Provides category-specific structured data types for evidence entries.
 *
 * Re-exports from the core diagnostic-packet implementation.
 */

export {
	type CooldownData,
	type CreateEvidenceEntryOptions,
	createEvidenceEntry,
	createEvidenceGroup,
	createPlaceholderEvidenceEntry,
	type ErrorData,
	type EvidenceCategory,
	type EvidenceEntry,
	type EvidenceGroup,
	type FailureData,
	type FileData,
	mergeEvidenceGroups,
	type SchedulingData,
	type SkipReason,
	type TestData,
} from "../core/diagnostic-packet.js";
