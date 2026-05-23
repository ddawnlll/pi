/**
 * Morning Report Generator — produces human-readable overnight execution reports.
 *
 * P20.B — Morning Report Generator
 *
 * Compiles data from the overnight run session, reflections, memories, audit,
 * and trust assessment into a structured morning report with all key sections.
 */

import type { RunSession } from "./orchestrator.js";

// =========================================================================
// Types shared across overnight module
// =========================================================================

export interface ArtifactLink {
	label: string;
	path: string;
	type: "reflection" | "audit" | "memory" | "report";
}

export interface TopProposal {
	title: string;
	score: number;
	description: string;
}

export interface WhatRanEntry {
	planId: string;
	planTitle: string;
	status: string;
	workspacesCompleted: number;
	workspacesFailed: number;
	duration: string;
}

export interface WhatStoppedEntry {
	plan: string;
	reason: string;
	at: string;
}

export interface MorningReportData {
	sessionId: string;
	date: string;
	whatRan: WhatRanEntry[];
	whatWorked: string[];
	whatFailed: string[];
	whatStopped: WhatStoppedEntry[];
	newMemoriesCreated: number;
	memoryTypesCreated: string[];
	newReflectionsGenerated: number;
	proposalsGenerated: number;
	proposalsAccepted: number;
	policyStops: number;
	approvalRequests: number;
	safetyInterventions: number;
	topProposals: TopProposal[];
	suggestedNextActions: string[];
	recommendedGoalUpdates: string[];
	artifactLinks: ArtifactLink[];
}

export interface MorningReportMemoryStore {
	getMemoryStats(): Promise<{ total: number; byType: Record<string, number> }>;
	countMemoriesSince(timestamp: string): Promise<number>;
}

export interface MorningReportAuditLedger {
	countEvents(filter?: { category?: string; outcome?: string; fromTimestamp?: string }): Promise<number>;
	queryEvents(options?: {
		limit?: number;
		offset?: number;
	}): Promise<Array<{ id: string; timestamp: string; message: string; target: string }>>;
}

export interface MorningReportReflectionEngine {
	countReflectionsSince(timestamp: string): Promise<number>;
}

export interface MorningReportObservationEngine {
	getObservationsSince(
		timestamp: string,
	): Promise<Array<{ id: string; type: string; content: string; timestamp: string }>>;
}

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
	whatStopped: WhatStoppedEntry[];
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
	topProposals: TopProposal[];
	recommendedGoalUpdates: string[];
	artifactLinks: ArtifactLink[];
	generatedAt: string;
	reportVersion: string;
	generatedBy: string;
}

// =========================================================================
// MorningReportGenerator
// =========================================================================

export class MorningReportGenerator {
	private memoryStore?: MorningReportMemoryStore;
	private reflectionEngine?: MorningReportReflectionEngine;
	private auditLedger?: MorningReportAuditLedger;

	constructor(
		memoryStore?: MorningReportMemoryStore,
		reflectionEngine?: MorningReportReflectionEngine,
		auditLedger?: MorningReportAuditLedger,
	) {
		this.memoryStore = memoryStore;
		this.reflectionEngine = reflectionEngine;
		this.auditLedger = auditLedger;
	}

