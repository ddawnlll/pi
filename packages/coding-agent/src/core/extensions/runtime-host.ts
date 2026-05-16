/**
 * RuntimeHost - wraps ExtensionRunner and ExtensionRegistry to provide a
 * safe, auditable, observable runtime for extensions.
 *
 * Responsibilities:
 * - Owns the ExtensionRunner and ExtensionRegistry
 * - Emits health events (startup, shutdown, degraded, error)
 * - Emits audit events (state transitions, configuration changes)
 * - Forwards error events from extensions with context
 * - Ensures extension hooks cannot bypass executor-mediated state changes
 * - Provides a safe lifecycle: register -> enable (load) -> disable -> unregister
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { type EventBus, createEventBus } from "../event-bus.js";

import type { BuildSystemPromptOptions } from "../system-prompt.js";
import { type ExtensionRunner, emitSessionShutdownEvent } from "./runner.js";
import { ExtensionRegistry } from "./registry.js";
import type {
	AuditEvent,
	Extension,
	ExtensionActions,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionPackage,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	HealthEvent,
	HealthStatus,
	InputEventResult,
	InputSource,
	MessageEndEvent,
	MessageRenderer,
	ProviderConfig,
	RegisteredTool,
	ResourcesDiscoverEvent,
	RuntimeHostEvent,
	RuntimeHostListener,
	SessionShutdownEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
} from "./types.js";

/** Options for RuntimeHost construction. */
export interface RuntimeHostOptions {
	/** Event bus for cross-extension communication. */
	eventBus?: EventBus;
	/** Current working directory. */
	cwd?: string;
	/** Agent directory for extension discovery. */
	agentDir?: string;
}

/**
 * Safe wrapper that proxies an ExtensionRunner while ensuring all state
 * transitions go through executor-mediated paths and events get audited.
 */
export class RuntimeHost {
	private runner: ExtensionRunner;
	private registry: ExtensionRegistry;
	private eventBus: EventBus;
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly healthListeners = new Set<RuntimeHostListener>();
	private readonly auditListeners = new Set<RuntimeHostListener>();
	private startupTime: number = 0;
	private healthStatus: HealthStatus = "healthy";
	private _shutdownInitiated = false;

	constructor(
		runner: ExtensionRunner,
		registry: ExtensionRegistry,
		options: RuntimeHostOptions = {},
	) {
		this.runner = runner;
		this.registry = registry;
		this.eventBus = options.eventBus ?? createEventBus();
		this.cwd = options.cwd ?? process.cwd();
		this.agentDir = options.agentDir ?? "";
	}

	// ========================================================================
	// Lifecycle
	// ========================================================================

	/**
	 * Start the runtime host.
	 * Emits a startup health event and transitions to healthy status.
	 */
	start(): void {
		this.startupTime = Date.now();
		this.healthStatus = "healthy";
		this.emitHealth("healthy", "Runtime host started");
		this.emitAudit("runtime.start", undefined, { startupTime: this.startupTime });

		// Wire extension error forwarding
		this.runner.onError((error: ExtensionError) => {
			this.emitHealth("error", `Extension error: ${error.error}`, {
				extensionPath: error.extensionPath,
				event: error.event,
				stack: error.stack,
			});
			this.emitAudit("extension.error", error.extensionPath, {
				event: error.event,
				error: error.error,
			});
		});
	}

	/**
	 * Initiate a graceful shutdown.
	 * Emits a shutdown health event.
	 */
	async shutdown(reason: string = "user_initiated"): Promise<void> {
		if (this._shutdownInitiated) return;
		this._shutdownInitiated = true;

		this.emitHealth("healthy", `Shutdown initiated: ${reason}`);
		this.emitAudit("runtime.shutdown", undefined, { reason });

		// Emit session_shutdown to all loaded extensions
		const shutdownEvent: SessionShutdownEvent = {
			type: "session_shutdown",
			reason: "quit",
		};
		await emitSessionShutdownEvent(this.runner, shutdownEvent);
	}

