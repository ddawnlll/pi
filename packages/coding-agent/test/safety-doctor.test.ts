/**
 * Tests for Safety Doctor - P2 Workstream 7.J
 */

import { describe, expect, it } from "vitest";
import { createSafetyDoctor, SafetyDoctor, SafetyIssueSeverity, SafetyIssueType } from "../src/core/safety-doctor.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

describe("SafetyDoctor", () => {
	const doctor = new SafetyDoctor();

	describe("placeholder detection", () => {
		it("should detect TODO placeholders in title", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Implement [TODO] feature",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.length).toBeGreaterThan(0);
			expect(issues[0].type).toBe(SafetyIssueType.Placeholder);
			expect(issues[0].severity).toBe(SafetyIssueSeverity.Critical);
		});

		it("should detect FIXME placeholders", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Fix [FIXME] bug",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.Placeholder)).toBe(true);
		});

		it("should detect template variable placeholders", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Update {{component}} configuration",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.Placeholder)).toBe(true);
		});

		it("should detect placeholders in acceptance criteria", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				acceptanceCriteria: ["Tests pass", "[TODO] Add more tests"],
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.Placeholder)).toBe(true);
		});

		it("should not flag valid titles", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Implement user authentication",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.filter((i) => i.type === SafetyIssueType.Placeholder)).toHaveLength(0);
		});
	});

	describe("destructive command detection", () => {
		it("should detect rm -rf commands", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: [],
					cannotEdit: [],
					canRun: ["rm -rf /tmp/test"],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.DestructiveCommand)).toBe(true);
			expect(issues.find((i) => i.type === SafetyIssueType.DestructiveCommand)?.severity).toBe(
				SafetyIssueSeverity.Critical,
			);
		});

		it("should detect git push commands", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: [],
					cannotEdit: [],
					canRun: ["git push origin main"],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.DestructiveCommand)).toBe(true);
		});

		it("should detect git reset --hard commands", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: [],
					cannotEdit: [],
					canRun: ["git reset --hard HEAD"],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.DestructiveCommand)).toBe(true);
		});

		it("should detect npm publish commands", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: [],
					cannotEdit: [],
					canRun: ["npm publish"],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.DestructiveCommand)).toBe(true);
		});

		it("should allow safe commands", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: [],
					cannotEdit: [],
					canRun: ["npm test", "npm run build", "git status"],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.filter((i) => i.type === SafetyIssueType.DestructiveCommand)).toHaveLength(0);
		});
	});

	describe("secret file detection", () => {
		it("should detect .env file access", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: [".env"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.SecretAccess)).toBe(true);
			expect(issues.find((i) => i.type === SafetyIssueType.SecretAccess)?.severity).toBe(
				SafetyIssueSeverity.Critical,
			);
		});

		it("should detect .pem file access", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["certs/private.pem"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.SecretAccess)).toBe(true);
		});

		it("should detect private key file access", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: [".ssh/id_rsa"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.SecretAccess)).toBe(true);
		});

		it("should allow normal file access", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["src/app.ts", "README.md"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.filter((i) => i.type === SafetyIssueType.SecretAccess)).toHaveLength(0);
		});
	});

	describe("security ambiguity detection", () => {
		it("should warn about security workspaces without reviewer role", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Implement authentication system",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.SecurityAmbiguity)).toBe(true);
			expect(issues.find((i) => i.type === SafetyIssueType.SecurityAmbiguity)?.severity).toBe(
				SafetyIssueSeverity.Warning,
			);
		});

		it("should not warn if security workspace has reviewer role", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Implement authentication system",
				dependencies: [],
				roleBudget: "reviewer",
				maxRetries: 3,
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.filter((i) => i.type === SafetyIssueType.SecurityAmbiguity)).toHaveLength(0);
		});

		it("should not warn if security workspace has high risk level", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Update RBAC permissions",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "high",
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.filter((i) => i.type === SafetyIssueType.SecurityAmbiguity)).toHaveLength(0);
		});
	});

	describe("queue validation", () => {
		it("should validate safe queue", () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Implement feature A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.B",
						title: "Implement feature B",
						dependencies: ["7.A"],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const report = doctor.validateQueue(queue);

			expect(report.safe).toBe(true);
			expect(report.critical).toHaveLength(0);
		});

		it("should detect dependency cycles", () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: ["7.B"],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.B",
						title: "Task B",
						dependencies: ["7.A"],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const report = doctor.validateQueue(queue);

			expect(report.safe).toBe(false);
			expect(report.critical.some((i) => i.type === SafetyIssueType.DependencyCycle)).toBe(true);
		});

		it("should detect invalid workspace configuration", () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: ["7.Z"], // Non-existent dependency
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const report = doctor.validateQueue(queue);

			expect(report.safe).toBe(false);
			expect(report.critical.some((i) => i.type === SafetyIssueType.InvalidConfig)).toBe(true);
		});

		it("should detect multiple issues in queue", () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "[TODO] Implement feature",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
						capabilities: {
							canEdit: [".env"],
							cannotEdit: [],
							canRun: ["git push"],
							cannotRun: [],
						},
					},
				],
			};

			const report = doctor.validateQueue(queue);

			expect(report.safe).toBe(false);
			expect(report.critical.length).toBeGreaterThan(1);
			expect(report.critical.some((i) => i.type === SafetyIssueType.Placeholder)).toBe(true);
			expect(report.critical.some((i) => i.type === SafetyIssueType.SecretAccess)).toBe(true);
			expect(report.critical.some((i) => i.type === SafetyIssueType.DestructiveCommand)).toBe(true);
		});
	});

	describe("report formatting", () => {
		it("should format safe report", () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Safe workspace",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const report = doctor.validateQueue(queue);
			const formatted = doctor.formatReport(report);

			expect(formatted).toContain("SAFE to execute");
			expect(formatted).toContain("Total issues: 0");
		});

		it("should format unsafe report with critical issues", () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "[TODO] Unsafe workspace",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const report = doctor.validateQueue(queue);
			const formatted = doctor.formatReport(report);

			expect(formatted).toContain("CRITICAL safety issues");
			expect(formatted).toContain("CRITICAL ISSUES:");
			expect(formatted).toContain("placeholder");
		});

		it("should format report with warnings", () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Implement authentication",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const report = doctor.validateQueue(queue);
			const formatted = doctor.formatReport(report);

			expect(formatted).toContain("WARNINGS:");
		});
	});

	describe("createSafetyDoctor", () => {
		it("should create safety doctor instance", () => {
			const doctor = createSafetyDoctor();
			expect(doctor).toBeInstanceOf(SafetyDoctor);
		});
	});

	describe("pattern matching", () => {
		it("should match wildcard patterns", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["config/*.env"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.SecretAccess)).toBe(true);
		});

		it("should match double-star patterns", () => {
			const workspace: Workspace = {
				id: "7.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["**/secrets/**"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const issues = doctor.validateWorkspace(workspace);

			expect(issues.some((i) => i.type === SafetyIssueType.SecretAccess)).toBe(true);
		});
	});
});
