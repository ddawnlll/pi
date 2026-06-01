/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports LocalPiWorkerAdapter from @earendil-works/pi-worker-adapters.
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from @earendil-works/pi-worker-adapters.
 *
 * @deprecated Import from @earendil-works/pi-worker-adapters instead
 */
export type { LocalPiWorkerAdapterConfig } from "@earendil-works/pi-worker-adapters";
export { createLocalPiWorkerAdapter, LocalPiWorkerAdapter } from "@earendil-works/pi-worker-adapters";
