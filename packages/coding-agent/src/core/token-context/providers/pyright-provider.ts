/**
 * P43 Smart Read v2 — Pyright Provider Skeleton
 *
 * Potential future provider using Pyright npm package.
 * Currently: detection-only, reports as unavailable.
 *
 * Pyright integration would require either:
 *   - In-process type checking API (if exposed from npm)
 *   - stdio subprocess communication
 *
 * Both approaches are deferred due to complexity.
 * Python Smart Read v2 uses tree-sitter WASM or regex fallback for now.
 *
 * npm-only: pyright npm package does not require pip/system Python
 * for its own runtime, but full LSP integration is deferred.
 */

import type {
	SmartReadParseSource,
	SmartReadProvider,
	SmartReadProviderCapabilities,
	SmartReadResult,
} from "../types.js";
import { SMART_READ_CONFIDENCE } from "../types.js";

let _pyrightAvailable: boolean | null = null;

function _checkPyrightAvailability(): boolean {
	if (_pyrightAvailable !== null) return _pyrightAvailable;
	try {
		require.resolve("pyright");
		_pyrightAvailable = true;
	} catch {
		_pyrightAvailable = false;
	}
	return _pyrightAvailable;
}

export class PyrightProvider implements SmartReadProvider {
	readonly name = "pyright";
	readonly languageIds = ["python"];
	readonly extensions = [".py", ".pyw", ".pyx", ".pxd", ".pxi"];
	readonly priority = 90;

	isAvailable(): boolean {
		// Pyright LSP integration is deferred. Always return false for now.
		// When implemented, check checkPyrightAvailability() instead.
		return false;
	}

	getCapabilities(): SmartReadProviderCapabilities {
		return {
			outline: false,
			symbols: false,
			symbolExact: false,
			rangeExact: true,
			changed: true,
			exactRanges: false,
			mutationSafeExact: false,
			semantic: false,
			astBacked: false,
		};
	}

	async outline(_content: string, filePath: string): Promise<SmartReadResult> {
		return this.unavailableResult("outline", filePath);
	}

	async symbols(_content: string, filePath: string): Promise<SmartReadResult> {
		return this.unavailableResult("symbols", filePath);
	}

	async symbolExact(_content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		return this.unavailableResult("symbol_exact", filePath, symbol);
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
			parseSource: "lsp" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
		};
	}

	private unavailableResult(mode: string, filePath: string, symbol?: string): SmartReadResult {
		const content = symbol
			? `[Pyright provider unavailable for symbol "${symbol}" in ${filePath}]`
			: `[Pyright provider unavailable for ${mode} in ${filePath}]`;

		return {
			content,
			mode: mode as SmartReadResult["mode"],
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			parseSource: "lsp" as SmartReadParseSource,
			providerName: this.name,
			providerPriority: this.priority,
			isFallback: true,
			fallbackError: "Pyright LSP integration deferred; use tree-sitter WASM or regex fallback",
		};
	}
}
