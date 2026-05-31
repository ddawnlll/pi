/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports query handler from @earendil-works/pi-execution-service.
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from @earendil-works/pi-execution-service.
 *
 * @deprecated Import from @earendil-works/pi-execution-service instead
 */
export { createExecutionReadModel } from "@earendil-works/pi-execution-service";
