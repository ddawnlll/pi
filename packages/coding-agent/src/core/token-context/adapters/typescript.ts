/**
 * P43 TypeScript/JavaScript Smart Read Regex Fallback Adapter - W011
 *
 * v2: Demoted to regex fallback. Confidence capped at 0.45.
 * symbol_exact is never mutation-safe.
 * Primary provider for TypeScript is now TypeScriptCompilerProvider.
 *
 * Kept as fallback when TypeScript compiler is unavailable.
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

export class TypeScriptAdapter implements SmartReadAdapter {
	readonly name = "typescript-regex-fallback";
	readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

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
			fallbackError: "regex fallback: cannot guarantee exact symbol boundaries",
			suggestedNextReads: symbols.slice(0, 10).map((s) => s.name),
		};
	}

	async symbols(content: string, _filePath: string): Promise<SmartReadResult> {
		const symbols = this.extractSymbols(content);
		const symbolList = symbols
			.map((s) => {
				const exp = s.isExported ? "export " : "";
				const range = s.endLine ? ` L${s.line}-${s.endLine}` : ` L${s.line}`;
				return `${exp}${s.kind}: ${s.name}(${s.signature ?? ""})${range}`;
			})
			.join("\n");
		return {
			content: symbolList,
			mode: "symbols",
			mutationSafe: false,
			adapterConfidence: SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX,
			adapterName: this.name,
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex fallback: cannot guarantee exact symbol boundaries",
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

		// Use computed endLine if available, otherwise scan for closing brace
		let endLine = match.endLine;
		if (!endLine) {
			endLine = this.findClosingBrace(lines, match.line - 1, "{", "}");
			if (!endLine) {
				endLine = this.findNextBlankLine(lines, match.line - 1);
			}
			if (!endLine) {
				endLine = Math.min(match.line + 15, lines.length);
			}
		}

		const exactContent = lines.slice(match.line - 1, endLine).join("\n");

		return {
			content: exactContent,
			mode: "symbol_exact",
			mutationSafe: false, // I005: regex fallback is never mutation-safe for symbol_exact
			adapterConfidence: match.endLine ? SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX : 0.35,
			adapterName: this.name,
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex fallback cannot guarantee exact symbol boundaries",
			suggestedNextReads: endLine < lines.length ? [`offset=${endLine + 1}`] : undefined,
		};
	}

	async rangeExact(content: string, _filePath: string, startLine: number, endLine: number): Promise<SmartReadResult> {
		const lines = content.split("\n");
		const range = lines.slice(startLine - 1, endLine).join("\n");
		return {
			content: range,
			mode: "range_exact",
			mutationSafe: true, // range_exact is always safe
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

	// ============================================================================
	// Symbol Extraction - P43.1 optimized (kept for fallback)
	// ============================================================================

	private extractSymbols(content: string): SymbolInfo[] {
		const symbols: SymbolInfo[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const line = lines[i];
			const trimmed = line.trim();

			// Skip comments and empty lines
			if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
				continue;
			}

			// Strip leading export to classify by real kind
			const isExported = trimmed.startsWith("export ");
			const decl = isExported
				? trimmed
						.slice(7)
						.trim()
						.replace(/^default\s+/, "")
						.replace(/^type\s+/, "")
				: trimmed;

			// --- Imports ---
			if (trimmed.startsWith("import ")) {
				const name = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
				const fromMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
				symbols.push({
					name,
					kind: "import",
					line: lineNum,
					signature: fromMatch ? `from "${fromMatch[1]}"` : undefined,
					isExported: false,
				});
				continue;
			}

			// --- Export re-exports ---
			if (trimmed.match(/^export\s+\{[^}]*\}\s*;/)) {
				symbols.push({
					name: trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed,
					kind: "export",
					line: lineNum,
					isExported: true,
				});
				continue;
			}
			if (trimmed.match(/^export\s+\*\s+from/)) {
				symbols.push({
					name: trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed,
					kind: "export",
					line: lineNum,
					isExported: true,
				});
				continue;
			}
			if (trimmed === "export default" && i + 1 < lines.length) {
				continue;
			}

			// --- Class declarations ---
			const classMatch = decl.match(
				/^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w.]+(?:<[^>]+>)?))?(?:\s+implements\s+.+?)?\s*\{/,
			);
			if (classMatch) {
				const endLine = this.findClosingBrace(lines, i, "{", "}");
				symbols.push({
					name: classMatch[1],
					kind: "class",
					line: lineNum,
					signature: classMatch[2] ? `extends ${classMatch[2]}` : undefined,
					endLine,
					isExported,
				});
				continue;
			}

			// --- Interface declarations ---
			const ifaceMatch = decl.match(/^interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+.+?)?\s*\{/);
			if (ifaceMatch) {
				symbols.push({
					name: ifaceMatch[1],
					kind: "interface",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
					isExported,
				});
				continue;
			}

			// --- Type aliases ---
			const typeMatch = decl.match(/^type\s+(\w+)(?:<[^>]+>)?\s*=/);
			if (typeMatch) {
				symbols.push({
					name: typeMatch[1],
					kind: "type",
					line: lineNum,
					endLine: this.findTypeAliasEnd(lines, i),
					isExported,
				});
				continue;
			}

			// --- Enum declarations ---
			const enumMatch = decl.match(/^(?:const\s+)?enum\s+(\w+)\s*\{/);
			if (enumMatch) {
				symbols.push({
					name: enumMatch[1],
					kind: "enum",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
					isExported,
				});
				continue;
			}

			// --- Function declarations ---
			const funcMatch = decl.match(
				/^(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[\w<>.|&[\]]+(?:\s*\|\s*[\w<>.|&[\]]+)*)?\s*\{/,
			);
			if (funcMatch) {
				symbols.push({
					name: funcMatch[1],
					kind: "function",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
					isExported,
				});
				continue;
			}

			// --- Function declaration (body on next line) ---
			const funcMatch2 = decl.match(
				/^(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[\w<>.|&[\]]+(?:\s*\|\s*[\w<>.|&[\]]+)*)?\s*$/,
			);
			if (funcMatch2 && i + 1 < lines.length && lines[i + 1].trim() === "{") {
				symbols.push({
					name: funcMatch2[1],
					kind: "function",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i + 1, "{", "}"),
					isExported,
				});
				continue;
			}

			// --- Arrow functions assigned to const/let/var ---
			const arrowMatch = decl.match(
				/^(?:const|let|var)\s+(\w+)\s*(?::\s*[\w<>.|&[\]]+(?:\s*\|\s*[\w<>.|&[\]]+)*)?\s*=\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[\w<>.|&[\]]+(?:\s*\|\s*[\w<>.|&[\]]+)*)?\s*=>\s*\{/,
			);
			if (arrowMatch) {
				const endLine = this.findClosingBrace(lines, i, "{", "}");
				symbols.push({
					name: arrowMatch[1],
					kind: "function",
					line: lineNum,
					endLine: endLine || this.findNextBlankLine(lines, i),
					isExported,
				});
				continue;
			}

			// --- JSX component ---
			const jsxFuncMatch = decl.match(
				/^(?:async\s+)?function\s+([A-Z]\w*)\s*\([^)]*\)(?:\s*:\s*(?:React\.)?(?:JSX\.Element|ReactNode|ReactElement))?\s*\{/,
			);
			if (jsxFuncMatch && !classMatch) {
				symbols.push({
					name: jsxFuncMatch[1],
					kind: "component",
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
					isExported,
				});
				continue;
			}

			// --- Method declarations ---
			const methodMatch = decl.match(
				/^(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(#?\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[\w<>.|&[\]]+(?:\s*\|\s*[\w<>.|&[\]]+)*)?\s*\{/,
			);
			if (
				methodMatch &&
				!["if", "for", "while", "switch", "catch", "try", "return", "throw", "new", "delete"].includes(
					methodMatch[1],
				)
			) {
				const isConstructor = methodMatch[1] === "constructor";
				const kind = isConstructor ? "constructor" : "method";
				symbols.push({
					name: methodMatch[1],
					kind,
					line: lineNum,
					endLine: this.findClosingBrace(lines, i, "{", "}"),
					isExported: false,
				});
				continue;
			}

			// --- Method with opening brace on next line ---
			const methodMatch2 = decl.match(
				/^(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(#?\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[\w<>.|&[\]]+(?:\s*\|\s*[\w<>.|&[\]]+)*)?\s*$/,
			);
			if (
				methodMatch2 &&
				!["if", "for", "while", "switch", "catch", "try", "return"].includes(methodMatch2[1]) &&
				i + 1 < lines.length &&
				lines[i + 1].trim() === "{"
			) {
				const isConstructor = methodMatch2[1] === "constructor";
				const kind = isConstructor ? "constructor" : "method";
				symbols.push({
					name: methodMatch2[1],
					kind,
					line: lineNum,
					endLine: this.findClosingBrace(lines, i + 1, "{", "}"),
					isExported: false,
				});
				continue;
			}

			// --- Variable/constant declarations ---
			const varMatch = decl.match(/^(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?!\{)/);
			if (varMatch && !arrowMatch) {
				symbols.push({
					name: varMatch[1],
					kind: "variable",
					line: lineNum,
					isExported,
				});
			}
		}

		return symbols;
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	private buildOutline(symbols: SymbolInfo[]): string {
		const lines: string[] = [];
		lines.push("Symbol Outline:");
		lines.push("==============");
		for (const sym of symbols) {
			const exp = sym.isExported ? "export " : "";
			const sig = sym.signature ? ` ${sym.signature}` : "";
			lines.push(`  ${exp}[${sym.kind}] ${sym.name}${sig} @ L${sym.line}`);
		}
		return lines.join("\n");
	}

	private findClosingBrace(lines: string[], startIdx: number, open: string, close: string): number | undefined {
		let depth = 0;
		for (let i = startIdx; i < lines.length; i++) {
			const line = lines[i];
			const cleaned = line
				.replace(/(["'`])(?:(?!\1).)*?\1/g, "")
				.replace(/\/\/.*$/, "")
				.replace(/\/\*[\s\S]*?\*\//g, "");
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

	private findTypeAliasEnd(lines: string[], startIdx: number): number | undefined {
		let depth = 0;
		for (let i = startIdx; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			const cleaned = trimmed.replace(/(["'`])(?:(?!\1).)*?\1/g, "").replace(/\/\/.*$/, "");
			for (const ch of cleaned) {
				if ("<({[".includes(ch)) depth++;
				if (">)}]".includes(ch)) depth--;
			}
			if (depth <= 0 && (cleaned.endsWith(";") || (trimmed === "" && i > startIdx))) {
				return i + 1;
			}
		}
		return undefined;
	}

	private findNextBlankLine(lines: string[], startIdx: number): number | undefined {
		for (let i = startIdx + 1; i < lines.length; i++) {
			if (lines[i].trim() === "") {
				return i;
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
	isExported: boolean;
}
