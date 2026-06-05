/**
 * Process Killer — Standalone process-tree management for execution-contracts.
 * Extracted from coding-agent shell utils. Only uses Node.js stdlib.
 */

import child_process from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackedProcess {
	pid: number;
	planExecId: string;
	workspaceId?: string;
	startedAt: number;
	killedAt?: number;
	killReason?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const trackedProcesses = new Map<number, TrackedProcess>();

function killProcessTree(pid: number): void {
	try {
		child_process.execSync(`kill -9 -${pid} 2>/dev/null || true`, { timeout: 2000 });
	} catch {
		// Process may already be dead
	}
	try {
		child_process.execSync(`kill -9 ${pid} 2>/dev/null || true`, { timeout: 2000 });
	} catch {
		// Process may already be dead
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function killPlanProcesses(planExecId: string, reason?: string): void {
	const toKill: number[] = [];
	for (const [pid, proc] of trackedProcesses) {
		if (proc.planExecId === planExecId) {
			toKill.push(pid);
		}
	}
	for (const pid of toKill) {
		killProcessTree(pid);
		const existing = trackedProcesses.get(pid);
		if (existing) {
			existing.killedAt = Date.now();
			existing.killReason = reason;
		}
		trackedProcesses.delete(pid);
	}
}

export function killTrackedDetachedChildren(): void {
	for (const pid of trackedProcesses.keys()) {
		killProcessTree(pid);
	}
	trackedProcesses.clear();
}
