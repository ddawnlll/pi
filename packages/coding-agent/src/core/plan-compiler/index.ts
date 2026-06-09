/**
 * Plan Compiler — Public API
 *
 * The canonical entrypoint for PlanSpec v5 Alpha2 compilation.
 */

// Alpha2 types (for consumers that need the validated spec)
export type { PlanSpecV5Alpha2 } from "./alpha2/alpha2-types.js";
// Main compile function
export { compilePlanSpecAlpha2 } from "./compile-alpha2.js";
// Types
export type {
	PlanCompileResult,
	PlanCompilerPhase,
	PlanDiagnostic,
	PlanDiagnosticSeverity,
	PlanDiagnosticSourceSpan,
} from "./diagnostics/diagnostic.js";
export { PlanDiagnosticCode } from "./diagnostics/diagnostic-codes.js";
export type { DiagnosticSummary } from "./diagnostics/format-diagnostics.js";
// Diagnostics formatting
export { formatDiagnostics, formatDiagnosticsJson, summarizeDiagnostics } from "./diagnostics/format-diagnostics.js";
// Temporary migration adapter
export { compiledPlanToWorkspaceQueue } from "./emit/compiled-plan-to-workspace-queue.js";
// Compiled plan types
export type {
	CompiledCommandPolicy,
	CompiledCompletion,
	CompiledExecution,
	CompiledFilePolicy,
	CompiledPlan,
	CompiledTask,
	CompiledWave,
	CompiledWorkspace,
	ExecutionBatch,
} from "./emit/compiled-plan-types.js";
