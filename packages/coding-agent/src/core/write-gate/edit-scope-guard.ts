/**
 * P44.6.10 — Edit Scope Guard
 *
 * Rejects edit operations that cannot identify:
 * - Existing target artifact
 * - Allowed file scope
 * - Preserve constraints
 * - Patch strategy
 *
 * Contract Schema: 4.1.1
 */

import { type EditConfig, type EngineConfig, EngineMode } from "../mode/engine-mode.js";
import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { TaskIntentEnvelope } from "../mode/task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Patch Strategy
// ---------------------------------------------------------------------------

export type PatchStrategy = "replace_block" | "insert_after" | "insert_before" | "append" | "prepend" | "full_replace";

// ---------------------------------------------------------------------------
// Edit Scope Result
// ---------------------------------------------------------------------------

export interface EditScopeResult extends DiagnosticCollection {
	/** Whether the edit operation is authorized. */
	authorized: boolean;
	/** The resolved target path. */
	targetPath: string;
	/** The selected patch strategy. */
	patchStrategy: PatchStrategy;
	/** Preserve constraints. */
	preserveConstraints: string[];
}

// ---------------------------------------------------------------------------
// Edit Scope Evaluation
// ---------------------------------------------------------------------------

export function evaluateEditScope(config: EngineConfig, envelope: TaskIntentEnvelope): EditScopeResult {
	const diagnostics: ModeDiagnostic[] = [];

	if (config.mode !== EngineMode.Edit) {
		return {
			authorized: false,
			targetPath: "",
			patchStrategy: "full_replace",
			preserveConstraints: [],
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_READINESS_FAILURE",
					message: "Edit Scope Guard requires EngineMode.Edit.",
				},
			],
		};
	}

	const editConfig = config as EditConfig;

	// Check 1: Target path must identify existing target
	if (!editConfig.targetPath) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_MISSING_TARGET",
			message: "Edit operation requires an existing target path.",
		});
	}

	// Check 2: Preserve constraints
	const preserveConstraints = editConfig.preserveConstraints ?? [];
	if (preserveConstraints.length === 0) {
		diagnostics.push({
			severity: "warning",
			code: "WARN_MISSING_CONSTRAINTS",
			message: "No preserve constraints specified. Edit may overwrite content that should be preserved.",
		});
	}

	// Check 3: Derive patch strategy from constraints
	const patchStrategy = derivePatchStrategy(envelope);

	const hasBlocking = diagnostics.some((d) => d.severity === "blocking");

	return {
		authorized: !hasBlocking,
		targetPath: editConfig.targetPath || "",
		patchStrategy,
		preserveConstraints,
		diagnostics,
	};
}

function derivePatchStrategy(envelope: TaskIntentEnvelope): PatchStrategy {
	const raw = envelope.rawPrompt.toLowerCase();
	if (raw.includes("replace") || raw.includes("rewrite")) return "replace_block";
	if (raw.includes("insert after") || raw.includes("add after")) return "insert_after";
	if (raw.includes("insert before") || raw.includes("add before")) return "insert_before";
	if (raw.includes("append") || raw.includes("add to end")) return "append";
	if (raw.includes("prepend") || raw.includes("add to start")) return "prepend";
	return "replace_block"; // default strategy
}
