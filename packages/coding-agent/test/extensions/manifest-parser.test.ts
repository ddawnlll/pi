/**
 * Tests for ManifestParser and PermissionGate.
 *
 * Coverage targets:
 * - ManifestParser.parse() validates with zod schema
 * - PermissionGate.check() rejects unauthorized access
 * - extension_permission_denied hard stop triggered
 * - >= 90% unit test coverage
 */

import { describe, expect, it } from "vitest";
import {
	ManifestParser,
	ManifestValidationError,
	PermissionDeniedError,
} from "../../src/extensions/manifest-parser.js";
import { PermissionGate, PermissionGateError } from "../../src/extensions/permission-gate.js";

// ============================================================================
// Fixtures
// ============================================================================

const VALID_MANIFEST: Record<string, unknown> = {
	name: "my-extension",
	version: "1.0.0",
	description: "A test extension",
	author: "Test Author",
	license: "MIT",
};

const VALID_MANIFEST_WITH_PERMISSIONS: Record<string, unknown> = {
	name: "my-extension",
	version: "1.0.0",
	description: "A test extension with permissions",
	permissions: [
		{ id: "network", description: "Access network resources" },
		{ id: "bash", description: "Execute shell commands" },
	],
};

const VALID_SCOPED_MANIFEST: Record<string, unknown> = {
	name: "@scope/my-extension",
	version: "2.1.0-beta.1",
	description: "A scoped extension",
	engines: {
		pi: ">=0.14.0",
	},
	dependencies: {
		"other-ext": "^1.0.0",
	},
};

const INVALID_MANIFEST_MISSING_NAME: Record<string, unknown> = {
	version: "1.0.0",
};

const INVALID_MANIFEST_BAD_NAME: Record<string, unknown> = {
	name: "123-invalid",
	version: "1.0.0",
};

const INVALID_MANIFEST_BAD_VERSION: Record<string, unknown> = {
	name: "my-extension",
	version: "not-a-version",
};

const INVALID_MANIFEST_EMPTY_NAME: Record<string, unknown> = {
	name: "",
	version: "1.0.0",
};

// ============================================================================
// ManifestParser.parse()
// ============================================================================

