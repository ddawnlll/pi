/**
 * Morning Report Generator — P20.B
 *
 * Generates structured morning reports from overnight run sessions,
 * summarizing what ran, what happened, what changed, and suggested
 * next steps.
 *
 * The generator is designed to work with or without optional brain
 * dependencies (MemoryStore, PlatformAuditLedger, ObservationEngine,
 * ReflectionEngine). When available, it enriches the report with
 * additional data from these subsystems.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunSession } from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Execution record for a single plan within the overnight session.
 */
export interface WhatRanEntry {
	planId: string;
	planTitle: string;
	status: "completed" | "failed" | "stopped";
	workspacesCompleted: number;
	workspacesFailed: number;
	duration: string;
}

/**
 * Record of a stopped plan with reason and timestamp.
 */
export interface WhatStoppedEntry {
	plan: string;
	reason: string;
	at: string;
}

/**
 * A proposal included in the top proposals section.
 */
export interface TopProposal {
	title: string;
	score: number;
	description: string;
}

/**
 * A link to an artifact produced during the overnight run.
 */
export interface ArtifactLink {
	label: string;
	path: string;
	type: "reflection" | "audit" | "memory" | "report";
}

/**
 * Complete morning report data structure.
 */
export interface MorningReport {
	// Identity
	id: string;
	date: string;
	sessionId: string;

	// Summary
	title: string;
	summary: string;
	duration: string;
	plansAttempted: number;
	plansCompleted: number;
	plansFailed: number;

	// Execution
	whatRan: WhatRanEntry[];

	// Analysis
	whatWorked: string[];
	whatFailed: string[];
	whatStopped: WhatStoppedEntry[];

	// Changes
	newMemoriesCreated: number;
	memoryTypesCreated: string[];
	newReflectionsGenerated: number;
	proposalsGenerated: number;
	proposalsAccepted: number;

	// Trust
	policyStops: number;
	approvalRequests: number;
	safetyInterventions: number;
	totalAuditEntries: number;

	// Next steps
	suggestedNextActions: string[];
	topProposals: TopProposal[];
	recommendedGoalUpdates: string[];

	// Artifacts
	artifactLinks: ArtifactLink[];

	// Metadata
	generatedAt: string;
	reportVersion: string;
	generatedBy: string;
}

/**
 * Data payload for generateFromData.
 *
 * Allows constructing a morning report from raw data without a
 * RunSession object. Useful for testing or when the session data
 * comes from an external source.
 */
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

// ---------------------------------------------------------------------------
// Lightweight dependency interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the memory store, used to query memory stats.
 * Implementations: MemoryStore (brain/memory/store.ts)
 */
export interface MorningReportMemoryStore {
	/** Get summary statistics for all stored memories. */
	getMemoryStats(): Promise<{
		total: number;
		byType: Record<string, number>;
	}>;
	/** Count memories created after the given timestamp. */
	countMemoriesSince(timestamp: string): Promise<number>;
}

/**
 * Minimal interface for the audit ledger, used to query trust events.
 * Implementations: PlatformAuditLedger
 */
export interface MorningReportAuditLedger {
	/** Count events matching the given filter criteria. */
	countEvents(filter: { category?: string; outcome?: string; fromTimestamp?: string }): Promise<number>;
	/** Get events matching the given filter criteria. */
	queryEvents(filter: {
		category?: string;
		outcome?: string;
		fromTimestamp?: string;
		limit?: number;
	}): Promise<Array<{ id: string; timestamp: string; message: string; target?: string }>>;
}

/**
 * Minimal interface for the reflection engine, used to count reflections.
 * Implementations: ReflectionEngine (when created in P17)
 */
export interface MorningReportReflectionEngine {
	/** Count reflections generated after the given timestamp. */
	countReflectionsSince(timestamp: string): Promise<number>;
}

/**
 * Minimal interface for the observation engine, used to count observations.
 * Implementations: ObservationEngine
 */
