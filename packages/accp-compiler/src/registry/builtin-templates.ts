/**
 * ACCP Built-in Prompt Templates
 *
 * Pre-loaded compact prompt contracts for the ACCP compiler.
 * These are loaded into the template registry at startup.
 *
 * @packageDocumentation
 */

import { AccpTemplateRegistry } from "./template-registry.js";

/**
 * Load all built-in templates into a registry.
 */
export function loadBuiltinTemplates(_registry: AccpTemplateRegistry): void {
	// Built-in templates are registered by the constructor of AccpTemplateRegistry.
	// This function exists as a hook for future auto-loading.
	// Currently all 5 built-in contracts (bsr, fpr, tvr, prr, repair) are registered.
}

/**
 * Get the default ACCP template registry with all builtin templates loaded.
 */
export function createDefaultTemplateRegistry(): AccpTemplateRegistry {
	return new AccpTemplateRegistry();
}
