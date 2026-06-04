/**
 * P43 Smart Read v2 — Tree-sitter Rust AST Extractor
 *
 * Extracts symbols and exact ranges from Rust source using tree-sitter.
 *
 * Tree-sitter gives syntax-level exact ranges.
 * It does not provide type-semantic project-wide resolution.
 * Therefore confidence is high for node boundaries, but below LSP/compiler semantic providers.
 */

import type { TreeSitterParseResult, TreeSitterSymbolInfo } from "./tree-sitter-wasm-loader.js";
import { getNodeText, nodeToExactRange, validateExactRange } from "./tree-sitter-wasm-loader.js";

// ============================================================================
// Rust AST Node Kind Constants
// ============================================================================

const RUST_NODE_KINDS = {
	STRUCT_ITEM: "struct_item",
	ENUM_ITEM: "enum_item",
	TRAIT_ITEM: "trait_item",
	IMPL_ITEM: "impl_item",
	FUNCTION_ITEM: "function_item",
	MOD_ITEM: "mod_item",
	MACRO_DEFINITION: "macro_definition",
	TYPE_ITEM: "type_item",
	CONST_ITEM: "const_item",
	STATIC_ITEM: "static_item",
	USE_ITEM: "use_item",
	// TS tree-sitter names may differ; support both
	ASSOCIATED_ITEM: "associated_item",
	TYPE_IDENTIFIER: "type_identifier",
	NAME: "name",
	IDENTIFIER: "identifier",
	SCALLED_TYPE_IDENTIFIER: "scoped_type_identifier",
	// Alternative node names used by some grammars
	MACRO_RULES: "macro_rules",
	MACRO_INVOCATION: "macro_invocation",
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
function _findAllNamedChildren(node: any, type: string): any[] {
	if (!node.namedChildren) return [];
	return node.namedChildren.filter((c: any) => c.type === type);
}

/**
 * Get name text from an identifier/name child node.
 */
function _getChildNameText(node: any, childType: string, content: string): string | undefined {
	const child = findNamedChild(node, childType);
	if (child) return getNodeText(child, content);
	return undefined;
}

/**
 * Extract the name from a Rust item node.
 */
function getRustItemName(node: any, content: string): string | undefined {
	// Try name child first (common in tree-sitter-rust)
	const nameNode = findNamedChild(node, RUST_NODE_KINDS.NAME);
	if (nameNode) return getNodeText(nameNode, content);

	// Try type_identifier for type aliases
	const typeId = findNamedChild(node, RUST_NODE_KINDS.TYPE_IDENTIFIER);
	if (typeId) return getNodeText(typeId, content);

	return undefined;
}

/**
 * Extract impl target name (e.g., "User", "Display for User").
 */
function getImplName(node: any, content: string): string | undefined {
	// Try trait + type pattern
	const trait_ = findNamedChild(node, RUST_NODE_KINDS.TYPE_IDENTIFIER);
	if (trait_) {
		const traitText = getNodeText(trait_, content);
		const for_type = findNamedChild(node, "for");
		if (for_type) {
			// This is a trait impl
			const tgt = node.namedChildren.find(
				(c: any) => c.type === "type" || c.type === RUST_NODE_KINDS.TYPE_IDENTIFIER,
			);
			if (tgt && tgt !== trait_) {
				const tgtText = getNodeText(tgt, content);
				return `${traitText} for ${tgtText}`;
			}
		}
		return traitText;
	}

	// Try 'type' child (inherent impl)
	const typeNode = node.namedChildren.find(
		(c: any) => c.type === "type" || c.type === RUST_NODE_KINDS.TYPE_IDENTIFIER,
	);
	if (typeNode) return getNodeText(typeNode, content);

	return undefined;
}

/**
 * Walk the tree and collect all Rust symbols.
 */
export function extractRustSymbols(result: TreeSitterParseResult): TreeSitterSymbolInfo[] {
	const { tree, content, languageId } = result;
	const symbols: TreeSitterSymbolInfo[] = [];

	walkRustNode(tree.rootNode, content, languageId, symbols, undefined);

	return symbols;
}

/**
 * Find a Rust symbol by name.
 */
export function findRustSymbol(symbols: TreeSitterSymbolInfo[], name: string): TreeSitterSymbolInfo | undefined {
	// Try fullName match first
	let match = symbols.find((s) => s.fullName === name);
	if (match) return match;

	// Try name match with proper kind ordering
	// For "User", prefer struct/enum/trait over method
	if (name.indexOf(".") === -1) {
		match = symbols.find((s) => s.name === name && ["struct", "enum", "trait", "function", "macro"].includes(s.kind));
		if (match) return match;
	}

	// Any name match
	match = symbols.find((s) => s.name === name);
	if (match) return match;

	// Try container.name pattern
	const dotIndex = name.indexOf(".");
	if (dotIndex > 0) {
		const containerPart = name.slice(0, dotIndex);
		const memberPart = name.slice(dotIndex + 1);
		match = symbols.find((s) => s.containerName === containerPart && s.name === memberPart);
		if (match) return match;
	}

	return undefined;
}

/**
 * Recursively walk tree-sitter CST nodes collecting Rust symbols.
 */
function walkRustNode(
	node: any,
	content: string,
	languageId: string,
	symbols: TreeSitterSymbolInfo[],
	containerName: string | undefined,
): void {
	if (!node) return;

	const nodeType = node.type;

	// Struct item
	if (nodeType === RUST_NODE_KINDS.STRUCT_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			const sig = name;
			symbols.push({
				name,
				kind: "struct",
				languageId,
				...range,
				signature: sig,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Enum item
	if (nodeType === RUST_NODE_KINDS.ENUM_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "enum",
				languageId,
				...range,
				signature: name,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Trait item
	if (nodeType === RUST_NODE_KINDS.TRAIT_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "trait",
				languageId,
				...range,
				signature: name,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Impl item — add impl itself, then methods inside as children
	if (nodeType === RUST_NODE_KINDS.IMPL_ITEM) {
		const implName = getImplName(node, content);
		if (implName) {
			const implRange = nodeToExactRange(node);
			const implKind = "impl";
			const implFullName = containerName ? `${containerName}.impl ${implName}` : `impl ${implName}`;

			// Add the impl block as a container
			symbols.push({
				name: `impl ${implName}`,
				kind: implKind,
				languageId,
				...implRange,
				signature: implName,
				containerName,
				fullName: implFullName,
				isExported: isNodePub(node),
			});

			// Walk children for associated functions/methods
			for (const child of node.namedChildren || []) {
				walkRustNode(child, content, languageId, symbols, implName);
			}
			return;
		}
		// Fallback: walk children anyway
		for (const child of node.namedChildren || []) {
			walkRustNode(child, content, languageId, symbols, containerName);
		}
		return;
	}

	// Function item
	if (nodeType === RUST_NODE_KINDS.FUNCTION_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			const sig = extractRustFunctionSignature(node, content);
			const fullName = containerName ? `${containerName}.${name}` : name;

			// Determine kind: "method" if inside impl, "function" otherwise
			const kind = containerName ? "method" : "function";

			symbols.push({
				name,
				kind,
				languageId,
				...range,
				signature: sig,
				containerName,
				fullName,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Macro definition
	if (nodeType === RUST_NODE_KINDS.MACRO_DEFINITION || nodeType === RUST_NODE_KINDS.MACRO_RULES) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "macro",
				languageId,
				...range,
				signature: `${name}!`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Type item (type alias)
	if (nodeType === RUST_NODE_KINDS.TYPE_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "type",
				languageId,
				...range,
				signature: `type ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Const item
	if (nodeType === RUST_NODE_KINDS.CONST_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "const",
				languageId,
				...range,
				signature: `const ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Static item
	if (nodeType === RUST_NODE_KINDS.STATIC_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "static",
				languageId,
				...range,
				signature: `static ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Use item
	if (nodeType === RUST_NODE_KINDS.USE_ITEM) {
		const _useText = getNodeText(node, content);
		const name = findRustUsePath(node);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "use",
				languageId,
				...range,
				signature: `use ${name}`,
				containerName,
				fullName: name,
				isExported: false,
			});
		}
		return;
	}

	// Mod item
	if (nodeType === RUST_NODE_KINDS.MOD_ITEM) {
		const name = getRustItemName(node, content);
		if (name) {
			const range = nodeToExactRange(node);
			symbols.push({
				name,
				kind: "module",
				languageId,
				...range,
				signature: `mod ${name}`,
				containerName,
				fullName: containerName ? `${containerName}.${name}` : name,
				isExported: isNodePub(node),
			});
		}
		return;
	}

	// Recurse into children for other node types
	for (const child of node.namedChildren || []) {
		walkRustNode(child, content, languageId, symbols, containerName);
	}
}

/**
 * Check if a node has a pub modifier.
 */
function isNodePub(node: any): boolean {
	if (!node.namedChildren) return false;
	return node.namedChildren.some((c: any) => c.type === "pub" || c.type === "visibility_modifier");
}

/**
 * Extract function signature text.
 */
function extractRustFunctionSignature(node: any, content: string): string {
	const name = getRustItemName(node, content) || "";
	const params = findNamedChild(node, "parameters");
	if (params) {
		const paramText = getNodeText(params, content);
		return `${name}${paramText}`;
	}
	return `${name}()`;
}

/**
 * Find the path from a use item.
 */
function findRustUsePath(node: any): string | undefined {
	// Look for scoped_identifier or identifier children
	if (!node.namedChildren) return undefined;

	const pathParts: string[] = [];
	for (const child of node.namedChildren) {
		if (
			child.type === RUST_NODE_KINDS.IDENTIFIER ||
			child.type === RUST_NODE_KINDS.SCALLED_TYPE_IDENTIFIER ||
			child.type === "scoped_identifier"
		) {
			// For scoped identifiers, recursively extract
			pathParts.push(getNodeText(child, ""));
		}
	}

	return pathParts.length > 0 ? pathParts.join("::") : undefined;
}

// ============================================================================
// Outline builder
// ============================================================================

/**
 * Build a concise outline string from symbols.
 */
export function buildRustOutline(symbols: TreeSitterSymbolInfo[]): string {
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
 * Get exact content for a Rust symbol.
 */
export function rustSymbolExact(
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
