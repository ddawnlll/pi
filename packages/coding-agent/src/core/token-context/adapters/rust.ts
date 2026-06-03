/**
 * P43 Rust Smart Read Adapter - W014
 *
 * Detects structs, enums, traits, impl blocks, functions, mod declarations,
 * macros, and test modules.
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";

export class RustAdapter implements SmartReadAdapter {
	readonly name = "rust";
	readonly extensions = [".rs"];

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
		const symbolList = symbols
			.map((s) => `${s.kind}: ${s.name}${s.signature ? ` ${s.signature}` : ""} [L${s.line}]`)
			.join("\n");
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

			if (!trimmed || trimmed.startsWith("//")) continue;

			// Struct definition
			const structMatch = trimmed.match(
				/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?struct\s+(\w+)(?:<[^>]+>)?(?:\s*\([^)]*\))?\s*(?:\{|;)/,
			);
			if (structMatch) {
				symbols.push({
					name: structMatch[1],
					kind: "struct",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Enum definition
			const enumMatch = trimmed.match(/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?enum\s+(\w+)(?:<[^>]+>)?\s*\{/);
			if (enumMatch) {
				symbols.push({
					name: enumMatch[1],
					kind: "enum",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Trait definition
			const traitMatch = trimmed.match(
				/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)(?:<[^>]+>)?\s*(?:\{|;)/,
			);
			if (traitMatch) {
				symbols.push({
					name: traitMatch[1],
					kind: "trait",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Impl block
			const implMatch = trimmed.match(/^impl(?:\s*<[^>]+>)?\s+(?:(\w+)\s+for\s+)?(\w+)(?:<[^>]+>)?\s*\{/);
			if (implMatch) {
				const traitName = implMatch[1];
				const typeName = implMatch[2];
				const name = traitName ? `${traitName} for ${typeName}` : typeName;
				symbols.push({
					name,
					kind: "impl",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Function definition
			const funcMatch = trimmed.match(
				/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(/,
			);
			if (funcMatch) {
				symbols.push({
					name: funcMatch[1],
					kind: "function",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Module declaration
			const modMatch = trimmed.match(/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?mod\s+(\w+)\s*\{/);
			if (modMatch) {
				symbols.push({
					name: modMatch[1],
					kind: "mod",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Module declaration (file-based)
			const modFileMatch = trimmed.match(/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?mod\s+(\w+)\s*;/);
			if (modFileMatch) {
				symbols.push({
					name: modFileMatch[1],
					kind: "mod",
					line: lineNum,
				});
				continue;
			}

			// Use statement
			const useMatch = trimmed.match(/^use\s+(.+);/);
			if (useMatch) {
				const path = useMatch[1].length > 60 ? `${useMatch[1].slice(0, 57)}...` : useMatch[1];
				symbols.push({
					name: path,
					kind: "use",
					line: lineNum,
				});
				continue;
			}

			// Macro definition
			const macroMatch = trimmed.match(/^macro_rules!\s+(\w+)/);
			if (macroMatch) {
				symbols.push({
					name: macroMatch[1],
					kind: "macro",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
				});
				continue;
			}

			// Type alias
			const typeAliasMatch = trimmed.match(
				/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/,
			);
			if (typeAliasMatch) {
				symbols.push({
					name: typeAliasMatch[1],
					kind: "type",
					line: lineNum,
				});
				continue;
			}

			// Const/static
			const constMatch = trimmed.match(
				/^(?:pub(?:\s*\(\s*(?:crate|super)\s*\))?\s+)?(?:const|static)\s+(?:mut\s+)?(\w+)\s*:/,
			);
			if (constMatch) {
				symbols.push({
					name: constMatch[1],
					kind: "const",
					line: lineNum,
				});
				continue;
			}

			// Test module
			const testModuleMatch = trimmed.match(/^#\[cfg\(test\)\]/);
			if (testModuleMatch) {
				// Look ahead for mod tests
				for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
					const nextTrimmed = lines[j].trim();
					const modMatch = nextTrimmed.match(/^mod\s+(\w+)\s*\{/);
					if (modMatch) {
						symbols.push({
							name: modMatch[1],
							kind: "test-module",
							line: j + 1,
							endLine: this.findClosingBrace(lines, j, "{", "}"),
						});
						break;
					}
				}
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
			// Skip string literals
			const cleaned = line.replace(/(["'])(?:(?!\1).)*?\1/g, "").replace(/\/\/.*$/, "");
			for (let j = 0; j < cleaned.length; j++) {
				if (cleaned[j] === open) depth++;
				if (cleaned[j] === close) {
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
