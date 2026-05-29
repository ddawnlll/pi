/**
 * Brain Context Module — V5.04 Context Builder & Memory Injection
 *
 * Barrel file re-exporting all public types and classes from the
 * context sub-modules.
 *
 * @packageDocumentation
 */

// Context Builder
export { ContextBuilder, createContextBuilder } from "./context-builder.js";

// Memory Injection Engine
export { createMemoryInjectionEngine, MemoryInjectionEngine } from "./injection.js";

// Context Types
export type {
	ContextBuildOptions,
	ContextPack,
	ContextPackBuiltPayload,
	ContextSource,
	ContextSourceType,
	IgnoredMemoryEntry,
	IgnoredReasonCode,
	InjectionBlockedPayload,
	InjectionComplianceCheck,
	InjectionComplianceResult,
	InjectionPolicyRules,
	MemoryInjectionInput,
	MemoryInjectionOptions,
	MemoryInjectionPayload,
	MemoryInjectionRecord,
	MemoryInjectionReport,
	RepeatedPatternSummary,
	StuckItemSummary,
	TemporalContext,
} from "./types.js";
export {
	ALL_CONTEXT_SOURCE_TYPES,
	ALL_IGNORED_REASON_CODES,
	DEFAULT_INJECTION_POLICY_RULES,
} from "./types.js";
