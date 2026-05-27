/**
 * Retention engine for telemetry event lifecycle management (25.B).
 *
 * Re-exports from the canonical implementation in `store/retention.ts`.
 * Direct imports from this module are supported for backward compatibility.
 *
 * @module observability/retention
 * @deprecated Import from `@earendil-works/pi-coding-agent` or `./store/retention.js` directly.
 */

export {
	DEFAULT_DEDUPE_CONFIG,
	DEFAULT_RETENTION_BUDGET,
	DEFAULT_RETENTION_POLICY,
	type DedupeConfig,
	type PruneResult,
	type RetentionBudget,
	RetentionEngine,
	type RetentionPolicy,
	type RetentionRule,
} from "./store/retention.js";
