/**
 * P43 JSON/YAML Smart Read Adapter - W013
 *
 * Detects key paths, summarizes large arrays/objects,
 * and supports exact path/range reads.
 * JSON and YAML support via regex parsing.
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";

export class JsonYamlAdapter implements SmartReadAdapter {
	readonly name = "json-yaml";
	readonly extensions = [".json", ".yaml", ".yml", ".jsonc", ".json5"];

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");
		const keys = isYaml ? this.extractYamlKeys(content) : this.extractJsonKeys(content);

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
			adapterConfidence: 0.9,
			adapterName: this.name,
			isFallback: false,
			suggestedNextReads: keys.slice(0, 10).map((k) => k.path),
		};
	}

	async symbols(content: string, filePath: string): Promise<SmartReadResult> {
		const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");
		const keys = isYaml ? this.extractYamlKeys(content) : this.extractJsonKeys(content);
		const symbolList = keys.map((k) => `${k.type}: ${k.path} [L${k.line}]`).join("\n");

		return {
			content: symbolList,
			mode: "symbols",
			mutationSafe: false,
			adapterConfidence: 0.85,
			adapterName: this.name,
			isFallback: false,
			suggestedNextReads: keys.map((k) => k.path),
		};
	}

	async symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		const range = this.findPathRange(content, symbol);
		if (!range) {
			return {
				content: `[Path "${symbol}" not found in ${filePath}]`,
				mode: "symbol_exact",
				mutationSafe: false,
				adapterConfidence: 0.1,
				adapterName: this.name,
				isFallback: true,
				fallbackError: `path "${symbol}" not found`,
			};
		}

		const lines = content.split("\n");
		const exactContent = lines.slice(range.start - 1, range.end).join("\n");

		return {
			content: exactContent,
			mode: "symbol_exact",
			mutationSafe: true,
			adapterConfidence: 0.95,
			adapterName: this.name,
			isFallback: false,
		};
	}

	async rangeExact(content: string, _filePath: string, startLine: number, endLine: number): Promise<SmartReadResult> {
		const lines = content.split("\n");
		const range = lines.slice(startLine - 1, endLine).join("\n");
		return {
			content: range,
			mode: "range_exact",
			mutationSafe: true,
			adapterConfidence: 1.0,
			adapterName: this.name,
			isFallback: false,
		};
	}

	async changed(_content: string, filePath: string, delta: string): Promise<SmartReadResult> {
		return {
			content: `[Changed content based on delta for ${filePath}]\n${delta}`,
			mode: "changed",
			mutationSafe: false,
			adapterConfidence: 0.7,
			adapterName: this.name,
			isFallback: false,
		};
	}

	// ============================================================================
	// JSON Key Extraction
	// ============================================================================

	private extractJsonKeys(content: string): KeyInfo[] {
		const keys: KeyInfo[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const trimmed = lines[i].trim();

			const keyMatch = trimmed.match(/^"([^"]+)"\s*:/);
			if (keyMatch) {
				keys.push({
					path: keyMatch[1],
					type: this.inferJsonType(lines, i),
					line: lineNum,
				});
			}
		}

		return keys;
	}

	private inferJsonType(lines: string[], idx: number): string {
		const trimmed = lines[idx].trim();
		if (trimmed.includes('"')) return "string";
		if (trimmed.includes("[")) return "array";
		if (trimmed.includes("{")) return "object";
		if (trimmed.match(/:\s*(true|false)/)) return "boolean";
		if (trimmed.match(/:\s*null/)) return "null";
		if (trimmed.match(/:\s*\d/)) return "number";
		return "value";
	}

	// ============================================================================
	// YAML Key Extraction
	// ============================================================================

	private extractYamlKeys(content: string): KeyInfo[] {
		const keys: KeyInfo[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const line = lines[i];

			// Skip comments and empty lines
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") continue;

			const keyMatch = line.match(/^(\s*)([\w-]+)\s*:/);
			if (keyMatch) {
				const indent = keyMatch[1].length;
				const key = keyMatch[2];
				keys.push({
					path: indent > 0 ? `${"  ".repeat(indent / 2)}${key}` : key,
					type: this.inferYamlType(lines, i),
					line: lineNum,
				});
			}

			// List items
			const listMatch = line.match(/^(\s*)-\s+/);
			if (listMatch) {
				const indent = listMatch[1].length;
				const value = trimmed.slice(2).trim().slice(0, 40);
				keys.push({
					path: indent > 0 ? `${"  ".repeat(indent / 2)}- ${value}` : `- ${value}`,
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

	private buildOutline(filePath: string, keys: KeyInfo[], totalKeys: number): string {
		const lines: string[] = [];
		lines.push(`Key Path Outline (${filePath}):`);
		lines.push("=".repeat(40));
		for (const key of keys) {
			lines.push(`  [${key.type}] ${key.path} @ L${key.line}`);
		}
		if (totalKeys > keys.length) {
			lines.push(`  ... (${totalKeys - keys.length} more keys, use symbols mode for full list)`);
		}
		return lines.join("\n");
	}

	private findPathRange(content: string, path: string): { start: number; end: number } | undefined {
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			// Match key in JSON or YAML
			const keyMatch =
				trimmed.match(new RegExp(`^"${this.escapeRegExp(path)}"\\s*:`)) ??
				trimmed.match(new RegExp(`^${this.escapeRegExp(path)}\\s*:`));

			if (keyMatch) {
				const start = i + 1;
				const indent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;

				// Find the end of this block
				let end = lines.length;
				for (let j = i + 1; j < lines.length; j++) {
					const nextLine = lines[j].trim();
					if (!nextLine) continue;
					const nextIndent = lines[j].match(/^(\s*)/)?.[1].length ?? 0;
					if (nextIndent <= indent && !nextLine.startsWith(",")) {
						// Don't stop at trailing commas or closing braces at same indent
						if (!nextLine.match(/^[}\]]/) && !nextLine.trim().startsWith(",")) {
							end = j;
							break;
						}
					}
				}
				return { start, end };
			}
		}
		return undefined;
	}

	private escapeRegExp(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}

interface KeyInfo {
	path: string;
	type: string;
	line: number;
}