	async generate(session: RunSession): Promise<MorningReport> {
		const now = new Date();
		const dateStr = now.toISOString().split("T")[0];

		const plansCompleted = session.progress.completed;
		const plansFailed = session.progress.failed;
		const statusSummary =
			plansFailed === 0
				? `All ${plansCompleted} plans completed successfully`
				: `${plansCompleted} completed, ${plansFailed} failed`;

		const whatRan = session.planExecIds.map((id, i) => ({
			planId: id,
			planTitle: `Plan ${String.fromCharCode(65 + i)}`,
			status:
				i < plansCompleted
					? ("completed" as const)
					: i < plansCompleted + plansFailed
						? ("failed" as const)
						: ("stopped" as const),
			workspacesCompleted: 0,
			workspacesFailed: 0,
			duration: "0m",
		}));

		const whatWorked = whatRan
			.filter((p) => p.status === "completed")
			.map((p) => `${p.planTitle} completed successfully`);
		const whatFailed = whatRan.filter((p) => p.status === "failed").map((p) => `${p.planTitle} failed`);
		const whatStopped: WhatStoppedEntry[] =
			session.status === "stopped" && session.stopReason
				? [
						{
							plan: session.planExecIds.join(", "),
							reason: session.stopReason,
							at: session.completedAt ?? now.toISOString(),
						},
					]
				: [];

		// Enrich with optional dependencies
		let newMemoriesCreated = 0;
		let memoryTypesCreated: string[] = [];
		if (this.memoryStore) {
			try {
				const stats = await this.memoryStore.getMemoryStats();
				newMemoriesCreated = stats.total;
				memoryTypesCreated = Object.keys(stats.byType);
				if (session.startedAt) {
					await this.memoryStore.countMemoriesSince(session.startedAt);
				}
			} catch {
				// Non-fatal
			}
		}

		let newReflectionsGenerated = 0;
		if (this.reflectionEngine && session.startedAt) {
			try {
				newReflectionsGenerated = await this.reflectionEngine.countReflectionsSince(session.startedAt);
			} catch {
				// Non-fatal
			}
		}

		let totalAuditEntries = 0;
		let policyStops = 0;
		let approvalRequests = 0;
		let safetyInterventions = 0;
		if (this.auditLedger) {
			try {
				totalAuditEntries = await this.auditLedger.countEvents();
				policyStops = await this.auditLedger.countEvents({ category: "policy" });
				approvalRequests = await this.auditLedger.countEvents({
					category: "orchestrator",
					outcome: "pending_approval",
				});
				safetyInterventions = await this.auditLedger.countEvents({ outcome: "denied" });
			} catch {
				// Non-fatal
			}
		}

		const artifactLinks: ArtifactLink[] = [];
		if (this.memoryStore) {
			artifactLinks.push({ label: "Memory Stats", path: ".pi/brain/memory/", type: "memory" });
		}
		if (this.auditLedger) {
			artifactLinks.push({ label: "Audit Log", path: ".pi/brain/audit/", type: "audit" });
		}
		artifactLinks.push({
			label: "This Report",
			path: `.pi/brain/reports/mr-${session.id.slice(0, 8)}.md`,
			type: "report",
		});

		const title = this.generateTitle({ plansCompleted, plansFailed, total: session.progress.total });

		const report: MorningReport = {
			id: `mr-${session.id.slice(0, 8)}`,
			date: dateStr,
			sessionId: session.id,
			title,
			summary: statusSummary,
			duration: this.formatDuration(session.startedAt, session.completedAt),
			plansAttempted: session.progress.total,
			plansCompleted,
			plansFailed,
			whatRan,
			whatWorked,
			whatFailed,
			whatStopped,
			newMemoriesCreated,
			memoryTypesCreated,
			newReflectionsGenerated,
			proposalsGenerated: 0,
			proposalsAccepted: 0,
			policyStops,
			approvalRequests,
			safetyInterventions,
			totalAuditEntries,
			suggestedNextActions: [],
			topProposals: [],
			recommendedGoalUpdates: [],
			artifactLinks,
			generatedAt: now.toISOString(),
			reportVersion: "1.0.0",
			generatedBy: "MorningReportGenerator",
		};

		return report;
	}

	private generateTitle(stats: { plansCompleted: number; plansFailed: number; total: number }): string {
		if (stats.total === 0) {
			return "No Plans Executed";
		}
		if (stats.plansFailed === 0) {
			return `All ${stats.plansCompleted} Plans Completed`;
		}
		// If any plans failed, show failure count
		return `${stats.plansFailed}/${stats.total} Plans Failed`;
	}

	private formatDuration(startedAt?: string, completedAt?: string): string {
		if (!startedAt) return "N/A";
		const start = new Date(startedAt).getTime();
		const end = completedAt ? new Date(completedAt).getTime() : Date.now();
		const hours = Math.floor((end - start) / 3600000);
		const minutes = Math.floor(((end - start) % 3600000) / 60000);
		return `${hours}h ${minutes}m`;
	}

	async generateFromData(data: MorningReportData): Promise<MorningReport> {
		const now = new Date();
		const plansAttempted = data.whatRan.length;
		const plansCompleted = data.whatRan.filter((p) => p.status === "completed").length;
		const plansFailed = data.whatRan.filter((p) => p.status === "failed").length;
		const statusSummary =
			plansFailed === 0
				? `All ${plansCompleted} plans completed successfully`
				: `${plansCompleted} completed, ${plansFailed} failed`;

		return {
			id: `mr-${data.sessionId.slice(0, 8)}`,
			date: data.date,
			sessionId: data.sessionId,
			title: this.generateTitle({ plansCompleted, plansFailed, total: plansAttempted }),
			summary: statusSummary,
			duration: "N/A",
			plansAttempted,
			plansCompleted,
			plansFailed,
			whatRan: data.whatRan.map((w) => ({
				planId: w.planId,
				planTitle: w.planTitle,
				status: w.status as "completed" | "failed" | "stopped",
				workspacesCompleted: w.workspacesCompleted,
				workspacesFailed: w.workspacesFailed,
				duration: w.duration,
			})),
			whatWorked: data.whatWorked,
			whatFailed: data.whatFailed,
			whatStopped: data.whatStopped,
			newMemoriesCreated: data.newMemoriesCreated,
			memoryTypesCreated: data.memoryTypesCreated,
			newReflectionsGenerated: data.newReflectionsGenerated,
			proposalsGenerated: data.proposalsGenerated,
			proposalsAccepted: data.proposalsAccepted,
			policyStops: data.policyStops,
			approvalRequests: data.approvalRequests,
			safetyInterventions: data.safetyInterventions,
			totalAuditEntries: data.policyStops + data.approvalRequests,
			suggestedNextActions: data.suggestedNextActions,
			topProposals: data.topProposals,
			recommendedGoalUpdates: data.recommendedGoalUpdates,
			artifactLinks: data.artifactLinks,
			generatedAt: now.toISOString(),
			reportVersion: "1.0.0",
			generatedBy: "MorningReportGenerator",
		};
	}

