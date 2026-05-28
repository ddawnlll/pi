/**
 * Brain V5 Routes — REST API for V5 capability boundary status.
 *
 * Provides endpoints:
 *   GET /brain-v5/status   — Current V5 mode and capability flags
 *   GET /brain-v5/doctor    — V5 plan doctor report
 *   GET /brain-v5/gates     — V5 operator gate status
 *
 * Routes can be registered under any prefix:
 * - Globally: prefix "/api" → /api/brain-v5/status
 * - Per-project: prefix "/api/projects/:projectId" → /api/projects/:projectId/brain-v5/status
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface V5RouteOptions {
	getSettingsManager?: () => Promise<{
		getBrainV5Settings: () => {
			enabled?: boolean;
			readOnlyMode?: boolean;
			pushEnabled?: boolean;
			overnightOperatorEnabled?: boolean;
		};
		getBrainV5Mode: () => string;
	}>;
}

/**
 * Register Brain V5 status routes on a Fastify instance.
 *
 * @param fastify - Fastify instance to register routes on
 * @param options - SettingsManager provider
 */
export async function registerBrainV5Routes(fastify: FastifyInstance, options?: V5RouteOptions): Promise<void> {
	// GET /brain-v5/status — Current V5 mode and capability flags
	fastify.get("/brain-v5/status", async (_request, reply) => {
		try {
			let mode = "OFF";
			let flags = {
				enabled: false,
				readOnlyMode: true,
				pushEnabled: false,
				overnightOperatorEnabled: false,
			};

			if (options?.getSettingsManager) {
				const sm = await options.getSettingsManager();
				const settings = sm.getBrainV5Settings();
				mode = sm.getBrainV5Mode();
				flags = {
					enabled: settings.enabled ?? false,
					readOnlyMode: settings.readOnlyMode ?? true,
					pushEnabled: settings.pushEnabled ?? false,
					overnightOperatorEnabled: settings.overnightOperatorEnabled ?? false,
				};
			}

			return {
				mode,
				flags,
				v5Available: mode !== "OFF",
				canEmit: mode !== "OFF" && mode !== "READ_ONLY",
				canPush: mode === "DRAFTING" || mode === "OPERATOR_READY",
				canRunOvernight: mode === "OPERATOR_READY",
			};
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get Brain V5 status",
				message: error instanceof Error ? error.message : String(error),
				mode: "OFF",
				v5Available: false,
				canEmit: false,
				canPush: false,
				canRunOvernight: false,
			});
		}
	});

	// GET /brain-v5/doctor — V5 plan doctor report
	fastify.get("/brain-v5/doctor", async (_request, reply) => {
		try {
			const { buildV5DoctorReport, checkV5OperatorGates } = await import("@earendil-works/pi-coding-agent");

			let config: {
				enabled: boolean;
				readOnlyMode: boolean;
				pushEnabled: boolean;
				overnightOperatorEnabled: boolean;
				mode: "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";
			} = {
				enabled: false,
				readOnlyMode: true,
				pushEnabled: false,
				overnightOperatorEnabled: false,
				mode: "OFF",
			};

			if (options?.getSettingsManager) {
				const sm = await options.getSettingsManager();
				const raw = sm.getBrainV5Settings();
				config = {
					enabled: raw.enabled ?? false,
					readOnlyMode: raw.readOnlyMode ?? true,
					pushEnabled: raw.pushEnabled ?? false,
					overnightOperatorEnabled: raw.overnightOperatorEnabled ?? false,
					mode: sm.getBrainV5Mode() as "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY",
				};
			}

			const gates = checkV5OperatorGates(config);
			const report = buildV5DoctorReport(config, gates);

			return report;
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get V5 doctor report",
				message: error instanceof Error ? error.message : String(error),
				mode: "OFF",
				canSuggest: false,
				operatorGatesPassed: false,
				summary: "Error retrieving V5 status.",
				details: [],
			});
		}
	});

	// GET /brain-v5/gates — V5 operator gate status
	fastify.get("/brain-v5/gates", async (_request, reply) => {
		try {
			const { checkV5OperatorGates } = await import("@earendil-works/pi-coding-agent");

			let config: {
				enabled: boolean;
				readOnlyMode: boolean;
				pushEnabled: boolean;
				overnightOperatorEnabled: boolean;
				mode: "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";
			} = {
				enabled: false,
				readOnlyMode: true,
				pushEnabled: false,
				overnightOperatorEnabled: false,
				mode: "OFF",
			};

			if (options?.getSettingsManager) {
				const sm = await options.getSettingsManager();
				const raw = sm.getBrainV5Settings();
				config = {
					enabled: raw.enabled ?? false,
					readOnlyMode: raw.readOnlyMode ?? true,
					pushEnabled: raw.pushEnabled ?? false,
					overnightOperatorEnabled: raw.overnightOperatorEnabled ?? false,
					mode: sm.getBrainV5Mode() as "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY",
				};
			}

			const gates = checkV5OperatorGates(config);
			return gates;
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get V5 gate status",
				message: error instanceof Error ? error.message : String(error),
				pushEnabled: false,
				overnightOperatorEnabled: false,
				safetyProfileAllows: false,
				executionContextAllows: false,
				allGatesPassed: false,
			});
		}
	});
}
