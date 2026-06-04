/**
 * P43 Smart Read Core - W010 (v2)
 *
 * Implements smart_read modes, adapter registry, and provider registry.
 * Modes: outline, symbols, symbol_exact, range_exact, changed, raw.
 *
 * v2 changes:
 * - Provider-aware: registers providers with priority/availability/fallback
 * - Legacy adapter compatibility preserved
 * - Provider selection with timeout
 * - Fallback chain (provider -> adapter -> generic -> raw)
 * - Audit trail for provider selection
 */

import { extname } from "node:path";
import type {
	SmartReadAdapter,
	SmartReadMode,
	SmartReadProvider,
	SmartReadProviderPlan,
	SmartReadResult,
} from "./types.js";
import { withProviderTimeout } from "./types.js";

const DEFAULT_PROVIDER_TIMEOUT_MS = 1500;

export class SmartReadCore {
	private adapters = new Map<string, SmartReadAdapter>();
	private providers: SmartReadProvider[] = [];
	private fallbackAdapter?: SmartReadAdapter;

	/**
	 * Register an adapter for specific extensions (legacy).
	 */
	registerAdapter(adapter: SmartReadAdapter): void {
		for (const ext of adapter.extensions) {
			this.adapters.set(ext.toLowerCase(), adapter);
		}
	}

	/**
	 * Register a provider (v2).
	 */
	registerProvider(provider: SmartReadProvider): void {
		this.providers.push(provider);
	}

	/**
	 * Set the fallback adapter (used when no extension matches).
	 */
	setFallbackAdapter(adapter: SmartReadAdapter): void {
		this.fallbackAdapter = adapter;
	}

	/**
	 * Get the adapter for a file path (legacy).
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
	 * Get all registered providers.
	 */
	getAllProviders(): SmartReadProvider[] {
		return [...this.providers];
	}

	/**
	 * Get available providers for a file path, sorted by priority descending.
	 */
	async getProviders(filePath: string): Promise<SmartReadProvider[]> {
		const ext = extname(filePath).toLowerCase();
		const matching = this.providers.filter((p) => p.extensions.some((e) => e.toLowerCase() === ext));

		// Sort by priority descending
		matching.sort((a, b) => b.priority - a.priority);

		// Filter by availability
		const available: SmartReadProvider[] = [];
		for (const p of matching) {
			try {
				if (await p.isAvailable()) {
					available.push(p);
				}
			} catch {
				// Provider check failed, skip
			}
		}

		return available;
	}

	/**
	 * Get the provider plan for a file path, showing the fallback chain.
	 */
	async getProviderPlan(filePath: string): Promise<SmartReadProviderPlan> {
		const ext = extname(filePath).toLowerCase();
		const all = this.providers
			.filter((p) => p.extensions.some((e) => e.toLowerCase() === ext))
			.sort((a, b) => b.priority - a.priority);

		const entries = [];
		let selectedProvider: string | undefined;
		let fallbackReason: string | undefined;

		for (const p of all) {
			let available = false;
			try {
				available = await p.isAvailable();
			} catch {
				available = false;
			}

			const capabilities = p.getCapabilities();
			const parseSource = this.getParseSourceForProvider(p.name);

			entries.push({
				name: p.name,
				priority: p.priority,
				available,
				parseSource,
				capabilities,
			});

			if (available && !selectedProvider) {
				selectedProvider = p.name;
			}
		}

		if (!selectedProvider) {
			// Check legacy adapter
			const adapter = this.adapters.get(ext) || this.adapters.get(ext.replace(/^\./, "")) || this.fallbackAdapter;
			if (adapter) {
				selectedProvider = adapter.name;
				fallbackReason = "no v2 provider available; using legacy adapter";
			} else {
				fallbackReason = "no provider or adapter available; will use raw fallback";
			}
		}

		return {
			filePath,
			extension: ext,
			providers: entries,
			selectedProvider,
			fallbackReason,
		};
	}

