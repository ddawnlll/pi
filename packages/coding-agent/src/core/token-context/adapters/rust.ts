/**
 * P43 Rust Smart Read Regex Fallback Adapter - W014
 *
 * v2: Demoted to regex fallback. Confidence capped at 0.45.
 * symbol_exact is never mutation-safe.
 * Primary Rust provider is tree-sitter WASM (or rust-analyzer if explicitly configured).
 * No rust-analyzer required by default.
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

export class RustAdapter implements SmartReadAdapter {
	readonly name = "rust-regex-fallback";
	readonly extensions = [".rs"];

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
			fallbackError: "regex fallback: Rust outline is approximate",
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
			adapterConfidence: SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX,
			adapterName: this.name,
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex fallback: Rust symbol list is approximate",
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
