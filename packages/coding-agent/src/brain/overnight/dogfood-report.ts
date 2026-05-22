/**
 * Dogfood Report Generator — produces the final sign-off report for P20.
 *
 * P20.E — Dogfood Report
 *
 * Combines validation scenario results, trust assessment, and system metrics
 * into a comprehensive dogfood report with sign-off criteria.
 */

import { generateId } from "@earendil-works/pi-db";
import type { ScenarioResult } from "./validation";
import type { TrustAssessment } from "./trust-assessment";

// =========================================================================
// Types
// =========================================================================

export interface DogfoodReport {
	id: string;
	date: string;
	version: string;
	status: "success" | "partial" | "failed";
	summary: string;
	scenarios: Array<{
		id: string;
		name: string;
		passed: boolean;
		duration: number;
		checks: Array<{ id: string; passed: boolean; evidence: string }>;
	}>;
	trust: TrustAssessment;
	metrics: {
		observations: { total: number; bySource: Record<string, number>; bySeverity: Record<string, number> };
		memories: { total: number; byType: Record<string, number>; conflictsDetected: number; userCorrections: number };
		proposals: { generated: number; accepted: number; rejected: number; autoQueued: number };
		reflections: { total: number; memoriesFromReflection: number; suggestionsCreated: number };
		audit: { totalEntries: number; decisions: Record<string, number>; policyStops: number };
	};
	issues: Array<{
		id: string;
		severity: "critical" | "high" | "medium" | "low";
		description: string;
		component: string;
		resolution?: string;
		resolved: boolean;
	}>;
	recommendations: Array<{ priority: "P0" | "P1" | "P2"; title: string; description: string }>;
	signOff: {
		v2SafeForOvernight: boolean;
		trustGreenAcrossDimensions: boolean;
		allScenariosPassed: boolean;
		userControlsFunctional: boolean;
		morningReportsAccurate: boolean;
		signedOffBy?: string;
		signedOffAt?: string;
	};
	generatedAt: string;
	dogfoodRunId: string;
	reportVersion: string;
}

// =========================================================================
// DogfoodReportGenerator
// =========================================================================

export class DogfoodReportGenerator {
	async generate(
		scenarioResults: Map<string, ScenarioResult>,
		trustAssessment: TrustAssessment,
	): Promise<DogfoodReport> {
		const scenarios = Array.from(scenarioResults.values());
		const allPassed = scenarios.every((s) => s.passed);
		const somePassed = scenarios.some((s) => s.passed);
		const status: DogfoodReport["status"] = allPassed ? "success" : somePassed ? "partial" : "failed";

		const issues = this.detectIssues(scenarios, trustAssessment);
		const recommendations = this.generateRecommendations(issues);

		return {
			id: generateId(),
			date: new Date().toISOString().split("T")[0],
			version: "1.0.0",
			status,
			summary: this.generateSummary(scenarios, trustAssessment),
			scenarios: scenarios.map((s) => ({
				id: s.scenarioId,
				name: s.scenarioId,
				passed: s.passed,
				duration: s.duration,
				checks: s.checks.map((c) => ({
					id: c.id,
					passed: c.passed,
					evidence: (c.evidence as string) ?? "",
				})),
			})),
			trust: trustAssessment,
			metrics: {
				observations: { total: 0, bySource: {}, bySeverity: {} },
				memories: { total: 0, byType: {}, conflictsDetected: 0, userCorrections: 0 },
				proposals: { generated: 0, accepted: 0, rejected: 0, autoQueued: 0 },
				reflections: { total: 0, memoriesFromReflection: 0, suggestionsCreated: 0 },
				audit: { totalEntries: 0, decisions: {}, policyStops: 0 },
			},
			issues,
			recommendations,
			signOff: {
				v2SafeForOvernight: allPassed && trustAssessment.score >= 80,
				trustGreenAcrossDimensions: Object.values(trustAssessment.dimensions).every((d) => d.status === "green"),
				allScenariosPassed: allPassed,
				userControlsFunctional: trustAssessment.dimensions.userControl.score >= 80,
				morningReportsAccurate: false,
			},
			generatedAt: new Date().toISOString(),
			dogfoodRunId: generateId(),
			reportVersion: "1.0.0",
		};
	}

