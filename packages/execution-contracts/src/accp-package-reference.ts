/**
 * ACCP v2.0 Package Reference
 *
 * Exposes typed constants that describe the repository-root `accp_v2_0_package/`
 * directory layout. This package is a **design-time and fixture source** for ACCP v2.0
 * documentation, examples, prompt contracts, registry metadata, and schema sketches.
 *
 * ## Authority
 *
 * This module does not provide runtime authority. Raw YAML from the package must never
 * be parsed at runtime for execution decisions. Compiled TypeScript modules and compiled
 * ACCP JSON artifacts (compiled.json, route-signal.json, gate-verdict.json) are the
 * sole machine-readable authority inputs.
 *
 * ## Usage
 *
 * Import these constants to reference package subdirectories rather than hard-coding
 * paths. The package itself must never be mutated by any P49 (or later) workspace.
 *
 * @packageDocumentation
 */

/** Absolute root of the ACCP v2.0 local source package. */
export const ACCP_V2_PACKAGE_ROOT = "accp_v2_0_package" as const;

/** Subdirectory: documentation, addenda, compiler profiles. */
export const ACCP_V2_PACKAGE_DOCS = `${ACCP_V2_PACKAGE_ROOT}/docs` as const;

/** Subdirectory: example ACCP YAML files used as fixtures. */
export const ACCP_V2_PACKAGE_EXAMPLES = `${ACCP_V2_PACKAGE_ROOT}/examples` as const;

/** Subdirectory: prompt contract templates (BSR, FPR, PRR, TVR, repair). */
export const ACCP_V2_PACKAGE_PROMPTS = `${ACCP_V2_PACKAGE_ROOT}/prompts` as const;

/** Subdirectory: registry metadata (report types, diagnostic codes, support matrix). */
export const ACCP_V2_PACKAGE_REGISTRY = `${ACCP_V2_PACKAGE_ROOT}/registry` as const;

/** Subdirectory: JSON Schema sketches for common, BSR, gate verdict, route signal. */
export const ACCP_V2_PACKAGE_SCHEMAS = `${ACCP_V2_PACKAGE_ROOT}/schemas` as const;

/**
 * Canonical README for the package.
 */
export const ACCP_V2_PACKAGE_README = `${ACCP_V2_PACKAGE_ROOT}/README.md` as const;

/**
 * All known package paths for iteration or validation.
 */
export const ACCP_V2_PACKAGE_PATHS: readonly string[] = [
	ACCP_V2_PACKAGE_ROOT,
	ACCP_V2_PACKAGE_DOCS,
	ACCP_V2_PACKAGE_EXAMPLES,
	ACCP_V2_PACKAGE_PROMPTS,
	ACCP_V2_PACKAGE_REGISTRY,
	ACCP_V2_PACKAGE_SCHEMAS,
	ACCP_V2_PACKAGE_README,
] as const;

/**
 * Human-readable description of the package role.
 */
export const ACCP_V2_PACKAGE_DESCRIPTION = "Design-time and fixture source for ACCP v2.0 — read-only in P49." as const;
