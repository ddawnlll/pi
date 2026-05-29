/**
 * E2E Resource Monitor
 *
 * Samples system resources during execution:
 * - Memory (RSS, heap, external)
 * - CPU usage
 * - Event loop lag
 * - Open file descriptors & handles
 * - Disk space
 * - System load average
 *
 * Runs a background sampling loop at configurable intervals.
 */

import { type ResourceSample } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ResourceMonitorConfig {
	sampleIntervalMs?: number;
	maxSamples?: number;
}

// ---------------------------------------------------------------------------
// Resource Monitor
// ---------------------------------------------------------------------------

export class ResourceMonitor {
	private samples: ResourceSample[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly intervalMs: number;
	private readonly maxSamples: number;

	constructor(config: ResourceMonitorConfig = {}) {
		this.intervalMs = config.sampleIntervalMs ?? 5000;
		this.maxSamples = config.maxSamples ?? 10_000;
	}

	start(): void {
		if (this.timer) return;
		// Take an initial sample immediately
		this.sample();
		this.timer = setInterval(() => this.sample(), this.intervalMs);
		this.timer.unref();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		// Take a final sample
		this.sample();
	}

	/**
	 * Take a single resource sample.
	 */
	sample(): void {
		if (this.samples.length >= this.maxSamples) {
			// Remove oldest samples to stay under limit
			this.samples.splice(0, this.samples.length - this.maxSamples + 1);
		}

		const mem = process.memoryUsage();
		const cpu = process.cpuUsage();

		const sample: ResourceSample = {
			timestamp: Date.now(),
			rssMb: Math.round(mem.rss / (1024 * 1024)),
			heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
			heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
			externalMb: Math.round(mem.external / (1024 * 1024)),
			cpuUser: Math.round(cpu.user / 1000), // microseconds → milliseconds
			cpuSystem: Math.round(cpu.system / 1000),
			eventLoopLagMs: this.measureEventLoopLag(),
			openFds: this.countOpenFds(),
			activeHandles: (process as any)._getActiveHandles?.()?.length ?? -1,
			activeRequests: (process as any)._getActiveRequests?.()?.length ?? -1,
			diskFreeGb: this.getDiskFreeGb(),
			loadAvg1m: this.getLoadAvg(),
		};

		this.samples.push(sample);
	}

	// ── Accessors ──────────────────────────────────────────────────────

	getSamples(): ResourceSample[] {
		return [...this.samples];
	}

	getLatest(): ResourceSample | null {
		return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
	}

	getPeak(): { maxRssMb: number; maxHeapMb: number; maxEventLoopLagMs: number } {
		let maxRss = 0;
		let maxHeap = 0;
		let maxLag = 0;
		for (const s of this.samples) {
			if (s.rssMb > maxRss) maxRss = s.rssMb;
			if (s.heapUsedMb > maxHeap) maxHeap = s.heapUsedMb;
			if (s.eventLoopLagMs > maxLag) maxLag = s.eventLoopLagMs;
		}
		return { maxRssMb: maxRss, maxHeapMb: maxHeap, maxEventLoopLagMs: maxLag };
	}

	getAverage(): { avgRssMb: number; avgHeapMb: number; avgEventLoopLagMs: number } {
		if (this.samples.length === 0) return { avgRssMb: 0, avgHeapMb: 0, avgEventLoopLagMs: 0 };
		let rss = 0, heap = 0, lag = 0;
		for (const s of this.samples) {
			rss += s.rssMb;
			heap += s.heapUsedMb;
			lag += s.eventLoopLagMs;
		}
		return {
			avgRssMb: Math.round(rss / this.samples.length),
			avgHeapMb: Math.round(heap / this.samples.length),
			avgEventLoopLagMs: Math.round(lag / this.samples.length * 100) / 100,
		};
	}

	// ── Private ────────────────────────────────────────────────────────

	private measureEventLoopLag(): number {
		// Approximate event loop lag by measuring how long a tight synchronous
		// loop takes relative to wall-clock time. If the event loop is busy,
		// the loop takes longer than expected.
		const start = Date.now();
		let x = 0;
		for (let i = 0; i < 1_000_000; i++) x += Math.sqrt(i);
		const elapsed = Date.now() - start;
		// ~1ms baseline on modern hardware; anything above 5ms indicates lag
		return elapsed;
	}

	private countOpenFds(): number {
		try {
			const { readdirSync } = require("node:fs");
			return readdirSync("/proc/self/fd").length;
		} catch {
			return -1;
		}
	}

	private getDiskFreeGb(): number | null {
		try {
			const { execSync } = require("node:child_process");
			const df = execSync("df -BG . | tail -1", { encoding: "utf-8", timeout: 3000 });
			const parts = df.trim().split(/\s+/);
			const availStr = parts[3] ?? "0G";
			return parseInt(availStr.replace("G", ""), 10);
		} catch {
			return null;
		}
	}

	private getLoadAvg(): number | null {
		try {
			return require("node:os").loadavg()[0];
		} catch {
			return null;
		}
	}
}