	/**
	 * Whether shutdown has been initiated.
	 */
	get shutdownInitiated(): boolean {
		return this._shutdownInitiated;
	}

	// ========================================================================
	// Registry Operations (lifecycle with audit & health)
	// ========================================================================

	/**
	 * Register an extension package from a directory.
	 * Audits the registration.
	 */
	registerFromDirectory(
		dir: string,
	): ReturnType<ExtensionRegistry["registerFromDirectory"]> {
		const result = this.registry.registerFromDirectory(dir);
		if (result.error) {
			this.emitHealth("degraded", `Extension registration failed: ${result.error}`, {
				directory: dir,
			});
			this.emitAudit("extension.register.failed", undefined, {
				directory: dir,
				error: result.error,
			});
		} else {
			this.emitAudit("extension.register", result.package.manifest.name, {
				version: result.package.manifest.version,
				directory: dir,
			});
		}
		return result;
	}

	/**
	 * Register an inline extension factory.
	 * Audits the registration.
	 */
	registerInline(
		name: string,
		version: string,
		factory: (api: import("./types.js").ExtensionAPI) => void | Promise<void>,
	): ReturnType<ExtensionRegistry["registerInline"]> {
		const result = this.registry.registerInline(name, version, factory);
		if (result.error) {
			this.emitHealth("degraded", `Inline extension registration failed: ${result.error}`, {
				name,
			});
			this.emitAudit("extension.register.failed", name, { error: result.error });
		} else {
			this.emitAudit("extension.register", name, { version, source: "inline" });
		}
		return result;
	}

	/**
	 * Enable a registered extension package.
	 * Transitions from registered/disabled -> loaded.
	 * Audits and emits health events.
	 */
	async enable(
		name: string,
	): Promise<{ success: true; extension: Extension } | { success: false; error: string }> {
		this.emitAudit("extension.enabling", name);
		const result = await this.registry.enable(name);

		if (result.success) {
			this.emitHealth("healthy", `Extension enabled: ${name}`);
			this.emitAudit("extension.enabled", name, {
				tools: result.extension.tools.size,
				commands: result.extension.commands.size,
				handlers: Array.from(result.extension.handlers.keys()),
			});
		} else {
			this.emitHealth("degraded", `Failed to enable extension '${name}': ${result.error}`);
			this.emitAudit("extension.enable.failed", name, { error: result.error });
		}

		return result;
	}

	/**
	 * Disable a loaded extension.
	 * Transitions from loaded -> disabled.
	 * Audits and emits health events.
	 */
	async disable(
		name: string,
	): Promise<{ success: true } | { success: false; error: string }> {
		this.emitAudit("extension.disabling", name);
		const result = await this.registry.disable(name);

		if (result.success) {
			this.emitHealth("healthy", `Extension disabled: ${name}`);
			this.emitAudit("extension.disabled", name);
		} else {
			this.emitHealth("degraded", `Failed to disable extension '${name}': ${result.error}`);
			this.emitAudit("extension.disable.failed", name, { error: result.error });
		}

		return result;
	}

	/**
	 * Unregister an extension package.
	 * Disables first if loaded, then removes entirely.
	 * Audits and emits health events.
	 */
	async unregister(
		name: string,
	): Promise<{ success: true } | { success: false; error: string }> {
		this.emitAudit("extension.unregistering", name);
		const result = await this.registry.unregister(name);

		if (result.success) {
			this.emitHealth("healthy", `Extension unregistered: ${name}`);
			this.emitAudit("extension.unregistered", name);
		} else {
			this.emitHealth("degraded", `Failed to unregister extension '${name}': ${result.error}`);
			this.emitAudit("extension.unregister.failed", name, { error: result.error });
		}

		return result;
	}

