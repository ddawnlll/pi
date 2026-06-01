/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports WorkerAdapter types from @earendil-works/pi-execution-core.
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from @earendil-works/pi-execution-core.
 *
 * @deprecated Import from @earendil-works/pi-execution-core instead
 */
export type {
	WorkerAdapter,
	WorkerAdapterCapabilities,
	WorkerCommandHistoryEntry,
	WorkerEvent,
	WorkerRunRequest,
	WorkerRunResult,
	WorkerVerdict,
} from "@earendil-works/pi-execution-core";
