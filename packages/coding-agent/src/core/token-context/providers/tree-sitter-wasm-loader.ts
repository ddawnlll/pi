/**
 * P43 Smart Read v2 — Tree-sitter WASM Loader
 *
 * Lazily loads web-tree-sitter and tree-sitter grammar WASM files.
 * npm-only: depends on "web-tree-sitter" npm package.
 * If packages are unavailable, loader reports as unavailable.
 * Never auto-installs. Never crashes. Times out safely.
 *
 * Grammar WASM files are expected from "tree-sitter-wasms" or loaded from
 * standard paths. The loader attempts multiple resolution strategies.
 *
 * Tree-sitter gives syntax-level exact ranges.
 * It does not provide type-semantic project-wide resolution.
 * Therefore confidence is high for node boundaries, but below LSP/compiler semantic providers.
 */

// ============================================================================
// Types
// ============================================================================

export interface TreeSitterSymbolInfo {
	name: string;
	kind: string;
	languageId: string;
	startLine: number;
	endLine: number;
	startColumn: number;
	endColumn: number;
	startOffset: number;
	endOffset: number;
	containerName?: string;
	fullName?: string;
	signature?: string;
	isExported?: boolean;
}

export interface TreeSitterParseResult {
	tree: any;
	languageId: string;
	content: string;
}

export interface LoadedTreeSitterLanguage {
	languageId: string;
	parser: any;
	language: any;
}

export interface TreeSitterWasmLoaderOptions {
	/** Timeout for loading a grammar WASM file (ms). Default: 10000 */
	grammarTimeoutMs?: number;
	/** Whether to enable debug logging. Default: false */
	debug?: boolean;
}

// ============================================================================
// Grammar registry — maps language IDs to WASM resolution config
// ============================================================================

interface GrammarConfig {
	languageId: string;
	/** The node type name in tree-sitter for this language */
	tsLanguageName: string;
	/** File extensions this grammar supports */
	extensions: string[];
	/** Fallback WASM path candidates to try */
	wasmCandidates: string[];
}

const GRAMMAR_REGISTRY: Record<string, GrammarConfig> = {
	python: {
		languageId: "python",
		tsLanguageName: "tree_sitter_python",
		extensions: [".py", ".pyw"],
		wasmCandidates: [
			// tree-sitter-wasms package paths
			"tree-sitter-wasms/out/tree-sitter-python.wasm",
			"tree-sitter-wasms/out/python.wasm",
			"tree-sitter-wasms/grammars/python.wasm",
			// web-tree-sitter companion paths
			"web-tree-sitter/tree-sitter-python.wasm",
			"tree-sitter-python.wasm",
		],
	},
	rust: {
		languageId: "rust",
		tsLanguageName: "tree_sitter_rust",
		extensions: [".rs"],
		wasmCandidates: [
			"tree-sitter-wasms/out/tree-sitter-rust.wasm",
			"tree-sitter-wasms/out/rust.wasm",
			"tree-sitter-wasms/grammars/rust.wasm",
			"web-tree-sitter/tree-sitter-rust.wasm",
			"tree-sitter-rust.wasm",
		],
	},
	typescript: {
		languageId: "typescript",
		tsLanguageName: "tree_sitter_typescript",
		extensions: [".ts", ".tsx", ".mts", ".cts"],
		wasmCandidates: [
			"tree-sitter-wasms/out/tree-sitter-typescript.wasm",
			"tree-sitter-wasms/out/typescript.wasm",
			"tree-sitter-wasms/grammars/typescript.wasm",
			"web-tree-sitter/tree-sitter-typescript.wasm",
			"tree-sitter-typescript.wasm",
		],
	},
	javascript: {
		languageId: "javascript",
		tsLanguageName: "tree_sitter_javascript",
		extensions: [".js", ".jsx", ".mjs", ".cjs"],
		wasmCandidates: [
			"tree-sitter-wasms/out/tree-sitter-javascript.wasm",
			"tree-sitter-wasms/out/javascript.wasm",
			"tree-sitter-wasms/grammars/javascript.wasm",
			"web-tree-sitter/tree-sitter-javascript.wasm",
			"tree-sitter-javascript.wasm",
		],
	},
	json: {
		languageId: "json",
		tsLanguageName: "tree_sitter_json",
		extensions: [".json", ".jsonc"],
		wasmCandidates: [
			"tree-sitter-wasms/out/tree-sitter-json.wasm",
			"tree-sitter-wasms/out/json.wasm",
			"tree-sitter-wasms/grammars/json.wasm",
			"web-tree-sitter/tree-sitter-json.wasm",
			"tree-sitter-json.wasm",
		],
	},
	yaml: {
		languageId: "yaml",
		tsLanguageName: "tree_sitter_yaml",
		extensions: [".yaml", ".yml"],
		wasmCandidates: [
			"tree-sitter-wasms/out/tree-sitter-yaml.wasm",
			"tree-sitter-wasms/out/yaml.wasm",
			"tree-sitter-wasms/grammars/yaml.wasm",
			"web-tree-sitter/tree-sitter-yaml.wasm",
			"tree-sitter-yaml.wasm",
		],
	},
};

