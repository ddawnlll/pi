/**
 * Brain Memory Module
 *
 * Barrel file re-exporting all public types and classes
 * from the memory sub-modules.
 */

export type { LifecycleConfig, LifecycleTransition } from "./lifecycle.js";
// Memory Lifecycle Engine (P14.C)
export { MemoryLifecycleEngine } from "./lifecycle.js";
export type { MemoryIndex, MemoryIndexEntry, MemoryStoreConfig } from "./store.js";
// Memory Store (P14.B)
export { MemoryStore } from "./store.js";

// Memory Domain Model (P14.A) — re-exported for convenience
export type {
	MemoryConflict,
	MemoryLifecycle,
	MemoryProvenance,
	MemoryQuery,
	MemoryRecord,
	MemoryScore,
	MemorySourceRef,
	MemoryStats,
	MemoryType,
	ValidationResult,
} from "./types.js";
export {
	ALL_CONFLICT_TYPES,
	ALL_MEMORY_LIFECYCLES,
	ALL_MEMORY_SOURCE_REF_TYPES,
	ALL_MEMORY_TYPES,
	ALL_RESOLUTION_TYPES,
	ALL_VALIDATED_BY,
	computeMemoryScore,
	computeMemoryStats,
	createMemoryConflict,
	createMemoryRecord,
	deserializeMemoryConflict,
	deserializeMemoryRecord,
	MAX_QUERY_LIMIT,
	serializeMemoryConflict,
	serializeMemoryRecord,
	validateMemoryConflict,
	validateMemoryQuery,
	validateMemoryRecord,
} from "./types.js";
