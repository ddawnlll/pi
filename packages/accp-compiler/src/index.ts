/**
 * ACCP v2.0 Compiler — Public API
 *
 * The standalone deterministic TypeScript compiler for ACCP v2.0 source files.
 * Transforms ACCP-YAML source into compiled JSON artifacts, route signals,
 * gate verdicts, and rendered Markdown.
 *
 * ## Design
 *
 * - Deterministic: same input always produces same output
 * - No LLM dependency: all validation, compilation, and emission is TypeScript
 * - Reusable: imported by coding-agent, TUI, CLI, CI, and runtime tools
 * - Independent: does NOT import coding-agent runtime modules
 *
 * ## Authority
 *
 * The compiler produces evidence and control-flow artifacts. It does NOT
 * authorize execution, mutation, or workspace transitions. Route signals
 * are advisory. Gate verdicts are diagnostic. Reports are evidence-only.
 *
 * @packageDocumentation
 */

// Template registry
import { AccpTemplateRegistry, defaultTemplateRegistry } from "./registry/template-registry.js";
export { AccpTemplateRegistry, defaultTemplateRegistry };

// Types re-exported from execution-contracts for convenience
export type {
	AccpArtifactRef,
	AccpCompileResult,
	AccpCompileStatus,
	AccpDiagnostic,
	AccpFinding,
	AccpGateVerdict,
	AccpIntermediateRepresentation,
	AccpReportFamily,
	AccpReportType,
	AccpRouteSignal,
	AccpSupportLevel,
} from "@earendil-works/pi-execution-contracts";
// Core compiler pipeline
export { compileAccpSource } from "./compiler.js";
export { type AccpCompiledArtifact, AccpCompilerPipeline } from "./compiler-pipeline.js";
export { compileGateVerdict } from "./emit/emit-gate-verdict.js";
// Route signal and gate verdict compilers
export { compileRouteSignal, type RouteSignalCompileOptions } from "./emit/emit-route-signal.js";
export { evaluateGate } from "./gate/gate-evaluator.js";
export { evaluatePromotion } from "./gate/promotion-evaluator.js";
export { checkRoutePolicy } from "./gate/route-policy.js";
export { extractAccpYaml } from "./parser/extractor.js";
// Parsers and validators
export { type AccpParsedReport, parseAccpYaml } from "./parser/yaml-parser.js";
// Registry
export {
	type AccpReportRegistryEntry,
	getGateCriticalReportTypes,
	getReportTypesByFamily,
	isKnownReportType,
	lookupReportType,
} from "./registry/report-registry.js";
export { ACCP_GATE_CRITICAL_TYPES, ACCP_SCHEMA_LITE_TYPES } from "./registry/support-matrix.js";
export { validateCommonSchema } from "./validation/common-schema-validator.js";
