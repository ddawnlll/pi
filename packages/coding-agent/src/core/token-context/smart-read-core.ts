/**
 * P43 Smart Read Core - W010
 *
 * Implements smart_read modes and adapter registry.
 * Modes: outline, symbols, symbol_exact, range_exact, changed, raw.
 * outline/summary are mutationSafe=false (I002).
 * exact symbol/range/raw are mutationSafe=true (I003).
 */

import { extname } from "node:path";
import type { SmartReadAdapter, SmartReadMode, SmartReadResult } from "./types.js";

export class SmartReadCore {
	private adapters = new Map<string, SmartReadAdapter>();
	private fallbackAdapter?: SmartReadAdapter;

	/**
	 * Register an adapter for specific extensions.
	 */
	registerAdapter(adapter: SmartReadAdapter): void {
		for (const ext of adapter.extensions) {
			this.adapters.set(ext.toLowerCase(), adapter);
		}
	}

	/**
	 * Set the fallback adapter (used when no extension matches).
	 */
	setFallbackAdapter(adapter: SmartReadAdapter): void {
		this.fallbackAdapter = adapter;
	}

	/**
	 * Get the adapter for a file path.
	 */
	getAdapter(filePath: string): SmartReadAdapter | undefined {
		const ext = extname(filePath).toLowerCase();
		// Try exact extension match first
		const adapter = this.adapters.get(ext);
		if (adapter) return adapter;

		// Try without dot
		const noDot = ext.replace(/^\./, "");
		const adapterNoDot = this.adapters.get(noDot);
		if (adapterNoDot) return adapterNoDot;

		return this.fallbackAdapter;
	}

	/**
	 * Execute a smart read in the specified mode.
	 */
	async smartRead(
		content: string,
		filePath: string,
		mode: SmartReadMode,
		options?: { symbol?: string; startLine?: number; endLine?: number; delta?: string },
	): Promise<SmartReadResult> {
		const adapter = this.getAdapter(filePath);

		if (!adapter) {
			return this.rawFallback(content, "no adapter available");
		}

		try {
			switch (mode) {
				case "outline":
					return await adapter.outline(content, filePath);
				case "symbols":
					return await adapter.symbols(content, filePath);
				case "symbol_exact":
					if (!options?.symbol) {
						return this.rawFallback(content, "symbol_exact requires a symbol name");
					}
					return await adapter.symbolExact(content, filePath, options.symbol);
				case "range_exact":
					if (options?.startLine === undefined || options?.endLine === undefined) {
						return this.rawFallback(content, "range_exact requires startLine and endLine");
					}
					return await adapter.rangeExact(content, filePath, options.startLine, options.endLine);
				case "changed":
					if (!options?.delta) {
						return this.rawFallback(content, "changed mode requires a delta");
					}
					return await adapter.changed(content, filePath, options.delta);
				case "raw":
					return this.rawResult(content, adapter.name);
				default:
					return this.rawFallback(content, `unknown mode: ${mode}`);
			}
		} catch (error) {
			// I008: fail-open, fall back to raw
			return this.rawFallback(content, `adapter error: ${(error as Error).message}`);
		}
	}

	/**
	 * List registered adapter extensions.
	 */
	getRegisteredExtensions(): string[] {
		return Array.from(this.adapters.keys());
	}

	/**
	 * Create a raw result (mutationSafe=true, full content).
	 */
	private rawResult(content: string, adapterName: string): SmartReadResult {
		return {
			content,
			mode: "raw",
			mutationSafe: true,
			adapterConfidence: 1.0,
			adapterName,
			isFallback: false,
		};
	}

	/**
	 * Create a fallback raw result (mutationSafe=true, but marked as fallback).
	 */
	private rawFallback(content: string, error: string): SmartReadResult {
		return {
			content,
			mode: "raw",
			mutationSafe: true,
			adapterConfidence: 0.5,
			adapterName: "fallback",
			isFallback: true,
			fallbackError: error,
		};
	}
}
