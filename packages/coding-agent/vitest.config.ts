import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const codingAgentSrcDir = fileURLToPath(new URL("../coding-agent/src", import.meta.url));
const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const dbSrcIndex = fileURLToPath(new URL("../db/src/index.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));
const executionContractsSrcDir = fileURLToPath(new URL("../execution-contracts/src", import.meta.url));
const executionServiceSrcDir = fileURLToPath(new URL("../execution-service/src", import.meta.url));
const workerAdaptersSrcDir = fileURLToPath(new URL("../worker-adapters/src", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		pool: "forks",
		poolOptions: {
			forks: {
				execArgv: ["--max-old-space-size=4096"],
				maxForks: 2,
				singleFork: true,
			},
		},
		passWithNoTests: true,
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: [
			{ find: /^@earendil-works\/pi-ai$/, replacement: aiSrcIndex },
			{ find: /^@earendil-works\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@earendil-works\/pi-db$/, replacement: dbSrcIndex },
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@earendil-works\/pi-coding-agent$/, replacement: `${codingAgentSrcDir}/index.ts` },
			{ find: /^@earendil-works\/pi-coding-agent\/(.*)/, replacement: `${codingAgentSrcDir}/$1.ts` },
			{ find: /^@earendil-works\/pi-execution-contracts$/, replacement: `${executionContractsSrcDir}/index.ts` },
			{ find: /^@earendil-works\/pi-execution-contracts\/(.*)/, replacement: `${executionContractsSrcDir}/$1.ts` },
			{ find: /^@earendil-works\/pi-execution-service$/, replacement: `${executionServiceSrcDir}/index.ts` },
			{ find: /^@earendil-works\/pi-execution-service\/(.*)/, replacement: `${executionServiceSrcDir}/$1.ts` },
			{ find: /^@earendil-works\/pi-worker-adapters$/, replacement: `${workerAdaptersSrcDir}/index.ts` },
			{ find: /^@earendil-works\/pi-worker-adapters\/(.*)/, replacement: `${workerAdaptersSrcDir}/$1.ts` },
			{ find: /^@mariozechner\/pi-ai$/, replacement: aiSrcIndex },
			{ find: /^@mariozechner\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@mariozechner\/pi-agent-core$/, replacement: agentSrcIndex },
		],
	},
});
