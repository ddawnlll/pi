/**
 * P41.13 — E2E Visibility Gauntlet Plans (V1-V8)
 *
 * Defines visibility-specific gauntlet plans that test the 8 E2E visibility
 * scenarios from the P41 plan:
 *
 * V1 — live_log_stream
 * V2 — worker_transcript_capture
 * V3 — file_tree_visibility
 * V4 — file_diff_visibility
 * V5 — lead_directive_visibility
 * V6 — human_directive_flow
 * V7 — control_actions_visibility
 * V8 — completion_gate_visibility
 */

import type { GauntletPlan } from "../../src/core/execution-gauntlet/synthetic-plan-builder.js";

/**
 * V1 — Live Log Stream
 *
 * Purpose: Verify command stdout/stderr are streamed and visible.
 *
 * Expected events:
 * - command_started event exists
 * - command_stdout event exists
 * - command_stderr event exists when stderr is produced
 * - command_completed event exists
 * - live-monitor.log contains command output
 * - dashboard/read model can retrieve command logs
 */
export function buildV1LiveLogStream(): GauntletPlan {
	return {
		id: "V1",
		name: "live_log_stream",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose:
			"Verify command stdout/stderr are streamed and visible via synthetic worker command history and output.",
		workspaces: [
			{
				workspaceId: "V1-live-log",
				task: "Run command with stdout and stderr output",
				behavior: "success",
				targetCommand: "npm test",
			},
		],
		expected: {
			allComplete: true,
			commandHistoryExists: true,
			planCompletes: true,
		},
	};
}

/**
 * V2 — Worker Transcript Capture
 *
 * Purpose: Verify worker prompt/context/response/tool transcript is written.
 *
 * Expected:
 * - worker_transcript_written event exists
 * - worker transcript artifact exists
 * - worker detail read model includes transcript path
 * - combined-summary visibility.transcriptsWritten = true
 */
export function buildV2WorkerTranscriptCapture(): GauntletPlan {
	return {
		id: "V2",
		name: "worker_transcript_capture",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose: "Verify worker transcript artifacts are generated and accessible.",
		workspaces: [
			{
				workspaceId: "V2-transcript",
				task: "Create files with command history",
				behavior: "success",
				targetCommand: "npm test",
			},
		],
		expected: {
			allComplete: true,
			planCompletes: true,
			commandHistoryExists: true,
		},
	};
}

/**
 * V3 — File Tree Visibility
 *
 * Purpose: Verify file tree is generated and updated during execution.
 *
 * Expected:
 * - file_tree_updated event exists
 * - file tree read model exists
 * - created/modified/deleted file states are correct
 * - dashboard file tree endpoint returns data
 */
export function buildV3FileTreeVisibility(): GauntletPlan {
	return {
		id: "V3",
		name: "file_tree_visibility",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose: "Verify file changes are tracked and the file tree read model reflects all mutations.",
		workspaces: [
			{
				workspaceId: "V3-file-tree",
				task: "Create multiple source files and test files",
				behavior: "success",
				targetCommand: "npm test",
			},
		],
		expected: {
			allComplete: true,
			planCompletes: true,
		},
	};
}

/**
 * V4 — File Diff Visibility
 *
 * Purpose: Verify file diffs and snapshots are generated.
 *
 * Expected:
 * - file_snapshot_created event exists
 * - file_diff_created event exists
 * - diff artifact exists
 * - diff viewer read model can retrieve diff metadata
 */
export function buildV4FileDiffVisibility(): GauntletPlan {
	return {
		id: "V4",
		name: "file_diff_visibility",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose: "Verify file diffs/snapshots are produced as execution artifacts.",
		workspaces: [
			{
				workspaceId: "V4-file-diff",
				task: "Create files with deterministic content changes",
				behavior: "success",
				targetCommand: "npm test",
			},
		],
		expected: {
			allComplete: true,
			planCompletes: true,
		},
	};
}

/**
 * V5 — Lead Directive Visibility
 *
 * Purpose: Verify Lead Agent diagnosis/directive/escalation is visible.
 *
 * Expected:
 * - lead_diagnosis_created event exists
 * - lead_directive_created event exists
 * - lead_escalation_created event exists when expected
 * - Lead panel read model returns diagnosis/directive
 */