	/**
	 * Get a registered package by name.
	 */
	getPackage(name: string): ExtensionPackage | undefined {
		return this.registry.getPackage(name);
	}

	/**
	 * Get all registered packages.
	 */
	getAllPackages(): ExtensionPackage[] {
		return this.registry.getAllPackages();
	}

	/**
	 * Get loaded extensions (from enabled packages).
	 */
	getLoadedExtensions(): Extension[] {
		return this.registry.getLoadedExtensions();
	}

	// ========================================================================
	// Runner Proxies (with audit where appropriate)
	// ========================================================================

	/**
	 * Proxy APIs that safely delegate to the runner.
	 */

	getRunner(): ExtensionRunner {
		return this.runner;
	}

	getRegistry(): ExtensionRegistry {
		return this.registry;
	}

	getAllRegisteredTools(): RegisteredTool[] {
		return this.runner.getAllRegisteredTools();
	}

	getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
		return this.runner.getToolDefinition(toolName);
	}

	getShortcuts(
		resolvedKeybindings: import("../keybindings.js").KeybindingsConfig,
	): Map<import("@earendil-works/pi-tui").KeyId, ExtensionShortcut> {
		return this.runner.getShortcuts(resolvedKeybindings);
	}

	getShortcutDiagnostics(): import("../diagnostics.js").ResourceDiagnostic[] {
		return this.runner.getShortcutDiagnostics();
	}

	getRegisteredCommands(): import("./types.js").ResolvedCommand[] {
		return this.runner.getRegisteredCommands();
	}

	getCommandDiagnostics(): import("../diagnostics.js").ResourceDiagnostic[] {
		return this.runner.getCommandDiagnostics();
	}

	getCommand(name: string): import("./types.js").ResolvedCommand | undefined {
		return this.runner.getCommand(name);
	}

	getFlags(): Map<string, import("./types.js").ExtensionFlag> {
		return this.runner.getFlags();
	}

	setFlagValue(name: string, value: boolean | string): void {
		this.runner.setFlagValue(name, value);
	}

	getFlagValues(): Map<string, boolean | string> {
		return this.runner.getFlagValues();
	}

	getMessageRenderer(customType: string): MessageRenderer | undefined {
		return this.runner.getMessageRenderer(customType);
	}

	hasHandlers(eventType: string): boolean {
		return this.runner.hasHandlers(eventType);
	}

	/**
	 * bindCore is executor-mediated: it sets up the runtime with context actions.
	 * Use this to wire the host to your app's action implementations.
	 */
	bindCore(
		actions: ExtensionActions,
		contextActions: ExtensionContextActions,
		providerActions?: {
			registerProvider?: (name: string, config: ProviderConfig) => void;
			unregisterProvider?: (name: string) => void;
		},
	): void {
		this.runner.bindCore(actions, contextActions, providerActions);

		// Share the runtime with the registry
		this.registry.setRuntime(this.runner["runtime"]);

		this.emitAudit("runtime.bindCore");
	}

	bindCommandContext(actions?: ExtensionCommandContextActions): void {
		this.runner.bindCommandContext(actions);
	}

	setUIContext(uiContext: ExtensionUIContext): void {
		this.runner.setUIContext(uiContext);
	}

	getUIContext(): ExtensionUIContext {
		return this.runner.getUIContext();
	}

	hasUI(): boolean {
		return this.runner.hasUI();
	}

	getExtensionPaths(): string[] {
		return this.runner.getExtensionPaths();
	}

	createContext(): ExtensionContext {
		return this.runner.createContext();
	}

	createCommandContext(): import("./types.js").ExtensionCommandContext {
		return this.runner.createCommandContext();
	}

	/**
	 * Mark the runtime as stale after session replacement.
	 */
	invalidate(message?: string): void {
		this.runner.invalidate(message);
	}

	// ========================================================================
	// Event Emitters (forwarded to runner, but with error wrapping)
	// ========================================================================

	async emit(event: import("./types.js").ExtensionEvent): Promise<unknown> {
		return this.runner.emit(event as never);
	}

	async emitMessageEnd(event: MessageEndEvent): Promise<import("@earendil-works/pi-agent-core").AgentMessage | undefined> {
		return this.runner.emitMessageEnd(event);
	}

	async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		return this.runner.emitToolResult(event);
	}

	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		return this.runner.emitToolCall(event);
	}

	async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
		return this.runner.emitUserBash(event);
	}

	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		return this.runner.emitContext(messages);
	}

	async emitBeforeProviderRequest(payload: unknown): Promise<unknown> {
		return this.runner.emitBeforeProviderRequest(payload);
	}

	async emitBeforeAgentStart(
		prompt: string,
		images: ImageContent[] | undefined,
		systemPrompt: string,
		systemPromptOptions: BuildSystemPromptOptions,
	): Promise<unknown> {
		return this.runner.emitBeforeAgentStart(prompt, images, systemPrompt, systemPromptOptions);
	}

	async emitResourcesDiscover(
		cwd: string,
		reason: ResourcesDiscoverEvent["reason"],
	): Promise<{
		skillPaths: Array<{ path: string; extensionPath: string }>;
		promptPaths: Array<{ path: string; extensionPath: string }>;
		themePaths: Array<{ path: string; extensionPath: string }>;
	}> {
		return this.runner.emitResourcesDiscover(cwd, reason);
	}

	async emitInput(
		text: string,
		images: ImageContent[] | undefined,
		source: InputSource,
	): Promise<InputEventResult> {
		return this.runner.emitInput(text, images, source);
	}

	// ========================================================================
	// Health & Audit Events
	// ========================================================================

	/**
	 * Subscribe to health and audit events.
	 * Returns an unsubscribe function.
	 */
	onEvent(listener: RuntimeHostListener): () => void {
		this.healthListeners.add(listener);
		this.auditListeners.add(listener);
		return () => {
			this.healthListeners.delete(listener);
			this.auditListeners.delete(listener);
		};
	}

	/**
	 * Subscribe to health events only.
	 */
	onHealth(listener: (event: HealthEvent) => void): () => void {
		this.healthListeners.add(listener as RuntimeHostListener);
		return () => this.healthListeners.delete(listener as RuntimeHostListener);
	}

	/**
	 * Subscribe to audit events only.
	 */
	onAudit(listener: (event: AuditEvent) => void): () => void {
		this.auditListeners.add(listener as RuntimeHostListener);
		return () => this.auditListeners.delete(listener as RuntimeHostListener);
	}

	/**
	 * Get the current health status.
	 */
	getHealth(): { status: HealthStatus; uptime: number; startupTime: number } {
		return {
			status: this.healthStatus,
			uptime: this.startupTime > 0 ? Date.now() - this.startupTime : 0,
			startupTime: this.startupTime,
		};
	}

	/**
	 * Manually set health status (used by executor for degraded states).
	 */
	setHealth(status: HealthStatus, message: string, details?: Record<string, unknown>): void {
		this.healthStatus = status;
		this.emitHealth(status, message, details);
	}

	private emitHealth(
		status: HealthStatus,
		message: string,
		details?: Record<string, unknown>,
	): void {
		const event: HealthEvent = {
			type: "health",
			status,
			message,
			timestamp: Date.now(),
			details,
		};
		this.healthStatus = status;
		for (const listener of this.healthListeners) {
			try {
				listener(event);
			} catch {
				// silence listener errors
			}
		}
	}

	private emitAudit(
		action: string,
		packageName?: string,
		details?: Record<string, unknown>,
	): void {
		const event: AuditEvent = {
			type: "audit",
			action,
			packageName,
			timestamp: Date.now(),
			details,
		};
		for (const listener of this.auditListeners) {
			try {
				listener(event);
			} catch {
				// silence listener errors
			}
		}
	}
}
