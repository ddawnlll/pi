import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, "../../../.logs");
const LOG_FILE = path.join(LOG_DIR, "dashboard.log");

/** Ensure the log directory exists */
function ensureLogDir(): void {
	if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** Append a timestamped line to dashboard.log */
function logToFile(msg: string): void {
	try {
		ensureLogDir();
		const ts = new Date().toISOString();
		fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
	} catch { /* ignore write failures */ }
}

/**
 * Vite plugin: log every incoming HTTP request to .logs/dashboard.log.
 * Covers page loads, asset fetches, API proxy calls, and websocket upgrades.
 */
function requestLoggerPlugin(): Plugin {
	return {
		name: "pi-request-logger",
		configureServer(server: ViteDevServer) {
			logToFile("[request-logger] Plugin initialized — logging all requests to " + LOG_FILE);

			// Handle /__log endpoint for client-side log relay
			server.middlewares.use((req, res, next) => {
				if (req.url === "/__log" && req.method === "POST") {
					let body = "";
					req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
					req.on("end", () => {
						try {
							const { level, msg } = JSON.parse(body);
							logToFile(`[client:${level}] ${msg}`);
						} catch { /* ignore malformed */ }
						res.statusCode = 204;
						res.end();
					});
					return;
				}
				next();
			});

			// Log all other requests
			server.middlewares.use((req, res, next) => {
				// Skip the __log endpoint to avoid noise
				if (req.url === "/__log") { next(); return; }

				const start = Date.now();
				const method = req.method ?? "?";
				const url = req.url ?? "/?";

				logToFile(`-> ${method} ${url}`);

				res.on("finish", () => {
					const ms = Date.now() - start;
					logToFile(`<- ${method} ${url} [${res.statusCode}] ${ms}ms`);
				});

				next();
			});
		},
	};
}

/**
 * Vite plugin: inject client-side debug logging into the app entry point.
 * Patches main.tsx at transform time so every React mount, query, and
 * error gets logged to the browser console AND sent to a /__log endpoint
 * that appends to .logs/dashboard.log.
 */
function clientDebugPlugin(): Plugin {
	return {
		name: "pi-client-debug",
		transformIndexHtml(html) {
			// Inject a debug script BEFORE the main module so it runs first
			const debugScript = `
<script>
(function() {
	const _origFetch = window.fetch;
	const _origConsole = {};
	['log','warn','error','info'].forEach(lvl => { _origConsole[lvl] = console[lvl]; });

	function sendLog(level, args) {
		try {
			const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
			navigator.sendBeacon('/__log', JSON.stringify({ level, msg, ts: Date.now() }));
		} catch(e) {}
	}

	// Intercept console methods to mirror to server log
	['log','warn','error','info'].forEach(lvl => {
		console[lvl] = function(...args) {
			_origConsole[lvl].apply(console, args);
			sendLog(lvl, args);
		};
	});

	// Intercept fetch to log all API calls
	window.fetch = function(...args) {
		const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '?';
		const opts = args[1] || {};
		const method = opts.method || 'GET';
		_origConsole.log('[fetch] ->', method, url);
		const start = Date.now();
		return _origFetch.apply(this, args).then(res => {
			const ms = Date.now() - start;
			_origConsole.log('[fetch] <-', method, url, res.status, ms + 'ms');
			if (!res.ok) _origConsole.error('[fetch] FAIL', method, url, res.status, res.statusText);
			return res;
		}).catch(err => {
			const ms = Date.now() - start;
			_origConsole.error('[fetch] ERR', method, url, err.message, ms + 'ms');
			throw err;
		});
	};

	// Log unhandled errors
	window.addEventListener('error', e => { _origConsole.error('[unhandled]', e.message, e.filename, e.lineno); });
	window.addEventListener('unhandledrejection', e => { _origConsole.error('[unhandled-rejection]', e.reason); });

	_origConsole.log('[pi-debug] Client debug logging initialized');
})();
</script>`;
			return html.replace("<head>", "<head>" + debugScript);
		},
	};
}

export default defineConfig({
	root: ".",
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
	plugins: [
		react(),
		tailwindcss(),
		requestLoggerPlugin(),
		clientDebugPlugin(),
	],
});
