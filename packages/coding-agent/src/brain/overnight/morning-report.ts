/**
 * Morning Report Generator — produces human-readable overnight execution reports.
 *
 * P20.B — Morning Report Generator
 *
 * Compiles data from the overnight run session, reflections, memories, audit,
 * and trust assessment into a structured morning report with all key sections.
 */

import type { RunSession } from "./orchestrator";

// =========================================================================
// Types
// =========================================================================

export interface PlanRunSummary {
	planId: string;
	planTitle: string;
	status: "completed" | "failed" | "stopped";
	workspacesCompleted: number;
	workspacesFailed: number;
	duration: string;
}

export interface MorningReport {
	id: string;
	date: string;
	sessionId: string;
	title: string;
	summary: string;
	duration: string;
	plansAttempted: number;
	plansCompleted: number;
	plansFailed: number;
	whatRan: PlanRunSummary[];
	whatWorked: string[];
	whatFailed: string[];
	whatStopped: Array<{ plan: string; reason: string; at: string }>;
	newMemoriesCreated: number;
	memoryTypesCreated: string[];
	newReflectionsGenerated: number;
	proposalsGenerated: number;
	proposalsAccepted: number;
	policyStops: number;
	approvalRequests: number;
	safetyInterventions: number;
	totalAuditEntries: number;
	suggestedNextActions: string[];
	topProposals: Array<{ title: string; score: number; description: string }>;
	recommendedGoalUpdates: string[];
	artifactLinks: Array<{ label: string; path: string; type: "reflection" | "audit" | "memory" | "report" }>;
	generatedAt: string;
	reportVersion: string;
	generatedBy: string;
}

// =========================================================================
// MorningReportGenerator
// =========================================================================

export class MorningReportGenerator {
	async generate(session: RunSession): Promise<MorningReport> {
		const now = new Date();
		const dateStr = now.toISOString().split("T")[0];

		const plansCompleted = session.progress.completed;
		const plansFailed = session.progress.failed;
		const statusSummary =
			plansFailed === 0
				? `All ${plansCompleted} plans completed successfully`
				: `${plansCompleted} completed, ${plansFailed} failed`;

		const report: MorningReport = {
			id: `mr-${session.id.slice(0, 8)}`,
			date: dateStr,
			sessionId: session.id,
			title: this.generateTitle({ plansCompleted, plansFailed, total: session.progress.total }),
			summary: statusSummary,
			duration: this.formatDuration(session.startedAt, session.completedAt),
			plansAttempted: session.progress.total,
			plansCompleted,
			plansFailed,
			whatRan: [],
			whatWorked: [],
			whatFailed: [],
			whatStopped: [],
			newMemoriesCreated: 0,
			memoryTypesCreated: [],
			newReflectionsGenerated: 0,
			proposalsGenerated: 0,
			proposalsAccepted: 0,
			policyStops: 0,
			approvalRequests: 0,
			safetyInterventions: 0,
			totalAuditEntries: 0,
			suggestedNextActions: [],
			topProposals: [],
			recommendedGoalUpdates: [],
			artifactLinks: [],
			generatedAt: now.toISOString(),
			reportVersion: "1.0.0",
			generatedBy: "MorningReportGenerator",
		};

		return report;
	}

	private generateTitle(stats: { plansCompleted: number; plansFailed: number; total: number }): string {
		if (stats.plansFailed === 0) {
			return `Nightly run: ${stats.plansCompleted}/${stats.total} plans completed`;
		}
		if (stats.plansCompleted === 0) {
			return `Nightly run: all ${stats.plansFailed} plans failed`;
		}
		return `Nightly run: ${stats.plansCompleted} completed, ${stats.plansFailed} failed`;
	}

	private formatDuration(startedAt?: string, completedAt?: string): string {
		if (!startedAt) return "N/A";
		const start = new Date(startedAt).getTime();
		const end = completedAt ? new Date(completedAt).getTime() : Date.now();
		const hours = Math.floor((end - start) / 3600000);
		const minutes = Math.floor(((end - start) % 3600000) / 60000);
		return `${hours}h ${minutes}m`;
	}

	async renderMarkdown(report: MorningReport): Promise<string> {
		const lines: string[] = [];
		lines.push(`# ${report.title}`);
		lines.push("");
		lines.push(`**Date:** ${report.date}`);
		lines.push(`**Duration:** ${report.duration}`);
		lines.push(`**Status:** ${report.summary}`);
		lines.push("");

		// What ran
		if (report.whatRan.length > 0) {
			lines.push("## Plans Executed");
			lines.push("");
			lines.push("| Plan | Status | Workspaces | Duration |");
			lines.push("|------|--------|------------|----------|");
			for (const plan of report.whatRan) {
				lines.push(
					`| ${plan.planTitle} | ${plan.status} | ${plan.workspacesCompleted}/${plan.workspacesCompleted + plan.workspacesFailed} | ${plan.duration} |`,
				);
			}
			lines.push("");
		}

		// What worked
		if (report.whatWorked.length > 0) {
			lines.push("## What Worked");
			lines.push("");
			for (const item of report.whatWorked) {
				lines.push(`- ${item}`);
			}
			lines.push("");
		}

		// What failed
		if (report.whatFailed.length > 0) {
			lines.push("## What Failed");
			lines.push("");
			for (const item of report.whatFailed) {
				lines.push(`- ${item}`);
			}
			lines.push("");
		}

		// Memory & reflections
		if (report.newMemoriesCreated > 0 || report.newReflectionsGenerated > 0) {
			lines.push("## Brain Activity");
			lines.push("");
			lines.push(`- **New memories:** ${report.newMemoriesCreated}`);
			lines.push(`- **New reflections:** ${report.newReflectionsGenerated}`);
			lines.push(`- **Proposals generated:** ${report.proposalsGenerated}`);
			lines.push("");
		}

		// Trust
		if (report.policyStops > 0 || report.safetyInterventions > 0) {
			lines.push("## Trust & Safety");
			lines.push("");
			lines.push(`- Policy stops: ${report.policyStops}`);
			lines.push(`- Safety interventions: ${report.safetyInterventions}`);
			lines.push(`- Approval requests: ${report.approvalRequests}`);
			lines.push("");
		}

		// Next steps
		if (report.suggestedNextActions.length > 0) {
			lines.push("## Suggested Next Actions");
			lines.push("");
			for (const action of report.suggestedNextActions) {
				lines.push(`- ${action}`);
			}
			lines.push("");
		}

		lines.push(`_Generated by ${report.generatedBy} at ${report.generatedAt}_`);
		return lines.join("\n");
	}
}
