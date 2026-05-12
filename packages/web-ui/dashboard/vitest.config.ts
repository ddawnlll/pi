import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"node:child_process": path.resolve(__dirname, "./src/stubs/child_process.ts"),
			"node:fs": path.resolve(__dirname, "./src/stubs/fs.ts"),
			"node:fs/promises": path.resolve(__dirname, "./src/stubs/fs-promises.ts"),
			"node:os": path.resolve(__dirname, "./src/stubs/os.ts"),
			"node:path": path.resolve(__dirname, "./src/stubs/path.ts"),
			"node:crypto": path.resolve(__dirname, "./src/stubs/crypto.ts"),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: [path.resolve(__dirname, "./test/setup.ts")],
		include: ["test/**/*.test.{ts,tsx}"],
	},
});
