/**
 * P44.6.16 — Production Runtime Scan Adapter Path
 *
 * Connects the existing runtime scan loop to exactly one production
 * adapter path with explicit degraded-mode reporting.
 *
 * The adapter ensures the runtime scan always goes through a single
 * production path rather than having multiple fallback paths that
 * could silently degrade behavior.
 *
 * Contract Schema: 4.1.1
 */

import type { EngineConfig } from "../core/mode/engine-mode.js";
import type { TaskIntentEnvelope } from "../core/mode/task-intent-envelope.js";
import { routeToolOperation, type ToolRuntimeAdapterResult } from "./tool-runtime-adapter.js";

// ---------------------------------------------------------------------------
// Degraded Mode
// ---------------------------------------------------------------------------

/**
 * Degraded mode states for the runtime scan.
 */
export type DegradedMode = "none" | "gate_bypassed" | "fallback_path" | "adapter_error";

/**
 * Report of a degraded mode condition.
 */
export interface DegradedModeReport {
	/** The degraded mode state. */
	mode: DegradedMode;
	/** Human-readable description of the degradation. */
	description: string;
	/** Whether the degradation is blocking or informational. */
	blocking: boolean;
}

// ---------------------------------------------------------------------------
// Scan Result
// ---------------------------------------------------------------------------

export interface RuntimeScanResult {
	/** The adapter result from the single production path. */
	adapterResult: ToolRuntimeAdapterResult | null;
	/** Whether the scan completed through the production path. */
	productionPathUsed: boolean;
	/** Degraded mode report, if applicable. */
	degradedMode: DegradedModeReport | null;
	/** Diagnostics from the scan. */
	diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Runtime Scan Adapter
// ---------------------------------------------------------------------------

/**
 * Run a single production scan through the P44.6 mode-aware adapter path.
 *
 * This adapter ensures there is exactly one path for runtime scans.
 * If that path fails, it reports degraded mode rather than silently
 * falling back to a secondary path.
 */
export function runProductionScan(config: EngineConfig, envelope: TaskIntentEnvelope): RuntimeScanResult {
	const diagnostics: string[] = [];

	try {
		// Single production path: routeToolOperation
		const result = routeToolOperation(config, envelope);

		if (!result.authorized) {
			return {
				adapterResult: result,
				productionPathUsed: true,
				degradedMode: null,
				diagnostics: [...diagnostics, `Tool operation blocked by gate for mode ${config.mode}`],
			};
		}

		return {
			adapterResult: result,
			productionPathUsed: true,
			degradedMode: null,
			diagnostics,
		};
	} catch (error) {
		// Degraded mode — adapter error
		return {
			adapterResult: null,
			productionPathUsed: false,
			degradedMode: {
				mode: "adapter_error",
				description: `Runtime scan adapter encountered an error: ${error instanceof Error ? error.message : String(error)}`,
				blocking: true,
			},
			diagnostics: [...diagnostics, `Adapter error: ${error instanceof Error ? error.message : String(error)}`],
		};
	}
}
