/**
 * TUI / Live Console — P38.1
 *
 * Minimal live console for the gauntlet. Shows run progress, worker states,
 * and invariant failures. Does not depend on Ink or any TUI framework.
 *
 * When --tui=false (default), the live monitor still writes logs.
 * When --tui=true, this console periodically prints a status table.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TuiState {
	runId: string;
	elapsedMs: number;
	currentSuite: string;
	currentPlanId: string | null;
	executionMode: string;
	seed: number;
	iteration: number;
	totalIterations: number;
	activeWorkers: number;
	readyWorkers: number;
	blockedWorkers: number;
	failedWorkersTotal: number;
	completedWorkers: number;
	maxObservedParallelism: number;
	lastEvent: string;
	currentFailureClassification: string | null;
	leadDirectivesCreated: number;
	escalationsCreated: number;
	currentInvariantFailures: number;
	reportPath: string;
}

// ---------------------------------------------------------------------------
// TUI Console
// ---------------------------------------------------------------------------

export class TuiConsole {
	private state: TuiState | null = null;
	private enabled: boolean;
	private lastDraw = 0;
	private drawInterval = 1000; // min ms between draws
	private lines: string[] = [];

	constructor(enabled: boolean) {
		this.enabled = enabled;
	}

	/**
	 * Update the TUI state.
	 */
	update(state: TuiState): void {
		this.state = state;
		if (this.enabled) {
			const now = Date.now();
			if (now - this.lastDraw > this.drawInterval) {
				this.draw();
				this.lastDraw = now;
			}
		}
	}

	/**
	 * Force a redraw.
	 */
	flush(): void {
		if (this.enabled && this.state) {
			this.draw();
		}
	}

	/**
	 * Get current snapshot as text.
	 */
	snapshot(): string {
		if (!this.state) return "No data available.";
		return this.buildDisplay(this.state);
	}

	/**
	 * Write snapshot to file.
	 */
	getSnapshotText(): string {
		return `${this.lines.join("\n")}\n`;
	}

	private draw(): void {
		if (!this.state) return;

		const display = this.buildDisplay(this.state);
		this.lines = display.split("\n");

		// Clear screen and redraw
		process.stdout.write("\x1b[2J\x1b[H"); // clear screen, cursor home
		process.stdout.write(`${display}\n`);
	}

	private buildDisplay(state: TuiState): string {
		const elapsed = (state.elapsedMs / 1000).toFixed(1);
		const lines: string[] = [];

		lines.push("═".repeat(60));
		lines.push(`  Execution Stability Gauntlet — ${state.runId}`);
		lines.push("═".repeat(60));
		lines.push("");
		lines.push(`  Elapsed:      ${elapsed}s`);
		lines.push(`  Suite:        ${state.currentSuite}`);
		lines.push(`  Plan:         ${state.currentPlanId ?? "—"}`);
		lines.push(`  Mode:         ${state.executionMode}`);
		lines.push(`  Seed:         ${state.seed}`);
		lines.push(`  Iteration:    ${state.iteration}/${state.totalIterations}`);
		lines.push("");
		lines.push("  ── Workers ──");
		lines.push(`  Active:       ${state.activeWorkers}`);
		lines.push(`  Ready:        ${state.readyWorkers}`);
		lines.push(`  Blocked:      ${state.blockedWorkers}`);
		lines.push(`  Failed:       ${state.failedWorkersTotal}`);
		lines.push(`  Complete:     ${state.completedWorkers}`);
		lines.push(`  Max Parallel: ${state.maxObservedParallelism}`);
		lines.push("");
		lines.push("  ── Events ──");
		lines.push(`  Last Event:   ${state.lastEvent}`);
		lines.push(`  Failure:      ${state.currentFailureClassification ?? "—"}`);
		lines.push(`  Directives:   ${state.leadDirectivesCreated}`);
		lines.push(`  Escalations:  ${state.escalationsCreated}`);
		lines.push(`  Invariant Errs: ${state.currentInvariantFailures}`);
		lines.push("");
		lines.push(`  Report:       ${state.reportPath}`);
		lines.push("");
		lines.push("═".repeat(60));

		return lines.join("\n");
	}
}
