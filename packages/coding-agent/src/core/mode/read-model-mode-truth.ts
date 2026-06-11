/**
 * P44.6.26 — Read Model Mode Truth Fields
 *
 * Authoritative mode, gate verdict, diagnostics, route signal,
 * and evidence state exposed through the read model.
 *
 * Contract Schema: 4.1.1
 */

import type { RouteSignal } from "../smart-write/route-signal-compiler.js";
import type { EngineMode } from "./engine-mode.js";
import type { ModeDiagnostic } from "./mode-diagnostic.js";
import type { ReadinessVerdict } from "./readiness-gate.js";

// ---------------------------------------------------------------------------
// Mode Truth
// ---------------------------------------------------------------------------

export interface ModeTruth {
	/** The currently active engine mode. */
	activeMode: EngineMode | null;
	/** The last readiness gate verdict. */
	gateVerdict: ReadinessVerdict | null;
	/** Current diagnostics. */
	diagnostics: ModeDiagnostic[];
	/** Blocking diagnostics shortcut. */
	blockingDiagnostics: ModeDiagnostic[];
	/** The last compiled route signal. */
	routeSignal: RouteSignal | null;
	/** Whether the mode pipeline is ready. */
	ready: boolean;
	/** Timestamp of the last mode update (epoch ms). */
	lastUpdated: number;
}
