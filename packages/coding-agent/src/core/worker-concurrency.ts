/**
 * Compatibility shim — P40.2
 * @deprecated Import from @earendil-works/pi-execution-core
 */
export {
	MIN_STABLE_WORKERS,
	MAX_STABLE_WORKERS,
	MIN_EXPERIMENTAL_WORKERS,
	MAX_EXPERIMENTAL_WORKERS,
	DEFAULT_WORKERS,
	PROMOTION_GATES,
	checkPromotionGates,
	isStableWorkerCount,
	isExperimentalWorkerCount,
	requiresExperimentalMode,
	validateWorkerConcurrency,
	resolveEffectiveWorkerCount,
	formatWorkerConcurrencyValidation,
} from "@earendil-works/pi-execution-core";
export type {
	WorkerConcurrencySettings,
	WorkerConcurrencyValidationResult,
} from "@earendil-works/pi-execution-core";
