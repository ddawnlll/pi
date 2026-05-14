/**
 * Context Builder
 *
 * Builds classified context sections from a prompt context, computes
 * static/dynamic token splits, and enforces budget limits.
 *
 * Integrates context section classification (context-section.ts) with
 * the token budget enforcer (core/context-budget.ts) to provide a single
 * entry point for building a classified context report.
 *
 * Usage:
 *   const builder = new ContextBuilder();
 *   const result = builder.build(context, { role: "worker" });
 *   console.log(result.report);
 *   console.log(`Static: ${result.staticTokens}, Dynamic: ${result.dynamicTokens}`);
 *   if (!result.passesBudget) {
 *     throw new Error(result.budgetCheck.reason);
 *   }
 */

import type { Context, Message, Tool } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import {
	type BudgetCheckResult,
	BudgetExceededError,
	ContextBudgetEnforcer,
	type ContextBudgetSettings,
	type TokenRole,
} from "../core/context-budget.js";
import { type ContextSection, estimateTokenCount, hashString, summarizeMessageContent } from "./context-section.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for building a classified context.
 */
export interface ContextBuildOptions {
	/** Role for budget enforcement (default: "worker"). */
	role?: TokenRole;
	/** Number of pinned (cacheable) messages (default: 0). */
	pinnedMessageCount?: number;
}

/**
 * Result of building a classified context.
 */
export interface ContextBuildResult {
	/** Classified sections in priority order. */
	sections: ContextSection[];
	/** Total estimated tokens across all sections. */
	totalTokens: number;
	/** Estimated tokens in static cacheable sections. */
	staticTokens: number;
	/** Estimated tokens in semi-static cacheable sections. */
	semiStaticTokens: number;
	/** Estimated tokens in dynamic non-cacheable sections. */
	dynamicTokens: number;
	/** Budget check result from the enforcer. */
	budgetCheck: BudgetCheckResult;
	/** Whether the context passes the budget check. */
	passesBudget: boolean;
	/** Human-readable context classification report. */
	report: string;
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

/**
 * Builds classified context sections with budget enforcement.
 *
 * Accepts a full prompt Context and produces a ContextBuildResult with
 * cacheability-classified sections, token split estimates, budget check,
 * and a human-readable report.
 */
export class ContextBuilder {
	private budgetEnforcer: ContextBudgetEnforcer;

	/**
	 * @param budgetEnforcer - Budget enforcer instance (uses defaults if not provided).
	 */
	constructor(budgetEnforcer?: ContextBudgetEnforcer) {
		this.budgetEnforcer = budgetEnforcer ?? new ContextBudgetEnforcer();
	}

	/**
	 * Build a classified context report from a full prompt context.
	 *
	 * @param context - Full prompt context from the agent session.
	 * @param options - Build options (role, pinnedMessageCount).
	 * @returns ContextBuildResult with classified sections, token split, and budget check.
	 */
	build(context: Context, options?: ContextBuildOptions): ContextBuildResult {
		const role = options?.role ?? "worker";
		const pinnedMessageCount = options?.pinnedMessageCount ?? 0;

		// Build classified sections
		const sections = this.buildSections(context, pinnedMessageCount);

		// Compute token estimates per cacheability level
		const staticTokens = sections
			.filter((s) => s.cacheability === "static_cacheable")
			.reduce((sum, s) => sum + s.tokenEstimate, 0);

		const semiStaticTokens = sections
			.filter((s) => s.cacheability === "semi_static_cacheable")
			.reduce((sum, s) => sum + s.tokenEstimate, 0);

		const dynamicTokens = sections
			.filter((s) => s.cacheability === "dynamic_non_cacheable")
			.reduce((sum, s) => sum + s.tokenEstimate, 0);

		const totalTokens = staticTokens + semiStaticTokens + dynamicTokens;

		// Apply budget gateway
		const budgetCheck = this.budgetEnforcer.checkBudget(totalTokens, role);
		const passesBudget = budgetCheck.passed;

		// Build human-readable report
		const report = this.buildReport(
			sections,
			totalTokens,
			staticTokens,
			semiStaticTokens,
			dynamicTokens,
			budgetCheck,
		);

		return {
			sections,
			totalTokens,
			staticTokens,
			semiStaticTokens,
			dynamicTokens,
			budgetCheck,
			passesBudget,
			report,
		};
	}