	async renderJson(report: MorningReport): Promise<string> {
		return JSON.stringify(report, null, 2);
	}

	async saveReport(report: MorningReport, baseDir: string): Promise<string> {
		const { join } = await import("node:path");
		const { writeFile, mkdir } = await import("node:fs/promises");
		const dir = join(baseDir, ".pi", "brain", "reports");
		await mkdir(dir, { recursive: true });
		const path = join(dir, `${report.id}.md`);
		const md = await this.renderMarkdown(report);
		await writeFile(path, md, "utf-8");
		return path;
	}

	async renderMarkdown(report: MorningReport): Promise<string> {
		const lines: string[] = [];
		lines.push(`# Morning Report`);
		lines.push("");
		lines.push(`**${report.title}**`);
		lines.push("");
		lines.push(`**Date:** ${report.date}`);
		lines.push(`**Duration:** ${report.duration}`);
		lines.push(`**Status:** ${report.summary}`);
		lines.push("");

		// Executive Summary
		lines.push("## Executive Summary");
		lines.push("");
		lines.push(
			`Attempted ${report.plansAttempted} plans, ${report.plansCompleted} completed, ${report.plansFailed} failed.`,
		);
		lines.push("");

		// Plan Summary
		lines.push("## Plan Summary");
		lines.push("");
		lines.push("| Plan | Status | Workspaces | Duration |");
		lines.push("|------|--------|------------|----------|");
		for (const plan of report.whatRan) {
			lines.push(
				`| ${plan.planTitle} | ${plan.status} | ${plan.workspacesCompleted}/${plan.workspacesCompleted + plan.workspacesFailed} | ${plan.duration} |`,
			);
		}
		lines.push("");

		// What Ran
		if (report.whatRan.length > 0) {
			lines.push("## What Ran");
			lines.push("");
			for (const plan of report.whatRan) {
				lines.push(`- ${plan.planTitle} (${plan.status})`);
			}
			lines.push("");
		}

		// What stopped
		if (report.whatStopped.length > 0) {
			lines.push("### What Stopped");
			lines.push("");
			for (const entry of report.whatStopped) {
				lines.push(`- ${entry.plan}: ${entry.reason} (at ${entry.at})`);
			}
			lines.push("");
		}

		// Analysis
		lines.push("## Analysis");
		lines.push("");

		// What worked
		if (report.whatWorked.length > 0) {
			lines.push("### What Worked");
			lines.push("");
			for (const item of report.whatWorked) {
				lines.push(`- ${item}`);
			}
			lines.push("");
		}

		// What failed
		if (report.whatFailed.length > 0) {
			lines.push("### What Failed");
			lines.push("");
			for (const item of report.whatFailed) {
				lines.push(`- ${item}`);
			}
			lines.push("");
		}

		// Changes
		lines.push("## Changes");
		lines.push("");
		lines.push(`- New memories: ${report.newMemoriesCreated}`);
		lines.push(`- New reflections: ${report.newReflectionsGenerated}`);
		lines.push(`- Proposals generated: ${report.proposalsGenerated}`);
		lines.push("");

		// Trust & Safety
		lines.push("## Trust & Safety");
		lines.push("");
		lines.push(`- Policy stops: ${report.policyStops}`);
		lines.push(`- Safety interventions: ${report.safetyInterventions}`);
		lines.push(`- Approval requests: ${report.approvalRequests}`);
		lines.push("");

		// Artifacts
		if (report.artifactLinks.length > 0) {
			lines.push("## Artifacts");
			lines.push("");
			for (const link of report.artifactLinks) {
				lines.push(`- [${link.label}](${link.path})`);
			}
			lines.push("");
		}

		// Next steps
		lines.push("## Next Steps");
		lines.push("");
		if (report.suggestedNextActions.length > 0) {
			for (const action of report.suggestedNextActions) {
				lines.push(`- ${action}`);
			}
		} else {
			lines.push("No suggested next actions.");
		}
		lines.push("");

		lines.push(`_Generated by ${report.generatedBy} at ${report.generatedAt}_`);
		return lines.join("\n");
	}

	async sendReport(report: MorningReport, _channels?: string[]): Promise<void> {
		// Placeholder: would send report via notification channels
		// _channels parameter reserved for future use
		void report;
	}
}
