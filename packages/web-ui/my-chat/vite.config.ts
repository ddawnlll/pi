import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [tailwindcss()],
	define: {
		"process.platform": JSON.stringify("browser"),
		"process.env": "{}",
	},
	resolve: {
		alias: {
			// Stub out Node.js modules that shouldn't be in browser
			"node:child_process": path.resolve(__dirname, "./src/stubs/child_process.ts"),
			"node:fs": path.resolve(__dirname, "./src/stubs/fs.ts"),
			"node:fs/promises": path.resolve(__dirname, "./src/stubs/fs-promises.ts"),
			"node:os": path.resolve(__dirname, "./src/stubs/os.ts"),
			"node:path": path.resolve(__dirname, "./src/stubs/path.ts"),
			"node:crypto": path.resolve(__dirname, "./src/stubs/crypto.ts"),
		},
	},
	optimizeDeps: {
		exclude: ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
		esbuildOptions: {
			define: {
				global: "globalThis",
			},
		},
	},
	build: {
		commonjsOptions: {
			transformMixedEsModules: true,
		},
	},
});