describe("ManifestParser", () => {
	describe("parse()", () => {
		it("should parse a valid minimal manifest", () => {
			const result = ManifestParser.parse(VALID_MANIFEST);
			expect(result).toEqual({
				name: "my-extension",
				version: "1.0.0",
				description: "A test extension",
				author: "Test Author",
				license: "MIT",
			});
		});

		it("should parse a valid manifest with permissions", () => {
			const result = ManifestParser.parse(VALID_MANIFEST_WITH_PERMISSIONS);
			expect(result.name).toBe("my-extension");
			expect(result.version).toBe("1.0.0");
			expect(result.permissions).toHaveLength(2);
			expect(result.permissions![0]).toEqual({ id: "network", description: "Access network resources" });
			expect(result.permissions![1]).toEqual({ id: "bash", description: "Execute shell commands" });
		});

		it("should parse a valid scoped manifest with engines and dependencies", () => {
			const result = ManifestParser.parse(VALID_SCOPED_MANIFEST);
			expect(result.name).toBe("@scope/my-extension");
			expect(result.version).toBe("2.1.0-beta.1");
			expect(result.engines).toEqual({ pi: ">=0.14.0" });
			expect(result.dependencies).toEqual({ "other-ext": "^1.0.0" });
		});

		it("should throw ManifestValidationError for missing name", () => {
			expect(() => ManifestParser.parse(INVALID_MANIFEST_MISSING_NAME)).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for invalid name starting with digits", () => {
			expect(() => ManifestParser.parse(INVALID_MANIFEST_BAD_NAME)).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for invalid version", () => {
			expect(() => ManifestParser.parse(INVALID_MANIFEST_BAD_VERSION)).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for empty name", () => {
			expect(() => ManifestParser.parse(INVALID_MANIFEST_EMPTY_NAME)).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for null input", () => {
			expect(() => ManifestParser.parse(null)).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for undefined input", () => {
			expect(() => ManifestParser.parse(undefined)).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for non-object input (string)", () => {
			expect(() => ManifestParser.parse("not-an-object")).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for non-object input (number)", () => {
			expect(() => ManifestParser.parse(42)).toThrow(ManifestValidationError);
		});

		it("should throw ManifestValidationError for array input", () => {
			expect(() => ManifestParser.parse([])).toThrow(ManifestValidationError);
		});

		it("should include validation issues in the error", () => {
			try {
				ManifestParser.parse(INVALID_MANIFEST_MISSING_NAME);
				expect.unreachable("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(ManifestValidationError);
				const verror = error as ManifestValidationError;
				expect(verror.issues.length).toBeGreaterThan(0);
				expect(verror.message).toContain("Manifest validation failed");
			}
		});

		it("should reject names with special characters", () => {
			const badNames = [
				{ name: "my extension", version: "1.0.0" },
				{ name: "my.extension", version: "1.0.0" },
				{ name: "my/extension", version: "1.0.0" },
				{ name: "", version: "1.0.0" },
			];
			for (const manifest of badNames) {
				expect(() => ManifestParser.parse(manifest)).toThrow(ManifestValidationError);
			}
		});

		it("should reject bad version strings", () => {
			const badVersions = [
				{ name: "ext", version: "" },
				{ name: "ext", version: "1" },
				{ name: "ext", version: "1.0" },
				{ name: "ext", version: "abc" },
				{ name: "ext", version: "1.0.0.0" },
			];
			for (const manifest of badVersions) {
				expect(() => ManifestParser.parse(manifest)).toThrow(ManifestValidationError);
			}
		});

		it("should accept valid scoped names", () => {
			const validNames = [
				{ name: "@scope/ext", version: "1.0.0" },
				{ name: "@my-org/my-ext", version: "1.0.0" },
				{ name: "simple-name", version: "1.0.0" },
				{ name: "name_with_underscores", version: "1.0.0" },
				{ name: "name-with-hyphens", version: "1.0.0" },
			];
			for (const manifest of validNames) {
				const result = ManifestParser.parse(manifest);
				expect(result.name).toBe(manifest.name);
			}
		});

		it("should accept various valid semver versions", () => {
			const validVersions = [
				{ name: "ext", version: "0.0.1" },
				{ name: "ext", version: "1.0.0" },
				{ name: "ext", version: "999.999.999" },
				{ name: "ext", version: "1.2.3-beta.1" },
				{ name: "ext", version: "1.2.3-alpha" },
				{ name: "ext", version: "1.2.3-rc.1+build.123" },
			];
			for (const manifest of validVersions) {
				const result = ManifestParser.parse(manifest);
				expect(result.version).toBe(manifest.version);
			}
		});

		it("should reject permissions with empty id", () => {
			const manifest = {
				name: "ext",
				version: "1.0.0",
				permissions: [{ id: "" }],
			};
			expect(() => ManifestParser.parse(manifest)).toThrow(ManifestValidationError);
		});
	});

	// ============================================================================
	// ManifestParser.safeParse()
	// ============================================================================

	describe("safeParse()", () => {
		it("should return success for valid manifest", () => {
			const result = ManifestParser.safeParse(VALID_MANIFEST);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe("my-extension");
			}
		});

		it("should return failure for invalid manifest", () => {
			const result = ManifestParser.safeParse(INVALID_MANIFEST_MISSING_NAME);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeInstanceOf(ManifestValidationError);
				expect(result.error.message).toContain("Manifest validation failed");
			}
		});
	});

	describe("PermissionDeniedError", () => {
		it("should create error with correct name and message", () => {
			const error = new PermissionDeniedError("network", "my-ext");
			expect(error.name).toBe("PermissionDeniedError");
			expect(error.permission).toBe("network");
			expect(error.extensionName).toBe("my-ext");
			expect(error.message).toContain("extension_permission_denied");
			expect(error.message).toContain("network");
			expect(error.message).toContain("my-ext");
		});

		it("should use custom message if provided", () => {
			const error = new PermissionDeniedError("bash", "ext", "Custom message");
			expect(error.message).toBe("Custom message");
			expect(error.permission).toBe("bash");
			expect(error.extensionName).toBe("ext");
		});

		it("should be instanceof Error", () => {
			expect(new PermissionDeniedError("x", "y")).toBeInstanceOf(Error);
		});
	});
});

