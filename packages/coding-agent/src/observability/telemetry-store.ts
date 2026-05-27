/**
 * Telemetry Store — local in-memory store for telemetry events (25.B).
 *
 * Re-exports from the canonical implementation in `store/telemetry-store.ts`.
 * Direct imports from this module are supported for backward compatibility.
 *
 * @module observability/telemetry-store
 * @deprecated Import from `@earendil-works/pi-coding-agent` or `./store/telemetry-store.js` directly.
 */

export {
	DEFAULT_TELEMETRY_STORE_CONFIG,
	type FlushResult,
	InMemoryTelemetryStore,
	type TelemetryFlushTarget,
	type TelemetryQueryFilter,
	type TelemetryStoreConfig,
	type TelemetryStoreDiagnostics,
} from "./store/telemetry-store.js";
