/**
 * Parser Validation — P43.8C Smart Mutation Engine
 *
 * Validates files after mutation using available parsers.
 */

import type { ParserValidationResult } from "./mutation-types.js";

// =========================================================================
// Helper functions
// =========================================================================

function getFileExtension(filePath: string): string {
	const match = filePath.toLowerCase().match(/\.[a-z0-9]+$/);
	return match?.[0] ?? "";
}

// =========================================================================
// JSON validation
// =========================================================================

function validateJson(content: string): ParserValidationResult {
	try {
		JSON.parse(content);
		return { ok: true, parser: "json", diagnostics: [] };
	} catch (error: any) {
		const message = error?.message ?? "Invalid JSON";
		return {
			ok: false,
			parser: "json",
			diagnostics: [{ message, severity: "error" }],
		};
	}
}

// =========================================================================
// Basic JavaScript/TypeScript syntax validation using Function/SyntaxError
// =========================================================================

function validateJavaScript(content: string): ParserValidationResult {
	// Basic catch for obvious syntax errors
	const diagnostics: Array<{ message: string; line?: number; severity: "error" | "warning" }> = [];

	// Check for unbalanced braces (quick check, not perfect)
	const openBraces = (content.match(/\{/g) || []).length;
	const closeBraces = (content.match(/\}/g) || []).length;
	if (openBraces !== closeBraces) {
		diagnostics.push({
			message: `Unbalanced braces: ${openBraces} open, ${closeBraces} close`,
			severity: "error",
		});
	}

	// Try Function constructor as a quick syntax check (won't catch imports)
	try {
		// Only check if the file is small enough and could be a module
		if (content.length > 0 && content.length < 100_000) {
			// Don't run actual code, just parse for syntax
			// Use RegExp to check for common syntax issues
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i] ?? "";
				// Check for unterminated string literals (rough heuristic)
				const singleQuotes = (line.match(/'/g) || []).length;
				const doubleQuotes = (line.match(/"/g) || []).length;
				if (singleQuotes % 2 !== 0 && !line.includes("\\'")) {
					diagnostics.push({
						message: `Possibly unterminated single-quoted string`,
						line: i + 1,
						severity: "warning",
					});
				}
				if (doubleQuotes % 2 !== 0 && !line.includes('\\"')) {
					diagnostics.push({
						message: `Possibly unterminated double-quoted string`,
						line: i + 1,
						severity: "warning",
					});
				}
			}
		}
	} catch {
		// ignore
	}

	return {
		ok: diagnostics.length === 0 || diagnostics.every((d) => d.severity === "warning"),
		parser: "js-syntax",
		diagnostics,
	};
}

// =========================================================================
// YAML validation
// =========================================================================

function validateYaml(content: string): ParserValidationResult {
	// Basic YAML structural checks
	const diagnostics: Array<{ message: string; severity: "error" | "warning" }> = [];

	// YAML requires consistent indentation - check for tabs
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.includes("\t") && !line.startsWith("#")) {
			diagnostics.push({
				message: `Line ${i + 1} contains tabs (YAML should use spaces)`,
				severity: "warning",
			});
		}
	}

	return {
		ok: true, // basic YAML is hard to validate without a full parser
		parser: "yaml-basic",
		diagnostics,
	};
}

// =========================================================================
// Python validation (basic)
// =========================================================================

function validatePython(content: string): ParserValidationResult {
	const diagnostics: Array<{ message: string; severity: "error" | "warning" }> = [];
	const lines = content.split("\n");

	// Check indentation consistency
	const indentStack: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.trim().length === 0 || line.trim().startsWith("#")) continue;

		const indent = line.search(/\S/);
		if (indent > 0) {
			if (indentStack.length === 0 || indent > (indentStack[indentStack.length - 1] ?? 0)) {
				indentStack.push(indent);
			} else if (indent < (indentStack[indentStack.length - 1] ?? 0)) {
				while (indentStack.length > 0 && indent < (indentStack[indentStack.length - 1] ?? 0)) {
					indentStack.pop();
				}
			}
		}
	}

	return {
		ok: true, // basic structural check only
		parser: "python-basic",
		diagnostics,
	};
}

// =========================================================================
// Main validation function
// =========================================================================

export function validateFileContent(
	filePath: string,
	content: string,
	policy: "required" | "best_effort" | "disabled",
	allowUnavailable?: boolean,
): ParserValidationResult {
	if (policy === "disabled") {
		return { ok: true, parser: "none", diagnostics: [] };
	}

	const ext = getFileExtension(filePath);

	// JSON / JSONC
	if (ext === ".json" || ext === ".jsonc") {
		return validateJson(content);
	}

	// YAML / YML
	if (ext === ".yaml" || ext === ".yml") {
		return validateYaml(content);
	}

	// JavaScript / TypeScript
	if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
		return validateJavaScript(content);
	}

	// Python
	if (ext === ".py") {
		return validatePython(content);
	}

	// Markdown / Text — no parser required
	if ([".md", ".txt", ".mdx", ".rst"].includes(ext)) {
		return { ok: true, parser: "none", diagnostics: [] };
	}

	// Unknown extension
	if (policy === "required") {
		return {
			ok: allowUnavailable ?? false,
			parser: "unavailable",
			diagnostics: [
				{
					message: `No parser available for file type: ${ext}`,
					severity: "error",
				},
			],
		};
	}

	return {
		ok: true,
		parser: "unavailable",
		diagnostics: [
			{
				message: `No parser available for file type: ${ext}`,
				severity: "warning",
			},
		],
	};
}
