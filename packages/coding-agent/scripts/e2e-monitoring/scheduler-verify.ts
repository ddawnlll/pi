/**
 * E2E Scheduler Correctness Verifier
 *
 * Verifies that the scheduler made correct decisions during plan execution:
 * - No workspace was scheduled before its dependencies completed
 * - No workspace ran concurrently with a cannotRunWith peer
 * - No more than maxParallel workspaces were active simultaneously
 * - No workspace was orphaned (scheduled but never completed)
 * - Dependencies were respected (topological order maintained)
 * - File lock conflicts were handled correctly (no co-editing violations)
 */

import type { Workspace, WorkspaceQueue } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerCorrectnessReport {
	timestamp: number;
	totalAssertions: number;
	passed: number;
	failed: number;
	violations: SchedulerViolation[];
}

export interface SchedulerViolation {
	type: "dependency_order" | "max_parallelism" | "cannot_run_with" | "orphan" | "duplicate_launch" | "file_lock_conflict";
	message: string;
	workspaceIds: string[];
	detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Execution trace types
// ---------------------------------------------------------------------------

export interface WorkspaceTrace {
	workspaceId: string;
	dependencies: string[];
	cannotRunWith: string[];
	batch: string;
	queuedAt: number;
	startedAt: number | null;
	completedAt: number | null;
	verdict: string;
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export interface SchedulerVerifierConfig {
	queue: WorkspaceQueue;
	maxParallel: number;
	traces: WorkspaceTrace[];
}

export function verifySchedulerCorrectness(config: SchedulerVerifierConfig): SchedulerCorrectnessReport {
	const { queue, maxParallel, traces } = config;
	const violations: SchedulerViolation[] = [];

	const wsMap = new Map(queue.workspaces.map((w) => [w.id, w]));
	const traceMap = new Map(traces.map((t) => [t.workspaceId, t]));

	// 1. Dependency ordering: no workspace started before deps completed
	for (const trace of traces) {
		if (!trace.startedAt) continue;
		for (const depId of trace.dependencies) {
			const depTrace = traceMap.get(depId);
			if (!depTrace) continue;
			if (depTrace.completedAt === null) {
				violations.push({
					type: "dependency_order",
					message: `${trace.workspaceId} started at ${trace.startedAt} but dependency ${depId} never completed`,
					workspaceIds: [trace.workspaceId, depId],
				});
			} else if (depTrace.completedAt > trace.startedAt) {
				violations.push({
					type: "dependency_order",
					message: `${trace.workspaceId} started at ${trace.startedAt} before dependency ${depId} completed at ${depTrace.completedAt}`,
					workspaceIds: [trace.workspaceId, depId],
					detail: { startedAt: trace.startedAt, depCompletedAt: depTrace.completedAt },
				});
			}
		}
	}

	// 2. Max parallelism: never more than maxParallel active at once
	const timeline: Array<{ time: number; delta: number; id: string }> = [];
	for (const trace of traces) {
		if (trace.startedAt) timeline.push({ time: trace.startedAt, delta: 1, id: trace.workspaceId });
		if (trace.completedAt) timeline.push({ time: trace.completedAt, delta: -1, id: trace.workspaceId });
	}
	timeline.sort((a, b) => a.time - b.time);

	let activeCount = 0;
	let maxObserved = 0;
	const maxObservedAt: number[] = [];
	for (const event of timeline) {
		activeCount += event.delta;
		if (activeCount > maxObserved) {
			maxObserved = activeCount;
			maxObservedAt.length = 0;
		}
		if (activeCount === maxObserved) {
			maxObservedAt.push(event.time);
		}
		if (activeCount > maxParallel) {
			violations.push({
				type: "max_parallelism",
				message: `${activeCount} active workspaces exceeded maxParallel=${maxParallel} at time ${event.time}`,
				workspaceIds: [],
				detail: { activeCount, maxParallel, time: event.time },
			});
		}
	}

	// 3. cannotRunWith: no workspace ran concurrently with a restricted peer
	for (const trace of traces) {
		if (!trace.startedAt || !trace.completedAt) continue;
		const ws = wsMap.get(trace.workspaceId);
		if (!ws?.cannotRunWith) continue;

		for (const peerId of ws.cannotRunWith) {
			const peerTrace = traceMap.get(peerId);
			if (!peerTrace?.startedAt || !peerTrace.completedAt) continue;

			// Check for overlap
			const overlapStart = Math.max(trace.startedAt, peerTrace.startedAt);
			const overlapEnd = Math.min(trace.completedAt, peerTrace.completedAt);
			if (overlapStart < overlapEnd) {
				violations.push({
					type: "cannot_run_with",
					message: `${trace.workspaceId} ran concurrently with restricted peer ${peerId} (overlap: ${overlapStart}-${overlapEnd})`,
					workspaceIds: [trace.workspaceId, peerId],
					detail: { overlapMs: overlapEnd - overlapStart },
				});
			}
		}
	}

	// 4. Orphans: scheduled but never completed
	for (const trace of traces) {
		if (trace.startedAt && !trace.completedAt) {
			violations.push({
				type: "orphan",
				message: `${trace.workspaceId} was started at ${trace.startedAt} but never completed`,
				workspaceIds: [trace.workspaceId],
			});
		}
	}

	// 5. Duplicate launches: same workspace started twice without completing
	const startedCounts = new Map<string, number>();
	for (const trace of traces) {
		if (trace.startedAt) {
			startedCounts.set(trace.workspaceId, (startedCounts.get(trace.workspaceId) ?? 0) + 1);
		}
	}
	for (const [id, count] of startedCounts) {
		if (count > 1) {
			violations.push({
				type: "duplicate_launch",
				message: `${id} was launched ${count} times`,
				workspaceIds: [id],
				detail: { launchCount: count },
			});
		}
	}

	// 6. File lock conflicts: workspaces with overlapping canEdit were concurrent
	for (let i = 0; i < traces.length; i++) {
		for (let j = i + 1; j < traces.length; j++) {
			const a = traces[i];
			const b = traces[j];
			if (!a.startedAt || !a.completedAt || !b.startedAt || !b.completedAt) continue;

			// Overlap?
			const overlapStart = Math.max(a.startedAt, b.startedAt);
			const overlapEnd = Math.min(a.completedAt, b.completedAt);
			if (overlapStart >= overlapEnd) continue;

			const wsA = wsMap.get(a.workspaceId);
			const wsB = wsMap.get(b.workspaceId);
			if (!wsA?.capabilities?.canEdit || !wsB?.capabilities?.canEdit) continue;

			const setA = new Set(wsA.capabilities.canEdit);
			const setB = new Set(wsB.capabilities.canEdit);
			const intersection = [...setA].filter((f) => setB.has(f));

			// Skip if both in same batch (soft-locking allowed)
			if (a.batch === b.batch && a.batch !== "B0" && a.batch !== "") continue;

			if (intersection.length > 0) {
				violations.push({
					type: "file_lock_conflict",
					message: `${a.workspaceId} and ${b.workspaceId} ran concurrently with overlapping canEdit files: ${intersection.slice(0, 3).join(", ")}`,
					workspaceIds: [a.workspaceId, b.workspaceId],
					detail: { overlappingFiles: intersection, overlapMs: overlapEnd - overlapStart },
				});
			}
		}
	}

	return {
		timestamp: Date.now(),
		totalAssertions: 6,
		passed: [1, 2, 3, 4, 5, 6].filter((i) => {
			const type = ["dependency_order", "max_parallelism", "cannot_run_with", "orphan", "duplicate_launch", "file_lock_conflict"][i - 1];
			return !violations.some((v) => v.type === type);
		}).length,
		failed: new Set(violations.map((v) => v.type)).size,
		violations,
	};
}
