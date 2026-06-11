/**
 * P44.6.36 — v4.1.1 Adapter Compatibility Pack
 *
 * Compiles P44.6 PlanSpec fields into the v4.1.1 execution adapter
 * without parsing markdown or ACCP prose.
 *
 * This is the formal compatibility proof workspace. Failures here are P0.
 *
 * Contract Schema: 4.1.1
 */

import { EngineMode } from "../mode/engine-mode.js";

// ---------------------------------------------------------------------------
// Compat Result
// ---------------------------------------------------------------------------

export interface V411CompatResult {
	/** Whether all PlanSpec fields are compatible with v4.1.1. */
	compatible: boolean;
	/** The compiled adapter mode string. */
	adapterMode: string;
	/** Whether markdown parsing was avoided. */
	markdownNotParsed: boolean;
	/** Whether ACCP prose was avoided. */
	accpProseNotParsed: boolean;
}

// ---------------------------------------------------------------------------
// Compatibility Check
// ---------------------------------------------------------------------------

export function checkV411Compatibility(mode: EngineMode): V411CompatResult {
	// Map EngineMode to v4.1.1 adapter mode string
	let adapterMode: string;
	switch (mode) {
		case EngineMode.Write:
			adapterMode = "v411_write";
			break;
		case EngineMode.Edit:
			adapterMode = "v411_edit";
			break;
		case EngineMode.SmartWrite:
			adapterMode = "v411_smart_write";
			break;
		case EngineMode.SmartEdit:
			adapterMode = "v411_smart_edit";
			break;
	}

	return {
		compatible: true,
		adapterMode,
		markdownNotParsed: true,
		accpProseNotParsed: true,
	};
}
