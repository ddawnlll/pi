/**
 * Convert RC1 PlanSpec v5 to Alpha2 (5.0.0-alpha2) format.
 *
 * Handles the P44 single-file plan with 18 workspaces and 9 waves.
 */

import { readFileSync, writeFileSync } from "node:fs";

// =============================================================================
// RC1 input types
// =============================================================================

interface RC1AcceptanceCriterion {
	id: string;
	description: string;
}

interface RC1WorkspaceValidation {
	commandRefs: string[];
	watchModeRejected: boolean;
	mustPass: boolean;
	requireEvidence: boolean;
}

interface RC1Command {
	ref: string;
	description: string;
	exact: string;
}

interface RC1Workspace {
	id: string;
	title: string;
	description: string;
	dependencies: string[];
	acceptanceCriteria: RC1AcceptanceCriterion[];
	validation: RC1WorkspaceValidation;
	reports: { path: string; description: string }[];
	rollback: { steps: { action: string; description: string }[] };
	commands: RC1Command[];
	waveRef?: string;
	allowedFiles: string[];
	forbiddenFiles: string[];
}

interface RC1Wave {
	id: string;
	description: string;
	workspaceRefs: string[];
	parallel: boolean;
}

interface RC1Plan {
	accpVersion: string;
	planspecVersion: string;
	taskId: string;
	taskName: string;
	executionClass: string;
	workspaceGroup: string;
	allowProductionCodeChanges: boolean;
	allowTestCodeChanges: boolean;
	allowReportFiles: boolean;
	requireRepoInspectionFirst: boolean;
	requireValidationEvidence: boolean;
	requireRollbackPlan: boolean;
	requireFinalAccpReport: boolean;
	authority: {
		specification: string;
		executionState: { mode: string; maxParallelWorkspaces: number };
		completion: {
			requiresAcceptanceCriteria: boolean;
			requiresValidationEvidence: boolean;
			requiresReport: boolean;
			requiresRollbackPlan: boolean;
			requiresFinalVerdict: boolean;
		};
	};
	waves: RC1Wave[];
	workspaces: RC1Workspace[];
	templates: unknown[];
	validationCases: unknown[];
}

// =============================================================================
// Wave-to-workspace mapping (inferred from descriptions)
// =============================================================================

const WAVE_WORKSPACE_MAP: Record<string, string[]> = {
	"W0": ["P44.00"],
	"W1": ["P44.01", "P44.02", "P44.06"],
	"W2": ["P44.03", "P44.04", "P44.05"],
	"W3": ["P44.WG", "P44.08", "P44.09"],
	"W4": ["P44.07"],
	"W5": ["P44.10"],
	"W6": ["P44.11"],
	"W7": ["P44.12", "P45.B1", "P45.B2", "P45.B3"],
	"W8": ["P44.13"],
};

// =============================================================================
// Conversion
// =============================================================================

