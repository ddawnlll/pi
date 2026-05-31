/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports worker adapter types and implementations from
 * @earendil-works/pi-execution-core and @earendil-works/pi-worker-adapters.
 *
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from the new packages.
 *
 * @deprecated Import from @earendil-works/pi-execution-core or @earendil-works/pi-worker-adapters instead
 */
export type {
	WorkerAdapter,
	WorkerRunRequest,
	WorkerRunResult,
	WorkerVerdict,
	WorkerEvent,
	WorkerCommandHistoryEntry,
	WorkerAdapterCapabilities,
} from "@earendil-works/pi-execution-core";
export type { LocalPiWorkerAdapterConfig } from "@earendil-works/pi-worker-adapters";
export { LocalPiWorkerAdapter, createLocalPiWorkerAdapter } from "@earendil-works/pi-worker-adapters";
