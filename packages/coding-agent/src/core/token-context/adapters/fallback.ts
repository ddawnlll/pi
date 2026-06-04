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

		// Detect structural markers: markdown headings, all-caps section headers,
		// setext headings (underlined with === or ---), shebang, XML/HTML root tags
		const structure: Array<{ kind: string; title: string; line: number }> = [];
		// ToC detection: consecutive lines of - [text](#anchor) or - text pattern
		let inToc = false;

		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			const trimmed = l.trim();

			// ATX headings: ## Title
			const atx = trimmed.match(/^(#{1,6})\s+(.+)/);
			if (atx) {
				structure.push({
					kind: `h${atx[1].length}`,
					title: atx[2].replace(/\s*\{#.*\}\s*$/, "").trim(),
					line: i + 1,
				});
				inToc = false;
				continue;
			}

			// Setext headings: line followed by === or ---
			const nextLine = lines[i + 1]?.trim() ?? "";
			if (trimmed && /^={3,}$/.test(nextLine)) {
				structure.push({ kind: "h1", title: trimmed, line: i + 1 });
				i++; // skip the === line
				inToc = false;
				continue;
			}
			if (trimmed && /^-{3,}$/.test(nextLine) && !inToc) {
				structure.push({ kind: "h2", title: trimmed, line: i + 1 });
				i++; // skip the --- line
				inToc = false;
				continue;
			}

			// ALL-CAPS section headers (e.g., "INSTALLATION", "USAGE")
			if (/^[A-Z][A-Z\s]{2,50}$/.test(trimmed) && trimmed.length > 4) {
				structure.push({ kind: "section", title: trimmed, line: i + 1 });
				inToc = false;
				continue;
			}

			// ToC line detection: - [text](#anchor) or - text
			const isTocLine = /^\s*-\s+\[.+\]\(#/.test(trimmed) || /^\s*\d+\.\s+\[.+\]\(#/.test(trimmed);
			if (isTocLine) {
				if (!inToc) {
					structure.push({ kind: "toc", title: "(Table of Contents)", line: i + 1 });
					inToc = true;
				}
				continue;
			}
			if (inToc && trimmed === "") {
				inToc = false;
			}
		}

		const hasStructure = structure.length > 0;
		const confidence = hasStructure ? 0.65 : 0.3;

		// Build outline
		let result: string;
		if (hasStructure) {
			result = `Structural outline for ${filePath} (${totalLines} lines):\n`;
			for (const s of structure) {
				if (s.kind === "toc") {
					const tocEnd = structure.find((x) => x.line > s.line)?.line ?? totalLines;
					result += `  [toc] Skipped ToC block (L${s.line}-L${tocEnd - 1})\n`;
				} else {
					result += `  [${s.kind}] ${s.title} @ L${s.line}\n`;
				}
			}
			const lastStruct = structure[structure.length - 1];
			if (lastStruct.kind !== "toc" && lastStruct.line < totalLines) {
				result += `  ... (${totalLines - lastStruct.line} more lines after last heading)\n`;
			}
		} else {
			// No structure detected — fall back to first 20 lines as preview
			result = `Generic outline for ${filePath} (${totalLines} lines, no headings detected):\n`;
			for (let i = 0; i < Math.min(20, totalLines); i++) {
				const l = lines[i];
				result += `  L${i + 1}: ${l.length > 80 ? `${l.slice(0, 77)}...` : l}\n`;
			}
			if (totalLines > 20) {
				result += `  ... (${totalLines - 20} more lines)\n`;
			}
		}

		const suggestedNextReads = hasStructure
			? structure
					.filter((s) => s.kind !== "toc")
					.slice(0, 3)
					.map((s) => `range_exact:${s.line}-${s.line + 20}`)
			: [`range_exact:1-20`, `range_exact:21-40`];

		return {
			content: result,
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: confidence,
			adapterName: this.name,
			isFallback: !hasStructure,
			suggestedNextReads,
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
