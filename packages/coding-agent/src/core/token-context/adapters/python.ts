/**
 * P43 Python Smart Read Adapter - W012
 *
 * Detects classes, functions, methods, decorators, and exact ranges.
 * Regex-based, reports confidence.
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";

export class PythonAdapter implements SmartReadAdapter {
	readonly name = "python";
	readonly extensions = [".py", ".pyw", ".pyx", ".pxd", ".pxi"];

	async outline(content: string, _filePath: string): Promise<SmartReadResult> {
		const symbols = this.extractSymbols(content);
		const outline = this.buildOutline(symbols);
		return {
			content: outline,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: 0.85,
			adapterName: this.name,
			isFallback: false,
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
			adapterConfidence: 0.85,
			adapterName: this.name,
			isFallback: false,
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
				fallbackError: `symbol "${symbol}" not found`,
			};
		}

		const endLine = match.endLine ?? match.line + 20;
		const exactContent = lines.slice(match.line - 1, endLine).join("\n");

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

			// Function/method definition (async def too)
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
		// Python blocks end when indentation returns to base level
		let i = startIdx + 1;
		// Skip the ":" line - the block starts at the next line
		while (i < lines.length) {
			const line = lines[i];
			if (line.trim() === "") {
				i++;
				continue;
			}
			const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
			if (indent <= baseIndent) {
				return i; // end line is exclusive (line number)
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
