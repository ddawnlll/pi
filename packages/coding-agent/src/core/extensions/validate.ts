/**
 * Extension package manifest validation and version compatibility checking.
 *
 * Provides semver parsing and range matching for extension engines and
 * dependency constraints without external dependencies.
 */

// ============================================================================
// Semver parsing and matching (lightweight, no external deps)
// ============================================================================

interface Semver {
	major: number;
	minor: number;
	patch: number;
	prerelease: string | undefined;
}

/**
 * Parse a semver version string into its components.
 * Returns null for invalid versions.
 */
function parseSemver(version: string): Semver | null {
	const cleaned = version.trim().replace(/^v/i, "");
	const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([a-zA-Z0-9.-]+))?$/.exec(cleaned);
	if (!match) return null;

	const major = Number.parseInt(match[1], 10);
	const minor = match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
	const patch = match[3] !== undefined ? Number.parseInt(match[3], 10) : 0;
	const prerelease = match[4] || undefined;

	if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return null;

	return { major, minor, patch, prerelease };
}

/**
 * Compare two semver versions.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
function compareSemver(a: Semver, b: Semver): number {
	if (a.major !== b.major) return a.major > b.major ? 1 : -1;
	if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
	if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

	// No prerelease > has prerelease
	if (a.prerelease === b.prerelease) return 0;
	if (a.prerelease === undefined) return 1;
	if (b.prerelease === undefined) return -1;
	return a.prerelease > b.prerelease ? 1 : -1;
}

/**
 * Parse a semver range string into a predicate function.
 *
 * Supports:
 * - Exact: "1.2.3"
 * - Caret: "^1.2.3" (compatible with 1.x)
 * - Tilde: "~1.2.3" (patch-level changes)
 * - Wildcard: "1.x", "1.*", "x"
 * - Compound ranges separated by `||`
 * - Hyphen ranges: "1.0.0 - 2.0.0"
 * - Comparison operators: ">=1.0.0", "<2.0.0"
 */
function parseRange(range: string): ((v: Semver) => boolean) | null {
	const trimmed = range.trim().toLowerCase();

	// Handle OR (||) — first match wins
	if (trimmed.includes("||")) {
		const parts = trimmed.split("||").map((p) => p.trim());
		const predicates = parts.map(parseRange).filter(Boolean) as ((v: Semver) => boolean)[];
		if (predicates.length === 0) return null;
		return (v: Semver) => predicates.some((p) => p(v));
	}

	// Handle AND (space-separated comparisons like ">=1.0.0 <2.0.0")
	const andParts = trimmed.split(/\s+/);
	if (andParts.length >= 2 && andParts.every((p) => /^[<>=!]=?/.test(p) || /^\d/.test(p))) {
		const andPredicates = andParts.map(parseRange).filter(Boolean) as ((v: Semver) => boolean)[];
		if (andPredicates.length === 0) return null;
		return (v: Semver) => andPredicates.every((p) => p(v));
	}

	// Handle hyphen ranges: "1.0.0 - 2.0.0"
	const hyphenMatch = /^(.+?)\s*-\s*(.+)$/.exec(trimmed);
	if (hyphenMatch) {
		const low = parseRange(`>=${hyphenMatch[1]}`) as (v: Semver) => boolean;
		const high = parseRange(`<=${hyphenMatch[2]}`) as (v: Semver) => boolean;
		if (!low || !high) return null;
		return (v: Semver) => low(v) && high(v);
	}

	// Comparison operators: >=, <=, >, <, =, !=
	const opMatch = /^(>=|<=|!=|>|<|=)?(.+)$/.exec(trimmed);
	if (opMatch) {
		const op = opMatch[1] || "=";
		const verStr = opMatch[2].trim();
		const ver = parseSemver(verStr);
		if (!ver) return null;

		return (v: Semver) => {
			const cmp = compareSemver(v, ver);
			switch (op) {
				case ">=":
					return cmp >= 0;
				case "<=":
					return cmp <= 0;
				case ">":
					return cmp > 0;
				case "<":
					return cmp < 0;
				case "!=":
					return cmp !== 0;
				case "=":
				default:
					return cmp === 0;
			}
		};
	}

	// Caret: ^1.2.3
	const caretMatch = /^\^(.*)$/.exec(trimmed);
	if (caretMatch) {
		const ver = parseSemver(caretMatch[1]);
		if (!ver) return null;
		return (v: Semver) => {
			if (v.major !== ver.major) return false;
			if (ver.major !== 0) return v.minor >= ver.minor;
			// For 0.x, only allow patch-level changes
			if (v.minor !== ver.minor) return false;
			return v.patch >= ver.patch;
		};
	}

	// Tilde: ~1.2.3
	const tildeMatch = /^~(.*)$/.exec(trimmed);
	if (tildeMatch) {
		const ver = parseSemver(tildeMatch[1]);
		if (!ver) return null;
		return (v: Semver) => {
			if (v.major !== ver.major) return false;
			if (v.minor !== ver.minor) return false;
			return v.patch >= ver.patch;
		};
	}

	// Wildcard: "1.x", "1.*", "x", "*"
	if (trimmed === "*" || trimmed === "x") {
		return () => true;
	}
	const wildcardMatch = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(trimmed);
	if (wildcardMatch) {
		const major = Number.parseInt(wildcardMatch[1], 10);
		const minorStr = wildcardMatch[2];
		const patchStr = wildcardMatch[3];

		if (Number.isNaN(major)) return null;

		// 1.x or 1.*
		if (minorStr === "x" || minorStr === "*") {
			return (v: Semver) => v.major === major;
		}

		if (minorStr !== undefined) {
			const minor = Number.parseInt(minorStr, 10);
			if (Number.isNaN(minor)) return null;

			// 1.2.x
			if (patchStr === "x" || patchStr === "*") {
				return (v: Semver) => v.major === major && v.minor === minor;
			}

			if (patchStr !== undefined) {
				const patch = Number.parseInt(patchStr, 10);
				if (Number.isNaN(patch)) return null;
				return (v: Semver) => v.major === major && v.minor === minor && v.patch === patch;
			}
		}

		// Bare number gets exact match (same as "=1.0.0")
		return (v: Semver) => v.major === major;
	}

	// Fallback: try exact version
	const exact = parseSemver(trimmed);
	if (exact) {
		return (v: Semver) => compareSemver(v, exact) === 0;
	}

	return null;
}

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Public API
// ============================================================================

