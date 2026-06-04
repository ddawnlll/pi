/**
 * P43 Smart Read v2 — JSON/JSONC Native Parser Provider
 *
 * Uses jsonc-parser for AST-backed exact path reads when available.
 * Falls back to basic JSON.parse for simple cases.
 * Priority: 95 (highest for JSON files).
 *
 * npm-only: depends on "jsonc-parser" (already available in many projects).
 */

import type {
	SmartReadParseSource,
	SmartReadProvider,
	SmartReadProviderCapabilities,
	SmartReadResult,
} from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

interface JsonKeyInfo {
	path: string;
	type: string;
	line: number;
	endLine?: number;
	startOffset?: number;
	endOffset?: number;
}

// Try to load jsonc-parser dynamically
let _jsoncParser: any = null;
let _jsoncAvailable: boolean | null = null;

function getJsoncParser(): any {
	if (_jsoncAvailable !== null) return _jsoncParser;
	try {
		_jsoncParser = require("jsonc-parser");
		_jsoncAvailable = true;
	} catch {
		_jsoncAvailable = false;
	}
	return _jsoncParser;
}

export class JsonNativeProvider implements SmartReadProvider {
	readonly name = "json-native";
	readonly languageIds = ["json", "jsonc", "json5"];
	readonly extensions = [".json", ".jsonc", ".json5"];
	readonly priority = 95;

	isAvailable(): boolean {
		return getJsoncParser() !== null;
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

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		const keys = this.extractKeys(content);
		const threshold = 20;
		let outline: string;

		if (keys.length > threshold) {
			const summary = keys.slice(0, threshold);
			outline = this.buildOutline(filePath, summary, keys.length);
		} else {
			outline = this.buildOutline(filePath, keys, keys.length);
		}

		return {
			content: outline,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence:
				keys.length > 0 ? SMART_READ_CONFIDENCE.NATIVE_PARSER_OUTLINE : SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX,
			adapterName: this.name,
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
			suggestedNextReads: keys.slice(0, 10).map((k) => `symbol_exact:${k.path}`),
		};
	}