const EXTENSION_TO_LANGUAGE: Record<string, string> = {};
for (const [langId, config] of Object.entries(GRAMMAR_REGISTRY)) {
	for (const ext of config.extensions) {
		EXTENSION_TO_LANGUAGE[ext] = langId;
	}
}

// ============================================================================
// Loader implementation
// ============================================================================

let _webTreeSitterModule: any = null;
let _loaderAvailable: boolean | null = null;
const _parserCache: Map<string, any> = new Map();
const _languageCache: Map<string, any> = new Map();
let _initialized = false;

/**
 * Synchronous availability check via require.resolve.
 * Use this for sync contexts (e.g., getCapabilities).
 */
function checkAvailabilitySync(): boolean {
	if (_loaderAvailable !== null) return _loaderAvailable;
	try {
		require.resolve("web-tree-sitter");
		_loaderAvailable = true;
	} catch {
		_loaderAvailable = false;
	}
	return _loaderAvailable;
}

/**
 * Full availability check that also loads the module via dynamic import.
 * Async version used when loading grammars.
 */
async function checkAvailability(): Promise<boolean> {
	if (_loaderAvailable !== null && _webTreeSitterModule) return true;
	// First try sync require.resolve to set _loaderAvailable
	if (_loaderAvailable === null) {
		checkAvailabilitySync();
	}
	if (!_loaderAvailable) return false;
	try {
		// Use dynamic import for ESM compatibility
		// Use void 0 to prevent static analysis from resolving the package
		const mod = await import("web-tree-sitter" as string).catch(() => null);
		if (mod && typeof mod.default !== "undefined") {
			_webTreeSitterModule = mod.default || mod;
		} else if (mod) {
			_webTreeSitterModule = mod;
		} else {
			// Try require-style fallback (for CJS interop)
			try {
				const reqMod = require("web-tree-sitter");
				_webTreeSitterModule = reqMod;
			} catch {
				_webTreeSitterModule = null;
				_loaderAvailable = false;
			}
		}
		if (_webTreeSitterModule) {
			_loaderAvailable = true;
		}
	} catch {
		_loaderAvailable = false;
	}
	return _loaderAvailable;
}

/**
 * Initialize web-tree-sitter (call init() once).
 */
async function ensureInit(): Promise<boolean> {
	if (_initialized) return true;
	if (!(await checkAvailability())) return false;
	try {
		if (_webTreeSitterModule.init) {
			await _webTreeSitterModule.init();
		}
		_initialized = true;
		return true;
	} catch {
		_loaderAvailable = false;
		return false;
	}
}

/**
 * Resolve the WASM path for a grammar by trying candidates.
 * Returns the first resolvable path, or undefined.
 */
function resolveWasmPath(candidates: string[]): string | undefined {
	for (const candidate of candidates) {
		try {
			const resolved = require.resolve(candidate);
			return resolved;
		} catch {}
	}
	return undefined;
}

/**
 * Load a language grammar WASM file and return the language object.
 */
async function loadLanguage(languageId: string): Promise<any | undefined> {
	// Check cache
	const cached = _languageCache.get(languageId);
	if (cached) return cached;

	if (!(await ensureInit())) return undefined;

	const config = GRAMMAR_REGISTRY[languageId];
	if (!config) return undefined;

	try {
		const wasmPath = resolveWasmPath(config.wasmCandidates);
		if (!wasmPath) return undefined;

		// LoadLanguage expects a path or buffer
		let language: any;
		if (_webTreeSitterModule.Language) {
			language = await _webTreeSitterModule.Language.load(wasmPath);
		} else {
			return undefined;
		}

		_languageCache.set(languageId, language);
		return language;
	} catch {
		return undefined;
	}
}

/**
 * Get or create a parser for a language.
 */
function getParser(languageId: string, language: any): any | undefined {
	const cacheKey = languageId;
	const cached = _parserCache.get(cacheKey);
	if (cached) return cached;

	try {
		if (_webTreeSitterModule?.Parser) {
			const parser = new _webTreeSitterModule.Parser();
			parser.setLanguage(language);
			_parserCache.set(cacheKey, parser);
			return parser;
		}
	} catch {
		// Parser creation failed
	}
	return undefined;
}

// ============================================================================
// Public loader API
// ============================================================================

/**
 * Tree-sitter WASM loader singleton.
 */
