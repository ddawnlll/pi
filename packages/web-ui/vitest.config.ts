import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@earendil-works/pi-ai": path.resolve(__dirname, "../ai/src/index.ts"),
			"@earendil-works/pi-agent-core": path.resolve(__dirname, "../agent/src/index.ts"),
			"@mariozechner/mini-lit": path.resolve(__dirname, "../../node_modules/@mariozechner/mini-lit/dist/index.js"),
			"@mariozechner/mini-lit/dist": path.resolve(__dirname, "../../node_modules/@mariozechner/mini-lit/dist"),
		},
	},
	test: {
		environment: "node",
		globals: true,
		include: ["test/**/*.test.{ts,js}"],
	},
});
