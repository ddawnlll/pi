/**
 * P43 Smart Read v2 — YAML Native Parser Provider
 *
 * Uses the "yaml" npm package (already a dependency) for AST-backed reads.
 * Priority: 90 for YAML files.
 *
 * npm-only: depends on "yaml" which is already in package.json dependencies.
 * Exact ranges are available when the parser provides them; otherwise,
 * mutation safety is not claimed for symbol_exact.
 */

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
	endLine?: number;
}

let _yamlModule: any = null;
let _yamlAvailable: boolean | null = null;

function getYaml(): any {
	if (_yamlAvailable !== null) return _yamlModule;
	try {
		_yamlModule = require("yaml");
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
			exactRanges: true, // May not have exact ranges for all nodes
			mutationSafeExact: false, // Only true when exact range is available
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
		const symbolList = keys
			.map((k) => {
				const range = k.endLine ? ` L${k.line}-${k.endLine}` : ` L${k.line}`;
				return `${k.type}: ${k.path}${range}`;
			})
			.join("\n");

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
		const match = keys.find((k) => k.path === symbol);

		if (!match) {
			return {
				content: `[Path "${symbol}" not found in ${filePath}]`,
				mode: "symbol_exact",
				mutationSafe: false,
				adapterConfidence: 0.1,
				adapterName: this.name,
				parseSource: "native_parser" as SmartReadParseSource,
				providerName: this.name,
				isFallback: true,
				fallbackError: `path "${symbol}" not found via YAML parser`,
			};
		}

		const lines = content.split("\n");
		const endLine = match.endLine ?? Math.min(match.line + 20, lines.length);
		const exactContent = lines.slice(match.line - 1, endLine).join("\n");

		// YAML exact range is only mutation-safe if we have a verified endLine
		const exactRangeKnown = !!match.endLine && match.endLine > match.line;

		return {
			content: exactContent,
			mode: "symbol_exact",
			mutationSafe: exactRangeKnown,
			adapterConfidence: exactRangeKnown ? SMART_READ_CONFIDENCE.NATIVE_PARSER_EXACT : 0.7,
			adapterName: this.name,
			parseSource: "native_parser" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: !exactRangeKnown,
			exactRange: exactRangeKnown ? { startLine: match.line, endLine } : undefined,
			fallbackError: exactRangeKnown ? undefined : "exact YAML range unavailable",
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
	// Key extraction using yaml parser
	// ============================================================================

	private extractKeys(content: string): YamlKeyInfo[] {
		const yaml = getYaml();
		if (!yaml) return [];

		const keys: YamlKeyInfo[] = [];
		const _lines = content.split("\n");

		try {
			const doc = yaml.parseDocument(content);
			const root = doc.contents;
			if (!root) return [];

			function visit(node: any, path: string[], depth: number) {
				if (!node || typeof node !== "object") return;

				// YAML mapping (key-value pairs)
				if (node.items && Array.isArray(node.items)) {
					let maxEndLine = 0;
					const entries: Array<{ key: any; value: any }> = [];

					for (const item of node.items) {
						if (item.key) {
							const keyStr = String(item.key.value ?? item.key);
							const currentPath = [...path, keyStr];
							const pathStr = currentPath.join(".");

							// Try to get line information
							const keyLine = (item.key.lineRange?.[0] ?? 0) + 1;
							let valueEndLine = keyLine;

							if (item.value) {
								if (item.value.lineRange) {
									valueEndLine = (item.value.lineRange[1] ?? 0) + 1;
								} else if (item.value.items && Array.isArray(item.value.items)) {
									// For nested mappings/sequences, find the last child's end line
									for (const child of item.value.items) {
										if (child.value?.lineRange) {
											valueEndLine = Math.max(valueEndLine, (child.value.lineRange[1] ?? 0) + 1);
										}
									}
								}
							}

							let type = "value";
							if (item.value) {
								if (item.value.items && Array.isArray(item.value.items)) {
									type = item.value.items.some((i: any) => i.key) ? "object" : "array";
								}
							}

							maxEndLine = Math.max(maxEndLine, valueEndLine);

							keys.push({
								path: pathStr,
								type,
								line: keyLine,
								endLine: valueEndLine > keyLine ? valueEndLine : undefined,
							});

							entries.push({ key: item.key, value: item.value });
						}
					}

					// Recurse into child values that are mappings/sequences
					for (const entry of entries) {
						if (entry.value) {
							const currentPath = [...path, String(entry.key.value ?? entry.key)];
							visit(entry.value, currentPath, depth + 1);
						}
					}
				}

				// YAML sequence (list items)
				if (node.items && Array.isArray(node.items) && !node.items.some((i: any) => i.key)) {
					for (let i = 0; i < node.items.length; i++) {
						const item = node.items[i];
						const currentPath = [...path, `${i}`];
						visit(item, currentPath, depth + 1);
					}
				}
			}

			visit(root, [], 0);
		} catch {
			// Parser error - fall back to regex extraction
			return this.extractKeysRegex(content);
		}

		return keys;
	}

	private extractKeysRegex(content: string): YamlKeyInfo[] {
		const keys: YamlKeyInfo[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const line = lines[i];
			const trimmed = line.trim();

			if (!trimmed || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") continue;

			// Top-level key: value
			const keyMatch = line.match(/^(\s*)([\w.-]+)\s*:/);
			if (keyMatch) {
				const _indent = keyMatch[1].length;
				const key = keyMatch[2];
				keys.push({
					path: key,
					type: this.inferYamlType(lines, i),
					line: lineNum,
				});
			}

			// List items
			const listMatch = line.match(/^(\s*)-\s+/);
			if (listMatch) {
				const _indent = listMatch[1].length;
				const value = trimmed.slice(2).trim().slice(0, 40);
				keys.push({
					path: value,
					type: "list-item",
					line: lineNum,
				});
			}
		}

		return keys;
	}

	private inferYamlType(lines: string[], idx: number): string {
		const trimmed = lines[idx].trim();
		if (trimmed.match(/:\s*\{/)) return "object";
		if (trimmed.match(/:\s*\[/)) return "array";
		if (trimmed.match(/:\s*(true|false)/)) return "boolean";
		if (trimmed.match(/:\s*\d/)) return "number";
		if (trimmed.match(/:\s*null|:\s*~/)) return "null";
		if (trimmed.match(/:\s*["']/)) return "string";
		// Check next line indentation for nested content
		if (idx + 1 < lines.length) {
			const nextLine = lines[idx + 1];
			const nextTrimmed = nextLine.trim();
			const currentIndent = lines[idx].match(/^(\s*)/)?.[1].length ?? 0;
			const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
			if (nextIndent > currentIndent && nextTrimmed) {
				if (nextTrimmed.startsWith("- ")) return "array";
				return "object";
			}
		}
		return "value";
	}

	private buildOutline(filePath: string, keys: YamlKeyInfo[], totalKeys: number): string {
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
