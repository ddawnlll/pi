/**
 * Telemetry Query API — high-level aggregation and statistics (25.B).
 *
 * Re-exports from the canonical implementation in `store/query.ts`.
 * Direct imports from this module are supported for backward compatibility.
 *
 * @module observability/query-api
 * @deprecated Import from `@earendil-works/pi-coding-agent` or `./store/query.js` directly.
 */

export {
	type Aggregation,
	type AggregationFunction,
	type AggregationResult,
	type ErrorAnalysis,
	type EventStatistics,
	type TelemetryQuery,
	TelemetryQueryApi,
	type TimeBucketConfig,
	type TimeSeriesPoint,
	type TimeSeriesResult,
} from "./store/query.js";