	async symbols(content: string, _filePath: string): Promise<SmartReadResult> {
		const keys = this.extractKeys(content);
		const symbolList = keys.map((k) => `${k.type}: ${k.path} [L${k.line}]`).join("\n");

		return {
			content: symbolList,
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
		const keys = this.extractKeys(content);
		const keyPath = symbol;

		// Try exact path match
		const match = keys.find((k) => k.path === keyPath);

		if (!match) {
			// Try nested path match (e.g., "compilerOptions.paths")
			const segments = keyPath.split(".");
			const nestedMatch = keys.find((k) => {
				const kSegments = k.path.split(".");
				return (
					segments.length > 1 &&
					kSegments.length >= segments.length &&
					segments.every((s, i) => s === kSegments[i])
				);
			});

			if (!nestedMatch) {
				return {
					content: `[Path "${symbol}" not found in ${filePath}]`,
					mode: "symbol_exact",
					mutationSafe: false,
					adapterConfidence: 0.1,
					adapterName: this.name,
					parseSource: "native_parser" as SmartReadParseSource,
					providerName: this.name,
					isFallback: true,
					fallbackError: `path "${symbol}" not found via native parser`,
				};
			}

			const lines = content.split("\n");
			const endLine = nestedMatch.endLine ?? lines.length;
			const exactContent = lines.slice(nestedMatch.line - 1, endLine).join("\n");

			return {
				content: exactContent,
				mode: "symbol_exact",
				mutationSafe: true,
				adapterConfidence: SMART_READ_CONFIDENCE.NATIVE_PARSER_EXACT,
				adapterName: this.name,
				parseSource: "native_parser" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: false,
				exactRange: {
					startLine: nestedMatch.line,
					endLine: endLine,
					startOffset: nestedMatch.startOffset,
					endOffset: nestedMatch.endOffset,
				},
			};
		}

		const lines = content.split("\n");
		const endLine = match.endLine ?? lines.length;
		const exactContent = lines.slice(match.line - 1, endLine).join("\n");

		return {
			content: exactContent,
			mode: "symbol_exact",
			mutationSafe: true,
			adapterConfidence: SMART_READ_CONFIDENCE.NATIVE_PARSER_EXACT,
			adapterName: this.name,
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
			exactRange: {
				startLine: match.line,
				endLine: endLine,
				startOffset: match.startOffset,
				endOffset: match.endOffset,
			},
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
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
		};
	}

	// ============================================================================
	// Key extraction using jsonc-parser when available, fallback to JSON.parse
	// ============================================================================

	private extractKeys(content: string): JsonKeyInfo[] {
		const parser = getJsoncParser();
		if (parser) {
			return this.extractKeysWithParser(content, parser);
		}
		return this.extractKeysSimple(content);
	}

	private extractKeysWithParser(content: string, parser: any): JsonKeyInfo[] {
		const keys: JsonKeyInfo[] = [];
		const _lines = content.split("\n");
		const _offsetToLine = (offset: number): number => {
			let line = 0;
			for (let i = 0; i < offset && i < content.length; i++) {
				if (content[i] === "\n") line++;
			}
			return line;
		};

		try {
			const tree = parser.parseTree(content);
			if (!tree) return [];

			function visit(node: any, parentPath: string[]) {
				if (node.type === "property" && node.children && node.children.length >= 2) {
					const keyNode = node.children[0];
					const valueNode = node.children[1];
					const key = keyNode.value;

					if (typeof key === "string") {
						const currentPath = [...parentPath, key];
						const pathStr = currentPath.join(".");

						// Get line numbers from offsets
						const startOffset = keyNode.offset;
						const endOffset = valueNode.offset + (valueNode.length ?? 0);

						// Simple offset-to-line mapping using local helper
						const startLine = _offsetToLine(startOffset) + 1;
						const endLine = _offsetToLine(endOffset) + 1;

						let type = "value";
						if (valueNode.type === "object") type = "object";
						else if (valueNode.type === "array") type = "array";
						else if (valueNode.type === "string") type = "string";
						else if (valueNode.type === "number") type = "number";
						else if (valueNode.type === "boolean") type = "boolean";
						else if (valueNode.type === "null") type = "null";

						keys.push({
							path: pathStr,
							type,
							line: startLine,
							endLine,
							startOffset,
							endOffset,
						});

						if (valueNode.children) {
							visit(valueNode, currentPath);
						}
					}
				} else if (node.children) {
					for (const child of node.children) {
						visit(child, parentPath);
					}
				}
			}

			visit(tree, []);
		} catch {
			// Fall through to simple extraction
			return this.extractKeysSimple(content);
		}

		return keys;
	}

	private extractKeysSimple(content: string): JsonKeyInfo[] {
		const keys: JsonKeyInfo[] = [];
		const lines = content.split("\n");
		const pathStack: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const trimmed = lines[i].trim();

			// Track object/array depth from brackets
			const openObjects = (trimmed.match(/\{/g) || []).length;
			const closeObjects = (trimmed.match(/\}/g) || []).length;

			const keyMatch = trimmed.match(/^"([^"]+)"\s*:/);
			if (keyMatch) {
				const key = keyMatch[1];

				let type = "value";
				if (trimmed.includes("{")) type = "object";
				else if (trimmed.includes("[")) type = "array";
				else if (trimmed.includes('"')) type = "string";
				else if (trimmed.match(/:\s*(true|false)/)) type = "boolean";
				else if (trimmed.match(/:\s*null/)) type = "null";
				else if (trimmed.match(/:\s*\d/)) type = "number";

				// Build path using current depth tracking
				const path = pathStack.length > 0 ? `${pathStack.join(".")}.${key}` : key;

				keys.push({ path, type, line: lineNum });
			}

			// Update path stack for object depth
			for (let j = 0; j < openObjects - closeObjects; j++) {
				// We don't know the key of the current object from this line alone
				// This is a best-effort
			}
		}

		return keys;
	}

	private buildOutline(filePath: string, keys: JsonKeyInfo[], totalKeys: number): string {
		const lines: string[] = [];
		lines.push(`Key Path Outline (${filePath}):`);
		lines.push("=".repeat(40));
		for (const key of keys) {
			const range = key.endLine ? ` @ L${key.line}-${key.endLine}` : ` @ L${key.line}`;
			lines.push(`  [${key.type}] ${key.path}${range}`);
		}
		if (totalKeys > keys.length) {
			lines.push(`  ... (${totalKeys - keys.length} more keys, use symbols mode for full list)`);
		}
		return lines.join("\n");
	}
}