// Lazy-cached pi version
let _piVersion: string | undefined;

/** Set pi version explicitly (for testing). */
export function setPiVersion(version: string): void {
	_piVersion = version;
}

/** Get the current pi version. */
export function getPiVersion(): string {
	if (_piVersion) return _piVersion;
	_piVersion = readPiVersion();
	return _piVersion;
}

function readPiVersion(): string {
	try {
		// Walk up from dist/core/extensions/validate.js or src/core/extensions/validate.ts
		let dir = path.dirname(fileURLToPath(import.meta.url));
		// Navigate up from extensions/ -> core/ -> src/ -> package root
		for (let i = 0; i < 4; i++) {
			dir = path.dirname(dir);
		}
		const pkgPath = path.join(dir, "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		return pkg.version || "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/**
 * Check whether a version string satisfies a semver range.
 *
 * @param version - The version to check (e.g. "1.2.3")
 * @param range - The semver range (e.g. "^1.0.0", ">=1.0.0 <2.0.0")
 * @returns true if the version satisfies the range
 */
export function satisfies(version: string, range: string): boolean {
	const semver = parseSemver(version);
	if (!semver) return false;

	const predicate = parseRange(range);
	if (!predicate) return false;

	return predicate(semver);
}

/**
 * Validate that a version string looks like a valid semver.
 */
export function isValidSemver(version: string): boolean {
	return parseSemver(version) !== null;
}

/**
 * Validate an extension package manifest.
 * Returns an error string if invalid, or null if valid.
 */
export function validateManifest(
	manifest: Record<string, unknown>,
): string | null {
	if (!manifest.name || typeof manifest.name !== "string") {
		return "Manifest must have a 'name' field (string)";
	}

	if (!manifest.name.startsWith("@") && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(manifest.name)) {
		return "Extension name must start with a letter and contain only letters, digits, hyphens, and underscores";
	}

	if (!manifest.version || typeof manifest.version !== "string") {
		return "Manifest must have a 'version' field (string)";
	}

	if (!isValidSemver(manifest.version)) {
		return `Invalid semver version: '${manifest.version}'`;
	}

	// Validate engines.pi if present
	if (manifest.engines !== undefined && manifest.engines !== null) {
		if (typeof manifest.engines !== "object") {
			return "'engines' must be an object";
		}

		const engines = manifest.engines as Record<string, unknown>;
		if (engines.pi !== undefined && typeof engines.pi !== "string") {
			return "'engines.pi' must be a string (semver range)";
		}
	}

	// Validate dependencies if present
	if (manifest.dependencies !== undefined && manifest.dependencies !== null) {
		if (typeof manifest.dependencies !== "object") {
			return "'dependencies' must be an object";
		}

		for (const [depName, depRange] of Object.entries(manifest.dependencies)) {
			if (typeof depRange !== "string") {
				return `Dependency '${depName}' must have a semver range string`;
			}
		}
	}

	return null;
}

/**
 * Check if the pi host version satisfies the extension's engine requirement.
 *
 * @param engineRange - The semver range from engines.pi
 * @returns true if compatible, false otherwise
 */
export function isPiVersionCompatible(engineRange: string | undefined): boolean {
	if (!engineRange) return true; // no constraint = compatible
	const piVer = getPiVersion();
	return satisfies(piVer, engineRange);
}
