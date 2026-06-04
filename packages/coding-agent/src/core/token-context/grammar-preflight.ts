/**
 * P43 Grammar & LSP Preflight - P43.14 (v2)
 *
 * v2: Provider-aware preflight.
 * Reports actual provider plan per language.
 * Detects npm-only provider availability.
 * Never recommends system installs.
 * Fail-open: missing capability is a warning, not a hard failure.
 */

export interface GrammarCapability {
	/** Capability name */
	name: string;
	/** Whether available */
	available: boolean;
	/** Version string if available */
	version?: string;
	/** Path to grammar if available */
	path?: string;
	/** Languages supported */
	languages?: string[];
}

export interface SmartReadProviderPreflightEntry {
	primary: string;
	fallbackChain: string[];
	npmOnly: boolean;
	mutationSafeExact: boolean;
	warnings: string[];
}

export interface SmartReadProviderPreflightReport {
	capabilities: GrammarCapability[];
	treeSitterWasmAvailable: boolean;
	typeScriptCompilerAvailable: boolean;
	jsonLanguageServiceAvailable: boolean;
	yamlParserAvailable: boolean;
	pyrightNpmAvailable: boolean;
	warnings: string[];
	providerPlan: Record<string, SmartReadProviderPreflightEntry>;
	confidenceAdjustments: Record<string, number>;
}

export interface GrammarPreflightReport {
	/** All detected capabilities */
	capabilities: GrammarCapability[];
	/** Whether tree-sitter is available */
	treeSitterAvailable: boolean;
	/** Whether LSP is available */
	lspAvailable: boolean;
	/** Warnings about missing capabilities */
	warnings: string[];
	/** Recommended adapter confidence adjustments */
	confidenceAdjustments: Record<string, number>;
}

/**
 * Run the grammar/LSP preflight check.
 * Detects available grammar engines without auto-installing.
 * Returns legacy GrammarPreflightReport (backward compatible).
 */
export function runGrammarPreflight(): GrammarPreflightReport {
	const capabilities: GrammarCapability[] = [];
	const warnings: string[] = [];

	// Check for tree-sitter WASM
	const treeSitterWasmCap = detectTreeSitterWasm();
	capabilities.push(treeSitterWasmCap);

	// Check for TypeScript compiler
	const tsCompilerCap = detectTypeScriptCompiler();
	capabilities.push(tsCompilerCap);

	// Check for jsonc-parser (JSON native provider)
	const jsonParserCap = detectJsonParser();
	capabilities.push(jsonParserCap);

	// Check for yaml parser
	const yamlParserCap = detectYamlParser();
	capabilities.push(yamlParserCap);

	// Check for pyright
	const pyrightCap = detectPyright();
	capabilities.push(pyrightCap);

	const treeSitterWasmAvailable = treeSitterWasmCap.available;
	const typeScriptCompilerAvailable = tsCompilerCap.available;
	const jsonLanguageServiceAvailable = jsonParserCap.available;
	const yamlParserAvailable = yamlParserCap.available;
	const pyrightNpmAvailable = pyrightCap.available;

	if (!treeSitterWasmAvailable) {
		warnings.push("Tree-sitter WASM not available. Fallback to regex-based parsing with reduced confidence.");
	}
	if (!typeScriptCompilerAvailable) {
		warnings.push(
			"TypeScript compiler API not available. TypeScript/JS files will use regex fallback with reduced confidence.",
		);
	}
	if (!jsonLanguageServiceAvailable) {
		warnings.push("jsonc-parser not available. JSON files will use regex fallback with reduced confidence.");
	}
	if (!yamlParserAvailable) {
		warnings.push("yaml parser not available. YAML files will use regex fallback with reduced confidence.");
	}

	// Build confidence adjustments
	const confidenceAdjustments: Record<string, number> = {};
	if (!typeScriptCompilerAvailable) {
		confidenceAdjustments.typescript = -0.5;
	}
	if (!jsonLanguageServiceAvailable) {
		confidenceAdjustments.json = -0.5;
	}
	if (!yamlParserAvailable) {
		confidenceAdjustments.yaml = -0.5;
	}

	// Legacy report
	const report: GrammarPreflightReport = {
		capabilities,
		treeSitterAvailable: treeSitterWasmAvailable,
		lspAvailable: typeScriptCompilerAvailable || pyrightNpmAvailable,
		warnings,
		confidenceAdjustments,
	};

	return report;
}

