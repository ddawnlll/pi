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
 * Tree-sitter gives syntax-level exact ranges.
 * It does not provide type-semantic project-wide resolution.
 * Therefore confidence is high for node boundaries, but below LSP/compiler semantic providers.
 */

import type {
	SmartReadParseSource,
	SmartReadProvider,
	SmartReadProviderCapabilities,
	SmartReadResult,
} from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";
import { treeSitterWasmLoader } from "./tree-sitter-wasm-loader.js";

// Lazy-import extractors only when tree-sitter is available
let _pythonExtractor: any = null;
let _rustExtractor: any = null;
let _typescriptExtractor: any = null;

async function ensureExtractors(): Promise<void> {
	if (_pythonExtractor) return;
	try {
		const py = await import("./tree-sitter-python-extractor.js");
		_pythonExtractor = py;
		const rs = await import("./tree-sitter-rust-extractor.js");
		_rustExtractor = rs;
		const ts = await import("./tree-sitter-typescript-extractor.js");
		_typescriptExtractor = ts;
	} catch {
		// Extractors failed to load — will fall back
	}
}

// ============================================================================
// Extension-to-language mapping
// ============================================================================

const EXT_TO_LANGUAGE: Record<string, { languageId: string; extractor: string }> = {
	".py": { languageId: "python", extractor: "python" },
	".pyw": { languageId: "python", extractor: "python" },
	".rs": { languageId: "rust", extractor: "rust" },
	".ts": { languageId: "typescript", extractor: "typescript" },
	".tsx": { languageId: "typescript", extractor: "typescript" },
	".mts": { languageId: "typescript", extractor: "typescript" },
	".cts": { languageId: "typescript", extractor: "typescript" },
	".js": { languageId: "javascript", extractor: "typescript" },
	".jsx": { languageId: "javascript", extractor: "typescript" },
	".mjs": { languageId: "javascript", extractor: "typescript" },
	".cjs": { languageId: "javascript", extractor: "typescript" },
	".json": { languageId: "json", extractor: "json" },
	".jsonc": { languageId: "json", extractor: "json" },
	".yaml": { languageId: "yaml", extractor: "yaml" },
	".yml": { languageId: "yaml", extractor: "yaml" },
};

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

	/** Optional loader override for testing */
	private readonly _loader: typeof treeSitterWasmLoader | undefined;
	private _cachedCapabilities: SmartReadProviderCapabilities | null = null;

	constructor(options?: { loader?: typeof treeSitterWasmLoader }) {
		this._loader = options?.loader;
	}

	private get loader(): typeof treeSitterWasmLoader {
		return this._loader ?? treeSitterWasmLoader;
	}

	isAvailable(): boolean | Promise<boolean> {
		// Use sync detection; the loader caches the result from require.resolve
		return this.loader.isAvailable();
	}

	getCapabilities(): SmartReadProviderCapabilities {
		if (this._cachedCapabilities) return this._cachedCapabilities;
		// Use sync isAvailable check; async is fine here but sync is the interface
		const available = typeof this.isAvailable() === "boolean" ? (this.isAvailable() as boolean) : false;
		this._cachedCapabilities = {
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
		return this._cachedCapabilities;
	}

	// ============================================================================
	// Outline
	// ============================================================================

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		await ensureExtractors();
		const langInfo = this.getLanguageInfo(filePath);
		if (!langInfo) {
			return this.unavailableResult("outline", filePath);
		}

		const parseResult = await this.loader.parse(langInfo.languageId, content);
		if (!parseResult) {
			return this.unavailableResult("outline", filePath, undefined, "parse failed");
		}

		const symbols = this.extractSymbolsForLanguage(parseResult, langInfo.extractor);
		if (!symbols || symbols.length === 0) {
			return {
				content: "No symbols found.",
				mode: "outline",
				mutationSafe: false,
				adapterConfidence: SMART_READ_CONFIDENCE.TREE_SITTER_OUTLINE,
				adapterName: this.name,
				parseSource: "tree_sitter_wasm" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: true,
				fallbackError: "tree-sitter parsed content but no symbols extracted",
			};
		}

		const outline = this.buildOutlineForLanguage(symbols, langInfo.extractor);
		return {
			content: outline,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: SMART_READ_CONFIDENCE.TREE_SITTER_OUTLINE,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
		};
	}

	// ============================================================================
	// Symbols
	// ============================================================================

	async symbols(content: string, filePath: string): Promise<SmartReadResult> {
		await ensureExtractors();
		const langInfo = this.getLanguageInfo(filePath);
		if (!langInfo) {
			return this.unavailableResult("symbols", filePath);
		}

		const parseResult = await this.loader.parse(langInfo.languageId, content);
		if (!parseResult) {
			return this.unavailableResult("symbols", filePath, undefined, "parse failed");
		}

		const symbols = this.extractSymbolsForLanguage(parseResult, langInfo.extractor);
		if (!symbols || symbols.length === 0) {
			return {
				content: "No symbols found.",
				mode: "symbols",
				mutationSafe: false,
				adapterConfidence: 0.5,
				adapterName: this.name,
				parseSource: "tree_sitter_wasm" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: true,
				fallbackError: "tree-sitter parsed content but no symbols extracted",
			};
		}

		const symbolList = this.buildSymbolList(symbols);
		return {
			content: symbolList,
			mode: "symbols",
			mutationSafe: false,
			adapterConfidence: SMART_READ_CONFIDENCE.TREE_SITTER_OUTLINE,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
		};
	}

	// ============================================================================
	// Symbol Exact
	// ============================================================================

	async symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		await ensureExtractors();
		const langInfo = this.getLanguageInfo(filePath);
		if (!langInfo) {
			return this.unavailableResult("symbol_exact", filePath, symbol);
		}

		const parseResult = await this.loader.parse(langInfo.languageId, content);
		if (!parseResult) {
			return this.unavailableResult("symbol_exact", filePath, symbol, "parse failed");
		}

		const symbols = this.extractSymbolsForLanguage(parseResult, langInfo.extractor);
		if (!symbols || symbols.length === 0) {
			return {
				content: `[Symbol "${symbol}" not found via tree-sitter WASM]`,
				mode: "symbol_exact",
				mutationSafe: false,
				adapterConfidence: 0.3,
				adapterName: this.name,
				parseSource: "tree_sitter_wasm" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: true,
				fallbackError: `symbol "${symbol}" not found`,
			};
		}

		const foundSymbol = this.findSymbolForLanguage(symbols, symbol, langInfo.extractor);
		if (!foundSymbol) {
			return {
				content: `[Symbol "${symbol}" not found via tree-sitter WASM]`,
				mode: "symbol_exact",
				mutationSafe: false,
				adapterConfidence: 0.3,
				adapterName: this.name,
				parseSource: "tree_sitter_wasm" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: true,
				fallbackError: `symbol "${symbol}" not found`,
			};
		}

		const exactContent = this.symbolExactForLanguage(parseResult, foundSymbol, langInfo.extractor);
		if (!exactContent) {
			return {
				content: `[Symbol "${symbol}" found but exact range invalid]`,
				mode: "symbol_exact",
				mutationSafe: false,
				adapterConfidence: 0.3,
				adapterName: this.name,
				parseSource: "tree_sitter_wasm" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: true,
				fallbackError: "invalid exact tree-sitter range",
			};
		}

		return {
			content: exactContent.content,
			mode: "symbol_exact",
			mutationSafe: true,
			adapterConfidence: SMART_READ_CONFIDENCE.TREE_SITTER_EXACT,
			adapterName: this.name,
			parseSource: "tree_sitter_wasm" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
			exactRange: {
				startLine: exactContent.startLine,
				endLine: exactContent.endLine,
				startColumn: exactContent.startColumn,
				endColumn: exactContent.endColumn,
				startOffset: exactContent.startOffset,
				endOffset: exactContent.endOffset,
			},
		};
	}

	// ============================================================================
	// Range Exact
	// ============================================================================

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

	// ============================================================================
	// Changed
	// ============================================================================

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
	// Internal helpers
	// ============================================================================

	private getLanguageInfo(filePath: string): { languageId: string; extractor: string } | undefined {
		const ext = this.getExtension(filePath);
		return EXT_TO_LANGUAGE[ext];
	}

	private getExtension(filePath: string): string {
		const dot = filePath.lastIndexOf(".");
		if (dot === -1) return "";
		const ext = filePath.slice(dot).toLowerCase();
		return ext;
	}

	private extractSymbolsForLanguage(parseResult: any, extractor: string): any[] | undefined {
		switch (extractor) {
			case "python":
				return _pythonExtractor?.extractPythonSymbols(parseResult);
			case "rust":
				return _rustExtractor?.extractRustSymbols(parseResult);
			case "typescript":
				return _typescriptExtractor?.extractTypeScriptSymbols(parseResult);
			default:
				return undefined;
		}
	}

	private buildOutlineForLanguage(symbols: any[], extractor: string): string {
		switch (extractor) {
			case "python":
				return _pythonExtractor?.buildPythonOutline(symbols);
			case "rust":
				return _rustExtractor?.buildRustOutline(symbols);
			case "typescript":
				return _typescriptExtractor?.buildTypeScriptOutline(symbols);
			default:
				return "No symbols found.";
		}
	}

	private buildSymbolList(symbols: any[]): string {
		return symbols
			.map((s) => {
				const range = s.startLine === s.endLine ? ` L${s.startLine}` : ` L${s.startLine}-${s.endLine}`;
				const name = s.fullName || s.name;
				return `[${s.kind}] ${name}${range}`;
			})
			.join("\n");
	}

	private findSymbolForLanguage(symbols: any[], symbolName: string, extractor: string): any | undefined {
		switch (extractor) {
			case "python":
				return _pythonExtractor?.findPythonSymbol(symbols, symbolName);
			case "rust":
				return _rustExtractor?.findRustSymbol(symbols, symbolName);
			case "typescript":
				return _typescriptExtractor?.findTypeScriptSymbol(symbols, symbolName);
			default:
				return undefined;
		}
	}

	private symbolExactForLanguage(parseResult: any, symbol: any, extractor: string): any | undefined {
		switch (extractor) {
			case "python":
				return _pythonExtractor?.pythonSymbolExact(parseResult, symbol);
			case "rust":
				return _rustExtractor?.rustSymbolExact(parseResult, symbol);
			case "typescript":
				return _typescriptExtractor?.typeScriptSymbolExact(parseResult, symbol);
			default:
				return undefined;
		}
	}

	// ============================================================================
	// Fallback helpers
	// ============================================================================

	private unavailableResult(mode: string, filePath: string, symbol?: string, error?: string): SmartReadResult {
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
			fallbackError: error ?? "web-tree-sitter package not available",
		};
	}
}
