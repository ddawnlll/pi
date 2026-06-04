/**
 * P43 Python Smart Read Regex Fallback Adapter - W012
 *
 * v2: Demoted to regex fallback. Confidence capped at 0.45.
 * symbol_exact is never mutation-safe.
 * Primary Python provider is tree-sitter WASM or deferred Pyright.
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

export class PythonAdapter implements SmartReadAdapter {
	readonly name = "python-regex-fallback";
	readonly extensions = [".py", ".pyw", ".pyx", ".pxd", ".pxi"];

	async outline(content: string, _filePath: string): Promise<SmartReadResult> {
		const symbols = this.extractSymbols(content);
		const outline = this.buildOutline(symbols);
		return {
			content: outline,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: symbols.length > 0 ? SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX : 0.3,
			adapterName: this.name,
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex fallback: Python outline is approximate",
			suggestedNextReads: symbols.slice(0, 10).map((s) => s.name),
		};
	}

	async symbols(content: string, _filePath: string): Promise<SmartReadResult> {
		const symbols = this.extractSymbols(content);
		const symbolList = symbols.map((s) => `${s.kind}: ${s.name}(${s.signature ?? ""}) [L${s.line}]`).join("\n");
		return {
			content: symbolList,
			mode: "symbols",
			mutationSafe: false,
			adapterConfidence: SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX,
			adapterName: this.name,
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex fallback: Python symbol list is approximate",
			suggestedNextReads: symbols.map((s) => s.name),
		};
	}

	async symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		const lines = content.split("\n");
		const symbols = this.extractSymbols(content);
		const match = symbols.find((s) => s.name === symbol);

		if (!match) {
			return {
				content: `[Symbol "${symbol}" not found in ${filePath}]`,
				mode: "symbol_exact",
				mutationSafe: false,
				adapterConfidence: 0.1,
				adapterName: this.name,
				isFallback: true,
				parseSource: "regex_fallback",
				fallbackError: `symbol "${symbol}" not found via regex`,
			};
		}

		const endLine = match.endLine ?? match.line + 20;
		const exactContent = lines.slice(match.line - 1, endLine).join("\n");

		return {
			content: exactContent,
			mode: "symbol_exact",
			mutationSafe: false, // I005: regex fallback never mutation-safe for symbol_exact
			adapterConfidence: match.endLine ? SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX : 0.35,
			adapterName: this.name,
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex fallback cannot guarantee exact symbol boundaries",
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
			parseSource: "raw",
		};
	}

	async changed(_content: string, filePath: string, delta: string): Promise<SmartReadResult> {
		return {
			content: `[Changed content based on delta for ${filePath}]\n${delta}`,
			mode: "changed",
			mutationSafe: false,
			adapterConfidence: SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX,
			adapterName: this.name,
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex fallback changed detection is unreliable",
		};
	}

	private extractSymbols(content: string): SymbolInfo[] {
		const symbols: SymbolInfo[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const line = lines[i];
			const trimmed = line.trim();

			if (!trimmed || trimmed.startsWith("#")) continue;

			// Class definition
			const classMatch = trimmed.match(/^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/);
			if (classMatch) {
				const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
				symbols.push({
					name: classMatch[1],
					kind: "class",
					line: lineNum,
					signature: classMatch[2],
					indent,
					endLine: this.findBlockEnd(lines, i, indent),
				});
				continue;
			}

			// Function/method definition
			const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*\S+)?\s*:/);
			if (funcMatch) {
				const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
				symbols.push({
					name: funcMatch[1],
					kind: indent > 0 ? "method" : "function",
					line: lineNum,
					signature: funcMatch[2].length > 40 ? `${funcMatch[2].slice(0, 37)}...` : funcMatch[2],
					indent,
					endLine: this.findBlockEnd(lines, i, indent),
				});
				continue;
			}

			// Decorator
			if (trimmed.startsWith("@")) {
				const decMatch = trimmed.match(/^@(\w+(?:\.\w+)*)/);
				if (decMatch) {
					symbols.push({
						name: `@${decMatch[1]}`,
						kind: "decorator",
						line: lineNum,
					});
				}
				continue;
			}

			// Top-level variable assignments (constants)
			const varMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*/);
			if (varMatch && !trimmed.includes("(")) {
				symbols.push({
					name: varMatch[1],
					kind: "constant",
					line: lineNum,
				});
			}
		}

		return symbols;
	}

	private buildOutline(symbols: SymbolInfo[]): string {
		const lines: string[] = [];
		lines.push("Symbol Outline:");
		lines.push("==============");
		for (const sym of symbols) {
			const sig = sym.signature ? `(${sym.signature})` : "";
			lines.push(`  [${sym.kind}] ${sym.name}${sig} @ L${sym.line}`);
		}
		return lines.join("\n");
	}

	private findBlockEnd(lines: string[], startIdx: number, baseIndent: number): number | undefined {
		let i = startIdx + 1;
		while (i < lines.length) {
			const line = lines[i];
			if (line.trim() === "") {
				i++;
				continue;
			}
			const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
			if (indent <= baseIndent) {
				return i;
			}
			i++;
		}
		return lines.length;
	}
}

interface SymbolInfo {
	name: string;
	kind: string;
	line: number;
	endLine?: number;
	signature?: string;
	indent?: number;
}