	/**
	 * Build a classified context and throw if budget is exceeded.
	 *
	 * Convenience wrapper for callers that want fail-fast behavior.
	 *
	 * @param context - Full prompt context.
	 * @param options - Build options.
	 * @returns ContextBuildResult (guaranteed to have passesBudget === true).
	 * @throws BudgetExceededError if the context exceeds the budget.
	 */
	buildOrThrow(context: Context, options?: ContextBuildOptions): ContextBuildResult {
		const result = this.build(context, options);
		if (!result.passesBudget) {
			throw new BudgetExceededError(result.budgetCheck);
		}
		return result;
	}

	/**
	 * Get the underlying budget enforcer.
	 */
	getBudgetEnforcer(): ContextBudgetEnforcer {
		return this.budgetEnforcer;
	}

	/**
	 * Update budget settings on the enforcer.
	 */
	updateBudgetSettings(settings: Partial<ContextBudgetSettings>): void {
		this.budgetEnforcer.updateSettings(settings);
	}

	// -----------------------------------------------------------------------
	// Private: Section building
	// -----------------------------------------------------------------------

	/**
	 * Build classified sections from a context.
	 */
	private buildSections(context: Context, pinnedMessageCount: number): ContextSection[] {
		const sections: ContextSection[] = [];

		// Classify system prompt (includes dynamic date/cwd extraction)
		sections.push(...this.classifySystemPrompt(context.systemPrompt ?? ""));

		// Classify tools
		sections.push(...this.classifyTools(context.tools ?? []));

		// Classify messages into pinned (semi-static) and recent (dynamic)
		sections.push(...this.classifyMessages(context.messages ?? [], pinnedMessageCount));

		// Sort by priority for deterministic ordering
		sections.sort((a, b) => a.priority - b.priority);

		return sections;
	}

	/**
	 * Classify the system prompt into static and dynamic sections.
	 *
	 * Extracts known dynamic trailing lines (Current date, CWD) from the
	 * system prompt and classifies them as dynamic_non_cacheable.
	 */
	private classifySystemPrompt(systemPrompt: string): ContextSection[] {
		if (!systemPrompt) return [];

		const sections: ContextSection[] = [];
		const datePrefix = "Current date: ";
		const cwdPrefix = "Current working directory: ";
		const lines = systemPrompt.split("\n");
		const extracted: string[] = [];

		// Walk from the end to find trailing date/cwd lines
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			if (line.startsWith(datePrefix) || line.startsWith(cwdPrefix)) {
				extracted.unshift(line);
			} else {
				break;
			}
		}

		let staticPart = systemPrompt;
		if (extracted.length > 0) {
			staticPart = lines.slice(0, lines.length - extracted.length).join("\n");
		}

		// Static main system prompt
		sections.push({
			kind: "system_prompt",
			content: staticPart,
			cacheability: "static_cacheable",
			priority: 0,
			tokenEstimate: estimateTokenCount(staticPart),
			source: "system prompt",
			hash: hashString(staticPart),
		});

		// Dynamic date/cwd lines
		for (const line of extracted) {
			const kind = line.startsWith(datePrefix) ? "current_date" : "current_directory";
			sections.push({
				kind,
				content: line,
				cacheability: "dynamic_non_cacheable",
				priority: 999,
				tokenEstimate: estimateTokenCount(line),
				source: "system prompt (dynamic)",
				hash: hashString(line),
			});
		}

		return sections;
	}

