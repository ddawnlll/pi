/**
 * P43 Token Context Runtime - Barrel Export
 */

export type { ACROptions } from "./active-context-registry.js";
export { ActiveContextRegistry } from "./active-context-registry.js";
// Adapters
export { GenericFallbackAdapter, LLMFallbackAdapter } from "./adapters/fallback.js";
export { JsonYamlAdapter } from "./adapters/json-yaml.js";
export { PythonAdapter } from "./adapters/python.js";
export { RustAdapter } from "./adapters/rust.js";
export { TypeScriptAdapter } from "./adapters/typescript.js";
export type { ChangeLedgerOptions } from "./change-ledger.js";
export { ChangeLedger } from "./change-ledger.js";
export { CONTRACT_GOLDEN, checkContractCompatibility, P43_CONTRACT_VERSION } from "./contract-version.js";
export { buildEditRecoveryPacket, formatRecoveryPacket } from "./edit-recovery.js";
export type {
	EditRecoveryCandidate,
	EditRecoveryConfig,
	EditRecoveryMetrics,
	EditRecoveryPacket,
} from "./edit-recovery-types.js";
export { DEFAULT_EDIT_RECOVERY_CONFIG, EditRecoveryMetricsTracker } from "./edit-recovery-types.js";
export type {
	GrammarCapability,
	GrammarPreflightReport,
	SmartReadProviderPreflightEntry,
	SmartReadProviderPreflightReport,
} from "./grammar-preflight.js";
export { runGrammarPreflight, runSmartReadProviderPreflight } from "./grammar-preflight.js";
export type { FixtureClass, LabComparisonReport, LabFixture, LabOperation, LabRunResult } from "./lab-harness.js";
export { GAUNTLET_FIXTURES, LabHarness } from "./lab-harness.js";
export { JsonNativeProvider } from "./providers/json-native-provider.js";
export { PyrightProvider } from "./providers/pyright-provider.js";
export { TreeSitterWasmProvider } from "./providers/tree-sitter-wasm-provider.js";
// Providers (v2)
export { TypeScriptCompilerProvider } from "./providers/typescript-compiler-provider.js";
export { YamlNativeProvider } from "./providers/yaml-native-provider.js";
export type { RawCacheOptions } from "./raw-cache.js";
export { RawCache } from "./raw-cache.js";
export type { ReadHashCacheOptions } from "./read-hash-cache.js";
export { ReadHashCache } from "./read-hash-cache.js";
export type {
	AfterReadResult,
	MutationCheckResult,
	ReadInterceptResult,
	TokenContextRuntime,
} from "./runtime.js";
export { createTokenContextRuntime, detectRtkHook } from "./runtime.js";
export type { MechanismSavingsSummary, SavingsSummary, ToolSavingsSummary } from "./savings-ledger.js";
export { SavingsLedger } from "./savings-ledger.js";
export { SmartReadCore } from "./smart-read-core.js";
export type { CalibrationReport, ProviderCalibrationStatus } from "./token-estimator.js";
export { TokenEstimator } from "./token-estimator.js";

export type {
	ACRLedgerPolicyResult,
	ACRState,
	ActiveContextEntry,
	ChangeLedgerEvent,
	LedgerState,
	ProviderUsageRecord,
	RawCacheHandle,
	RawCacheStats,
	ReadSnapshot,
	SavingsConfidence,
	SavingsMechanism,
	SmartReadAdapter,
	SmartReadMode,
	SmartReadParseSource,
	SmartReadProvider,
	SmartReadProviderCapabilities,
	SmartReadProviderPlan,
	SmartReadProviderPlanEntry,
	SmartReadResult,
	TokenContextConfig,
	TokenContextMode,
	TokenEstimate,
	TokenSavingEvent,
} from "./types.js";
export {
	ACR_LEDGER_POLICY,
	DEFAULT_TOKEN_CONTEXT_CONFIG,
	getACRLedgerPolicy,
	isMutationSafeSmartReadResult,
	SMART_READ_CONFIDENCE,
	withProviderTimeout,
} from "./types.js";