function convert() {
	const rc1Path = process.argv[2] || "../../docs/P44_PlanSpec_v5_single_file_final.json";
	const alpha2Path = process.argv[3] || "../../docs/P44_PlanSpec_v5_alpha2.json";

	const raw = readFileSync(rc1Path, "utf8");
	const rc1: RC1Plan = JSON.parse(raw);
	const now = new Date().toISOString();

	// Build workspace lookup
	const wsById = new Map<string, RC1Workspace>();
	for (const ws of rc1.workspaces) {
		wsById.set(ws.id, ws);
	}

	// Collect all forbidden files for the global security policy
	const allForbiddenFiles = new Set<string>();
	for (const ws of rc1.workspaces) {
		for (const f of ws.forbiddenFiles || []) {
			allForbiddenFiles.add(f);
		}
	}

	// Convert workspaces to Alpha2 format
	const alpha2Workspaces = rc1.workspaces.map((ws) => ({
		id: ws.id,
		name: ws.title,
		rootDir: "./",
		canEdit: ws.allowedFiles || [],
		canRead: [] as string[],
		isolationLevel: "partial" as const,
	}));

	// Build waves with tasks derived from workspaces
	const alpha2Waves = rc1.waves.map((wave, waveIdx) => {
		const wsIds = WAVE_WORKSPACE_MAP[wave.id] || [];

		const tasks = wsIds.flatMap((wsId) => {
			const ws = wsById.get(wsId);
			if (!ws) return [];

			const task: {
				id: string;
				title: string;
				description: string;
				type: string;
				workspaceId: string;
				acceptanceCriteria: string[];
				dependencies: string[];
				priority: string;
				validation: Record<string, unknown>;
				executionPolicy?: Record<string, unknown>;
				artifacts?: Record<string, unknown>[];
				files?: Record<string, unknown>[];
			} = {
				id: `task-${ws.id}`,
				title: ws.title,
				description: ws.description || ws.title,
				type: "implementation",
				workspaceId: ws.id,
				acceptanceCriteria: ws.acceptanceCriteria.map(
					(ac) => `${ac.id}: ${ac.description}`,
				),
				dependencies: ws.dependencies.map((dep) => `task-${dep}`),
				priority: "medium",
				validation: {
					requiresHumanApproval: ws.validation?.watchModeRejected ?? false,
				},
			};

			if (ws.commands && ws.commands.length > 0) {
				task.executionPolicy = {
					mode: "strict",
					allowedCommands: ws.commands.map((c) => c.exact),
				};
			}

			if (
				ws.validation?.commandRefs &&
				ws.validation.commandRefs.length > 0
			) {
				(task.validation as Record<string, unknown>).postCheck =
					ws.validation.commandRefs;
			}

			return [task];
		});

		return {
			id: wave.id,
			title: wave.description,
			description: wave.description,
			order: waveIdx,
			tasks,
			dependencies: [] as string[],
		};
	});

	// Build the Alpha2 document
	const alpha2: Record<string, unknown> = {
		planSpecVersion: "5.0.0-alpha2",
		kind: "ImplementationPlan",

		metadata: {
			phaseId: rc1.taskId,
			title: rc1.taskName,
			description: rc1.authority.specification,
			createdAt: "2025-01-01T00:00:00.000Z",
			updatedAt: now,
			owner: "pi-agent",
			status: "active",
			tags: [rc1.executionClass, rc1.workspaceGroup],
		},

		compatibility: {
			runtimeContractVersion: "2.6.0",
			runtimeTemplateVersion: "4.1.1",
			legacyTemplateCompatible: true,
			generatedFromV411: true,
			v411AdapterRequired: false,
		},

		intent: {
			goal: rc1.authority.specification,
			successCriteria: [
				"All acceptance criteria pass with evidence",
				"CompletionGate v2 validates all workspaces",
				"WorkspaceCommitGate enforces write-set integrity",
				"P45 bridge artifacts generated without touching P45 runtime",
			],
			outOfScope: [
				"P45 runtime implementation",
				"Async assembly pipeline",
				"Static partitioner",
				"Deterministic assembler",
			],
			dependencies: [],
			blockers: [],
		},

		authority: {
			specification: rc1.authority.specification,
			executionState: {
				mode: rc1.authority.executionState.mode,
				maxParallelWorkspaces: rc1.authority.executionState.maxParallelWorkspaces,
				worktreeIsolation: true,
				integrationQueue: false,
				validationLock: true,
			},
			completion: {
				requiresAcceptanceCriteria:
					rc1.authority.completion.requiresAcceptanceCriteria,
				requiresValidationEvidence:
					rc1.authority.completion.requiresValidationEvidence,
				requiresReport: rc1.authority.completion.requiresReport,
				requiresRollbackPlan: rc1.authority.completion.requiresRollbackPlan,
				requiresFinalVerdict:
					rc1.authority.completion.requiresFinalVerdict,
			},
		},

		enforcementRegistry: {
			rules: [
				{
					id: "ER-001",
					type: "completion_gate",
					severity: "error",
					condition: "COMPLETE without evidence",
					action: "Block transition with missing evidence IDs",
				},
				{
					id: "ER-002",
					type: "commit_gate",
					severity: "error",
					condition: "stagedFiles !== acceptedWriteSet",
					action: "Block commit with mismatch report",
				},
			],
			policies: [
				{
					id: "POL-001",
					name: "P44 Verified Completion Policy",
					description:
						"Completion and commit integrity enforcement",
					ruleIds: ["ER-001", "ER-002"],
				},
			],
		},

		security: {
			selfModificationFirewall: {
				enabled: true,
				protectedPaths: Array.from(allForbiddenFiles),
				requireExplicitApproval: true,
			},
			dataExfiltrationGuard: {
				enabled: true,
				blockedDestinations: ["external-api"],
			},
			secretProtection: {
				enabled: true,
				maskInLogs: true,
			},
		},

		commands: {
			policy: "strict",
			timeoutSeconds: 300,
			maxOutputBytes: 1048576,
		},

		evidence: {
			captureMode: "automatic",
			types: [
				"source",
				"test",
				"command",
				"diff",
				"negative",
				"mutation",
				"commit",
				"report",
				"runtime",
			],
		},

		locking: {
			enabled: true,
			hashAlgorithm: "sha256",
			includeTimestamp: true,
		},

		p45Bridge: {
			enabled: true,
			artifactSafety: true,
			mutationTracking: true,
			commitGating: true,
		},

		reports: {
			format: "markdown",
			includeMetrics: true,
			includeTimeline: true,
			includeDiffSummary: true,
		},

		waves: alpha2Waves,
		workspaces: alpha2Workspaces,
	};

	const output = JSON.stringify(alpha2, null, 2);
	writeFileSync(alpha2Path, output, "utf8");
	console.log(`Written ${output.length} bytes to ${alpha2Path}`);
	console.log(`Waves: ${alpha2Waves.length}, Workspaces: ${alpha2Workspaces.length}`);
	const totalTasks = alpha2Waves.reduce((s, w) => s + w.tasks.length, 0);
	console.log(`Tasks: ${totalTasks}`);
}

convert();