export function buildV5LeadDirectiveVisibility(): GauntletPlan {
	return {
		id: "V5",
		name: "lead_directive_visibility",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose: "Verify Lead Agent directives and escalations are visible through the read model.",
		workspaces: [
			{
				workspaceId: "V5-lead-directive",
				task: "Fail with missing command history to trigger Lead Agent",
				behavior: "missing_command_history",
				targetCommand: "npm test",
			},
		],
		expected: {
			completionGateBlocks: true,
			leadDirectiveCreated: true,
			planDoesNotComplete: true,
		},
	};
}

/**
 * V6 — Human Directive Flow
 *
 * Purpose: Verify user can send a directive and it enters retry/control flow.
 *
 * Expected:
 * - human_directive_sent event exists
 * - directive persisted
 * - retry packet includes human directive
 * - worker transcript shows directive
 * - combined-summary visibility.humanDirectiveVisible = true
 */
export function buildV6HumanDirectiveFlow(): GauntletPlan {
	return {
		id: "V6",
		name: "human_directive_flow",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose:
			"Verify human directive flow: directive sent, persisted, and visible in retry/control pathways.",
		workspaces: [
			{
				workspaceId: "V6-human-directive",
				task: "Fail repeatedly to trigger escalation, providing a human directive path",
				behavior: "repeat_same_failure",
				targetCommand: "npm test",
			},
		],
		expected: {
			leadDirectiveCreated: true,
			userEscalationCreated: true,
			planDoesNotComplete: true,
		},
	};
}

/**
 * V7 — Control Actions Visibility
 *
 * Purpose: Verify pause/resume/stop/retry/rerun validation actions are evented and visible.
 *
 * Expected:
 * - control command event exists
 * - execution-service command boundary is used
 * - state/read model updates
 * - dashboard control endpoint returns result
 */
export function buildV7ControlActionsVisibility(): GauntletPlan {
	return {
		id: "V7",
		name: "control_actions_visibility",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose: "Verify control actions (pause/resume/stop/retry) are visible via events and read model updates.",
		workspaces: [
			{
				workspaceId: "V7-control",
				task: "Succeed to verify control flow",
				behavior: "success",
				targetCommand: "npm test",
			},
		],
		expected: {
			allComplete: true,
			planCompletes: true,
		},
	};
}

/**
 * V8 — Completion Gate Visibility
 *
 * Purpose: Verify CompletionGate block reasons are visible.
 *
 * Expected:
 * - completion_gate_blocked event exists
 * - block reason visible in workspace detail
 * - command evidence visible
 * - combined-summary visibility.completionGateVisible = true
 */
export function buildV8CompletionGateVisibility(): GauntletPlan {
	return {
		id: "V8",
		name: "completion_gate_visibility",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose: "Verify CompletionGate block reasons are visible and exposed via the read model and combined summary.",
		workspaces: [
			{
				workspaceId: "V8-completion-gate",
				task: "Fail completion gate with missing command history",
				behavior: "missing_command_history",
				targetCommand: "npm test",
			},
		],
		expected: {
			completionGateBlocks: true,
			planDoesNotComplete: true,
		},
	};
}

/**
 * All V1-V8 visibility plans
 */
export const VISIBILITY_PLANS: GauntletPlan[] = [
	buildV1LiveLogStream(),
	buildV2WorkerTranscriptCapture(),
	buildV3FileTreeVisibility(),
	buildV4FileDiffVisibility(),
	buildV5LeadDirectiveVisibility(),
	buildV6HumanDirectiveFlow(),
	buildV7ControlActionsVisibility(),
	buildV8CompletionGateVisibility(),
];

/**
 * Visibility-specific scenario metadata.
 * Each entry maps a plan ID to its testable visibility assertions.
 */
export const VISIBILITY_SCENARIO_META: Record<
	string,
	{
		/** Human-readable description */
		description: string;
		/** Required visibility flags that must be true in the combined summary */
		requiredVisibilityFlags: Array<keyof CombinedSummaryVisibility>;
		/** Whether this scenario expects command history to be recorded */
		expectsCommandHistory: boolean;
		/** Whether this scenario expects transcript artifacts */
		expectsTranscripts: boolean;
		/** Whether this expects lead agent visibility */
		expectsLeadAgentVisible: boolean;
		/** Whether this expects completion gate visibility */
		expectsCompletionGateVisible: boolean;
	}
