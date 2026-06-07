/**
 * P43 Smart Read v2 — YAML Native Parser Provider
 *
 * Uses the "yaml" npm package (Eemeli Aro) for AST-backed reads.
 * Priority: 90 for YAML files.
 *
 * Optimizations:
 * - Full AST traversal via yaml.parseDocument()
 * - Line ranges from node.lineRange (no regex fallback needed)
 * - mutationSafe=true for symbol_exact when exact range is available
 * - Tree cache to avoid double parse
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type {
	SmartReadParseSource,
	SmartReadProvider,
	SmartReadProviderCapabilities,
	SmartReadResult,
} from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

interface YamlKeyInfo {
	path: string;
	type: string;
	line: number;
	endLine: number;
}

let _yamlModule: any = null;
let _yamlAvailable: boolean | null = null;

const _require = typeof require !== "undefined" ? require : createRequire(import.meta.url);

function getYaml(): any {
	if (_yamlAvailable !== null) return _yamlModule;
	try {
		_yamlModule = _require("yaml");
		_yamlAvailable = true;
	} catch {
		_yamlAvailable = false;
	}
	return _yamlModule;
}

export class YamlNativeProvider implements SmartReadProvider {
	readonly name = "yaml-native";
	readonly languageIds = ["yaml"];
	readonly extensions = [".yaml", ".yml"];
	readonly priority = 90;

	// Tree cache: key is content hash, value is parsed document
	private _docCache = new Map<string, any>();
	private _cacheMaxSize = 10;

	isAvailable(): boolean {
		return getYaml() !== null;
	}

	getCapabilities(): SmartReadProviderCapabilities {
		return {
			outline: true,
			symbols: true,
			symbolExact: true,
			rangeExact: true,
			changed: true,
			exactRanges: true,
			mutationSafeExact: true, // True when exact range is available from AST
			semantic: false,
			astBacked: true,
		};
	}

	// ============================================================================
	// Document Cache — avoid double parse
	// ============================================================================

	private getContentKey(content: string): string {
		if (content.length < 128) return `${content.length}:${content}`;
		const prefix = content.slice(0, 64);
		const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
		return `${content.length}:${prefix}:${hash}`;
	}

	private getDocument(content: string): any {
		const yaml = getYaml();
		if (!yaml) return null;

		const key = this.getContentKey(content);
		if (this._docCache.has(key)) {
			return this._docCache.get(key);
		}

		try {
			const doc = yaml.parseDocument(content);
			this._docCache.set(key, doc);

			// Evict oldest if cache is full
			if (this._docCache.size > this._cacheMaxSize) {
				const firstKey = this._docCache.keys().next().value;
				if (firstKey) this._docCache.delete(firstKey);
			}

			return doc;
		} catch {
			return null;
		}
	}

	// ============================================================================
	// Key Collection — single pass with AST
	// ============================================================================

	private collectKeys(content: string): YamlKeyInfo[] {
		const yaml = getYaml();
		if (!yaml) return [];

		const keys: YamlKeyInfo[] = [];

		try {
			const doc = this.getDocument(content);
			if (!doc || !doc.contents) return [];

			this.visitNode(doc.contents, [], keys);
		} catch {
			// Parser error
		}

		return keys;
	}

	private visitNode(node: any, parentPath: string[], keys: YamlKeyInfo[]): void {
		if (!node || typeof node !== "object") return;

		// YAML mapping (key-value pairs)
		if (node.items && Array.isArray(node.items)) {
			for (const item of node.items) {
				if (!item.key) continue;

				const keyStr = String(item.key.value ?? item.key);
				const currentPath = [...parentPath, keyStr];
				const pathStr = currentPath.join(".");

				// Get line information from node.lineRange
				const keyLine = (item.key.lineRange?.[0] ?? 0) + 1;
				let endLine = keyLine;

				if (item.value) {
					if (item.value.lineRange) {
						endLine = (item.value.lineRange[1] ?? 0) + 1;
					} else if (item.value.items && Array.isArray(item.value.items)) {
						// For nested mappings/sequences, find the last child's end line
						for (const child of item.value.items) {
							if (child.value?.lineRange) {
								endLine = Math.max(endLine, (child.value.lineRange[1] ?? 0) + 1);
							} else if (child.lineRange) {
								endLine = Math.max(endLine, (child.lineRange[1] ?? 0) + 1);
							}
						}
					}
				}

				// Ensure endLine is at least keyLine
				if (endLine < keyLine) endLine = keyLine;

				let type = "value";
				if (item.value) {
					if (item.value.items && Array.isArray(item.value.items)) {
						type = item.value.items.some((i: any) => i.key) ? "object" : "array";
					}
				}

				keys.push({
					path: pathStr,
					type,
					line: keyLine,
					endLine,
				});

				// Recurse into child values that are mappings/sequences
				if (item.value) {
					this.visitNode(item.value, currentPath, keys);
				}
			}
		}
	}

	// ============================================================================
	// Public API
	// ============================================================================

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		const yaml = getYaml();
		if (!yaml) {
			return this.makeFallbackResult(filePath, "yaml parser not available");
		}

		const keys = this.collectKeys(content);
		if (keys.length === 0) {
			return {
				content: `[No YAML keys found in ${filePath}]`,
				mode: "outline",
				mutationSafe: false,
				adapterConfidence: SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX,
				adapterName: this.name,
				parseSource: "native_parser" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: false,
			};
		}

		const threshold = 20;
		const displayKeys = keys.length > threshold ? keys.slice(0, threshold) : keys;
		const outline = this.buildOutline(filePath, displayKeys, keys.length);

		return {
			content: outline,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: SMART_READ_CONFIDENCE.NATIVE_PARSER_OUTLINE,
			adapterName: this.name,
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
			suggestedNextReads: keys.slice(0, 10).map((k) => `symbol_exact:${k.path}`),
		};
	}

	async symbols(content: string, _filePath: string): Promise<SmartReadResult> {
		const yaml = getYaml();
		if (!yaml) {
			return this.makeFallbackResult(_filePath, "yaml parser not available");
		}

		const keys = this.collectKeys(content);
		const symbolList = keys.map((k) => `${k.type}: ${k.path} [L${k.line}-${k.endLine}]`).join("\n");

		return {
			content: symbolList || "[No symbols found]",
			mode: "symbols",
			mutationSafe: false,
			adapterConfidence: SMART_READ_CONFIDENCE.NATIVE_PARSER_EXACT - 0.05,
			adapterName: this.name,
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
			suggestedNextReads: keys.map((k) => `symbol_exact:${k.path}`),
		};
	}

	async symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		const yaml = getYaml();
		if (!yaml) {
			return this.makeNotFoundResult(symbol, filePath, "yaml parser not available");
		}

		try {
			const doc = this.getDocument(content);
			if (!doc || !doc.contents) {
				return this.makeNotFoundResult(symbol, filePath, "parse failed");
			}

			// Split path by dots — note: keys containing literal dots will be split incorrectly.
			const pathSegments = symbol.split(".");

			// Navigate the AST manually since yaml doesn't have findNodeAtLocation
			let currentNode: any = doc.contents;
			for (const segment of pathSegments) {
				if (!currentNode || !currentNode.items || !Array.isArray(currentNode.items)) {
					return this.makeNotFoundResult(symbol, filePath, `path segment "${segment}" not found`);
				}

				const found = currentNode.items.find((item: any) => {
					const keyVal = item.key?.value ?? item.key;
					return String(keyVal) === segment;
				});

				if (!found) {
					return this.makeNotFoundResult(symbol, filePath, `path segment "${segment}" not found`);
				}

				currentNode = found.value;
			}

			if (!currentNode) {
				return this.makeNotFoundResult(symbol, filePath, "value is null");
			}

			// Get exact line range from the node
			const startLine = (currentNode.lineRange?.[0] ?? 0) + 1;
			const endLine = (currentNode.lineRange?.[1] ?? 0) + 1;

			if (startLine === 0 || endLine === 0) {
				return this.makeNotFoundResult(symbol, filePath, "no line range available");
			}

			// Extract exact content
			const lines = content.split("\n");
			const exactContent = lines.slice(startLine - 1, endLine).join("\n");

			return {
				content: exactContent,
				mode: "symbol_exact",
				mutationSafe: true, // True because yaml parser gives us exact line ranges
				adapterConfidence: SMART_READ_CONFIDENCE.NATIVE_PARSER_EXACT,
				adapterName: this.name,
				parseSource: "native_parser" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: false,
				exactRange: {
					startLine,
					endLine,
				},
			};
		} catch (err) {
			return this.makeNotFoundResult(symbol, filePath, (err as Error).message);
		}
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
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
		};
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	private makeFallbackResult(_filePath: string, error: string): SmartReadResult {
		return {
			content: `[yaml parser error]\n${error}`,
			mode: "raw",
			mutationSafe: true,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "regex_fallback" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
			fallbackError: error,
		};
	}

	private makeNotFoundResult(symbol: string, filePath: string, extraError?: string): SmartReadResult {
		const errorMsg = extraError ? ` (${extraError})` : "";
		return {
			content: `[Path "${symbol}" not found in ${filePath}${errorMsg}]`,
			mode: "symbol_exact",
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
			fallbackError: `path "${symbol}" not found via yaml parser${errorMsg}`,
		};
	}

	private buildOutline(filePath: string, keys: YamlKeyInfo[], totalKeys: number): string {
		const lines: string[] = [];
		lines.push(`Key Path Outline (${filePath}):`);
		lines.push("=".repeat(40));
		for (const key of keys) {
			lines.push(`  [${key.type}] ${key.path} @ L${key.line}-${key.endLine}`);
		}
		if (totalKeys > keys.length) {
			lines.push(`  ... (${totalKeys - keys.length} more keys, use symbols mode for full list)`);
		}
		return lines.join("\n");
	}
}
