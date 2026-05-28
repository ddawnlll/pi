/**
 * Brain V5 — Config module.
 *
 * Reads V5 settings from the SettingsManager and derives the current
 * operating mode. This is the single source of truth for all V5 code
 * paths when determining capability.
 *
 * @packageDocumentation
 */

import type { SettingsManager } from "../../core/settings-manager.js";
import type { BrainV5Config, BrainV5Mode } from "./types.js";

// =========================================================================
// V5 Config Resolver
// =========================================================================

/**
 * Resolve the full BrainV5Config from a SettingsManager.
 *
 * This is the only function that should read brainV5 settings from
 * the settings manager. All V5 modules consume config through this.
 *
 * @param settings - The active SettingsManager instance
 * @returns A fully resolved BrainV5Config
 */
export function resolveBrainV5Config(settings: SettingsManager): BrainV5Config {
	const raw = settings.getBrainV5Settings();
	const mode = deriveBrainV5Mode(
		raw.enabled ?? false,
		raw.readOnlyMode ?? true,
		raw.pushEnabled ?? false,
		raw.overnightOperatorEnabled ?? false,
	);

	return {
		enabled: raw.enabled ?? false,
		readOnlyMode: raw.readOnlyMode ?? true,
		pushEnabled: raw.pushEnabled ?? false,
		overnightOperatorEnabled: raw.overnightOperatorEnabled ?? false,
		mode,
	};
}

// =========================================================================
// Mode Derivation
// =========================================================================

/**
 * Derive the effective BrainV5Mode from the four raw capability flags.
 *
 * Logic:
 * - If not enabled → OFF
 * - If enabled + readOnlyMode → READ_ONLY (reads only, no events)
 * - If enabled + !readOnlyMode + !pushEnabled → ADVISORY (can emit events but not push)
 * - If enabled + !readOnlyMode + pushEnabled + !overnight → DRAFTING (can push approved changes)
 * - If enabled + !readOnlyMode + pushEnabled + overnight → OPERATOR_READY (full autonomous)
 */
export function deriveBrainV5Mode(
	enabled: boolean,
	readOnlyMode: boolean,
	pushEnabled: boolean,
	overnightOperatorEnabled: boolean,
): BrainV5Mode {
	if (!enabled) return "OFF";
	if (readOnlyMode) return "READ_ONLY";
	if (!pushEnabled) return "ADVISORY";
	if (!overnightOperatorEnabled) return "DRAFTING";
	return "OPERATOR_READY";
}

// =========================================================================
// Capability Checks
// =========================================================================

/**
 * Check if V5 is enabled at all.
 */
export function isV5Enabled(config: BrainV5Config): boolean {
	return config.enabled;
}

/**
 * Shortcut: check if V5 can emit any kind of event.
 * This is true for all modes except OFF and READ_ONLY.
 */
export function canV5EmitEvents(config: BrainV5Config): boolean {
	return config.mode !== "OFF" && config.mode !== "READ_ONLY";
}

/**
 * Shortcut: check if V5 can push approved changes to execution.
 * Requires DRAFTING or higher.
 */
export function canV5Push(config: BrainV5Config): boolean {
	return config.mode === "DRAFTING" || config.mode === "OPERATOR_READY";
}

/**
 * Shortcut: check if V5 can run overnight operator sessions.
 * Requires OPERATOR_READY.
 */
export function canV5RunOvernight(config: BrainV5Config): boolean {
	return config.mode === "OPERATOR_READY";
}