	/**
	 * Classify tool definitions as static cacheable sections.
	 */
	private classifyTools(tools: Tool<TSchema>[]): ContextSection[] {
		if (tools.length === 0) return [];

		const content = tools.map((t) => `${t.name}: ${t.description}`).join("\n");
		return [
			{
				kind: "tool_definitions",
				content,
				cacheability: "static_cacheable",
				priority: 1,
				tokenEstimate: estimateTokenCount(content),
				source: "tool registry",
				hash: hashString(content),
			},
		];
	}

	/**
	 * Classify messages into pinned (semi-static) and recent (dynamic) sections.
	 *
	 * Logs, timestamps, and retry data that appear as recent messages are
	 * classified as dynamic to keep them out of the cacheable prefix.
	 */
	private classifyMessages(messages: Message[], pinnedMessageCount: number): ContextSection[] {
		const sections: ContextSection[] = [];
		if (messages.length === 0) return sections;

		const count = Math.min(pinnedMessageCount, messages.length);
		const pinned = messages.slice(0, count);
		const recent = messages.slice(count);

		if (pinned.length > 0) {
			const content = pinned.map((m) => `${m.role}: ${summarizeMessageContent(m.content)}`).join("\n");
			sections.push({
				kind: "pinned_messages",
				content,
				cacheability: "semi_static_cacheable",
				priority: 50,
				tokenEstimate: estimateTokenCount(content),
				source: "pinned conversation history",
				hash: hashString(content),
			});
		}

		if (recent.length > 0) {
			const content = recent.map((m) => `${m.role}: ${summarizeMessageContent(m.content)}`).join("\n");
			sections.push({
				kind: "recent_messages",
				content,
				cacheability: "dynamic_non_cacheable",
				priority: 100,
				tokenEstimate: estimateTokenCount(content),
				source: "recent conversation history",
				hash: hashString(content),
			});
		}

		return sections;
	}

	// -----------------------------------------------------------------------
	// Private: Report generation
	// -----------------------------------------------------------------------

	/**
	 * Build a human-readable context classification report.
	 *
	 * The report shows each section with its cacheability tag, token estimates,
	 * and the budget check result. This satisfies AC3 (worker context report
	 * shows static/dynamic token split).
	 */
	private buildReport(
		sections: ContextSection[],
		totalTokens: number,
		staticTokens: number,
		semiStaticTokens: number,
		dynamicTokens: number,
		budgetCheck: BudgetCheckResult,
	): string {
		const lines: string[] = [];
		lines.push("Context Classification Report");
		lines.push("=".repeat(44));

		for (const section of sections) {
			const tag =
				section.cacheability === "static_cacheable"
					? "[STATIC]"
					: section.cacheability === "semi_static_cacheable"
						? "[SEMI]"
						: "[DYNAMIC]";
			lines.push(`${tag} ${section.kind} (${section.source}) ~${section.tokenEstimate}t`);
		}

		const pct = (val: number) => (totalTokens > 0 ? Math.round((val / totalTokens) * 100) : 0);

		lines.push("");
		lines.push("Token Split:");
		lines.push(`  Static:      ${staticTokens}t (${pct(staticTokens)}%)`);
		lines.push(`  Semi-Static: ${semiStaticTokens}t (${pct(semiStaticTokens)}%)`);
		lines.push(`  Dynamic:     ${dynamicTokens}t (${pct(dynamicTokens)}%)`);
		lines.push(`  Total:       ${totalTokens}t`);

		lines.push("");
		lines.push(`Budget Check: ${budgetCheck.passed ? "PASS" : "BLOCKED"}`);
		lines.push(`  Role:     ${budgetCheck.role}`);
		lines.push(`  Limit:    ${budgetCheck.budgetLimit}t`);
		if (budgetCheck.reason) {
			lines.push(`  Reason:   ${budgetCheck.reason}`);
		}

		return lines.join("\n");
	}
}
