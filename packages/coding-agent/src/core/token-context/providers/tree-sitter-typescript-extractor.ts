/**
 * P43 Smart Read v2 — Tree-sitter TypeScript/JavaScript AST Extractor (Secondary)
 *
 * Secondary provider for TypeScript/JavaScript.
 * TypeScript compiler provider remains primary (priority 100).
 * Tree-sitter is secondary (priority 80).
 *
 * Tree-sitter gives syntax-level exact ranges.
 * It does not provide type-semantic project-wide resolution.
 * Therefore confidence is high for node boundaries, but below LSP/compiler semantic providers.
 */

import type { TreeSitterParseResult, TreeSitterSymbolInfo } from "./tree-sitter-wasm-loader.js";
import { getNodeText, nodeToExactRange, validateExactRange } from "./tree-sitter-wasm-loader.js";

// ============================================================================
// TypeScript/JS Node Kind Constants
// ============================================================================

const TS_NODE_KINDS = {
	// Class
	CLASS_DECLARATION: "class_declaration",
	METHOD_DEFINITION: "method_definition",
	// Functions
	FUNCTION_DECLARATION: "function_declaration",
	ARROW_FUNCTION: "arrow_function",
	LEXICAL_DECLARATION: "lexical_declaration",
	VARIABLE_DECLARATOR: "variable_declarator",
	// Interfaces & Types
	INTERFACE_DECLARATION: "interface_declaration",
	TYPE_ALIAS_DECLARATION: "type_alias_declaration",
	ENUM_DECLARATION: "enum_declaration",
	// Imports/Exports
	IMPORT_STATEMENT: "import_statement",
	EXPORT_STATEMENT: "export_statement",
	// Names
	IDENTIFIER: "identifier",
	PROPERTY_IDENTIFIER: "property_identifier",
	// Modifiers
	PUBLIC: "public",
	PRIVATE: "private",
	PROTECTED: "protected",
	STATIC: "static",
	ASYNC: "async",
	DECORATOR: "decorator",
	ABSTRACT: "abstract",
	// Property
	PUBLIC_FIELD_DEFINITION: "public_field_definition",
} as const;

// ============================================================================
// Symbol Extraction
// ============================================================================

/**
 * Find the first child node with a specific type.
 */
function findNamedChild(node: any, type: string): any | undefined {
	if (!node.namedChildren) return undefined;
	return node.namedChildren.find((c: any) => c.type === type);
}

/**
 * Find all named children matching a type.
 */
function findAllNamedChildren(node: any, type: string): any[] {
	if (!node.namedChildren) return [];
	return node.namedChildren.filter((c: any) => c.type === type);
}

/**
 * Check if a node has a specific modifier among its children.
 */
function hasModifier(node: any, type: string): boolean {
	if (!node.namedChildren) return false;
	return node.namedChildren.some((c: any) => c.type === type || c.type === `${type}_modifier`);
}

/**
 * Get exported status from a node and its potential export wrapper.
 * In tree-sitter, export is a parent or modifier.
 */
function isExportedNode(node: any, parent: any | undefined): boolean {
	if (hasModifier(node, "export")) return true;
	if (parent && parent.type === TS_NODE_KINDS.EXPORT_STATEMENT) return true;
	// Check if the grandparent is an export statement
	if (parent && parent.type === "statement_block") return false;
	return false;
}

/**
 * Extract symbols from TypeScript/JavaScript tree-sitter tree.
 */
export function extractTypeScriptSymbols(result: TreeSitterParseResult): TreeSitterSymbolInfo[] {
	const { tree, content, languageId } = result;
	const symbols: TreeSitterSymbolInfo[] = [];

	walkTSNode(tree.rootNode, content, languageId, symbols, undefined, undefined);

	return symbols;
}

/**
 * Find a TS symbol by name.
 */
export function findTypeScriptSymbol(symbols: TreeSitterSymbolInfo[], name: string): TreeSitterSymbolInfo | undefined {
	// Try fullName match first
	let match = symbols.find((s) => s.fullName === name);
	if (match) return match;

	// Try name match (prefer top-level)
	match = symbols.find((s) => s.name === name && s.containerName === undefined);
	if (match) return match;

	// Any name match
	match = symbols.find((s) => s.name === name);
	if (match) return match;

	return undefined;
}

/**
 * Recursively walk tree-sitter CST collecting TS/JS symbols.
 */