export const treeSitterWasmLoader = {
	/**
	 * Check if web-tree-sitter is available at runtime (sync, via require.resolve).
	 * Does not throw — returns false if unavailable.
	 */
	isAvailable: (): boolean => {
		return checkAvailabilitySync();
	},

	/**
	 * Full async availability check with module loading.
	 */
	isAvailableAsync: async (): Promise<boolean> => {
		return await checkAvailability();
	},

	/**
	 * Get list of language IDs that have available grammar WASM files.
	 */
	getAvailableLanguages: async (): Promise<string[]> => {
		if (!(await checkAvailability())) return [];
		const available: string[] = [];
		for (const [langId, config] of Object.entries(GRAMMAR_REGISTRY)) {
			if (resolveWasmPath(config.wasmCandidates)) {
				available.push(langId);
			}
		}
		return available;
	},

	/**
	 * Get available languages for a file extension.
	 */
	getLanguageForExtension: (ext: string): string | undefined => {
		return EXTENSION_TO_LANGUAGE[ext.toLowerCase()];
	},

	/**
	 * Get grammar config for a language.
	 */
	getGrammarConfig: (languageId: string): GrammarConfig | undefined => {
		return GRAMMAR_REGISTRY[languageId];
	},

	/**
	 * Parse content for a given language.
	 * Returns undefined if language grammar is unavailable or parsing fails.
	 */
	parse: async (languageId: string, content: string): Promise<TreeSitterParseResult | undefined> => {
		const language = await loadLanguage(languageId);
		if (!language) return undefined;

		const parser = getParser(languageId, language);
		if (!parser) return undefined;

		try {
			const tree = parser.parse(content);
			if (!tree) return undefined;
			return { tree, languageId, content };
		} catch {
			return undefined;
		}
	},

	/**
	 * Reset all caches (useful for testing).
	 */
	reset: (): void => {
		_parserCache.clear();
		_languageCache.clear();
		_initialized = false;
		_loaderAvailable = null;
		_webTreeSitterModule = null;
	},

	/**
	 * Check if web-tree-sitter has been initialized.
	 */
	isInitialized: (): boolean => _initialized,

	/**
	 * Set the web-tree-sitter module (for testing injection).
	 */
	setModule: (mod: any): void => {
		_webTreeSitterModule = mod;
		_loaderAvailable = mod !== null;
	},
};

// ============================================================================
// Shared helper: node to exact range
// ============================================================================

/**
 * Extract exact range from a tree-sitter AST node.
 * All line numbers are 1-based.
 */
export function nodeToExactRange(node: any): {
	startLine: number;
	endLine: number;
	startColumn: number;
	endColumn: number;
	startOffset: number;
	endOffset: number;
} {
	return {
		startLine: node.startPosition.row + 1,
		endLine: node.endPosition.row + 1,
		startColumn: node.startPosition.column,
		endColumn: node.endPosition.column,
		startOffset: node.startIndex,
		endOffset: node.endIndex,
	};
}

/**
 * Get the text content of a tree-sitter node from the source string.
 */
export function getNodeText(node: any, content: string): string {
	if (node.startIndex !== undefined && node.endIndex !== undefined) {
		return content.slice(node.startIndex, node.endIndex);
	}
	return "";
}

/**
 * Walk the tree-sitter tree and collect nodes matching a predicate.
 */
export function walkTree(tree: any, predicate: (node: any) => boolean): any[] {
	const results: any[] = [];
	const cursor = tree.walk();
	let done = false;

	while (!done) {
		const node = cursor.currentNode();
		if (node && predicate(node)) {
			results.push(node);
		}

		if (cursor.gotoFirstChild()) {
			continue;
		}

		if (cursor.gotoNextSibling()) {
			continue;
		}

		let retreated = false;
		while (cursor.gotoParent()) {
			if (cursor.gotoNextSibling()) {
				retreated = true;
				break;
			}
		}

		if (!retreated) {
			done = true;
		}
	}

	return results;
}

/**
 * Validate that an exact range is consistent.
 * Returns error string if invalid, null if valid.
 */
export function validateExactRange(
	range: {
		startLine: number;
		endLine: number;
		startOffset: number;
		endOffset: number;
	},
	content: string,
): string | null {
	if (range.startOffset < 0) return "startOffset < 0";
	if (range.endOffset <= range.startOffset) return "endOffset <= startOffset";
	if (range.endOffset > content.length) return "endOffset > content.length";
	if (range.startLine <= 0) return "startLine <= 0";
	if (range.endLine < range.startLine) return "endLine < startLine";

	const sliced = content.slice(range.startOffset, range.endOffset);
	if (sliced.length === 0) return "sliced content is empty";

	return null;
}
