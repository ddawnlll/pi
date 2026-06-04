/**
 * P43 Smart Read v2 — Tree-sitter Python AST Extractor
 *
 * Extracts symbols and exact ranges from Python source using tree-sitter.
 *
 * Tree-sitter gives syntax-level exact ranges.
 * It does not provide type-semantic project-wide resolution.
 * Therefore confidence is high for node boundaries, but below LSP/compiler semantic providers.
 */

import type { TreeSitterParseResult, TreeSitterSymbolInfo } from "./tree-sitter-wasm-loader.js";
import { getNodeText, nodeToExactRange, validateExactRange } from "./tree-sitter-wasm-loader.js";

// ============================================================================
// Python AST Node Kind Constants
// ============================================================================

const PYTHON_NODE_KINDS = {
	CLASS_DEFINITION: "class_definition",
	FUNCTION_DEFINITION: "function_definition",
	DECORATED_DEFINITION: "decorated_definition",
	IDENTIFIER: "identifier",
	BLOCK: "block",
	DECORATOR: "decorator",
	ASYNC_DEF: "async",
	PARAMETERS: "parameters",
} as const;

// ============================================================================
// Symbol Extraction
// ============================================================================

/**
 * Check if a node's type matches any of the given kinds.
 */
function _nodeIs(node: any, ...kinds: string[]): boolean {
	return kinds.includes(node.type);
}

/**
 * Find the first child node with a specific type.
 */
function findNamedChild(node: any, type: string): any | undefined {
	if (!node.namedChildren) return undefined;
	return node.namedChildren.find((c: any) => c.type === type);
}

/**
 * Get the name from a class or function definition node.
 * Returns undefined if no identifier child found.
 */
function _getDefName(node: any): string | undefined {
	if (node.type === PYTHON_NODE_KINDS.CLASS_DEFINITION) {
		const nameChild = findNamedChild(node, PYTHON_NODE_KINDS.IDENTIFIER);
		if (nameChild) return getNodeText(nameChild, "");
	}
	if (node.type === PYTHON_NODE_KINDS.FUNCTION_DEFINITION) {
		const nameChild = findNamedChild(node, PYTHON_NODE_KINDS.IDENTIFIER);
		if (nameChild) return getNodeText(nameChild, "");
	}
	return undefined;
}

/**
 * Walk the tree and collect all symbols recursively.
 * Returns TreeSitterSymbolInfo[] with 1-based lines.
 */
export function extractPythonSymbols(result: TreeSitterParseResult): TreeSitterSymbolInfo[] {
	const { tree, content, languageId } = result;
	const symbols: TreeSitterSymbolInfo[] = [];

	// Manual tree walking to avoid tree-sitter query API dependency
	walkNodeForSymbols(tree.rootNode, content, languageId, symbols, undefined);

	return symbols;
}

/**
 * Find a symbol by name in the extracted symbols.
 */
export function findPythonSymbol(symbols: TreeSitterSymbolInfo[], name: string): TreeSitterSymbolInfo | undefined {
	// Try fullName match first
	let match = symbols.find((s) => s.fullName === name);
	if (match) return match;

	// Try name match (prefer top-level / exported)
	match = symbols.find((s) => s.name === name && s.containerName === undefined);
	if (match) return match;

	// Any name match
	match = symbols.find((s) => s.name === name);
	if (match) return match;

	return undefined;
}

/**
 * Find a symbol by exact range (for validation).
 */
function _findSymbolAtRange(
	symbols: TreeSitterSymbolInfo[],
	startOffset: number,
	endOffset: number,
): TreeSitterSymbolInfo | undefined {
	return symbols.find((s) => s.startOffset === startOffset && s.endOffset === endOffset);
}

/**
 * Recursively walk tree-sitter CST nodes collecting Python symbols.
 */