	async renderMarkdown(report: DogfoodReport): Promise<string> {
		const lines: string[] = [];
		lines.push(`# Dogfood Report — ${report.date}`);
		lines.push("");
		lines.push(`**Status:** ${report.status}`);
		lines.push(`**Trust Score:** ${report.trust.score}/100`);
		lines.push(`**Scenarios:** ${report.scenarios.filter((s) => s.passed).length}/${report.scenarios.length} passed`);
		lines.push("");

		// Sign-off
		lines.push("## Sign-Off");
		lines.push("");
		const criteria = [
			["V2 Safe for Overnight", report.signOff.v2SafeForOvernight],
			["Trust Green Across Dimensions", report.signOff.trustGreenAcrossDimensions],
			["All Scenarios Passed", report.signOff.allScenariosPassed],
			["User Controls Functional", report.signOff.userControlsFunctional],
			["Morning Reports Accurate", report.signOff.morningReportsAccurate],
		];
		for (const [label, passed] of criteria) {
			lines.push(`- [${passed ? "x" : " "}] ${label}`);
		}
		lines.push("");

		// Scenarios
		lines.push("## Scenarios");
		lines.push("");
		lines.push("| Scenario | Status | Duration | Checks |");
		lines.push("|----------|--------|----------|--------|");
		for (const s of report.scenarios) {
			const passed = s.checks.filter((c) => c.passed).length;
			const total = s.checks.length;
			lines.push(`| ${s.id} | ${s.passed ? "Pass" : "Fail"} | ${s.duration}ms | ${passed}/${total} |`);
		}
		lines.push("");

		// Trust dimensions
		lines.push("## Trust Assessment");
		lines.push("");
		lines.push(`**Overall Score:** ${report.trust.score}/100`);
		lines.push("");
		lines.push("| Dimension | Score | Status |");
		lines.push("|-----------|-------|--------|");
		for (const [key, dim] of Object.entries(report.trust.dimensions)) {
			lines.push(`| ${key} | ${dim.score}/100 | ${dim.status} |`);
		}
		lines.push("");

		// Issues
		if (report.issues.length > 0) {
			lines.push("## Issues");
			lines.push("");
			for (const issue of report.issues) {
				lines.push(`- [${issue.severity.toUpperCase()}] ${issue.description} (${issue.component})`);
				if (issue.resolution) lines.push(`  Resolution: ${issue.resolution}`);
				if (!issue.resolved) lines.push("  **Unresolved**");
			}
			lines.push("");
		}

		// Recommendations
		if (report.recommendations.length > 0) {
			lines.push("## Recommendations");
			lines.push("");
			for (const rec of report.recommendations) {
				lines.push(`- **${rec.priority}:** ${rec.title} — ${rec.description}`);
			}
			lines.push("");
		}

		lines.push(`_Generated at ${report.generatedAt} | Version ${report.reportVersion}_`);
		return lines.join("\n");
	}

	private generateSummary(
		scenarios: ScenarioResult[],
		trust: TrustAssessment,
	): string {
		const passed = scenarios.filter((s) => s.passed).length;
		const total = scenarios.length;
		const lines: string[] = [];
		lines.push(`Scenario pass rate: ${passed}/${total}`);
		lines.push(`Trust score: ${trust.score}/100 (${trust.trend})`);
		lines.push(`Dimensions: ${Object.entries(trust.dimensions).map(([k, v]) => `${k}=${v.status}`).join(", ")}`);
		return lines.join(" | ");
	}

	private detectIssues(
		scenarios: ScenarioResult[],
		trust: TrustAssessment,
	): DogfoodReport["issues"] {
		const issues: DogfoodReport["issues"] = [];

		// Failed scenarios
		for (const s of scenarios) {
			if (!s.passed) {
				issues.push({
					id: `issue-scenario-${s.scenarioId}`,
					severity: "high",
					description: `Scenario ${s.scenarioId} failed`,
					component: "validation",
					resolved: false,
				});
			}
		}

		// Non-green trust dimensions
		for (const [key, dim] of Object.entries(trust.dimensions)) {
			if (dim.status !== "green") {
				issues.push({
					id: `issue-trust-${key}`,
					severity: dim.status === "red" ? "critical" : "high",
					description: `Trust dimension "${key}" is ${dim.status} (score: ${dim.score})`,
					component: "trust",
					resolved: false,
				});
			}
		}

		return issues;
	}

	private generateRecommendations(issues: DogfoodReport["issues"]): DogfoodReport["recommendations"] {
		const recommendations: DogfoodReport["recommendations"] = [];

		for (const issue of issues) {
			const priority: "P0" | "P1" | "P2" = issue.severity === "critical" ? "P0" : issue.severity === "high" ? "P1" : "P2";
			recommendations.push({
				priority,
				title: `Fix ${issue.component}: ${issue.description}`,
				description: `Resolve "${issue.description}" in ${issue.component}`,
			});
		}

		return recommendations;
	}
}