// ============================================================================
// PermissionGate.check()
// ============================================================================

describe("PermissionGate", () => {
	describe("check()", () => {
		it("should allow access when permission is declared", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST_WITH_PERMISSIONS);
			const result = PermissionGate.check(manifest, "network");
			expect(result.allowed).toBe(true);
			expect(result.permission).toBe("network");
			expect(result.extensionName).toBe("my-extension");
		});

		it("should deny access when permission is not declared", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST_WITH_PERMISSIONS);
			const result = PermissionGate.check(manifest, "filesystem");
			expect(result.allowed).toBe(false);
			expect(result.permission).toBe("filesystem");
			expect(result.extensionName).toBe("my-extension");
			expect(result.reason).toContain("not declared");
		});

		it("should deny access when manifest has no permissions at all", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST);
			const result = PermissionGate.check(manifest, "network");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("declares no permissions");
		});

		it("should deny access for empty permissions array", () => {
			const manifest = ManifestParser.parse({
				name: "ext",
				version: "1.0.0",
				permissions: [],
			});
			const result = PermissionGate.check(manifest, "anything");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("declares no permissions");
		});

		it("should allow access to multiple declared permissions", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST_WITH_PERMISSIONS);
			expect(PermissionGate.check(manifest, "network").allowed).toBe(true);
			expect(PermissionGate.check(manifest, "bash").allowed).toBe(true);
		});

		it("should correctly identify the extension name in the result", () => {
			const manifest = ManifestParser.parse({
				name: "@scope/custom-ext",
				version: "1.0.0",
				permissions: [{ id: "network" }],
			});
			const result = PermissionGate.check(manifest, "filesystem");
			expect(result.extensionName).toBe("@scope/custom-ext");
		});
	});

	// ============================================================================
	// PermissionGate.require() - Hard Stop
	// ============================================================================

	describe("require()", () => {
		it("should succeed when permission is declared", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST_WITH_PERMISSIONS);
			expect(() => PermissionGate.require(manifest, "network")).not.toThrow();
		});

		it("should throw PermissionGateError when permission is not declared", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST_WITH_PERMISSIONS);
			expect(() => PermissionGate.require(manifest, "filesystem")).toThrow(PermissionGateError);
		});

		it("should throw PermissionGateError when manifest has no permissions", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST);
			expect(() => PermissionGate.require(manifest, "network")).toThrow(PermissionGateError);
		});

		it("should include extension_permission_denied in the error message", () => {
			const manifest = ManifestParser.parse(VALID_MANIFEST_WITH_PERMISSIONS);
			try {
				PermissionGate.require(manifest, "filesystem");
				expect.unreachable("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(PermissionGateError);
				const perror = error as PermissionGateError;
				expect(perror.message).toContain("extension_permission_denied");
				expect(perror.permission).toBe("filesystem");
				expect(perror.extensionName).toBe("my-extension");
			}
		});

		it("should throw PermissionGateError for any undeclared permission even with some declared", () => {
			const manifest = ManifestParser.parse({
				name: "ext",
				version: "1.0.0",
				permissions: [{ id: "bash" }],
			});
			expect(() => PermissionGate.require(manifest, "bash")).not.toThrow();
			expect(() => PermissionGate.require(manifest, "network")).toThrow(PermissionGateError);
			expect(() => PermissionGate.require(manifest, "filesystem")).toThrow(PermissionGateError);
		});

		it("should hard stop (throw) for any undeclared permission even on valid manifests", () => {
			// Core behavior: PermissionGateError IS the hard stop.
			// The caller is expected to catch this and prevent the operation.
			const manifest = ManifestParser.parse({
				name: "strict-ext",
				version: "1.0.0",
				permissions: [{ id: "read" }],
			});
			expect(() => PermissionGate.require(manifest, "write")).toThrow(PermissionGateError);
			expect(() => PermissionGate.require(manifest, "read")).not.toThrow();
		});
	});
});
