import { existsSync } from "node:fs";
import { readFile, watch, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

const fastify = Fastify({
	logger: true,
});

// CORS for local development
await fastify.register(fastifyCors, {
	origin: true,
});

// Serve static dashboard files
const dashboardDist = resolve(process.cwd(), "../web-ui/dist");
await fastify.register(fastifyStatic, {
	root: dashboardDist,
	prefix: "/",
});

// Types
interface PlanState {
	title: string;
	phase: string;
	status: "running" | "paused" | "stopped" | "completed" | "failed";
	elapsed: number;
	queue: {
		pending: number;
		active: number;
		blocked: number;
		complete: number;
		failed: number;
	};
	workers: Array<{
		id: string;
		stage: string;
		attempt: number;
		retries: number;
		snapshotPath?: string;
		reportPath?: string;
	}>;
}

interface ControlRequest {
	action: "pause" | "stop" | "cancel" | "resume";
	requestedAt: string;
	requestedBy: string;
}

// Helper to get .pi directory
function getPiDir(): string {
	// Look for .pi in project root (two levels up from web-server package)
	const piDir = resolve(process.cwd(), "../../.pi");
	return piDir;
}

// GET /api/plan-state - Poll plan state
fastify.get("/api/plan-state", async (_request, reply) => {
	const piDir = getPiDir();
	const stateFile = join(piDir, "plan-state.json");

	fastify.log.info({ piDir, stateFile, exists: existsSync(stateFile) }, "Checking plan state file");

	if (!existsSync(stateFile)) {
		return reply.code(404).send({ error: "Plan state not found", path: stateFile });
	}

	try {
		const content = await readFile(stateFile, "utf-8");
		fastify.log.info({ contentLength: content.length }, "Read plan state file");
		const state: PlanState = JSON.parse(content);
		return state;
	} catch (error) {
		fastify.log.error({ error }, "Failed to read plan state");
		return reply.code(500).send({ error: "Failed to read plan state", message: String(error) });
	}
});

// GET /api/events - SSE stream of execution journal
fastify.get("/api/events", async (request, reply) => {
	const journalFile = join(getPiDir(), "execution-journal.ndjson");

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	// Send existing events first
	if (existsSync(journalFile)) {
		try {
			const content = await readFile(journalFile, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);

			// Send last 50 events
			const recentLines = lines.slice(-50);
			for (const line of recentLines) {
				reply.raw.write(`data: ${line}\n\n`);
			}
		} catch (_error) {
			// Ignore read errors
		}
	}

	// Watch for new events
	const abortController = new AbortController();

	request.raw.on("close", () => {
		abortController.abort();
	});

	try {
		const watcher = watch(journalFile, { signal: abortController.signal });

		for await (const event of watcher) {
			if (event.eventType === "change") {
				try {
					const content = await readFile(journalFile, "utf-8");
					const lines = content.trim().split("\n").filter(Boolean);
					const lastLine = lines[lines.length - 1];

					if (lastLine) {
						reply.raw.write(`data: ${lastLine}\n\n`);
					}
				} catch (_error) {
					// Ignore read errors
				}
			}
		}
	} catch (_error) {
		// Watcher aborted or file doesn't exist
	}
});

// GET /api/logs/:workspaceId/:attempt/:stream - SSE stream of worker logs
fastify.get<{
	Params: { workspaceId: string; attempt: string; stream: string };
}>("/api/logs/:workspaceId/:attempt/:stream", async (request, reply) => {
	const { workspaceId, attempt, stream } = request.params;
	const logFile = join(getPiDir(), "workspaces", workspaceId, "attempts", attempt, `${stream}.log`);

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	// Send existing log content
	if (existsSync(logFile)) {
		try {
			const content = await readFile(logFile, "utf-8");
			const lines = content.split("\n").filter(Boolean);

			for (const line of lines) {
				reply.raw.write(`data: ${line}\n\n`);
			}
		} catch (_error) {
			// Ignore read errors
		}
	}

	// Watch for new log lines
	const abortController = new AbortController();

	request.raw.on("close", () => {
		abortController.abort();
	});

	try {
		const watcher = watch(logFile, { signal: abortController.signal });

		for await (const event of watcher) {
			if (event.eventType === "change") {
				try {
					const content = await readFile(logFile, "utf-8");
					const lines = content.split("\n").filter(Boolean);
					const lastLine = lines[lines.length - 1];

					if (lastLine) {
						reply.raw.write(`data: ${lastLine}\n\n`);
					}
				} catch (_error) {
					// Ignore read errors
				}
			}
		}
	} catch (_error) {
		// Watcher aborted or file doesn't exist
	}
});

// POST /api/control - Send control command
fastify.post<{ Body: ControlRequest }>("/api/control", async (request, reply) => {
	const { action, requestedAt, requestedBy } = request.body;
	const controlFile = join(getPiDir(), "plan-control.json");

	// Validate action
	if (!["pause", "stop", "cancel", "resume"].includes(action)) {
		return reply.code(400).send({ success: false, error: "Invalid action" });
	}

	// Check resume safety
	if (action === "resume") {
		try {
			if (existsSync(controlFile)) {
				const content = await readFile(controlFile, "utf-8");
				const currentControl = JSON.parse(content);

				if (currentControl.action !== "pause") {
					return reply.code(409).send({
						success: false,
						error: `resume not safe: current action is ${currentControl.action}`,
					});
				}
			}
		} catch (_error) {
			// If we can't read current state, allow resume
		}
	}

	// Write control file
	try {
		const controlData = { action, requestedAt, requestedBy };
		await writeFile(controlFile, JSON.stringify(controlData, null, 2));
		return { success: true };
	} catch (_error) {
		return reply.code(500).send({ success: false, error: "Failed to write control file" });
	}
});

// Start server
const start = async () => {
	try {
		const port = Number(process.env.PORT) || 3000;
		await fastify.listen({ port, host: "127.0.0.1" });
		console.log(`Dashboard server running at http://127.0.0.1:${port}`);
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
};

start();