/**
 * Run the full provider-aware preflight check.
 * Returns detailed provider plan and availability information.
 */
export function runSmartReadProviderPreflight(): SmartReadProviderPreflightReport {
	const report = runGrammarPreflight();
	// Reuse detection from runGrammarPreflight by extracting capabilities
	const caps: GrammarCapability[] = report.capabilities;
	const treeSitterWasmAvailable =
		caps.find((c: GrammarCapability) => c.name === "tree-sitter-wasm")?.available ?? false;
	const typeScriptCompilerAvailable =
		caps.find((c: GrammarCapability) => c.name === "typescript-compiler")?.available ?? false;
	const jsonLanguageServiceAvailable =
		caps.find((c: GrammarCapability) => c.name === "jsonc-parser")?.available ?? false;
	const yamlParserAvailable = caps.find((c: GrammarCapability) => c.name === "yaml-parser")?.available ?? false;
	const pyrightNpmAvailable = caps.find((c: GrammarCapability) => c.name === "pyright")?.available ?? false;

	const providerPlan = buildDefaultProviderPlan(
		treeSitterWasmAvailable,
		typeScriptCompilerAvailable,
		jsonLanguageServiceAvailable,
		yamlParserAvailable,
	);

	return {
		capabilities: caps,
		treeSitterWasmAvailable,
		typeScriptCompilerAvailable,
		jsonLanguageServiceAvailable,
		yamlParserAvailable,
		pyrightNpmAvailable,
		warnings: report.warnings,
		providerPlan,
		confidenceAdjustments: report.confidenceAdjustments,
	};
}

function detectTreeSitterWasm(): GrammarCapability {
	try {
		require.resolve("web-tree-sitter");
		return {
			name: "tree-sitter-wasm",
			available: true,
			languages: ["typescript", "javascript", "python", "rust", "json", "yaml"],
		};
	} catch {
		return {
			name: "tree-sitter-wasm",
			available: false,
			languages: ["typescript", "javascript", "python", "rust", "json", "yaml"],
		};
	}
}

function detectTypeScriptCompiler(): GrammarCapability {
	try {
		require.resolve("typescript");
		return {
			name: "typescript-compiler",
			available: true,
			languages: ["typescript", "javascript", "tsx", "jsx"],
		};
	} catch {
		return {
			name: "typescript-compiler",
			available: false,
			languages: ["typescript", "javascript", "tsx", "jsx"],
		};
	}
}

function detectJsonParser(): GrammarCapability {
	try {
		require.resolve("jsonc-parser");
		return {
			name: "jsonc-parser",
			available: true,
			languages: ["json", "jsonc"],
		};
	} catch {
		return {
			name: "jsonc-parser",
			available: false,
			languages: ["json", "jsonc"],
		};
	}
}

function detectYamlParser(): GrammarCapability {
	try {
		require.resolve("yaml");
		return {
			name: "yaml-parser",
			available: true,
			languages: ["yaml"],
		};
	} catch {
		return {
			name: "yaml-parser",
			available: false,
			languages: ["yaml"],
		};
	}
}

function detectPyright(): GrammarCapability {
	try {
		require.resolve("pyright");
		return {
			name: "pyright",
			available: true,
			languages: ["python"],
		};
	} catch {
		return {
			name: "pyright",
			available: false,
			languages: ["python"],
		};
	}
}

