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
export { AccpCompilerPipeline } from "./compiler-pipeline.js";
