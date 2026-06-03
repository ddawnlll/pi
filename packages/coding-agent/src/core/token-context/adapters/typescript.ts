/**
 * P43 TypeScript/JavaScript Smart Read Adapter - W011
 *
 * Detects imports, exports, classes, methods, functions, and symbol ranges.
 * Uses regex-based parsing (no tree-sitter dependency).
 * Reports confidence level based on match quality.
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";

export class TypeScriptAdapter implements SmartReadAdapter {
	readonly name = "typescript";
	readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

	async outline(content: string, _filePath: string): Promise<SmartReadResult> {
		const symbols = this.extractSymbols(content);
		const outline = this.buildOutline(symbols);
		return {
			content: outline,
			mode: "outline",
			mutationSafe: false, // I002: outline is not mutation-safe
			adapterConfidence: 0.9,
			adapterName: this.name,
			isFallback: false,
			suggestedNextReads: symbols.slice(0, 10).map((s) => s.name),
		};
	}

	async symbols(content: string, _filePath: string): Promise<SmartReadResult> {
		const symbols = this.extractSymbols(content);
		const symbolList = symbols.map((s) => `${s.kind}: ${s.name} (${s.signature ?? ""}) [L${s.line}]`).join("\n");
		return {
			content: symbolList,
			mode: "symbols",
			mutationSafe: false, // I002
			adapterConfidence: 0.9,
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

		// Extract exact lines for this symbol
		const endLine = match.endLine ?? match.line + 20;
		const exactContent = lines.slice(match.line - 1, endLine).join("\n");

		return {
			content: exactContent,
			mode: "symbol_exact",
			mutationSafe: true, // I003: exact symbol read is mutation-safe
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
			mutationSafe: true, // I003: exact range is mutation-safe
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
	// Symbol Extraction (regex-based)
	// ============================================================================

	private extractSymbols(content: string): SymbolInfo[] {
		const symbols: SymbolInfo[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const line = lines[i];

			// Skip comments and empty lines
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
				continue;
			}

			// Import statements
			const importMatch = trimmed.match(
				/^import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/,
			);
			if (importMatch) {
				symbols.push({
					name: trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed,
					kind: "import",
					line: lineNum,
					signature: `from "${importMatch[1]}"`,
				});
				continue;
			}

			// Export statements
			if (trimmed.startsWith("export ")) {
				const exportMatch = trimmed.match(
					/^export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface|enum|async\s+function)\s+(\w+)/,
				);
				if (exportMatch) {
					symbols.push({
						name: exportMatch[1],
						kind: "export",
						line: lineNum,
					});
					continue;
				}
				if (trimmed.match(/^export\s+\{[^}]+\}/)) {
					symbols.push({
						name: trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed,
						kind: "export",
						line: lineNum,
					});
					continue;
				}
				if (trimmed.startsWith("export default ")) {
					symbols.push({
						name: "default",
						kind: "export",
						line: lineNum,
					});
					continue;
				}
			}

			// Class declarations
			const classMatch = trimmed.match(
				/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+(?:\.\w+)*))?(?:\s+implements\s+.+)?\s*\{/,
			);
			if (classMatch) {
				symbols.push({
					name: classMatch[1],
					kind: "class",
					line: lineNum,
					signature: classMatch[2] ? `extends ${classMatch[2]}` : undefined,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Interface declarations
			const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+.+)?\s*\{/);
			if (interfaceMatch) {
				symbols.push({
					name: interfaceMatch[1],
					kind: "interface",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Type aliases
			const typeMatch = trimmed.match(/^(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/);
			if (typeMatch) {
				symbols.push({
					name: typeMatch[1],
					kind: "type",
					line: lineNum,
				});
				continue;
			}

			// Enum declarations
			const enumMatch = trimmed.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/);
			if (enumMatch) {
				symbols.push({
					name: enumMatch[1],
					kind: "enum",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Function declarations (including async)
			const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)/);
			if (funcMatch) {
				symbols.push({
					name: funcMatch[1],
					kind: "function",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}") ?? lineNum + 5,
				});
				continue;
			}

			// Arrow functions assigned to const
			const arrowMatch = trimmed.match(
				/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[^=]+)?\s*=>|:\s*(?:[^=]+)\s*=>)/,
			);
			if (arrowMatch) {
				symbols.push({
					name: arrowMatch[1],
					kind: "function",
					line: lineNum,
				});
				continue;
			}

			// Method declarations (within class body, detect by indentation)
			const methodMatch = trimmed.match(
				/^(?:\s{2,})?(?:public|private|protected|static|async|abstract)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*\w+(?:<[^>]+>)?(?:\s*\|\s*\w+(?:<[^>]+>)?)*)?\s*\{/,
			);
			if (methodMatch && !["if", "for", "while", "switch", "catch", "try"].includes(methodMatch[1])) {
				symbols.push({
					name: methodMatch[1],
					kind: "method",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Variable declarations with type annotations
			const varMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?!\{)/);
			if (varMatch) {
				symbols.push({
					name: varMatch[1],
					kind: "variable",
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
			const sig = sym.signature ? ` ${sym.signature}` : "";
			lines.push(`  [${sym.kind}] ${sym.name}${sig} @ L${sym.line}`);
		}
		return lines.join("\n");
	}

	private findClosingBrace(lines: string[], startIdx: number, open: string, close: string): number | undefined {
		let depth = 0;
		for (let i = startIdx; i < lines.length; i++) {
			const line = lines[i];
			for (let j = 0; j < line.length; j++) {
				if (line[j] === open) depth++;
				if (line[j] === close) {
					depth--;
					if (depth === 0) return i + 1;
				}
			}
		}
		return undefined;
	}
}

interface SymbolInfo {
	name: string;
	kind: string;
	line: number;
	endLine?: number;
	signature?: string;
}