function buildDefaultProviderPlan(
	treeSitterWasmAvailable: boolean,
	typeScriptCompilerAvailable: boolean,
	jsonLanguageServiceAvailable: boolean,
	yamlParserAvailable: boolean,
): Record<string, SmartReadProviderPreflightEntry> {
	return {
		typescript: {
			primary: typeScriptCompilerAvailable
				? "typescript-compiler"
				: "tree-sitter-wasm (if available) -> typescript-regex-fallback",
			fallbackChain: typeScriptCompilerAvailable
				? ["tree-sitter-wasm", "typescript-regex-fallback", "generic", "raw"]
				: ["typescript-regex-fallback", "generic", "raw"],
			npmOnly: true,
			mutationSafeExact: typeScriptCompilerAvailable,
			warnings: typeScriptCompilerAvailable
				? []
				: ["TypeScript compiler not available; regex fallback used by default"],
		},
		javascript: {
			primary: typeScriptCompilerAvailable ? "typescript-compiler" : "typescript-regex-fallback",
			fallbackChain: typeScriptCompilerAvailable
				? ["tree-sitter-wasm", "typescript-regex-fallback", "generic", "raw"]
				: ["typescript-regex-fallback", "generic", "raw"],
			npmOnly: true,
			mutationSafeExact: typeScriptCompilerAvailable,
			warnings: typeScriptCompilerAvailable
				? []
				: ["TypeScript compiler not available; regex fallback used by default"],
		},
		python: {
			primary: treeSitterWasmAvailable ? "tree-sitter-wasm" : "python-regex-fallback",
			fallbackChain: treeSitterWasmAvailable
				? ["pyright (deferred)", "python-regex-fallback", "generic", "raw"]
				: ["python-regex-fallback", "generic", "raw"],
			npmOnly: true,
			mutationSafeExact: treeSitterWasmAvailable,
			warnings: [
				...(!treeSitterWasmAvailable ? ["Tree-sitter WASM not available; Python uses regex fallback"] : []),
				...(treeSitterWasmAvailable
					? [
							"Tree-sitter WASM provides AST-backed exact ranges. symbol_exact is mutation-safe.",
							"Pyright LSP integration is deferred.",
						]
					: ["Pyright LSP integration is deferred; Python symbol_exact is not mutation-safe"]),
			],
		},
		rust: {
			primary: treeSitterWasmAvailable ? "tree-sitter-wasm" : "rust-regex-fallback",
			fallbackChain: treeSitterWasmAvailable
				? ["rust-analyzer (external, disabled by default)", "rust-regex-fallback", "generic", "raw"]
				: ["rust-regex-fallback", "generic", "raw"],
			npmOnly: true,
			mutationSafeExact: treeSitterWasmAvailable,
			warnings: [
				...(!treeSitterWasmAvailable ? ["Tree-sitter WASM not available; Rust uses regex fallback"] : []),
				...(treeSitterWasmAvailable
					? ["Tree-sitter WASM provides AST-backed exact ranges. symbol_exact is mutation-safe."]
					: []),
				"rust-analyzer is not npm-only; disabled by default. Enable via explicit opt-in config.",
			],
		},
		json: {
			primary: jsonLanguageServiceAvailable ? "json-native" : "json-yaml-regex-fallback",
			fallbackChain: jsonLanguageServiceAvailable
				? ["tree-sitter-wasm", "json-yaml-regex-fallback", "generic", "raw"]
				: ["json-yaml-regex-fallback", "generic", "raw"],
			npmOnly: true,
			mutationSafeExact: jsonLanguageServiceAvailable,
			warnings: jsonLanguageServiceAvailable
				? []
				: ["jsonc-parser not available; JSON uses regex fallback with approximate key extraction"],
		},
		yaml: {
			primary: yamlParserAvailable ? "yaml-native" : "json-yaml-regex-fallback",
			fallbackChain: yamlParserAvailable
				? ["tree-sitter-wasm", "json-yaml-regex-fallback", "generic", "raw"]
				: ["json-yaml-regex-fallback", "generic", "raw"],
			npmOnly: true,
			mutationSafeExact: false,
			warnings: yamlParserAvailable
				? ["YAML exact range not always available; symbol_exact mutationSafe only when exact range is known"]
				: ["yaml npm package not available; YAML uses regex fallback"],
		},
		generic: {
			primary: "generic",
			fallbackChain: ["llm-fallback", "raw"],
			npmOnly: true,
			mutationSafeExact: false,
			warnings: ["Generic fallback confidence capped at 0.30; not mutation-safe"],
		},
	};
}