export interface MorningReportObservationEngine {
	/** Count observations created after the given timestamp. */
	countObservationsSince(timestamp: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Default report version
// ---------------------------------------------------------------------------

const REPORT_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Morning Report Generator
// ---------------------------------------------------------------------------

/**
 * Generates structured morning reports from overnight run sessions.
 *
 * Usage:
 * ```ts
 * const generator = new MorningReportGenerator();
 * const report = await generator.generate(session);
 * const md = await generator.renderMarkdown(report);
 * const path = await generator.saveReport(report, "/path/to/reports");
 * ```
 */
export class MorningReportGenerator {
	/**
	 * @param memoryStore        Optional memory store for memory stats
	 * @param reflectionEngine   Optional reflection engine for reflection counts
	 * @param auditLedger        Optional audit ledger for trust/audit data
	 * @param observationEngine  Optional observation engine for observation counts
	 */
	constructor(
		private memoryStore?: MorningReportMemoryStore,
		private reflectionEngine?: MorningReportReflectionEngine,
		private auditLedger?: MorningReportAuditLedger,
	) {}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Generate a morning report from an overnight run session.
	 *
	 * Enriches the report with data from optional dependencies
	 * (memory store, audit ledger, etc.) when available.
	 *
	 * @param session - The completed overnight run session
	 * @returns A fully populated MorningReport
	 */
	async generate(session: RunSession): Promise<MorningReport> {
		const date = new Date().toISOString().split("T")[0];
		const sessionStart = session.startedAt ?? session.createdAt;
		const sessionEnd = session.completedAt ?? new Date().toISOString();

		const durationMs = new Date(sessionEnd).getTime() - new Date(sessionStart).getTime();
		const duration = this.formatDuration(durationMs);

		const whatRan = await this.buildWhatRan(session);
		const analysis = await this.buildAnalysis(session);
		const changes = await this.buildChanges(session);
		const trustInfo = await this.buildTrust(session);
		const nextSteps = await this.buildNextSteps(session);
		const artifactLinks = await this.buildArtifacts(session);

		const report: Partial<MorningReport> = {
			id: randomUUID(),
			date,
			sessionId: session.id,
			duration,
			plansAttempted: session.planExecIds.length,
			plansCompleted: session.progress.completed,
			plansFailed: session.progress.failed,
			whatRan,
			whatWorked: analysis.whatWorked,
			whatFailed: analysis.whatFailed,
			whatStopped: analysis.whatStopped,
			...changes,
			...trustInfo,
			...nextSteps,
			artifactLinks,
			generatedAt: new Date().toISOString(),
			reportVersion: REPORT_VERSION,
			generatedBy: "MorningReportGenerator",
		};

		report.title = this.generateTitle(report);
		report.summary = await this.generateSummary(report);

		return report as MorningReport;
	}

	/**
	 * Generate a morning report from raw data.
	 *
	 * Useful when the session data comes from an external source
	 * or for testing without a full RunSession object.
	 *
	 * @param data - Raw morning report data
	 * @returns A fully populated MorningReport
	 */
	async generateFromData(data: MorningReportData): Promise<MorningReport> {
		const date = data.date ?? new Date().toISOString().split("T")[0];

		const plansAttempted = data.whatRan.length;
		const plansCompleted = data.whatRan.filter((e) => e.status === "completed").length;
		const plansFailed = data.whatRan.filter((e) => e.status === "failed").length;

		const report: Partial<MorningReport> = {
			id: randomUUID(),
			date,
			sessionId: data.sessionId,
			duration: this.computeDurationFromEntries(data.whatRan),
			plansAttempted,
			plansCompleted,
			plansFailed,
			whatRan: data.whatRan,
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
			totalAuditEntries: 0,
			suggestedNextActions: data.suggestedNextActions,
			topProposals: data.topProposals,
			recommendedGoalUpdates: data.recommendedGoalUpdates,
			artifactLinks: data.artifactLinks,
			generatedAt: new Date().toISOString(),
			reportVersion: REPORT_VERSION,
			generatedBy: "MorningReportGenerator",
		};

		report.title = this.generateTitle(report);
		report.summary = await this.generateSummary(report);

		return report as MorningReport;
	}

	// -----------------------------------------------------------------------
	// Section builders
	// -----------------------------------------------------------------------

	/**
	 * Build the "What Ran" section from session data.
	 */
	private async buildWhatRan(session: RunSession): Promise<WhatRanEntry[]> {
		// In a real implementation, we'd query the plan queue for per-plan details.
		// For now, derive from the session progress.
		const entries: WhatRanEntry[] = [];

		for (const planExecId of session.planExecIds) {
			// Determine individual plan status based on overall session
			let planStatus: WhatRanEntry["status"];
			const index = session.planExecIds.indexOf(planExecId);
			const isFailed = index < session.progress.failed;
			const isStopped = session.status === "stopped" && index >= session.progress.completed;

			if (isStopped) {
				planStatus = "stopped";
			} else if (isFailed) {
				planStatus = "failed";
			} else {
				planStatus = "completed";
			}

			entries.push({
				planId: planExecId,
				planTitle: `Plan ${planExecId}`,
				status: planStatus,
				workspacesCompleted: planStatus === "completed" ? 1 : 0,
				workspacesFailed: planStatus === "failed" ? 1 : 0,
				duration: "0m",
			});
		}

		return entries;
	}

	/**
	 * Build the analysis section (what worked, what failed, what stopped).
	 */
	private async buildAnalysis(
		session: RunSession,
	): Promise<{ whatWorked: string[]; whatFailed: string[]; whatStopped: WhatStoppedEntry[] }> {
		const whatWorked: string[] = [];
		const whatFailed: string[] = [];
		const whatStopped: WhatStoppedEntry[] = [];

		if (session.progress.completed > 0) {
			whatWorked.push(`${session.progress.completed} of ${session.planExecIds.length} plans completed successfully`);
		}

		if (session.progress.failed > 0) {
			whatFailed.push(`${session.progress.failed} plan(s) failed during execution`);
		}

		if (session.status === "stopped" && session.stopReason) {
			whatStopped.push({
				plan: session.planExecIds.join(", "),
				reason: session.stopReason,
				at: session.completedAt ?? new Date().toISOString(),
			});
			whatFailed.push(`Execution stopped: ${session.stopReason}`);
		}

		return { whatWorked, whatFailed, whatStopped };
	}

	/**
	 * Build the changes section (memories, reflections, proposals).
	 */
	private async buildChanges(session: RunSession): Promise<{
		newMemoriesCreated: number;
		memoryTypesCreated: string[];
		newReflectionsGenerated: number;
		proposalsGenerated: number;
		proposalsAccepted: number;
	}> {
		const sessionStart = session.startedAt ?? session.createdAt;
		let newMemoriesCreated = 0;
		let memoryTypesCreated: string[] = [];
		let newReflectionsGenerated = 0;
		const proposalsGenerated = 0;
		const proposalsAccepted = 0;

		// Query memory store if available
		if (this.memoryStore) {
			try {
				newMemoriesCreated = await this.memoryStore.countMemoriesSince(sessionStart);
				const stats = await this.memoryStore.getMemoryStats();
				memoryTypesCreated = Object.entries(stats.byType)
					.filter(([_, count]) => count > 0)
					.map(([type]) => type);
			} catch {
				// Non-fatal — fall back to defaults
			}
		}

		// Query reflection engine if available
		if (this.reflectionEngine) {
			try {
				newReflectionsGenerated = await this.reflectionEngine.countReflectionsSince(sessionStart);
			} catch {
				// Non-fatal
			}
		}

		return {
			newMemoriesCreated,
			memoryTypesCreated,
			newReflectionsGenerated,
			proposalsGenerated,
			proposalsAccepted,
		};
	}

	/**
	 * Build the trust/safety section.
	 */
	private async buildTrust(session: RunSession): Promise<{
		policyStops: number;
		approvalRequests: number;
		safetyInterventions: number;
		totalAuditEntries: number;
	}> {
		const sessionStart = session.startedAt ?? session.createdAt;
		let policyStops = 0;
		let approvalRequests = 0;
		let safetyInterventions = 0;
		let totalAuditEntries = 0;

		// Calculate policy stops from session stop condition
		if (session.stopReason?.includes("policy")) {
			policyStops++;
		}
		if (session.stopReason?.includes("safety") || session.stopReason?.includes("low_confidence")) {
			safetyInterventions++;
		}

		// Query audit ledger if available
		if (this.auditLedger) {
			try {
				const policyEvents = await this.auditLedger.countEvents({
					category: "policy",
					fromTimestamp: sessionStart,
				});
				policyStops += policyEvents;

				const approvalEvents = await this.auditLedger.countEvents({
					category: "orchestrator",
					outcome: "pending_approval",
					fromTimestamp: sessionStart,
				});
				approvalRequests += approvalEvents;

				const safetyQuery = await this.auditLedger.countEvents({
					outcome: "denied",
					fromTimestamp: sessionStart,
				});
				safetyInterventions += safetyQuery;

				const allEvents = await this.auditLedger.countEvents({
					fromTimestamp: sessionStart,
				});
				totalAuditEntries = allEvents;
			} catch {
				// Non-fatal
			}
		}

		return {
			policyStops,
			approvalRequests,
			safetyInterventions,
			totalAuditEntries,
		};
	}

	/**
	 * Build the next steps section with suggested actions and proposals.
	 */
	private async buildNextSteps(session: RunSession): Promise<{
		suggestedNextActions: string[];
		topProposals: TopProposal[];
		recommendedGoalUpdates: string[];
	}> {
		const suggestedNextActions: string[] = [];
		const topProposals: TopProposal[] = [];
		const recommendedGoalUpdates: string[] = [];

		// Generate suggested next actions based on session outcome
		if (session.progress.failed > 0) {
			suggestedNextActions.push("Review failed plans and address errors before re-running");
		}

		if (session.status === "stopped") {
			suggestedNextActions.push(
				`Investigate stop reason: "${session.stopReason ?? "unknown"}" and resolve before next run`,
			);
		}

		if (session.progress.completed > 0 && session.progress.failed === 0) {
			suggestedNextActions.push("Review completed plans and verify all acceptance criteria were met");
		}

		if (session.planExecIds.length > session.progress.completed + session.progress.failed) {
			suggestedNextActions.push(
				`${session.planExecIds.length - session.progress.completed - session.progress.failed} plan(s) still pending — consider manual review`,
			);
		}

		suggestedNextActions.push("Review morning report and plan next execution cycle");

		// Check for audit entries from the session
		if (this.auditLedger) {
			try {
				const sessionStart = session.startedAt ?? session.createdAt;
				const auditEntries = await this.auditLedger.queryEvents({
					fromTimestamp: sessionStart,
					limit: 5,
				});
				for (const entry of auditEntries) {
					if (entry.message?.toLowerCase().includes("proposal")) {
						topProposals.push({
							title: entry.message,
							score: 0.7,
							description: `Audit entry: ${entry.message}`,
						});
					}
				}
			} catch {
				// Non-fatal
			}
		}

		return {
			suggestedNextActions,
			topProposals,
			recommendedGoalUpdates,
		};
	}

	/**
	 * Build artifact links from the session data.
	 */
	private async buildArtifacts(session: RunSession): Promise<ArtifactLink[]> {
		const links: ArtifactLink[] = [];
		const date = new Date().toISOString().split("T")[0];

		// Report itself
		links.push({
			label: "Morning Report",
			path: `.pi/brain/overnight/reports/${date}.md`,
			type: "report",
		});

		// Audit entries if available
		if (this.auditLedger) {
			links.push({
				label: "Audit Log (Session)",
				path: ".pi/brain/audit",
				type: "audit",
			});
		}

		// Memory if available
		if (this.memoryStore) {
			links.push({
				label: "Memory Store",
				path: ".pi/brain/memory",
				type: "memory",
			});
		}

		// Add session completion artifact
		if (session.completedAt) {
			links.push({
				label: `Session ${session.status === "completed" ? "Complete" : "Incomplete"}`,
				path: `.pi/brain/overnight/sessions.json`,
				type: "report",
			});
		}

		return links;
	}

	// -----------------------------------------------------------------------
	// Summary helpers
	// -----------------------------------------------------------------------

	/**
	 * Generate a human-readable title for the report.
	 */
	private generateTitle(report: Partial<MorningReport>): string {
		const dateStr = report.date ?? new Date().toISOString().split("T")[0];
		const completed = report.plansCompleted ?? 0;
		const total = report.plansAttempted ?? 0;
		const failed = report.plansFailed ?? 0;

		if (total === 0) {
			return `Morning Report — ${dateStr} (No Plans Executed)`;
		}

		if (failed === 0 && completed === total) {
			return `Morning Report — ${dateStr} (All ${total} Plans Completed)`;
		}

		if (failed > 0) {
			return `Morning Report — ${dateStr} (${failed}/${total} Plans Failed)`;
		}

		return `Morning Report — ${dateStr} (${completed}/${total} Plans Complete)`;
	}

	/**
	 * Generate an executive summary for the report.
	 */
	private async generateSummary(report: Partial<MorningReport>): Promise<string> {
		const completed = report.plansAttempted ?? 0;
		const failed = report.plansFailed ?? 0;
		const total = report.plansAttempted ?? 0;

		const parts: string[] = [];

		if (total === 0) {
			parts.push("No plans were executed during this session.");
		} else if (failed === 0 && completed === total) {
			parts.push(`All ${total} plan(s) completed successfully.`);
		} else if (failed > 0) {
			parts.push(`${completed} of ${total} plan(s) completed, ${failed} failed.`);
		} else {
			parts.push(`${completed} of ${total} plan(s) completed.`);
		}

		if (report.whatStopped && report.whatStopped.length > 0) {
			parts.push(`Execution stopped: ${report.whatStopped[0].reason}`);
		}

		if ((report.newMemoriesCreated ?? 0) > 0) {
			parts.push(`${report.newMemoriesCreated} new memory(ies) created.`);
		}

		if ((report.newReflectionsGenerated ?? 0) > 0) {
			parts.push(`${report.newReflectionsGenerated} new reflection(s) generated.`);
		}

		if ((report.policyStops ?? 0) > 0) {
			parts.push(`${report.policyStops} policy stop(s) triggered.`);
		}

		if ((report.suggestedNextActions?.length ?? 0) > 0) {
			parts.push(`${report.suggestedNextActions!.length} suggested next action(s).`);
		}

		return parts.join(" ");
	}

	// -----------------------------------------------------------------------
	// Output
	// -----------------------------------------------------------------------

	/**
	 * Save the report to disk as markdown.
	 *
	 * @param report   The morning report to save
	 * @param baseDir  Base directory for reports (default: <cwd>/.pi/brain/overnight/reports)
	 * @returns The absolute path to the saved file
	 */
	async saveReport(report: MorningReport, baseDir?: string): Promise<string> {
		const reportsDir = baseDir ?? resolve(process.cwd(), ".pi", "brain", "overnight", "reports");
		const date = report.date ?? new Date().toISOString().split("T")[0];
		const fileName = `${date}.md`;
		const filePath = join(reportsDir, fileName);

		const markdown = await this.renderMarkdown(report);

		// Ensure directory exists
		const { mkdir } = await import("node:fs/promises");
		await mkdir(reportsDir, { recursive: true });

		await writeFile(filePath, markdown, "utf-8");
		return filePath;
	}

	/**
	 * Render the report as a markdown string.
	 */
	async renderMarkdown(report: MorningReport): Promise<string> {
		const lines: string[] = [];

		// Header
		lines.push(`# ${report.title}`);
		lines.push("");
		lines.push(`**Date:** ${report.date}`);
		lines.push(`**Duration:** ${report.duration}`);
		lines.push(`**Report Version:** ${report.reportVersion}`);
		lines.push(`**Generated At:** ${report.generatedAt}`);
		lines.push("");

		// Executive Summary
		lines.push("## Executive Summary");
		lines.push("");
		lines.push(report.summary);
		lines.push("");

		// Plan Summary
		lines.push("## Plan Summary");
		lines.push("");
		lines.push(`| Metric | Value |`);
		lines.push(`|--------|-------|`);
		lines.push(`| Plans Attempted | ${report.plansAttempted} |`);
		lines.push(`| Plans Completed | ${report.plansCompleted} |`);
		lines.push(`| Plans Failed | ${report.plansFailed} |`);
		lines.push("");

		// What Ran
		lines.push("## What Ran");
		lines.push("");
		if (report.whatRan.length > 0) {
			lines.push(`| Plan ID | Title | Status | Workspaces Completed | Workspaces Failed | Duration |`);
			lines.push(`|---------|-------|--------|---------------------|-------------------|----------|`);
			for (const entry of report.whatRan) {
				lines.push(
					`| ${entry.planId} | ${entry.planTitle} | ${entry.status} | ${entry.workspacesCompleted} | ${entry.workspacesFailed} | ${entry.duration} |`,
				);
			}
		} else {
			lines.push("No plan entries recorded for this session.");
		}
		lines.push("");

		// Analysis
		lines.push("## Analysis");
		lines.push("");

		if (report.whatWorked.length > 0) {
			lines.push("### What Worked");
			for (const item of report.whatWorked) {
				lines.push(`- ${item}`);
			}
			lines.push("");
		}

		if (report.whatFailed.length > 0) {
			lines.push("### What Failed");
			for (const item of report.whatFailed) {
				lines.push(`- ${item}`);
			}
			lines.push("");
		}

		if (report.whatStopped.length > 0) {
			lines.push("### What Stopped");
			lines.push("");
			lines.push(`| Plan | Reason | At |`);
			lines.push(`|------|--------|----|`);
			for (const entry of report.whatStopped) {
				lines.push(`| ${entry.plan} | ${entry.reason} | ${entry.at} |`);
			}
			lines.push("");
		}

		// Changes
		lines.push("## Changes");
		lines.push("");
		lines.push(`| Metric | Value |`);
		lines.push(`|--------|-------|`);
		lines.push(`| New Memories Created | ${report.newMemoriesCreated} |`);
		lines.push(`| Memory Types Created | ${report.memoryTypesCreated.join(", ") || "none"} |`);
		lines.push(`| New Reflections Generated | ${report.newReflectionsGenerated} |`);
		lines.push(`| Proposals Generated | ${report.proposalsGenerated} |`);
		lines.push(`| Proposals Accepted | ${report.proposalsAccepted} |`);
		lines.push("");

		// Trust & Safety
		lines.push("## Trust & Safety");
		lines.push("");
		lines.push(`| Metric | Value |`);
		lines.push(`|--------|-------|`);
		lines.push(`| Policy Stops | ${report.policyStops} |`);
		lines.push(`| Approval Requests | ${report.approvalRequests} |`);
		lines.push(`| Safety Interventions | ${report.safetyInterventions} |`);
		lines.push(`| Total Audit Entries | ${report.totalAuditEntries} |`);
		lines.push("");

		// Next Steps
		lines.push("## Next Steps");
		lines.push("");

		if (report.suggestedNextActions.length > 0) {
			lines.push("### Suggested Actions");
			for (const action of report.suggestedNextActions) {
				lines.push(`- ${action}`);
			}
			lines.push("");
		}

		if (report.topProposals.length > 0) {
			lines.push("### Top Proposals");
			lines.push("");
			lines.push(`| Title | Score | Description |`);
			lines.push(`|-------|-------|-------------|`);
			for (const proposal of report.topProposals) {
				lines.push(`| ${proposal.title} | ${proposal.score} | ${proposal.description} |`);
			}
			lines.push("");
		}

		if (report.recommendedGoalUpdates.length > 0) {
			lines.push("### Recommended Goal Updates");
			for (const update of report.recommendedGoalUpdates) {
				lines.push(`- ${update}`);
			}
			lines.push("");
		}

		// Artifacts
		if (report.artifactLinks.length > 0) {
			lines.push("## Artifacts");
			lines.push("");
			lines.push(`| Label | Path | Type |`);
			lines.push(`|-------|------|------|`);
			for (const link of report.artifactLinks) {
				lines.push(`| ${link.label} | \`${link.path}\` | ${link.type} |`);
			}
			lines.push("");
		}

		// Footer
		lines.push("---");
		lines.push(`_Report generated by ${report.generatedBy} at ${report.generatedAt}_`);

		return lines.join("\n");
	}

	/**
	 * Render the report as a JSON string.
	 */
	async renderJson(report: MorningReport): Promise<string> {
		return JSON.stringify(report, null, 2);
	}

	/**
	 * Send the report to notification channels.
	 *
	 * Currently a no-op placeholder. Future implementations may
	 * send to desktop notifications, email, Slack, etc.
	 *
	 * @param report   The morning report
	 * @param channels Optional list of channel names (e.g., ["desktop", "email"])
	 */
	async sendReport(report: MorningReport, channels?: string[]): Promise<void> {
		// Placeholder — notification delivery is deferred to a
		// notification service integration (future workstream).
		const _channels = channels ?? [];
		if (_channels.length > 0) {
			// Log intent for now
			console.log(`[MorningReport] Would send report ${report.id} to channels: ${_channels.join(", ")}`);
		}
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Format a duration in milliseconds to a human-readable string.
	 */
	private formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}
		return `${minutes}m`;
	}

	/**
	 * Compute an approximate total duration from whatRan entries.
	 */
	private computeDurationFromEntries(entries: WhatRanEntry[]): string {
		// Estimate 5 minutes per completed plan, 2 minutes per failed/stopped plan
		let totalMinutes = 0;
		for (const entry of entries) {
			if (entry.status === "completed") {
				totalMinutes += 5;
			} else {
				totalMinutes += 2;
			}
		}

		if (totalMinutes >= 60) {
			const hours = Math.floor(totalMinutes / 60);
			const mins = totalMinutes % 60;
			return `${hours}h ${mins}m`;
		}
		return `${totalMinutes}m`;
	}
}
