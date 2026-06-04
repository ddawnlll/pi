/**
 * P43 Smart Read v2 — Tree-sitter WASM Provider
 *
 * Uses tree-sitter WASM packages for cross-platform AST-backed reads.
 * Priority: 80 (secondary to compiler/native parsers, better than regex).
 *
 * npm-only: depends on "web-tree-sitter" and "tree-sitter-wasms" or similar.
 * If packages are unavailable, provider reports as unavailable and falls through.
 * Never auto-installs. Never crashes.
 *
 * TODO: Implement full AST extraction once tree-sitter WASM integration is stable.
 * Current implementation: available detection and fail-open fallback.
 */

import type {
	SmartReadParseSource,
	SmartReadProvider,
	SmartReadProviderCapabilities,
	SmartReadResult,
} from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

// Track availability status
let _tsWasmAvailable: boolean | null = null;

function checkTreeSitterWasmAvailability(): boolean {
	if (_tsWasmAvailable !== null) return _tsWasmAvailable;
	try {
		// Try dynamic require to check if web-tree-sitter is installed
		require.resolve("web-tree-sitter");
		_tsWasmAvailable = true;
	} catch {
		_tsWasmAvailable = false;
	}
	return _tsWasmAvailable;
}

export class TreeSitterWasmProvider implements SmartReadProvider {
	readonly name = "tree-sitter-wasm";
	readonly languageIds = ["typescript", "javascript", "tsx", "jsx", "python", "rust", "json", "yaml"];
	readonly extensions = [
		".ts",
		".tsx",
		".js",
		".jsx",
		".mjs",
		".cjs",
		".mts",
		".cts",
		".py",
		".pyw",
		".rs",
		".json",
		".yaml",
		".yml",
	];
	readonly priority = 80;
	private initialized = false;

	isAvailable(): boolean {
		return checkTreeSitterWasmAvailability();
	}

	getCapabilities(): SmartReadProviderCapabilities {
		const available = this.isAvailable();
		return {
			outline: available,
			symbols: available,
			symbolExact: available,
			rangeExact: true,
			changed: true,
			exactRanges: available,
			mutationSafeExact: available,
			semantic: false,
			astBacked: available,
		};
	}

	private async ensureInitialized(): Promise<boolean> {
		if (this.initialized) return true;
		if (!this.isAvailable()) return false;

		try {
			// Dynamic import of web-tree-sitter
			const Parser = require("web-tree-sitter");
			await Parser.init();
			this.initialized = true;
			return true;
		} catch {
			_tsWasmAvailable = false;
			return false;
		}
	}

	async outline(_content: string, filePath: string): Promise<SmartReadResult> {
		if (!(await this.ensureInitialized())) {
			return this.unavailableResult("outline", filePath);
		}

		// TODO: Full tree-sitter AST traversal for outline generation
		// For now, return a basic structural outline
		return {
			content: `[Tree-sitter WASM outline not yet implemented for ${filePath}]`,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
			fallbackError: "tree-sitter WASM outline not yet implemented",
		};
	}

	async symbols(_content: string, filePath: string): Promise<SmartReadResult> {
		if (!(await this.ensureInitialized())) {
			return this.unavailableResult("symbols", filePath);
		}

		return {
			content: `[Tree-sitter WASM symbols not yet implemented for ${filePath}]`,
			mode: "symbols",
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
			fallbackError: "tree-sitter WASM symbols not yet implemented",
		};
	}

	async symbolExact(_content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		if (!(await this.ensureInitialized())) {
			return this.unavailableResult("symbol_exact", filePath, symbol);
		}

		return {
			content: `[Tree-sitter WASM symbol lookup not yet implemented for "${symbol}" in ${filePath}]`,
			mode: "symbol_exact",
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
			fallbackError: "tree-sitter WASM symbol lookup not yet implemented",
		};
	}

	async rangeExact(content: string, _filePath: string, startLine: number, endLine: number): Promise<SmartReadResult> {
		const lines = content.split("\n");
		const range = lines.slice(startLine - 1, endLine).join("\n");
		return {
			content: range,
			mode: "range_exact",
			mutationSafe: true,
			adapterConfidence: SMART_READ_CONFIDENCE.RAW,
			adapterName: this.name,
			parseSource: "raw" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
			exactRange: { startLine, endLine },
		};
	}

	async changed(_content: string, filePath: string, delta: string): Promise<SmartReadResult> {
		return {
			content: `[Changed content based on delta for ${filePath}]\n${delta}`,
			mode: "changed",
			mutationSafe: false,
			adapterConfidence: 0.5,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
		};
	}

	// ============================================================================
	// Fallback helpers
	// ============================================================================

	private unavailableResult(mode: string, filePath: string, symbol?: string): SmartReadResult {
		const content = symbol
			? `[Tree-sitter WASM unavailable for symbol "${symbol}" in ${filePath}]`
			: `[Tree-sitter WASM unavailable for ${mode} in ${filePath}]`;

		return {
			content,
			mode: mode as SmartReadResult["mode"],
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
			fallbackError: "web-tree-sitter package not available",
		};
	}
}
