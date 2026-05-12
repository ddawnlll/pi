import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: ".",
	plugins: [react(), tailwindcss()],
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
		exclude: ["@earendil-works/pi-agent", "@earendil-works/pi-ai"],
		esbuildOptions: {
			define: {
				global: "globalThis",
			},
		},
	},
	build: {
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, "index.html"),
			},
		},
		commonjsOptions: {
			transformMixedEsModules: true,
		},
	},
	server: {
		port: 5176,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:3000",
				changeOrigin: true,
				ws: true,
			},
		},
	},
});
