/**
 * ToolAdapter
 *
 * Bridges loaded extension tools into agent-compatible tool definitions.
 * Extension tool execution is wrapped with sandbox isolation (via vm) and
 * error handling so tool failures do not stop the workspace execution plan.
 *
 * Acceptance criteria:
 * 1. Installed extension appears in agent tool list
 * 2. When agent calls extension tool, it runs in sandbox
 * 3. Failed extension tool call does not stop the plan
 * 4. WorkspaceAgentExecutor works with extension tools
 */

import vm from "node:vm";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { Extension, ToolDefinition } from "../core/extensions/types.js";

// ============================================================================
// Types
// ============================================================================

/** Options for creating a ToolAdapter. */
export interface ToolAdapterOptions {
	/**
	 * Loaded extensions whose registered tools should be adapted.
	 */
	extensions: Extension[];

	/**
	 * Whether to sandbox tool execution.
	 * When true, the original tool execute function is called inside a
	 * vm.createContext() sandbox where require, process, and other
	 * dangerous globals are blocked.
	 * Default: true.
	 */
	sandbox?: boolean;
}

/** Result of adapting extension tools. */
export interface ToolAdapterResult {
	/**
	 * Adapted tool definitions suitable for passing to createAgentSession
	 * or AgentSession as customTools.
	 */
	toolDefinitions: ToolDefinition[];

