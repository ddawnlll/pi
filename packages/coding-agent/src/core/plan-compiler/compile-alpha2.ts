/**
 * Plan Compiler — Alpha2 Compilation Pipeline
 *
 * The canonical entrypoint for compiling a PlanSpec v5 Alpha2 JSON string
 * into an executable CompiledPlan.
 *
 * Pipeline:
 * 1. Source classification (empty, markdown, non-JSON)
 * 2. JSON parse (malformed, root type)
 * 3. Version/kind validation
 * 4. Schema validation (Zod strict)
 * 5. Semantic validation (duplicates, references)
 * 6. Graph validation (cycles)
 * 7. Command/security validation
 * 8. Completion validation
 * 9. Emission (CompiledPlan, WorkerPackets, PlanLock)
 */

import { classifySource, parseJson, validateAlpha2Schema, validateVersionAndKind } from "./alpha2/parse-alpha2-json.js";
import { failResult, okResult, type PlanCompileResult, type PlanDiagnostic } from "./diagnostics/diagnostic.js";
import { emitCompiledPlan } from "./emit/emit-compiled-plan.js";
import { emitPlanLock } from "./emit/emit-plan-lock.js";
import { emitWorkerPackets } from "./emit/emit-worker-packets.js";
import { validateAlpha2Commands } from "./validation/validate-alpha2-commands.js";
import { validateAlpha2Completion } from "./validation/validate-alpha2-completion.js";
import { validateAlpha2Graph } from "./validation/validate-alpha2-graph.js";
import { validateAlpha2Security } from "./validation/validate-alpha2-security.js";
import { validateAlpha2Semantics } from "./validation/validate-alpha2-semantics.js";

// =============================================================================
// Main entry
// =============================================================================

/**
 * Compile a PlanSpec v5 Alpha2 JSON string into an executable artifact.
 *
 * Returns a PlanCompileResult with:
 * - ok: true if compilation succeeded
 * - artifact: CompiledPlan (if ok)
 * - workerPackets: WorkerPacketV5[] (if ok)
 * - planLock: PlanLock (if ok)
 * - diagnostics: all diagnostics from every phase
 */
export function compilePlanSpecAlpha2(input: string): PlanCompileResult {
	const allDiagnostics: PlanDiagnostic[] = [];

	// =========================================================================
	// Phase 1: Source classification
	// =========================================================================
	const classifyDiags = classifySource(input);
	if (classifyDiags) {
		allDiagnostics.push(...classifyDiags);
		return failResult(allDiagnostics);
	}

	// =========================================================================
	// Phase 2: JSON parse
	// =========================================================================
	const { parsed, diagnostics: parseDiags } = parseJson(input);
	allDiagnostics.push(...parseDiags);
	if (!parsed) {
		return failResult(allDiagnostics);
	}

	const obj = parsed as Record<string, unknown>;

	// =========================================================================
	// Phase 3: Version and kind validation
	// =========================================================================
	const vkDiags = validateVersionAndKind(obj);
	allDiagnostics.push(...vkDiags);
	if (vkDiags.length > 0) {
		return failResult(allDiagnostics);
	}

	// =========================================================================
	// Phase 4: Schema validation
	// =========================================================================
	const { spec, diagnostics: schemaDiags } = validateAlpha2Schema(obj);
	allDiagnostics.push(...schemaDiags);
	if (!spec) {
		return failResult(allDiagnostics);
	}

	// =========================================================================
	// Phase 5: Semantic validation
	// =========================================================================
	const semanticDiags = validateAlpha2Semantics(spec);
	allDiagnostics.push(...semanticDiags);

	// =========================================================================
	// Phase 6: Graph validation
	// =========================================================================
	const graphDiags = validateAlpha2Graph(spec);
	allDiagnostics.push(...graphDiags);

	// =========================================================================
	// Phase 7: Command/security validation
	// =========================================================================
	const commandDiags = validateAlpha2Commands(spec);
	allDiagnostics.push(...commandDiags);

	const securityDiags = validateAlpha2Security(spec);
	allDiagnostics.push(...securityDiags);

	// =========================================================================
	// Phase 8: Completion validation
	// =========================================================================
	const completionDiags = validateAlpha2Completion(spec);
	allDiagnostics.push(...completionDiags);

	// Check for fatal or error diagnostics
	const hasBlocking = allDiagnostics.some((d) => d.severity === "error" || d.severity === "fatal");

	if (hasBlocking) {
		return failResult(allDiagnostics);
	}

	// =========================================================================
	// Phase 9: Emission
	// =========================================================================
	try {
		const compiledPlan = emitCompiledPlan(spec, allDiagnostics);
		const planLock = emitPlanLock(compiledPlan);
		const workerPackets = emitWorkerPackets(compiledPlan, planLock.planLockHash);

		// Attach worker packets and plan lock to the compiled plan
		compiledPlan.workerPackets = workerPackets;
		compiledPlan.planLock = planLock;

		return okResult(compiledPlan, workerPackets, planLock);
	} catch (e) {
		allDiagnostics.push({
			code: "E_EMISSION_FAILED" as import("./diagnostics/diagnostic-codes.js").PlanDiagnosticCode,
			severity: "fatal",
			phase: "emission",
			message: `Emission failed: ${(e as Error).message}`,
		});
		return failResult(allDiagnostics);
	}
}
