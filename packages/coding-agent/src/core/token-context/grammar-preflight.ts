/**
 * P43 Grammar & LSP Preflight - P43.14
 *
 * Checks runtime availability of tree-sitter, LSP, or other
 * grammar engines. Reports capabilities. Never auto-installs.
 * Fail-open: missing capability is a warning, not a hard failure.
 */

export interface GrammarCapability {
	/** Capability name */
	name: string;
	/** Whether available */
	available: boolean;
	/** Version string if available */
	version?: string;
	/** Path to grammar if available */
	path?: string;
	/** Languages supported */
	languages?: string[];
}

export interface GrammarPreflightReport {
	/** All detected capabilities */
	capabilities: GrammarCapability[];
	/** Whether tree-sitter is available */
	treeSitterAvailable: boolean;
	/** Whether LSP is available */
	lspAvailable: boolean;
	/** Warnings about missing capabilities */
	warnings: string[];
	/** Recommended adapter confidence adjustments */
	confidenceAdjustments: Record<string, number>;
}

/**
 * Run the grammar/LSP preflight check.
 * Detects available grammar engines without auto-installing.
 */
export function runGrammarPreflight(): GrammarPreflightReport {
	const capabilities: GrammarCapability[] = [];
	const warnings: string[] = [];

	// Check for tree-sitter
	const treeSitterCap = detectTreeSitter();
	capabilities.push(treeSitterCap);
	if (!treeSitterCap.available) {
		warnings.push(
			"Tree-sitter not available. Smart read adapters will use regex-based parsing with reduced confidence.",
		);
	}

	// Check for language-specific LSP
	const lspCaps = detectLSP();
	capabilities.push(...lspCaps);
	const lspAvailable = lspCaps.some((c) => c.available);
	if (!lspAvailable) {
		warnings.push("No LSP servers detected. Exact symbol resolution will rely on regex parsing only.");
	}

	// Build confidence adjustments
	const confidenceAdjustments: Record<string, number> = {};
	if (!treeSitterCap.available) {
		// Reduce confidence for regex-based adapters
		confidenceAdjustments.typescript = -0.15;
		confidenceAdjustments.python = -0.15;
		confidenceAdjustments.rust = -0.2;
		confidenceAdjustments["json-yaml"] = -0.05;
	}
	if (lspAvailable) {
		confidenceAdjustments.typescript += 0.1;
		confidenceAdjustments.python += 0.1;
		confidenceAdjustments.rust += 0.1;
	}

	return {
		capabilities,
		treeSitterAvailable: treeSitterCap.available,
		lspAvailable,
		warnings,
		confidenceAdjustments,
	};
}

function detectTreeSitter(): GrammarCapability {
	try {
		// Dynamic require to avoid hard dependency
		const ts = require("tree-sitter");
		return {
			name: "tree-sitter",
			available: true,
			version: ts.version ?? "unknown",
		};
	} catch {
		return {
			name: "tree-sitter",
			available: false,
		};
	}
}

function detectLSP(): GrammarCapability[] {
	const caps: GrammarCapability[] = [];

	// Check for TypeScript LSP
	try {
		require.resolve("typescript/lib/tsserverlibrary");
		caps.push({
			name: "typescript-lsp",
			available: true,
			languages: ["typescript", "javascript", "tsx", "jsx"],
		});
	} catch {
		caps.push({
			name: "typescript-lsp",
			available: false,
			languages: ["typescript", "javascript"],
		});
	}

	// Check for Python LSP (pyright/pylsp)
	try {
		require.resolve("pyright");
		caps.push({ name: "python-lsp", available: true, languages: ["python"] });
	} catch {
		caps.push({ name: "python-lsp", available: false, languages: ["python"] });
	}

	// Check for Rust analyzer
	try {
		require.resolve("rust-analyzer");
		caps.push({ name: "rust-lsp", available: true, languages: ["rust"] });
	} catch {
		caps.push({ name: "rust-lsp", available: false, languages: ["rust"] });
	}

	return caps;
}
