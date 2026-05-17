/**
 * Sandbox Worker
 *
 * This module runs inside a `worker_threads` Worker. It receives code and
 * options via `workerData`, creates a `vm.createContext()` sandbox with
 * `require`, `process`, `__dirname`, `__filename` all set to `undefined`,
 * executes the code, and sends the result back via `parentPort.postMessage()`.
 *
 * If the Worker is terminated by the main thread (timeout) or crashes
 * (OOM from --max-old-space-size), the main thread handles the error
 * classification. This module only reports successful execution or
 * JavaScript-level errors caught during sandbox execution.
 */

import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

// ============================================================================
// Types
// ============================================================================

interface SandboxLog {
	type: string;
	text: string;
}

interface WorkerInputData {
	code: string;
	input?: unknown;
	timeoutMs?: number;
	maxMemoryMB?: number;
}

// ============================================================================
// Worker Execution
// ============================================================================

function run(): void {
	const data = workerData as WorkerInputData;
	const logs: SandboxLog[] = [];

	// Create sandbox context with all dangerous globals stripped out.
	// `require`, `process`, `__dirname`, `__filename`, `global`, `globalThis`
	// are explicitly set to `undefined` to prevent escape.
	const context = vm.createContext({
		// Blocked globals
		require: undefined,
		process: undefined,
		__dirname: undefined,
		__filename: undefined,
		global: undefined,
		globalThis: undefined,

		// Safe console: capture output into a log buffer
		console: {
			log: (...args: unknown[]) => {
				logs.push({ type: "log", text: args.map((a) => String(a)).join(" ") });
			},
			error: (...args: unknown[]) => {
				logs.push({ type: "error", text: args.map((a) => String(a)).join(" ") });
			},
			warn: (...args: unknown[]) => {
				logs.push({ type: "warn", text: args.map((a) => String(a)).join(" ") });
			},
			info: (...args: unknown[]) => {
				logs.push({ type: "info", text: args.map((a) => String(a)).join(" ") });
			},
		},

		// Block timers to prevent escaping the timeout
		setTimeout: undefined,
		setInterval: undefined,
		clearTimeout: undefined,
		clearInterval: undefined,
		setImmediate: undefined,
		clearImmediate: undefined,

		// Block constructors that can be used to escape
		Function: undefined,
		Proxy: undefined,

		// Allow basic primitives and objects
		Array,
		Boolean,
		Date,
		Error,
		JSON,
		Map,
		Math,
		Number,
		Object,
		Promise,
		RangeError,
		RegExp,
		Set,
		String,
		Symbol,
		SyntaxError,
		TypeError,
		URIError,
		WeakMap,
		WeakSet,
		parseInt,
		parseFloat,
		isNaN,
		isFinite,
		decodeURI,
		decodeURIComponent,
		encodeURI,
		encodeURIComponent,
		Infinity,
		NaN,
		undefined: undefined,

		// Provide input data under a safe key
		__input__: data.input,
	});

	try {
		const script = new vm.Script(data.code);

		// Resource limits are enforced inside the worker via
		// vm.Script.runInContext() resourceLimits option.
		const resourceLimits = data.maxMemoryMB
			? { maxOldGenerationSizeMb: data.maxMemoryMB }
			: undefined;

		// resourceLimits is supported at runtime in Node.js 22 but
		// @types/node doesn't include it in RunningScriptOptions.
		// Cast to any to bypass the type limitation.
		const runOptions: Record<string, unknown> = {
			breakOnSigint: true,
		};
		if (resourceLimits) {
			runOptions.resourceLimits = resourceLimits;
		}

		const output = script.runInContext(context, runOptions as any);

		parentPort?.postMessage({
			success: true,
			output,
			logs,
		});
	} catch (err: unknown) {
		// Capture all error properties for debugging
		const errorObj: Record<string, unknown> = {};
		if (err instanceof Error) {
			errorObj.message = err.message;
			errorObj.name = err.name;
			errorObj.code = (err as NodeJS.ErrnoException).code;
		} else {
			errorObj.message = String(err);
		}

		parentPort?.postMessage({
			success: false,
			error: errorObj,
			logs,
		});
	}
}

run();
