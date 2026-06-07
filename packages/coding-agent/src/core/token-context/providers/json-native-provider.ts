/**
 * P43 Smart Read v2 — JSON/JSONC Native Parser Provider
 *
 * Uses jsonc-parser (Microsoft) for AST-backed exact path reads.
 * Priority: 95 (highest for JSON files).
 *
 * Optimizations:
 * - Line index built once per file (binary search for offset→line)
 * - Parse tree cached by content hash (avoids double parse)
 * - Single-pass offsetToLine via line index
 * - visit() extracted as private method
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

// Load jsonc-parser once
let _jsonc: any = null;
let _jsoncAvailable: boolean | null = null;

const _require = typeof require !== "undefined" ? require : createRequire(import.meta.url);

function getJsonc(): any {
	if (_jsoncAvailable !== null) return _jsonc;
	try {
		_jsonc = _require("jsonc-parser");
		_jsoncAvailable = true;
	} catch {
		_jsoncAvailable = false;
	}
	return _jsonc;
}

interface JsonKeyInfo {
	path: string;
	type: string;
	line: number;
	endLine: number;
}

export class JsonNativeProvider implements SmartReadProvider {
	readonly name = "json-native";
	readonly languageIds = ["json", "jsonc", "json5"];
	readonly extensions = [".json", ".jsonc", ".json5"];
	readonly priority = 95;

	// Tree cache: key is content hash, value is parsed tree
	private _treeCache = new Map<string, any>();
	private _cacheMaxSize = 10;

	isAvailable(): boolean {
		return getJsonc() !== null;
	}

	getCapabilities(): SmartReadProviderCapabilities {
		return {
			outline: true,
			symbols: true,
			symbolExact: true,
			rangeExact: true,
			changed: true,
			exactRanges: true,
			mutationSafeExact: true,
			semantic: false,
			astBacked: true,
		};
	}

	// ============================================================================
	// Line Index — build once, binary search for offset→line
	// ============================================================================

	private buildLineIndex(content: string): number[] {
		const offsets: number[] = [0];
		for (let i = 0; i < content.length; i++) {
			if (content[i] === "\n") offsets.push(i + 1);
		}
		return offsets;
	}

	private offsetToLineFast(lineIndex: number[], offset: number): number {
		let lo = 0;
		let hi = lineIndex.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineIndex[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1; // 1-indexed
	}

	// ============================================================================
	// Tree Cache — avoid double parse
	// ============================================================================

	private getContentKey(content: string): string {
		// Cheap but reasonably unique key: length + first 64 chars hash
		if (content.length < 128) return `${content.length}:${content}`;
		const prefix = content.slice(0, 64);
		const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
		return `${content.length}:${prefix}:${hash}`;
	}

	private getTree(content: string): any {
		const jsonc = getJsonc();
		if (!jsonc) return null;

		const key = this.getContentKey(content);
		if (this._treeCache.has(key)) {
			return this._treeCache.get(key);
		}

		const tree = jsonc.parseTree(content);
		this._treeCache.set(key, tree);

		// Evict oldest if cache is full
		if (this._treeCache.size > this._cacheMaxSize) {
			const firstKey = this._treeCache.keys().next().value;
			if (firstKey) this._treeCache.delete(firstKey);
		}

		return tree;
	}

	// ============================================================================
	// Key Collection — single pass with line index
	// ============================================================================

	private collectKeys(content: string): JsonKeyInfo[] {
		const jsonc = getJsonc();
		if (!jsonc) return [];

		const keys: JsonKeyInfo[] = [];
		const lineIndex = this.buildLineIndex(content);

		try {
			const tree = this.getTree(content);
			if (!tree) return [];

			this.visitNode(tree, [], content, lineIndex, keys);
		} catch {
			// jsonc-parser failure
		}

		return keys;
	}

	private visitNode(node: any, parentPath: string[], content: string, lineIndex: number[], keys: JsonKeyInfo[]): void {
		if (!node || typeof node !== "object") return;

		if (node.type === "property" && node.children && node.children.length >= 2) {
			const keyNode = node.children[0];
			const valueNode = node.children[1];
			const key = keyNode.value;

			if (typeof key === "string") {
				const currentPath = [...parentPath, key];
				const pathStr = currentPath.join(".");

				let type = "value";
				if (valueNode.type === "object") type = "object";
				else if (valueNode.type === "array") type = "array";
				else if (valueNode.type === "string") type = "string";
				else if (valueNode.type === "number") type = "number";
				else if (valueNode.type === "boolean") type = "boolean";
				else if (valueNode.type === "null") type = "null";

				const startLine = this.offsetToLineFast(lineIndex, keyNode.offset);
				const endOffset = valueNode.offset + (valueNode.length ?? 0);
				const endLine = this.offsetToLineFast(lineIndex, endOffset);

				keys.push({
					path: pathStr,
					type,
					line: startLine,
					endLine,
				});

				if (valueNode.children) {
					this.visitNode(valueNode, currentPath, content, lineIndex, keys);
				}
			}
		} else if (node.children) {
			for (const child of node.children) {
				this.visitNode(child, parentPath, content, lineIndex, keys);
			}
		}
	}

	// ============================================================================
	// Public API
	// ============================================================================

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		const jsonc = getJsonc();
		if (!jsonc) {
			return this.makeFallbackResult(filePath, "jsonc-parser not available");
		}

		const keys = this.collectKeys(content);
		if (keys.length === 0) {
			return {
				content: `[No JSON keys found in ${filePath}]`,
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
		const jsonc = getJsonc();
		if (!jsonc) {
			return this.makeFallbackResult(_filePath, "jsonc-parser not available");
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
		const jsonc = getJsonc();
		if (!jsonc) {
			return this.makeNotFoundResult(symbol, filePath, "jsonc-parser not available");
		}

		try {
			const tree = this.getTree(content);
			if (!tree) {
				return this.makeNotFoundResult(symbol, filePath, "parse failed");
			}

			// Split path by dots — note: keys containing literal dots will be split incorrectly.
			// For now, document this limitation. A quoted path syntax could be added later.
			const pathSegments = symbol.split(".");

			// Use jsonc-parser's findNodeAtLocation for O(1) AST navigation
			const node = jsonc.findNodeAtLocation(tree, pathSegments);

			if (!node) {
				return this.makeNotFoundResult(symbol, filePath);
			}

			const startOffset = node.offset;
			const endOffset = node.offset + (node.length ?? 0);

			// Build line index once for both start and end
			const lineIndex = this.buildLineIndex(content);
			const startLine = this.offsetToLineFast(lineIndex, startOffset);
			const endLine = this.offsetToLineFast(lineIndex, endOffset);

			// Extract exact content using line index
			const lines = content.split("\n");
			const exactContent = lines.slice(startLine - 1, endLine).join("\n");

			return {
				content: exactContent,
				mode: "symbol_exact",
				mutationSafe: true, // True because jsonc-parser gives us exact AST positions
				adapterConfidence: SMART_READ_CONFIDENCE.NATIVE_PARSER_EXACT,
				adapterName: this.name,
				parseSource: "native_parser" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: false,
				exactRange: {
					startLine,
					endLine,
					startOffset,
					endOffset,
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
			content: `[jsonc-parser error — raw JSON]\n${error}`,
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
			fallbackError: `path "${symbol}" not found via jsonc-parser${errorMsg}`,
		};
	}

	private buildOutline(filePath: string, keys: JsonKeyInfo[], totalKeys: number): string {
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