> = {
	V1: {
		description: "Live command log / terminal stream — stdout/stderr events exist and are visible",
		requiredVisibilityFlags: ["commandLogsWritten", "liveMonitorWritten"],
		expectsCommandHistory: true,
		expectsTranscripts: true,
		expectsLeadAgentVisible: false,
		expectsCompletionGateVisible: false,
	},
	V2: {
		description: "Worker transcript capture — transcript artifacts are written and linked",
		requiredVisibilityFlags: ["transcriptsWritten", "eventStreamWritten"],
		expectsCommandHistory: true,
		expectsTranscripts: true,
		expectsLeadAgentVisible: false,
		expectsCompletionGateVisible: false,
	},
	V3: {
		description: "File tree visibility — file tree read model reflects workspace mutations",
		requiredVisibilityFlags: ["fileTreeAvailable", "stateSnapshotsWritten"],
		expectsCommandHistory: true,
		expectsTranscripts: true,
		expectsLeadAgentVisible: false,
		expectsCompletionGateVisible: false,
	},
	V4: {
		description: "File diff visibility — diffs and snapshot artifacts are generated",
		requiredVisibilityFlags: ["fileDiffsWritten", "stateSnapshotsWritten"],
		expectsCommandHistory: true,
		expectsTranscripts: true,
		expectsLeadAgentVisible: false,
		expectsCompletionGateVisible: false,
	},
	V5: {
		description: "Lead directive visibility — diagnosis, directives, and escalations are visible",
		requiredVisibilityFlags: ["leadAgentVisible", "escalationVisible", "workerContextAvailable"],
		expectsCommandHistory: false,
		expectsTranscripts: true,
		expectsLeadAgentVisible: true,
		expectsCompletionGateVisible: false,
	},
	V6: {
		description: "Human directive flow — directives enter retry/control flow and are visible",
		requiredVisibilityFlags: ["humanDirectiveVisible", "escalationVisible"],
		expectsCommandHistory: false,
		expectsTranscripts: true,
		expectsLeadAgentVisible: true,
		expectsCompletionGateVisible: false,
	},
	V7: {
		description: "Control actions visibility — actions are evented and update read model",
		requiredVisibilityFlags: ["controlEventsVisible", "dashboardReadModelAvailable"],
		expectsCommandHistory: true,
		expectsTranscripts: true,
		expectsLeadAgentVisible: false,
		expectsCompletionGateVisible: false,
	},
	V8: {
		description: "Completion gate visibility — block reasons are exposed in workspace detail and summary",
		requiredVisibilityFlags: ["completionGateVisible"],
		expectsCommandHistory: false,
		expectsTranscripts: true,
		expectsLeadAgentVisible: false,
		expectsCompletionGateVisible: true,
	},
};

/**
 * Visibility section of the combined summary.
 * Mirrors the P41 plan specification for visibility validation.
 */
export interface CombinedSummaryVisibility {
	eventStreamWritten: boolean;
	stateSnapshotsWritten: boolean;
	liveMonitorWritten: boolean;
	transcriptsWritten: boolean;
	commandLogsWritten: boolean;
	fileTreeAvailable: boolean;
	fileDiffsWritten: boolean;
	workerContextAvailable: boolean;
	dashboardReadModelAvailable: boolean;
	leadAgentVisible: boolean;
	completionGateVisible: boolean;
	humanDirectiveVisible: boolean;
	controlEventsVisible: boolean;
	escalationVisible: boolean;
}

/**
 * Default visibility section with all flags false.
 */
export function createDefaultVisibility(): CombinedSummaryVisibility {
	return {
		eventStreamWritten: false,
		stateSnapshotsWritten: false,
		liveMonitorWritten: false,
		transcriptsWritten: false,
		commandLogsWritten: false,
		fileTreeAvailable: false,
		fileDiffsWritten: false,
		workerContextAvailable: false,
		dashboardReadModelAvailable: false,
		leadAgentVisible: false,
		completionGateVisible: false,
		humanDirectiveVisible: false,
		controlEventsVisible: false,
		escalationVisible: false,
	};
}
