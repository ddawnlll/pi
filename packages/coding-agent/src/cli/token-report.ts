/**
 * Token Usage Reports / CLI Visibility - P1 Workstream 7.E
 *
 * Provides CLI commands and reporting for token usage visibility.
 */

import type { BudgetCheckResult, TokenUsage } from "@earendil-works/pi-agent-core";

/**
 * Token report for a single request
 */
export interface TokenReport {
	/** Role type */
	role: string;
	/** Estimated input tokens */
	estimatedInput: number;
	/** Actual input tokens (if available) */
	actualInput?: number;
	/** Actual output tokens (if available) */
	actualOutput?: number;
	/** Total tokens (if available) */
	totalTokens?: number;
	/** Budget limit */
	budget: number;
	/** Whether budget was exceeded */
	overBudget: boolean;
	/** Whether compaction occurred */
	compactionOccurred: boolean;
	/** Model used */
	model?: string;
	/** Provider used */
	provider?: string;
	/** Timestamp */
	timestamp: number;
	/** Request ID */
	requestId?: string;
}

/**
 * Summary report for multiple requests
 */
export interface TokenSummaryReport {
	/** Total estimated input tokens */
	totalEstimatedInput: number;
	/** Total actual input tokens */
	totalActualInput: number;
	/** Total actual output tokens */
	totalActualOutput: number;
	/** Total requests */
	totalRequests: number;
	/** Requests over budget */
	overBudgetRequests: number;
	/** Average estimated vs actual ratio */
	estimateAccuracy: number;
	/** Reports by role */
	byRole: Record<
		string,
		{
			count: number;
			totalEstimated: number;
			totalActual: number;
		}
	>;
}

/**
 * Format a token report for human-readable output
 *
 * @param report - Token report
 * @returns Formatted string
 */
export function formatTokenReportHuman(report: TokenReport): string {
	const lines: string[] = [];

	lines.push("Token Usage Report");
	lines.push("=".repeat(50));

	if (report.model && report.provider) {
		lines.push(`Model: ${report.provider}/${report.model}`);
	}

	lines.push(`Role: ${report.role}`);
	lines.push(`Budget: ${report.budget.toLocaleString()} tokens`);
	lines.push("");

	lines.push("Estimated:");
	lines.push(`  Input: ${report.estimatedInput.toLocaleString()} tokens`);

	if (report.actualInput !== undefined || report.actualOutput !== undefined) {
		lines.push("");
		lines.push("Actual:");
		if (report.actualInput !== undefined) {
			lines.push(`  Input: ${report.actualInput.toLocaleString()} tokens`);
			const diff = report.actualInput - report.estimatedInput;
			const diffPercent = ((diff / report.estimatedInput) * 100).toFixed(1);
			lines.push(`  Difference: ${diff > 0 ? "+" : ""}${diff} (${diffPercent}%)`);
		}
		if (report.actualOutput !== undefined) {
			lines.push(`  Output: ${report.actualOutput.toLocaleString()} tokens`);
		}
		if (report.totalTokens !== undefined) {
			lines.push(`  Total: ${report.totalTokens.toLocaleString()} tokens`);
		}
	}

	lines.push("");
	lines.push("Status:");
	lines.push(`  Over Budget: ${report.overBudget ? "YES ⚠️" : "No"}`);
	lines.push(`  Compaction: ${report.compactionOccurred ? "Yes" : "No"}`);

	if (report.overBudget) {
		const excess = report.estimatedInput - report.budget;
		lines.push(`  Excess: ${excess.toLocaleString()} tokens over budget`);
	}

	return lines.join("\n");
}

/**
 * Format a token report as JSON
 *
 * @param report - Token report
 * @param pretty - Whether to pretty-print
 * @returns JSON string
 */
export function formatTokenReportJson(report: TokenReport, pretty = true): string {
	return JSON.stringify(report, null, pretty ? 2 : 0);
}

/**
 * Format a summary report for human-readable output
 *
 * @param summary - Summary report
 * @returns Formatted string
 */
export function formatSummaryReportHuman(summary: TokenSummaryReport): string {
	const lines: string[] = [];

	lines.push("Token Usage Summary");
	lines.push("=".repeat(50));
	lines.push("");

	lines.push("Overall:");
	lines.push(`  Total Requests: ${summary.totalRequests}`);
	lines.push(
		`  Over Budget: ${summary.overBudgetRequests} (${((summary.overBudgetRequests / summary.totalRequests) * 100).toFixed(1)}%)`,
	);
	lines.push("");

	lines.push("Tokens:");
	lines.push(`  Estimated Input: ${summary.totalEstimatedInput.toLocaleString()}`);
	if (summary.totalActualInput > 0) {
		lines.push(`  Actual Input: ${summary.totalActualInput.toLocaleString()}`);
		lines.push(`  Actual Output: ${summary.totalActualOutput.toLocaleString()}`);
		lines.push(`  Estimate Accuracy: ${(summary.estimateAccuracy * 100).toFixed(1)}%`);
	}
	lines.push("");

	lines.push("By Role:");
	for (const [role, stats] of Object.entries(summary.byRole)) {
		lines.push(`  ${role}:`);
		lines.push(`    Requests: ${stats.count}`);
		lines.push(`    Estimated: ${stats.totalEstimated.toLocaleString()}`);
		if (stats.totalActual > 0) {
			lines.push(`    Actual: ${stats.totalActual.toLocaleString()}`);
		}
	}

	return lines.join("\n");
}

