/**
 * P44.6.13 — Tool Runtime Write/Edit Adapter
 *
 * Routes production write and edit tool paths through P44.6 mode-aware
 * gates rather than bypassing via helper APIs.
 *
 * This adapter sits between the tool execution layer and the actual
 * file system operations. It intercepts write and edit calls,
 * routes them through the appropriate gate (WriteGate v2, Edit Scope
 * Guard, etc.), and only proceeds when the gate authorizes the operation.
 *
 * Contract Schema: 4.1.1
 */

import { type EngineConfig, EngineMode } from "../core/mode/engine-mode.js";
import type { ModeDiagnostic } from "../core/mode/mode-diagnostic.js";
import type { TaskIntentEnvelope } from "../core/mode/task-intent-envelope.js";
import { type EditScopeResult, evaluateEditScope } from "../core/write-gate/edit-scope-guard.js";
import { evaluateWriteGate, type WriteGateResult } from "../core/write-gate/write-gate-v2.js";

// ---------------------------------------------------------------------------
// Adapter Result
// ---------------------------------------------------------------------------

export type ToolOperation = "write" | "edit" | "smart_write" | "smart_edit" | "blocked";

export interface ToolRuntimeAdapterResult {
	/** The authorized operation, or "blocked" if gate rejected. */
	operation: ToolOperation;
	/** The gate result that authorized or rejected the operation. */
	gateResult: WriteGateResult | EditScopeResult | null;
	/** Diagnostics from the gating process. */
	diagnostics: ModeDiagnostic[];
	/** Whether the operation is authorized. */
	authorized: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function routeToolOperation(config: EngineConfig, envelope: TaskIntentEnvelope): ToolRuntimeAdapterResult {
	switch (config.mode) {
		case EngineMode.Write: {
			const gateResult = evaluateWriteGate(config, envelope);
			return {
				operation: gateResult.authorized ? "write" : "blocked",
				gateResult,
				diagnostics: gateResult.diagnostics,
				authorized: gateResult.authorized,
			};
		}
		case EngineMode.Edit: {
			const gateResult = evaluateEditScope(config, envelope);
			return {
				operation: gateResult.authorized ? "edit" : "blocked",
				gateResult,
				diagnostics: gateResult.diagnostics,
				authorized: gateResult.authorized,
			};
		}
		case EngineMode.SmartWrite:
			return {
				operation: "smart_write",
				gateResult: null,
				diagnostics: [],
				authorized: true,
			};
		case EngineMode.SmartEdit:
			return {
				operation: "smart_edit",
				gateResult: null,
				diagnostics: [],
				authorized: true,
			};
	}
}