	/**
	 * Tool names that should be added to the agent's allowed tool list
	 * so they are not filtered out.
	 */
	toolNames: string[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Create an error tool result with the given error message. */
function createErrorToolResult(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
	};
}

// ============================================================================
// VM Sandbox Execution
// ============================================================================

/** Shared safe sandbox context with basic JavaScript built-ins but no dangerous globals. */
function createSandboxContext(params: unknown): Record<string, unknown> {
	return {
		// Blocked dangerous globals
		require: undefined,
		process: undefined,
		__dirname: undefined,
		__filename: undefined,
		global: undefined,
		globalThis: undefined,
		setTimeout: undefined,
		setInterval: undefined,
		clearTimeout: undefined,
		clearInterval: undefined,
		setImmediate: undefined,
		clearImmediate: undefined,
		Function: undefined,
		Proxy: undefined,

		// Safe built-ins
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
		console: {
			log: (...args: unknown[]) => {
				console.log("[sandbox]", ...args);
			},
			error: (...args: unknown[]) => {
				console.error("[sandbox]", ...args);
			},
			warn: (...args: unknown[]) => {
				console.warn("[sandbox]", ...args);
			},
		},

		// Input data
		__params__: params,
	};
}

/**
 * Execute a tool execute function source inside a vm sandbox.
 *
 * The sandbox blocks require, process, setTimeout, Function constructor,
 * and other dangerous globals while allowing safe JavaScript built-ins.
 *
 * The execute function is serialized to a string and evaluated inside the
 * sandbox context. The params are passed as a `__params__` variable in the
 * sandbox context.
 */
async function executeInVMSandbox(
	executeFn: ToolDefinition["execute"],
	toolCallId: string,
	params: unknown,
): Promise<{ success: true; output: AgentToolResult<unknown> } | { success: false; error: string }> {
	const fnSource = executeFn.toString();

	const escapedToolCallId = toolCallId.replace(/"/g, '\\"');
	const serializedParams = JSON.stringify(params);

	// The tool execute function may reference global symbols that exist in the
	// sandbox context (Array, Object, JSON, etc.) or import references that
	// will be undefined. The try/catch handles any ReferenceError from missing
	// imports or globals.
	const code = `
		(async function() {
			const toolFn = ${fnSource};
			try {
				const params = JSON.parse('${serializedParams}');
				const result = await toolFn("${escapedToolCallId}", params, undefined, undefined, {});
				return JSON.stringify({ success: true, output: result });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return JSON.stringify({ success: false, error: msg });
			}
		})()
	`;

	try {
		const context = createSandboxContext(params);

		// Run the script - the returned value is the result of the async IIFE (a Promise)
		const script = new vm.Script(code);

		// runInContext returns the result of the last expression, which is the Promise
		// from the async IIFE. We need to await it.
		const promiseResult = script.runInContext(vm.createContext(context), {
			breakOnSigint: true,
		}) as Promise<string>;

		const resultStr = await promiseResult;
		const result = JSON.parse(resultStr) as
			| { success: true; output: AgentToolResult<unknown> }
			| { success: false; error: string };

		if (result.success) {
			return { success: true, output: result.output };
		}
		return { success: false, error: result.error };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { success: false, error: errorMessage };
	}
}

// ============================================================================
// ToolAdapter
// ============================================================================

/**
 * Adapts extension tools for agent execution with sandbox isolation.
 *
 * @example
 * ```typescript
 * // Load extensions and adapt their tools
 * const extensionsResult = resourceLoader.getExtensions();
 * const adapter = new ToolAdapter({
 *   extensions: extensionsResult.extensions,
 * });
 * const result = adapter.adaptAllTools();
 *
 * // Pass to createAgentSession
 * const { session } = await createAgentSession({
 *   tools: [...defaultTools, ...result.toolNames],
 *   customTools: result.toolDefinitions,
 * });
 * ```
 */
export class ToolAdapter {
	private extensions: Extension[];
	private sandbox: boolean;

	constructor(options: ToolAdapterOptions) {
		this.extensions = options.extensions;
		this.sandbox = options.sandbox ?? true;
	}

	/**
	 * Get all extension tools adapted as ToolDefinition[] with their names.
	 *
	 * Each tool's execute function is wrapped:
	 * - Runs in vm sandbox when sandbox mode is enabled
	 * - Catches errors and returns them as error results
	 * - Console output from sandbox is logged with [sandbox] prefix
	 */
	adaptAllTools(): ToolAdapterResult {
		const toolDefinitions: ToolDefinition[] = [];
		const toolNames: string[] = [];

		for (const extension of this.extensions) {
			for (const [toolName, registeredTool] of extension.tools) {
				const originalDefinition = registeredTool.definition;
				toolNames.push(toolName);

				const adaptedDefinition: ToolDefinition = {
					name: originalDefinition.name,
					label: originalDefinition.label,
					description: originalDefinition.description,
					parameters: originalDefinition.parameters,
					promptSnippet: originalDefinition.promptSnippet,
					promptGuidelines: originalDefinition.promptGuidelines,
					renderShell: originalDefinition.renderShell,
					executionMode: originalDefinition.executionMode,
					prepareArguments: originalDefinition.prepareArguments,

					execute: async (
						toolCallId: string,
						params: unknown,
						signal: AbortSignal | undefined,
						onUpdate: AgentToolUpdateCallback<unknown> | undefined,
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
						_ctx: unknown,
					): Promise<AgentToolResult<unknown>> => {
						return this.executeToolSafely(originalDefinition, toolCallId, params, signal, onUpdate);
					},

					renderCall: originalDefinition.renderCall,
					renderResult: originalDefinition.renderResult,
				};

				toolDefinitions.push(adaptedDefinition);
			}
		}

		return { toolDefinitions, toolNames };
	}

	/**
	 * Execute an extension tool with error handling and optional sandbox isolation.
	 *
	 * The execution is wrapped so that any errors are caught and returned as
	 * error tool results, preventing plan crashes from tool failures.
	 *
	 * In sandbox mode, the tool's execute function runs inside a vm.createContext()
	 * sandbox where require, process, setTimeout, Function constructor, and Proxy
	 * are blocked.
	 */
	private async executeToolSafely(
		definition: ToolDefinition,
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
	): Promise<AgentToolResult<unknown>> {
		try {
			if (this.sandbox) {
				const vmResult = await executeInVMSandbox(definition.execute, toolCallId, params);

				if (vmResult.success) {
					return vmResult.output;
				}

				console.error(`[tool-adapter] Sandbox execution failed for tool "${definition.name}": ${vmResult.error}`);
				return createErrorToolResult(vmResult.error);
			}

			// Non-sandbox mode: run directly (but still catch errors)
			const output = await definition.execute(toolCallId, params, signal, onUpdate, {} as any);
			return output;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[tool-adapter] Tool "${definition.name}" execution failed: ${errorMessage}`);
			return createErrorToolResult(errorMessage);
		}
	}
}

/**
 * Convenience function to adapt extension tools for agent execution.
 *
 * @param extensions - Loaded extensions
 * @param options - Optional adapter overrides
 * @returns Adapted tool definitions and names
 */
export function adaptExtensionTools(extensions: Extension[], options?: { sandbox?: boolean }): ToolAdapterResult {
	const adapter = new ToolAdapter({
		extensions,
		...options,
	});
	return adapter.adaptAllTools();
}