/**
 * Create a token report from usage and budget check
 *
 * @param usage - Token usage
 * @param budgetCheck - Budget check result
 * @param compactionOccurred - Whether compaction occurred
 * @returns Token report
 */
export function createTokenReport(
	usage: TokenUsage,
	budgetCheck: BudgetCheckResult,
	compactionOccurred = false,
): TokenReport {
	return {
		role: usage.role,
		estimatedInput: usage.estimatedInput,
		actualInput: usage.actualInput,
		actualOutput: usage.actualOutput,
		totalTokens: usage.totalTokens,
		budget: budgetCheck.budgetLimit,
		overBudget: !budgetCheck.passed,
		compactionOccurred,
		model: usage.model,
		provider: usage.provider,
		timestamp: usage.timestamp,
		requestId: usage.requestId,
	};
}

/**
 * Create a summary report from multiple token usages
 *
 * @param usages - Array of token usages
 * @returns Summary report
 */
export function createSummaryReport(usages: TokenUsage[]): TokenSummaryReport {
	const byRole: Record<string, { count: number; totalEstimated: number; totalActual: number }> = {};

	let totalEstimatedInput = 0;
	let totalActualInput = 0;
	let totalActualOutput = 0;
	let actualCount = 0;

	for (const usage of usages) {
		totalEstimatedInput += usage.estimatedInput;

		if (usage.actualInput !== undefined) {
			totalActualInput += usage.actualInput;
			actualCount++;
		}

		if (usage.actualOutput !== undefined) {
			totalActualOutput += usage.actualOutput;
		}

		if (!byRole[usage.role]) {
			byRole[usage.role] = { count: 0, totalEstimated: 0, totalActual: 0 };
		}

		byRole[usage.role].count++;
		byRole[usage.role].totalEstimated += usage.estimatedInput;
		if (usage.actualInput !== undefined) {
			byRole[usage.role].totalActual += usage.actualInput;
		}
	}

	const estimateAccuracy = actualCount > 0 ? totalActualInput / totalEstimatedInput : 0;

	return {
		totalEstimatedInput,
		totalActualInput,
		totalActualOutput,
		totalRequests: usages.length,
		overBudgetRequests: 0, // Would need budget checks to calculate
		estimateAccuracy,
		byRole,
	};
}

/**
 * Format budget check result for display
 *
 * @param result - Budget check result
 * @returns Formatted string
 */
export function formatBudgetCheckResult(result: BudgetCheckResult): string {
	if (result.passed) {
		return `✓ Budget check passed: ${result.estimatedTokens.toLocaleString()} / ${result.budgetLimit.toLocaleString()} tokens (${result.role})`;
	}

	return `✗ Budget check failed: ${result.estimatedTokens.toLocaleString()} / ${result.budgetLimit.toLocaleString()} tokens (${result.role})\n  Reason: ${result.reason}`;
}

/**
 * Estimate tokens for a file and format report
 *
 * @param filePath - Path to file
 * @param content - File content
 * @param lineCount - Number of lines
 * @returns Formatted report
 */
export function formatFileTokenEstimate(filePath: string, content: string, lineCount: number): string {
	// Estimate using chars/4 heuristic
	const estimatedTokens = Math.ceil(content.length / 4);

	const lines: string[] = [];
	lines.push(`File: ${filePath}`);
	lines.push(`Lines: ${lineCount.toLocaleString()}`);
	lines.push(`Characters: ${content.length.toLocaleString()}`);
	lines.push(`Estimated Tokens: ${estimatedTokens.toLocaleString()}`);

	// Provide context about budget
	if (estimatedTokens <= 4000) {
		lines.push("Classification: Small (fits in flash budget)");
	} else if (estimatedTokens <= 12000) {
		lines.push("Classification: Medium (fits in worker budget)");
	} else if (estimatedTokens <= 24000) {
		lines.push("Classification: Large (fits in lead budget)");
	} else if (estimatedTokens <= 64000) {
		lines.push("Classification: Very Large (requires escalation)");
	} else {
		lines.push("Classification: Huge (requires expensive context flag)");
	}

	return lines.join("\n");
}
