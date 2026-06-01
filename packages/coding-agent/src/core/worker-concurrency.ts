/**
 * Compatibility shim — P40.2
 * @deprecated Import from @earendil-works/pi-execution-core
 */

export type {
	WorkerConcurrencySettings,
	WorkerConcurrencyValidationResult,
} from "@earendil-works/pi-execution-core";
export {
	checkPromotionGates,
	DEFAULT_WORKERS,
	formatWorkerConcurrencyValidation,
	isExperimentalWorkerCount,
	isStableWorkerCount,
	MAX_EXPERIMENTAL_WORKERS,
	MAX_STABLE_WORKERS,
	MIN_EXPERIMENTAL_WORKERS,
	MIN_STABLE_WORKERS,
	PROMOTION_GATES,
	requiresExperimentalMode,
	resolveEffectiveWorkerCount,
	validateWorkerConcurrency,
} from "@earendil-works/pi-execution-core";