	/**
	 * Execute a smart read in the specified mode.
	 */
	async smartRead(
		content: string,
		filePath: string,
		mode: SmartReadMode,
		options?: { symbol?: string; startLine?: number; endLine?: number; delta?: string; timeoutMs?: number },
	): Promise<SmartReadResult> {
		const timeoutMs = options?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;

		// Try v2 providers first
		const providers = await this.getProviders(filePath);
		if (providers.length > 0) {
			for (const provider of providers) {
				try {
					const result = await withProviderTimeout(
						this.callProvider(provider, content, filePath, mode, options),
						timeoutMs,
						provider.name,
					);

					// Validate result: if it's a fallback or unavailable, try next provider
					if (result && !result.isFallback) {
						return this.ensureExactRangeConsistency(result);
					}
				} catch {}
			}
		}

		// Fallback to legacy adapter
		const adapter = this.getAdapter(filePath);
		if (adapter) {
			try {
				const result = await withProviderTimeout(
					this.callAdapter(adapter, content, filePath, mode, options),
					timeoutMs,
					adapter.name,
				);
				if (result) {
					return this.ensureExactRangeConsistency(result);
				}
			} catch {
				// Adapter failed, fall through to raw
			}
		}

		// Final fallback: raw
		return this.rawFallback(content, "no provider or adapter available");
	}

	/**
	 * List registered adapter extensions.
	 */
	getRegisteredExtensions(): string[] {
		return Array.from(this.adapters.keys());
	}

	/**
	 * List registered provider names.
	 */
	getRegisteredProviders(): string[] {
		return this.providers.map((p) => p.name);
	}

	// ============================================================================
	// Internal helpers
	// ============================================================================

	private async callProvider(
		provider: SmartReadProvider,
		content: string,
		filePath: string,
		mode: SmartReadMode,
		options?: { symbol?: string; startLine?: number; endLine?: number; delta?: string },
	): Promise<SmartReadResult> {
		switch (mode) {
			case "outline":
				return provider.outline(content, filePath);
			case "symbols":
				return provider.symbols(content, filePath);
			case "symbol_exact":
				if (!options?.symbol) {
					return this.rawFallback(content, "symbol_exact requires a symbol name");
				}
				return provider.symbolExact(content, filePath, options.symbol);
			case "range_exact":
				if (options?.startLine === undefined || options?.endLine === undefined) {
					return this.rawFallback(content, "range_exact requires startLine and endLine");
				}
				return provider.rangeExact(content, filePath, options.startLine, options.endLine);
			case "changed":
				if (!options?.delta) {
					return this.rawFallback(content, "changed mode requires a delta");
				}
				return provider.changed(content, filePath, options.delta);
			case "raw":
				return this.rawResult(content, provider.name);
			default:
				return this.rawFallback(content, `unknown mode: ${mode}`);
		}
	}

	private async callAdapter(
		adapter: SmartReadAdapter,
		content: string,
		filePath: string,
		mode: SmartReadMode,
		options?: { symbol?: string; startLine?: number; endLine?: number; delta?: string },
	): Promise<SmartReadResult> {
		switch (mode) {
			case "outline":
				return adapter.outline(content, filePath);
			case "symbols":
				return adapter.symbols(content, filePath);
			case "symbol_exact":
				if (!options?.symbol) {
					return this.rawFallback(content, "symbol_exact requires a symbol name");
				}
				return adapter.symbolExact(content, filePath, options.symbol);
			case "range_exact":
				if (options?.startLine === undefined || options?.endLine === undefined) {
					return this.rawFallback(content, "range_exact requires startLine and endLine");
				}
				return adapter.rangeExact(content, filePath, options.startLine, options.endLine);
			case "changed":
				if (!options?.delta) {
					return this.rawFallback(content, "changed mode requires a delta");
				}
				return adapter.changed(content, filePath, options.delta);
			case "raw":
				return this.rawResult(content, adapter.name);
			default:
				return this.rawFallback(content, `unknown mode: ${mode}`);
		}
	}

	/**
	 * Ensure exactRange is set for mutation-safe results, and vice versa.
	 */
	private ensureExactRangeConsistency(result: SmartReadResult): SmartReadResult {
		// If symbol_exact claims mutationSafe=true but has no exactRange, downgrade
		if (result.mode === "symbol_exact" && result.mutationSafe === true && !result.exactRange) {
			return {
				...result,
				mutationSafe: false,
				adapterConfidence: Math.min(result.adapterConfidence ?? 0.5, 0.5),
				isFallback: true,
				fallbackError: result.fallbackError ?? "symbol_exact missing exactRange; downgraded to non-mutation-safe",
			};
		}

		return result;
	}

	/**
	 * Map provider name to parse source.
	 */
	private getParseSourceForProvider(name: string): any {
		switch (name) {
			case "typescript-compiler":
				return "typescript_compiler";
			case "json-native":
			case "yaml-native":
				return "native_parser";
			case "tree-sitter-wasm":
				return "tree_sitter_wasm";
			case "pyright":
				return "lsp";
			default:
				return "regex_fallback";
		}
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
			parseSource: "raw",
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
			parseSource: "raw",
		};
	}
}
