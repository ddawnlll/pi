import type { AccpCompileResult } from "@earendil-works/pi-execution-contracts";
import { AccpCompilerPipeline } from "./compiler-pipeline.js";

/**
 * Compile an ACCP v2.0 YAML source document into structured artifacts.
 *
 * This is the top-level entry point. It delegates to AccpCompilerPipeline
 * for the full compilation lifecycle.
 *
 * @param sourceYaml - Raw ACCP-YAML source string.
 * @param sourcePath - Optional source file path (for diagnostics).
 * @returns Compilation result with status, diagnostics, and artifact paths.
 */
export function compileAccpSource(sourceYaml: string, sourcePath?: string): AccpCompileResult {
	const pipeline = new AccpCompilerPipeline(sourceYaml, sourcePath);
	return pipeline.execute();
}
