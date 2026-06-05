/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports worker adapter types and implementations from
 * @earendil-works/pi-execution-contracts and @earendil-works/pi-worker-adapters.
 *
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from the new packages.
 *
 * @deprecated Import from @earendil-works/pi-execution-contracts or @earendil-works/pi-worker-adapters instead
 */
export type {
	WorkerAdapter,
	WorkerAdapterCapabilities,
	WorkerCommandHistoryEntry,
	WorkerEvent,
	WorkerRunRequest,
	WorkerRunResult,
	WorkerVerdict,
} from "@earendil-works/pi-execution-contracts";
export type { LocalPiWorkerAdapterConfig } from "@earendil-works/pi-worker-adapters";
export { createLocalPiWorkerAdapter, LocalPiWorkerAdapter } from "@earendil-works/pi-worker-adapters";
