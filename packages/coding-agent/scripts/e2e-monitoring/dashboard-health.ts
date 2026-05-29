/**
 * E2E Dashboard Health Checker
 *
 * Verifies that web server endpoints are responsive after plan execution.
 * Tests critical API endpoints for health, correctness, and latency.
 */

import { type DashboardHealthReport, type EndpointCheck } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DashboardHealthConfig {
	baseUrl?: string;
	timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function checkDashboardHealth(config: DashboardHealthConfig = {}): Promise<DashboardHealthReport> {
	const baseUrl = config.baseUrl ?? "http://localhost:3000";
	const timeoutMs = config.timeoutMs ?? 5000;

	const endpoints: Array<{ path: string; method: string; expectedStatus?: number }> = [
		{ path: "/api/health", method: "GET", expectedStatus: 200 },
		{ path: "/api/ai-models", method: "GET", expectedStatus: 200 },
		{ path: "/api/projects", method: "GET", expectedStatus: 200 },
	];

	const checks: EndpointCheck[] = [];

	for (const ep of endpoints) {
		const check = await checkEndpoint(baseUrl + ep.path, ep.method, timeoutMs, ep.expectedStatus);
		checks.push(check);
	}

	const passed = checks.filter((c) => c.statusCode !== null && c.error === null).length;
	const failed = checks.filter((c) => c.error !== null || c.statusCode === null).length;

	return {
		timestamp: Date.now(),
		baseUrl,
		endpointsChecked: checks.length,
		endpointsPassed: passed,
		endpointsFailed: failed,
		checks,
		serverPid: null,
		serverUptimeMs: null,
	};
}

async function checkEndpoint(url: string, method: string, timeoutMs: number, expectedStatus?: number): Promise<EndpointCheck> {
	const start = Date.now();
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const response = await fetch(url, {
			method,
			signal: controller.signal,
			headers: { "Accept": "application/json" },
		});
		clearTimeout(timer);

		const latencyMs = Date.now() - start;
		let bodySample: unknown = null;
		try {
			const text = await response.text();
			bodySample = text.substring(0, 200);
		} catch {}

		const expectedOk = expectedStatus ?? 200;
		if (response.status !== expectedOk) {
			return {
				endpoint: url,
				method,
				statusCode: response.status,
				latencyMs,
				error: `Expected ${expectedOk}, got ${response.status}`,
				bodySample,
			};
		}

		return { endpoint: url, method, statusCode: response.status, latencyMs, error: null, bodySample };
	} catch (err) {
		return {
			endpoint: url,
			method,
			statusCode: null,
			latencyMs: Date.now() - start,
			error: err instanceof Error ? err.message : String(err),
			bodySample: null,
		};
	}
}
