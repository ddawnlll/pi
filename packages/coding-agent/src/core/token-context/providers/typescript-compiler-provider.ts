/**
 * P43 Smart Read v2 — TypeScript Compiler Provider
 *
 * Uses the TypeScript compiler API for AST-backed smart reads.
 * This is the primary provider for TS/JS/TSX/JSX files.
 * Priority: 100 (highest for TypeScript).
 *
 * npm-only: depends on the "typescript" package which is a devDependency
 * and also available as a transitive dependency.
 */

import ts from "typescript";
import type {
	SmartReadParseSource,
	SmartReadProvider,
	SmartReadProviderCapabilities,
	SmartReadResult,
} from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

// Lazy-loaded TypeScript reference
let _tsModule: typeof ts | null = null;
let _tsAvailable: boolean | null = null;

function getTypeScript(): typeof ts | null {
	if (_tsAvailable !== null) return _tsModule;
	// The static import `import ts from "typescript"` at the top of this module
	// already loaded the typescript package. If the import failed, this module
	// would not have loaded at all, so ts is guaranteed to be available here.
	// We avoid using require() because pi runs as ESM, where require is not defined.
	_tsModule = ts;
	_tsAvailable = true;
	return _tsModule;
}

function inferScriptKind(filePath: string): ts.ScriptKind {
	const lower = filePath.toLowerCase();
	if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (lower.endsWith(".mts")) return ts.ScriptKind.TS;
	if (lower.endsWith(".cts")) return ts.ScriptKind.TS;
	if (lower.endsWith(".ts")) return ts.ScriptKind.TS;
	if (lower.endsWith(".mjs")) return ts.ScriptKind.JS;
	if (lower.endsWith(".cjs")) return ts.ScriptKind.JS;
	if (lower.endsWith(".js")) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

interface ProviderSymbolInfo {
	name: string;
	kind: string;
	line: number;
	endLine?: number;
	startColumn?: number;
	endColumn?: number;
	startOffset?: number;
	endOffset?: number;
	signature?: string;
	isExported?: boolean;
	containerName?: string;
}

export class TypeScriptCompilerProvider implements SmartReadProvider {
	readonly name = "typescript-compiler";
	readonly languageIds = ["typescript", "javascript", "tsx", "jsx"];
	readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
	readonly priority = 100;

	private tsInstance: typeof ts | null = null;

	isAvailable(): boolean {
		this.tsInstance = getTypeScript();
		return this.tsInstance !== null;
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
			semantic: true,
			astBacked: true,
		};
	}

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		if (!this.isAvailable()) {
			return this.unavailableResult("outline", filePath);
		}
		const ts = this.tsInstance!;
		try {
			const sourceFile = ts.createSourceFile(
				filePath,
				content,
				ts.ScriptTarget.Latest,
				true,
				inferScriptKind(filePath),
			);
			const symbols = this.extractSymbols(sourceFile, ts);

			const outline = this.buildOutline(symbols);
			const confidence = symbols.length > 0 ? SMART_READ_CONFIDENCE.TYPESCRIPT_COMPILER_EXACT - 0.08 : 0.5;

			return {
				content: outline,
				mode: "outline",
				mutationSafe: false,
				adapterConfidence: confidence,
				adapterName: this.name,
				parseSource: "typescript_compiler" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: false,
				suggestedNextReads: symbols.slice(0, 10).map((s) => {
					const prefix = s.containerName ? `${s.containerName}.` : "";
					return `symbol_exact:${prefix}${s.name}`;
				}),
			};
		} catch (error) {
			return this.errorFallback(content, `typescript compiler error: ${(error as Error).message}`);
		}
	}

	async symbols(content: string, _filePath: string): Promise<SmartReadResult> {
		if (!this.isAvailable()) {
			return this.unavailableResult("symbols", _filePath);
		}
		const ts = this.tsInstance!;
		try {
			const sourceFile = ts.createSourceFile(
				_filePath,
				content,
				ts.ScriptTarget.Latest,
				true,
				inferScriptKind(_filePath),
			);
			const symbols = this.extractSymbols(sourceFile, ts);

			const symbolList = symbols
				.map((s) => {
					const exp = s.isExported ? "export " : "";
					const container = s.containerName ? `${s.containerName}.` : "";
					const range = s.endLine ? ` L${s.line}-${s.endLine}` : ` L${s.line}`;
					const sig = s.signature ? ` ${s.signature}` : "";
					return `${exp}${s.kind} ${container}${s.name}${sig}${range}`;
				})
				.join("\n");

			return {
				content: symbolList || "(no symbols found)",
				mode: "symbols",
				mutationSafe: false,
				adapterConfidence: SMART_READ_CONFIDENCE.TYPESCRIPT_COMPILER_EXACT - 0.06,
				adapterName: this.name,
				parseSource: "typescript_compiler" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: false,
				suggestedNextReads: symbols.map((s) => {
					const prefix = s.containerName ? `${s.containerName}.` : "";
					return `symbol_exact:${prefix}${s.name}`;
				}),
			};
		} catch (error) {
			return this.errorFallback(content, `typescript compiler error: ${(error as Error).message}`);
		}
	}

	async symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		if (!this.isAvailable()) {
			return this.unavailableResult("symbol_exact", filePath, symbol);
		}
		const ts = this.tsInstance!;
		try {
			const sourceFile = ts.createSourceFile(
				filePath,
				content,
				ts.ScriptTarget.Latest,
				true,
				inferScriptKind(filePath),
			);
			const symbols = this.extractSymbols(sourceFile, ts);

			// Try exact match
			let match = symbols.find((s) => s.name === symbol);

			// Try qualified name (ClassName.methodName)
			if (!match && symbol.includes(".")) {
				const parts = symbol.split(".");
				const containerName = parts[0];
				const memberName = parts[1];
				match = symbols.find((s) => s.name === memberName && s.containerName === containerName);
			}

			if (!match) {
				return {
					content: `[Symbol "${symbol}" not found in ${filePath}]`,
					mode: "symbol_exact",
					mutationSafe: false,
					adapterConfidence: 0.1,
					adapterName: this.name,
					parseSource: "typescript_compiler" as SmartReadParseSource,
					providerName: this.name,
					isFallback: true,
					fallbackError: `symbol "${symbol}" not found via TypeScript compiler`,
				};
			}

			const lines = content.split("\n");
			const endLine = match.endLine ?? Math.min(match.line + 20, lines.length);
			const exactContent = lines.slice(match.line - 1, endLine).join("\n");

			return {
				content: exactContent,
				mode: "symbol_exact",
				mutationSafe: true,
				adapterConfidence: SMART_READ_CONFIDENCE.TYPESCRIPT_COMPILER_EXACT,
				adapterName: this.name,
				parseSource: "typescript_compiler" as SmartReadParseSource,
				providerName: this.name,
				providerPriority: this.priority,
				isFallback: false,
				exactRange: {
					startLine: match.line,
					endLine: endLine,
					startColumn: match.startColumn,
					endColumn: match.endColumn,
					startOffset: match.startOffset,
					endOffset: match.endOffset,
				},
				suggestedNextReads: endLine < lines.length ? [`offset=${endLine + 1}`] : undefined,
			};
		} catch (error) {
			return this.errorFallback(content, `typescript compiler error: ${(error as Error).message}`, symbol);
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
			parseSource: "typescript_compiler" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: false,
		};
	}

	// ============================================================================
	// AST Symbol Extraction
	// ============================================================================

	private extractSymbols(sourceFile: ts.SourceFile, tsModule: typeof ts): ProviderSymbolInfo[] {
		const symbols: ProviderSymbolInfo[] = [];
		const _self = this;

		function visitNode(node: ts.Node, containerName?: string) {
			const nodeStart = node.getStart(sourceFile);
			const nodeEnd = node.getEnd();
			const startPos = sourceFile.getLineAndCharacterOfPosition(nodeStart);
			const endPos = sourceFile.getLineAndCharacterOfPosition(nodeEnd);

			// Class declaration
			if (tsModule.isClassDeclaration(node) && node.name) {
				const name = node.name.text;
				symbols.push({
					name,
					kind: "class",
					line: startPos.line + 1,
					endLine: endPos.line + 1,
					startColumn: startPos.character + 1,
					endColumn: endPos.character + 1,
					startOffset: nodeStart,
					endOffset: nodeEnd,
					isExported: _self.isNodeExported(node, tsModule),
					containerName,
				});

				// Visit class members
				for (const member of node.members) {
					visitNode(member, name);
				}
				return;
			}

			// Method declaration (inside class)
			if (tsModule.isMethodDeclaration(node) && node.name) {
				const name = _self.getPropertyName(node.name, tsModule);
				if (!name) return;
				const isConstructor = name === "constructor";
				symbols.push({
					name,
					kind: isConstructor ? "constructor" : "method",
					line: startPos.line + 1,
					endLine: endPos.line + 1,
					startColumn: startPos.character + 1,
					endColumn: endPos.character + 1,
					startOffset: nodeStart,
					endOffset: nodeEnd,
					containerName: containerName ?? "<class>",
				});
				return;
			}

			// Getter/Setter
			if ((tsModule.isGetAccessorDeclaration(node) || tsModule.isSetAccessorDeclaration(node)) && node.name) {
				const name = _self.getPropertyName(node.name, tsModule);
				if (!name) return;
				symbols.push({
					name,
					kind: tsModule.isGetAccessorDeclaration(node) ? "getter" : "setter",
					line: startPos.line + 1,
					endLine: endPos.line + 1,
					startColumn: startPos.character + 1,
					endColumn: endPos.character + 1,
					startOffset: nodeStart,
					endOffset: nodeEnd,
					containerName,
				});
				return;
			}

			// Function declaration
			if (tsModule.isFunctionDeclaration(node) && node.name) {
				const name = node.name.text;
				symbols.push({
					name,
					kind: "function",
					line: startPos.line + 1,
					endLine: endPos.line + 1,
					startColumn: startPos.character + 1,
					endColumn: endPos.character + 1,
					startOffset: nodeStart,
					endOffset: nodeEnd,
					isExported: _self.isNodeExported(node, tsModule),
					containerName,
				});
				return;
			}

			// Interface declaration
			if (tsModule.isInterfaceDeclaration(node) && node.name) {
				const name = node.name.text;
				symbols.push({
					name,
					kind: "interface",
					line: startPos.line + 1,
					endLine: endPos.line + 1,
					startColumn: startPos.character + 1,
					endColumn: endPos.character + 1,
					startOffset: nodeStart,
					endOffset: nodeEnd,
					isExported: _self.isNodeExported(node, tsModule),
					containerName,
				});
				return;
			}

			// Type alias
			if (tsModule.isTypeAliasDeclaration(node) && node.name) {
				const name = node.name.text;
				symbols.push({
					name,
					kind: "type",
					line: startPos.line + 1,
					endLine: endPos.line + 1,
					startColumn: startPos.character + 1,
					endColumn: endPos.character + 1,
					startOffset: nodeStart,
					endOffset: nodeEnd,
					isExported: _self.isNodeExported(node, tsModule),
					containerName,
				});
				return;
			}

			// Enum declaration
			if (tsModule.isEnumDeclaration(node) && node.name) {
				const name = node.name.text;
				symbols.push({
					name,
					kind: "enum",
					line: startPos.line + 1,
					endLine: endPos.line + 1,
					startColumn: startPos.character + 1,
					endColumn: endPos.character + 1,
					startOffset: nodeStart,
					endOffset: nodeEnd,
					isExported: _self.isNodeExported(node, tsModule),
					containerName,
				});
				return;
			}

			// Variable statement (const/let/var)
			if (tsModule.isVariableStatement(node)) {
				for (const decl of node.declarationList.declarations) {
					if (tsModule.isIdentifier(decl.name)) {
						const name = decl.name.text;
						const isConstLike =
							name[0] === name[0]?.toUpperCase() || node.declarationList.flags === tsModule.NodeFlags.Const;
						symbols.push({
							name,
							kind: isConstLike ? "constant" : "variable",
							line: startPos.line + 1,
							endLine: endPos.line + 1,
							startColumn: startPos.character + 1,
							endColumn: endPos.character + 1,
							startOffset: nodeStart,
							endOffset: nodeEnd,
							isExported: _self.isNodeExported(node, tsModule),
							containerName,
						});
					}
				}
				return;
			}

			// Module declaration
			if (tsModule.isModuleDeclaration(node) && node.name) {
				const name = _self.getPropertyName(node.name, tsModule);
				if (name) {
					symbols.push({
						name,
						kind: "module",
						line: startPos.line + 1,
						endLine: endPos.line + 1,
						startColumn: startPos.character + 1,
						endColumn: endPos.character + 1,
						startOffset: nodeStart,
						endOffset: nodeEnd,
						isExported: _self.isNodeExported(node, tsModule),
						containerName,
					});
				}
				return;
			}

			// Recurse into child nodes
			tsModule.forEachChild(node, (child: ts.Node) => visitNode(child, containerName));
		}

		tsModule.forEachChild(sourceFile, (node: ts.Node) => visitNode(node));

		return symbols;
	}

	private isNodeExported(node: ts.Node, tsModule: typeof ts): boolean {
		if ("modifiers" in node) {
			const modifiers = (node as { modifiers?: ts.ModifierLike[] }).modifiers;
			if (modifiers) {
				return modifiers.some((m) => m.kind === tsModule.SyntaxKind.ExportKeyword);
			}
		}
		return false;
	}

	private getPropertyName(nameNode: ts.PropertyName | ts.BindingName, tsModule: typeof ts): string | undefined {
		if (tsModule.isIdentifier(nameNode)) return nameNode.text;
		if (tsModule.isStringLiteral(nameNode)) return nameNode.text;
		if (tsModule.isNumericLiteral(nameNode)) return nameNode.text;
		return undefined;
	}

	// ============================================================================
	// Output formatting
	// ============================================================================

	private buildOutline(symbols: ProviderSymbolInfo[]): string {
		const lines: string[] = [];
		lines.push("Symbol Outline:");
		lines.push("==============");

		if (symbols.length === 0) {
			lines.push("  (no symbols detected)");
			return lines.join("\n");
		}

		for (const sym of symbols) {
			const exp = sym.isExported ? "export " : "";
			const container = sym.containerName ? `${sym.containerName}.` : "";
			const range = sym.endLine ? ` @ L${sym.line}-${sym.endLine}` : ` @ L${sym.line}`;
			lines.push(`  ${exp}[${sym.kind}] ${container}${sym.name}${range}`);
		}
		return lines.join("\n");
	}

	// ============================================================================
	// Fallback helpers
	// ============================================================================

	private unavailableResult(mode: string, filePath: string, symbol?: string): SmartReadResult {
		const content = symbol
			? `[TypeScript compiler unavailable for symbol "${symbol}" in ${filePath}]`
			: `[TypeScript compiler unavailable for ${mode} in ${filePath}]`;

		return {
			content,
			mode: mode as SmartReadResult["mode"],
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "regex_fallback" as SmartReadParseSource,
			providerName: this.name,
			isFallback: true,
			fallbackError: "typescript package not available",
		};
	}

	private errorFallback(_content: string, error: string, symbol?: string): SmartReadResult {
		return {
			content: symbol ? `[Error resolving symbol "${symbol}": ${error}]` : `[Error: ${error}]`,
			mode: symbol ? "symbol_exact" : "outline",
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "regex_fallback" as SmartReadParseSource,
			providerName: this.name,
			isFallback: true,
			fallbackError: error,
		};
	}
}
