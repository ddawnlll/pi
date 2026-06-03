/**
 * P43 Generic & LLM-Assisted Fallback Adapter - W015
 *
 * Handles unknown languages safely.
 * Generic outline first, then LLM-assisted if configured and within budget.
 * LLM fallback output always mutationSafe=false (I002).
 * Over-budget fallback aborts to exact/raw (I008).
 */

import type { SmartReadAdapter, SmartReadResult } from "../types.js";

/**
 * Generic fallback adapter for unknown languages.
 * Provides basic line-based outline and range extraction.
 * Never produces mutation-safe results (I002).
 */
export class GenericFallbackAdapter implements SmartReadAdapter {
	readonly name = "generic";
	readonly extensions: string[] = [];

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		const lines = content.split("\n");
		const totalLines = lines.length;
		const heading = `Generic Outline for ${filePath} (${totalLines} lines):\n`;
		const preview = lines
			.slice(0, 20)
			.map((l, i) => `  L${i + 1}: ${l.length > 80 ? `${l.slice(0, 77)}...` : l}`)
			.join("\n");

		const result = heading + preview;
		if (totalLines > 20) {
			return {
				content: `${result}\n  ... (${totalLines - 20} more lines)`,
				mode: "outline",
				mutationSafe: false,
				adapterConfidence: 0.3,
				adapterName: this.name,
				isFallback: true,
				suggestedNextReads: [`range_exact:1-20`, `range_exact:21-40`],
			};
		}

		return {
			content: result,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: 0.3,
			adapterName: this.name,
			isFallback: true,
		};
	}

	async symbols(content: string, filePath: string): Promise<SmartReadResult> {
		return this.outline(content, filePath);
	}

	async symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		// Generic fallback cannot resolve symbols
		const lines = content.split("\n");
		// Try simple text search
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(symbol)) {
				const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join("\n");
				return {
					content: context,
					mode: "symbol_exact",
					mutationSafe: false,
					adapterConfidence: 0.2,
					adapterName: this.name,
					isFallback: true,
				};
			}
		}

		return {
			content: `[Symbol "${symbol}" not found via generic search in ${filePath}]`,
			mode: "symbol_exact",
			mutationSafe: false,
			adapterConfidence: 0.1,
			adapterName: this.name,
			isFallback: true,
			fallbackError: `generic adapter cannot resolve symbols`,
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
		};
	}

	async changed(_content: string, filePath: string, delta: string): Promise<SmartReadResult> {
		return {
			content: `[Changed content based on delta for ${filePath}]\n${delta}`,
			mode: "changed",
			mutationSafe: false,
			adapterConfidence: 0.5,
			adapterName: this.name,
			isFallback: true,
		};
	}
}

/**
 * LLM-assisted fallback adapter.
 *
 * Uses an LLM call to parse unknown file types, but with strict
 * budget limits. Always sets mutationSafe=false (I002).
 * This is a stub that can be wired to a real LLM call.
 */
export class LLMFallbackAdapter implements SmartReadAdapter {
	readonly name = "llm-fallback";
	readonly extensions: string[] = [];
	private maxTokens: number;
	private llmCallFn?: (prompt: string, content: string, filePath: string) => Promise<string>;

	constructor(maxTokens: number, llmCallFn?: (prompt: string, content: string, filePath: string) => Promise<string>) {
		this.maxTokens = maxTokens;
		this.llmCallFn = llmCallFn;
	}

	async outline(content: string, filePath: string): Promise<SmartReadResult> {
		if (!this.llmCallFn) {
			// No LLM configured, fall through to generic
			const generic = new GenericFallbackAdapter();
			return generic.outline(content, filePath);
		}

		const estimatedTokens = Math.ceil(content.length / 4);
		if (estimatedTokens > this.maxTokens) {
			// I008: over budget, abort to raw
			return {
				content: `[LLM fallback over budget: ${estimatedTokens} tokens > ${this.maxTokens} max. Using raw content.]\n\n${content.slice(0, 500)}...`,
				mode: "outline",
				mutationSafe: false,
				adapterConfidence: 0.1,
				adapterName: this.name,
				isFallback: true,
				fallbackError: `over budget: ${estimatedTokens} > ${this.maxTokens}`,
			};
		}

		try {
			const prompt = `Analyze this file (${filePath}) and provide a structured outline of its symbols (classes, functions, methods, variables, etc.). Format: [kind] name @ L<line>`;
			const result = await this.llmCallFn(prompt, content, filePath);

			return {
				content: result,
				mode: "outline",
				mutationSafe: false, // I002: LLM output is never mutation-safe
				adapterConfidence: 0.5,
				adapterName: this.name,
				isFallback: false,
			};
		} catch {
			const generic = new GenericFallbackAdapter();
			return generic.outline(content, filePath);
		}
	}

	async symbols(content: string, filePath: string): Promise<SmartReadResult> {
		if (!this.llmCallFn) {
			const generic = new GenericFallbackAdapter();
			return generic.symbols(content, filePath);
		}

		const estimatedTokens = Math.ceil(content.length / 4);
		if (estimatedTokens > this.maxTokens) {
			return {
				content: `[LLM fallback over budget for symbols mode: ${estimatedTokens} tokens > ${this.maxTokens} max.]`,
				mode: "symbols",
				mutationSafe: false,
				adapterConfidence: 0.1,
				adapterName: this.name,
				isFallback: true,
				fallbackError: `over budget`,
			};
		}

		const generic = new GenericFallbackAdapter();
		return generic.symbols(content, filePath);
	}

	async symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult> {
		const generic = new GenericFallbackAdapter();
		return generic.symbolExact(content, filePath, symbol);
	}

	async rangeExact(content: string, filePath: string, startLine: number, endLine: number): Promise<SmartReadResult> {
		const generic = new GenericFallbackAdapter();
		return generic.rangeExact(content, filePath, startLine, endLine);
	}

	async changed(content: string, filePath: string, delta: string): Promise<SmartReadResult> {
		const generic = new GenericFallbackAdapter();
		return generic.changed(content, filePath, delta);
	}
}