function walkNodeForSymbols(
	node: any,
	content: string,
	languageId: string,
	symbols: TreeSitterSymbolInfo[],
	containerName: string | undefined,
): void {
	if (!node) return;

	const nodeType = node.type;

	// Class definition
	if (nodeType === PYTHON_NODE_KINDS.CLASS_DEFINITION) {
		const nameChild = findNamedChild(node, PYTHON_NODE_KINDS.IDENTIFIER);
		if (nameChild) {
			const name = getNodeText(nameChild, content);
			const range = nodeToExactRange(node);
			const sig = extractPythonSignature(node, content);

			const info: TreeSitterSymbolInfo = {
				name,
				kind: "class",
				languageId,
				...range,
				signature: sig,
				isExported: true,
				fullName: name,
			};
			symbols.push(info);

			// Walk body for methods
			const body = findNamedChild(node, PYTHON_NODE_KINDS.BLOCK);
			if (body) {
				for (const child of body.namedChildren || []) {
					walkNodeForSymbols(child, content, languageId, symbols, name);
				}
			}
			return;
		}
	}

	// Decorated definition (class with decorator)
	if (nodeType === PYTHON_NODE_KINDS.DECORATED_DEFINITION) {
		const defNode = findDecoratedTarget(node);
		if (defNode) {
			if (defNode.type === PYTHON_NODE_KINDS.CLASS_DEFINITION) {
				const nameChild = findNamedChild(defNode, PYTHON_NODE_KINDS.IDENTIFIER);
				if (nameChild) {
					const name = getNodeText(nameChild, content);
					const range = nodeToExactRange(node); // include decorators
					const sig = extractPythonSignature(defNode, content);

					const info: TreeSitterSymbolInfo = {
						name,
						kind: "class",
						languageId,
						...range,
						signature: sig,
						isExported: true,
						fullName: name,
					};
					symbols.push(info);

					// Walk body for methods
					const body = findNamedChild(defNode, PYTHON_NODE_KINDS.BLOCK);
					if (body) {
						for (const child of body.namedChildren || []) {
							walkNodeForSymbols(child, content, languageId, symbols, name);
						}
					}
					return;
				}
			} else if (
				defNode.type === PYTHON_NODE_KINDS.FUNCTION_DEFINITION ||
				defNode.type === "async_function_definition"
			) {
				const _isAsync = defNode.type === "async_function_definition";
				const nameChild = findNamedChild(defNode, PYTHON_NODE_KINDS.IDENTIFIER);
				if (nameChild) {
					const name = getNodeText(nameChild, content);
					const range = nodeToExactRange(node); // include decorators
					const sig = extractPythonSignature(defNode, content);

					const fullName = containerName ? `${containerName}.${name}` : name;

					const info: TreeSitterSymbolInfo = {
						name,
						kind: "function",
						languageId,
						...range,
						signature: sig,
						containerName,
						fullName,
						isExported: true,
					};
					symbols.push(info);
					return;
				}
			}
		}
	}

	// Function definition
	if (nodeType === PYTHON_NODE_KINDS.FUNCTION_DEFINITION || nodeType === "async_function_definition") {
		const nameChild = findNamedChild(node, PYTHON_NODE_KINDS.IDENTIFIER);
		if (nameChild) {
			const name = getNodeText(nameChild, content);
			const range = nodeToExactRange(node);
			const sig = extractPythonSignature(node, content);

			const fullName = containerName ? `${containerName}.${name}` : name;

			const info: TreeSitterSymbolInfo = {
				name,
				kind: "function",
				languageId,
				...range,
				signature: sig,
				containerName,
				fullName,
				isExported: !containerName,
			};
			symbols.push(info);
			return;
		}
	}

	// Recurse into children for other node types
	for (const child of node.namedChildren || []) {
		walkNodeForSymbols(child, content, languageId, symbols, containerName);
	}
}

/**
 * Find the actual definition inside a decorated_definition node.
 */
function findDecoratedTarget(node: any): any | undefined {
	if (!node.namedChildren) return undefined;
	// The last named child in a decorated_definition is the actual definition
	const children = node.namedChildren;
	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i];
		if (
			child.type === PYTHON_NODE_KINDS.CLASS_DEFINITION ||
			child.type === PYTHON_NODE_KINDS.FUNCTION_DEFINITION ||
			child.type === "async_function_definition"
		) {
			return child;
		}
	}
	return undefined;
}

/**
 * Extract a readable signature from a Python function/class definition.
 */
function extractPythonSignature(node: any, content: string): string {
	if (node.type === PYTHON_NODE_KINDS.FUNCTION_DEFINITION || node.type === "async_function_definition") {
		const nameChild = findNamedChild(node, PYTHON_NODE_KINDS.IDENTIFIER);
		const params = findNamedChild(node, PYTHON_NODE_KINDS.PARAMETERS);
		if (nameChild && params) {
			const name = getNodeText(nameChild, "");
			const paramText = getNodeText(params, content);
			return `${name}${paramText}`;
		}
	}
	if (node.type === PYTHON_NODE_KINDS.CLASS_DEFINITION) {
		const nameChild = findNamedChild(node, PYTHON_NODE_KINDS.IDENTIFIER);
		if (nameChild) {
			return getNodeText(nameChild, "");
		}
	}
	return "";
}

// ============================================================================
// Outline builder
// ============================================================================

/**
 * Build a concise outline string from symbols.
 */
export function buildPythonOutline(symbols: TreeSitterSymbolInfo[]): string {
	if (symbols.length === 0) return "No symbols found.";

	const lines: string[] = [];
	lines.push("Symbol Outline:");
	lines.push("==============");

	for (const sym of symbols) {
		const range = sym.startLine === sym.endLine ? ` L${sym.startLine}` : ` L${sym.startLine}-${sym.endLine}`;
		const kind = sym.kind === "class" ? "class" : "function";
		const name = sym.fullName || sym.name;
		lines.push(`  [${kind}] ${name} ${range}`);
	}

	return lines.join("\n");
}

// ============================================================================
// Symbol exact extraction
// ============================================================================

/**
 * Get exact content for a symbol by name.
 * Returns the smart read result fields needed.
 */
export function pythonSymbolExact(
	result: TreeSitterParseResult,
	symbol: TreeSitterSymbolInfo,
):
	| {
			content: string;
			startLine: number;
			endLine: number;
			startColumn: number;
			endColumn: number;
			startOffset: number;
			endOffset: number;
	  }
	| undefined {
	const validationError = validateExactRange(
		{
			startLine: symbol.startLine,
			endLine: symbol.endLine,
			startOffset: symbol.startOffset,
			endOffset: symbol.endOffset,
		},
		result.content,
	);

	if (validationError) return undefined;

	return {
		content: result.content.slice(symbol.startOffset, symbol.endOffset),
		startLine: symbol.startLine,
		endLine: symbol.endLine,
		startColumn: symbol.startColumn,
		endColumn: symbol.endColumn,
		startOffset: symbol.startOffset,
		endOffset: symbol.endOffset,
	};
}
