/**
 * Auth Routes — REST API for managing provider API keys.
 *
 * Provides access to the shared auth.json storage so users can
 * view and manage provider credentials from the dashboard settings UI.
 *
 * Endpoints:
 *   GET    /api/auth          List all providers with their auth status
 *   PUT    /api/auth/:provider  Save an API key for a provider
 *   DELETE /api/auth/:provider  Remove stored credentials for a provider
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getProviders } from "@earendil-works/pi-ai";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types (shared with frontend)
// ---------------------------------------------------------------------------

export interface ProviderAuthInfo {
	provider: string;
	name: string;
	configured: boolean;
	source?: string;
	label?: string;
}

export interface AuthListResponse {
	providers: ProviderAuthInfo[];
}

export interface SaveApiKeyRequest {
	apiKey: string;
}

// ---------------------------------------------------------------------------
// Provider display names (mirrors BUILT_IN_PROVIDER_DISPLAY_NAMES)
// ---------------------------------------------------------------------------

const DISPLAY_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	"amazon-bedrock": "Amazon Bedrock",
	"azure-openai-responses": "Azure OpenAI Responses",
	cerebras: "Cerebras",
	"cloudflare-ai-gateway": "Cloudflare AI Gateway",
	"cloudflare-workers-ai": "Cloudflare Workers AI",
	deepseek: "DeepSeek",
	fireworks: "Fireworks",
	google: "Google Gemini",
	"google-vertex": "Google Vertex AI",
	groq: "Groq",
	huggingface: "Hugging Face",
	"kimi-coding": "Kimi For Coding",
	mistral: "Mistral",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax (China)",
	moonshotai: "Moonshot AI",
	"moonshotai-cn": "Moonshot AI (China)",
	neotokens: "NeoTokens",
	opencode: "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	openai: "OpenAI",
	openrouter: "OpenRouter",
	together: "Together AI",
	"vercel-ai-gateway": "Vercel AI Gateway",
	xai: "xAI",
	zai: "ZAI",
	xiaomi: "Xiaomi MiMo",
	"xiaomi-token-plan-cn": "Xiaomi MiMo Token Plan (China)",
	"xiaomi-token-plan-ams": "Xiaomi MiMo Token Plan (Amsterdam)",
	"xiaomi-token-plan-sgp": "Xiaomi MiMo Token Plan (Singapore)",
};

function getDisplayName(provider: string): string {
	return DISPLAY_NAMES[provider] ?? provider;
}

// ---------------------------------------------------------------------------
// Auth storage helper — reads/writes auth.json directly
// ---------------------------------------------------------------------------

function getAuthPath(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = envDir || join(homedir(), ".pi", "agent");
	return join(agentDir, "auth.json");
}

interface AuthFileData {
	[provider: string]: { type: "api_key"; key: string } | ({ type: "oauth" } & Record<string, unknown>);
}

function readAuthFile(): AuthFileData {
	try {
		const p = getAuthPath();
		if (existsSync(p)) {
			return JSON.parse(readFileSync(p, "utf-8"));
		}
	} catch {
		// File may not exist yet
	}
	return {};
}

function writeAuthFile(data: AuthFileData): void {
	const p = getAuthPath();
	const d = dirname(p);
	if (!existsSync(d)) {
		mkdirSync(d, { recursive: true });
	}
	writeFileSync(p, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAuthRoutes(fastify: FastifyInstance): void {
	/**
	 * GET /api/auth — List all providers with their auth status
	 */
	fastify.get("/api/auth", async (_request, reply) => {
		try {
			const authData = readAuthFile();
			const providers = getProviders();
			const result: ProviderAuthInfo[] = providers.map((provider) => {
				const cred = authData[provider];
				return {
					provider,
					name: getDisplayName(provider),
					configured: cred?.type === "api_key" && !!cred.key,
					source: cred?.type === "api_key" ? "stored" : undefined,
				};
			});

			return { providers: result };
		} catch (error) {
			fastify.log.error({ error }, "Failed to list auth providers");
			return reply.code(500).send({ error: "Failed to list providers" });
		}
	});

	/**
	 * PUT /api/auth/:provider — Save an API key for a provider
	 */
	fastify.put<{
		Params: { provider: string };
		Body: SaveApiKeyRequest;
	}>("/api/auth/:provider", async (request, reply) => {
		try {
			const { provider } = request.params;
			const { apiKey } = request.body;

			if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
				return reply.code(400).send({ error: "apiKey is required" });
			}

			const authData = readAuthFile();
			authData[provider] = { type: "api_key", key: apiKey.trim() };
			writeAuthFile(authData);

			return { success: true };
		} catch (error) {
			fastify.log.error({ error }, "Failed to save API key");
			return reply.code(500).send({ error: "Failed to save API key" });
		}
	});

	/**
	 * DELETE /api/auth/:provider — Remove stored credentials for a provider
	 */
	fastify.delete<{
		Params: { provider: string };
	}>("/api/auth/:provider", async (request, reply) => {
		try {
			const { provider } = request.params;
			const authData = readAuthFile();
			delete authData[provider];
			writeAuthFile(authData);

			return { success: true };
		} catch (error) {
			fastify.log.error({ error }, "Failed to remove credentials");
			return reply.code(500).send({ error: "Failed to remove credentials" });
		}
	});
}