function walkTSNode(
	node: any,
	content: string,
	languageId: string,
	symbols: TreeSitterSymbolInfo[],
	containerName: string | undefined,
	parent: any | undefined,
): void {
	if (!node) return;

	const nodeType = node.type;

	// Class declaration
	if (nodeType === TS_NODE_KINDS.CLASS_DECLARATION) {
		const name = getTSName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			const exported = isExportedNode(node, parent);
			symbols.push({
				name,
				kind: "class",
				languageId,
				...range,
				signature: `class ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: exported,
			});

			// Walk class body for methods/properties
			const body = findNamedChild(node, "class_body");
			if (body) {
				for (const child of body.namedChildren || []) {
					walkTSNode(child, content, languageId, symbols, name, node);
				}
			}
			return;
		}
	}

	// Method definition (inside class)
	if (nodeType === TS_NODE_KINDS.METHOD_DEFINITION) {
		const name = getTSName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "method",
				languageId,
				...range,
				signature: `${containerName ? `${containerName}.` : ""}${name}()`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: false,
			});
		}
		return;
	}

	// Public field definition (class property)
	if (nodeType === TS_NODE_KINDS.PUBLIC_FIELD_DEFINITION) {
		const name = getTSName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "property",
				languageId,
				...range,
				signature: name,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: false,
			});
		}
		return;
	}

	// Function declaration
	if (nodeType === TS_NODE_KINDS.FUNCTION_DECLARATION) {
		const name = getTSName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			const exported = isExportedNode(node, parent);
			const fullName = containerName ? `${containerName}.${name}` : name;
			symbols.push({
				name,
				kind: "function",
				languageId,
				...range,
				signature: `${name}()`,
				containerName,
				fullName,
				isExported: exported,
			});
		}
		return;
	}

	// Lexical declaration with arrow function (const x = () => {})
	if (nodeType === TS_NODE_KINDS.LEXICAL_DECLARATION) {
		for (const declarator of findAllNamedChildren(node, TS_NODE_KINDS.VARIABLE_DECLARATOR)) {
			const nameNode = findNamedChild(declarator, TS_NODE_KINDS.IDENTIFIER);
			const arrowFn = findNamedChild(declarator, TS_NODE_KINDS.ARROW_FUNCTION);
			if (nameNode && arrowFn) {
				const name = getNodeText(nameNode, content);
				const range = nodeToExactRange(declarator);
				const exported = isExportedNode(node, parent);
				const fullName = containerName ? `${containerName}.${name}` : name;
				symbols.push({
					name,
					kind: "function",
					languageId,
					...range,
					signature: `${name} = () => { ... }`,
					containerName,
					fullName,
					isExported: exported,
				});
			} else if (nameNode) {
				// Plain variable declaration
				const name = getNodeText(nameNode, content);
				const range = nodeToExactRange(declarator);
				const exported = isExportedNode(node, parent);
				const fullName = containerName ? `${containerName}.${name}` : name;
				symbols.push({
					name,
					kind: "variable",
					languageId,
					...range,
					signature: name,
					containerName,
					fullName,
					isExported: exported,
				});
			}
		}
		return;
	}

	// Interface declaration
	if (nodeType === TS_NODE_KINDS.INTERFACE_DECLARATION) {
		const name = getTSName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			const exported = isExportedNode(node, parent);
			symbols.push({
				name,
				kind: "interface",
				languageId,
				...range,
				signature: `interface ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: exported,
			});
		}
		return;
	}

	// Type alias declaration
	if (nodeType === TS_NODE_KINDS.TYPE_ALIAS_DECLARATION) {
		const name = getTSName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			const exported = isExportedNode(node, parent);
			symbols.push({
				name,
				kind: "type",
				languageId,
				...range,
				signature: `type ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: exported,
			});
		}
		return;
	}

	// Enum declaration
	if (nodeType === TS_NODE_KINDS.ENUM_DECLARATION) {
		const name = getTSName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			const exported = isExportedNode(node, parent);
			symbols.push({
				name,
				kind: "enum",
				languageId,
				...range,
				signature: `enum ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: exported,
			});
		}
		return;
	}

	// Import statement
	if (nodeType === TS_NODE_KINDS.IMPORT_STATEMENT) {
		const importText = getNodeText(node, content);
		// Extract the module source
		const source = extractImportSource(node, content);
		const range = nodeToExactRange(node);
		const fullName = source ? `import from "${source}"` : getNodeText(node, content);
		symbols.push({
			name: fullName,
			kind: "import",
			languageId,
			...range,
			signature: importText,
			containerName,
			fullName,
			isExported: false,
		});
		return;
	}

	// Recurse for container nodes
	for (const child of node.namedChildren || []) {
		walkTSNode(child, content, languageId, symbols, containerName, node);
	}
}

/**
 * Get name from a TS node.
 */
function getTSName(node: any, content: string): string | undefined {
	// Try property_identifier (used in methods and fields)
	const propId = findNamedChild(node, TS_NODE_KINDS.PROPERTY_IDENTIFIER);
	if (propId) return getNodeText(propId, content);

	// Try identifier
	const id = findNamedChild(node, TS_NODE_KINDS.IDENTIFIER);
	if (id) return getNodeText(id, content);

	// Try name child
	const nameChild = findNamedChild(node, "name");
	if (nameChild) return getNodeText(nameChild, content);

	return undefined;
}

/**
 * Extract module source from an import statement.
 */
function extractImportSource(node: any, content: string): string | undefined {
	if (!node.namedChildren) return undefined;
	const stringChild = node.namedChildren.find((c: any) => c.type === "string" || c.type === "string_fragment");
	if (stringChild) return getNodeText(stringChild, content);
	return undefined;
}

// ============================================================================
// Outline builder
// ============================================================================

/**
 * Build a concise outline string from symbols.
 */
export function buildTypeScriptOutline(symbols: TreeSitterSymbolInfo[]): string {
	if (symbols.length === 0) return "No symbols found.";

	const lines: string[] = [];
	lines.push("Symbol Outline:");
	lines.push("==============");

	for (const sym of symbols) {
		const range = sym.startLine === sym.endLine ? ` L${sym.startLine}` : ` L${sym.startLine}-${sym.endLine}`;
		const name = sym.fullName || sym.name;
		lines.push(`  [${sym.kind}] ${name} ${range}`);
	}

	return lines.join("\n");
}

// ============================================================================
// Symbol exact extraction
// ============================================================================

/**
 * Get exact content for a TypeScript symbol.
 */
export function typeScriptSymbolExact(
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
