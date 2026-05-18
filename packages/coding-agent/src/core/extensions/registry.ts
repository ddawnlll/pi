/**
 * Extension Registry - manages the full lifecycle of extension packages.
 *
 * The registry is responsible for:
 * - Registering packages with manifest validation
 * - Enabling (loading and activating) extensions
 * - Disabling (deactivating) extensions
 * - Unregistering (removing) packages
 * - Tracking lifecycle state per package
 * - Emitting lifecycle events for observability
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createEventBus, type EventBus } from "../event-bus.js";
import { createExtensionRuntime, loadExtensions } from "./loader.js";
import type {
	Extension,
	ExtensionFactory,
	ExtensionPackage,
	ExtensionPackageManifest,
	ExtensionRuntime,
	RegistryEvent,
	RegistryEventListener,
	RegistryEventType,
} from "./types.js";
import { getPiVersion, isPiVersionCompatible, validateManifest } from "./validate.js";

/**
 * Resolve and read the pi subsection from a package.json or extension.json.
 * Returns the raw manifest object or null.
 */
function readPiManifestFromFile(manifestPath: string): Record<string, unknown> | null {
	try {
		const content = fs.readFileSync(manifestPath, "utf-8");
		const pkg = JSON.parse(content);

		// Check for pi field in package.json
		if (pkg.pi && typeof pkg.pi === "object") {
			return pkg.pi as Record<string, unknown>;
		}

		// Standalone extension.json with top-level fields
		if (pkg.name && pkg.version) {
			return pkg as Record<string, unknown>;
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Find the manifest file for a package directory.
 * Checks for package.json (with pi field) or extension.json.
 */
function findManifest(dir: string): { manifestPath: string; raw: Record<string, unknown> } | null {
	// Check package.json first
	const pkgJsonPath = path.join(dir, "package.json");
	if (fs.existsSync(pkgJsonPath)) {
		const raw = readPiManifestFromFile(pkgJsonPath);
		if (raw) {
			return { manifestPath: pkgJsonPath, raw };
		}
	}

	// Check extension.json
	const extJsonPath = path.join(dir, "extension.json");
	if (fs.existsSync(extJsonPath)) {
		const raw = readPiManifestFromFile(extJsonPath);
		if (raw) {
			return { manifestPath: extJsonPath, raw };
		}
	}

	return null;
}

/**
 * Options for the ExtensionRegistry constructor.
 */
export interface ExtensionRegistryOptions {
	/** Cached factory functions for inline extensions (keyed by name). */
	inlineFactories?: Map<string, ExtensionFactory>;
	/** Event bus for cross-extension communication. */
	eventBus?: EventBus;
	/** Current working directory for path resolution. */
	cwd?: string;
	/** Agent directory for extension resolution. */
	agentDir?: string;
}

/**
 * Extension Registry
 *
 * Manages extension packages through their full lifecycle:
 * registered -> enabling -> loaded -> disabling -> disabled
 */
export class ExtensionRegistry {
	private packages = new Map<string, ExtensionPackage>();
	private readonly inlineFactories: Map<string, ExtensionFactory>;
	private readonly eventBus: EventBus;
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly listeners = new Set<RegistryEventListener>();

	// Reference to the shared runtime, set after bind
	private runtime: ExtensionRuntime | null = null;

	constructor(options: ExtensionRegistryOptions = {}) {
		this.inlineFactories = options.inlineFactories ?? new Map();
		this.eventBus = options.eventBus ?? createEventBus();
		this.cwd = options.cwd ?? process.cwd();
		this.agentDir = options.agentDir ?? "";
	}

	/**
	 * Subscribe to registry lifecycle events.
	 * Returns an unsubscribe function.
	 */
	onEvent(listener: RegistryEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Emit a registry event to all listeners. */
	private emitEvent(type: RegistryEventType, packageName: string, error?: string): void {
		const event: RegistryEvent = { type, packageName, timestamp: Date.now(), error };
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Silently ignore listener errors to prevent cascading failures
			}
		}
	}

	/**
	 * Register an extension package from a directory.
	 *
	 * Validates the manifest, checks pi version compatibility, and adds the
	 * package to the registry in the "registered" state.
	 *
	 * Returns the registered package or an error.
	 */
	registerFromDirectory(
		dir: string,
	): { package: ExtensionPackage; error?: undefined } | { package?: undefined; error: string } {
		const resolvedDir = path.resolve(this.cwd, dir);

		if (!fs.existsSync(resolvedDir)) {
			return { error: `Directory not found: ${resolvedDir}` };
		}

		if (!fs.statSync(resolvedDir).isDirectory()) {
			return { error: `Not a directory: ${resolvedDir}` };
		}

		// Find manifest
		const found = findManifest(resolvedDir);
		if (!found) {
			return { error: `No package.json (with pi field) or extension.json found in ${resolvedDir}` };
		}

		// Validate manifest
		const validationError = validateManifest(found.raw);
		if (validationError) {
			return { error: `Invalid manifest in ${found.manifestPath}: ${validationError}` };
		}

		// Build typed manifest
		const rawEngines = found.raw.engines as Record<string, unknown> | undefined;
		const rawDeps = found.raw.dependencies as Record<string, unknown> | undefined;

		const manifest: ExtensionPackageManifest = {
			name: found.raw.name as string,
			version: found.raw.version as string,
			description: found.raw.description as string | undefined,
			author: found.raw.author as string | undefined,
			license: found.raw.license as string | undefined,
			engines: rawEngines
				? {
						pi: typeof rawEngines.pi === "string" ? rawEngines.pi : undefined,
					}
				: undefined,
			dependencies: rawDeps
				? Object.fromEntries(Object.entries(rawDeps).map(([k, v]) => [k, String(v)]))
				: undefined,
		};

		// Check for duplicate
		if (this.packages.has(manifest.name)) {
			return { error: `Package '${manifest.name}' is already registered` };
		}

		// Check pi version compatibility
		if (!isPiVersionCompatible(manifest.engines?.pi)) {
			return {
				error: `Package '${manifest.name}@${manifest.version}' requires pi version '${manifest.engines?.pi}' but current version is '${this.getPiVersionString()}'`,
			};
		}

		const pkg: ExtensionPackage = {
			manifest,
			directory: resolvedDir,
			manifestPath: found.manifestPath,
			state: "registered",
			extension: null,
		};

		this.packages.set(manifest.name, pkg);
		this.emitEvent("registered", manifest.name);

		return { package: pkg };
	}

	/**
	 * Register an inline extension from a factory function.
	 * Useful for testing and built-in extensions.
	 */
	registerInline(
		name: string,
		version: string,
		factory: ExtensionFactory,
	): { package: ExtensionPackage; error?: undefined } | { package?: undefined; error: string } {
		// Validate name
		if (!name || typeof name !== "string") {
			return { error: "Extension name must be a non-empty string" };
		}

		if (this.packages.has(name)) {
			return { error: `Package '${name}' is already registered` };
		}

		if (this.inlineFactories.has(name)) {
			return { error: `Inline factory for '${name}' is already registered` };
		}

		const manifest: ExtensionPackageManifest = {
			name,
			version,
			description: `Inline extension: ${name}`,
		};

		const pkg: ExtensionPackage = {
			manifest,
			directory: "<inline>",
			manifestPath: "<inline>",
			state: "registered",
			extension: null,
		};

		this.packages.set(name, pkg);
		this.inlineFactories.set(name, factory);
		this.emitEvent("registered", name);

		return { package: pkg };
	}

	/**
	 * Enable a registered extension package.
	 *
	 * Transitions the package from "registered" or "disabled" to "loaded".
	 * Validates dependencies are satisfied before loading.
	 */
	async enable(name: string): Promise<{ success: true; extension: Extension } | { success: false; error: string }> {
		const pkg = this.packages.get(name);
		if (!pkg) {
			return { success: false, error: `Package '${name}' is not registered` };
		}

		if (pkg.state === "loaded") {
			return { success: true, extension: pkg.extension! };
		}

		if (pkg.state === "enabling") {
			return { success: false, error: `Package '${name}' is already being enabled` };
		}

		if (pkg.state === "disabling") {
			return { success: false, error: `Package '${name}' is currently being disabled, wait for completion` };
		}

		// Validate dependencies are satisfied
		if (pkg.manifest.dependencies) {
			for (const [depName, depRange] of Object.entries(pkg.manifest.dependencies)) {
				const depPkg = this.packages.get(depName);
				if (!depPkg) {
					return {
						success: false,
						error: `Package '${name}' depends on '${depName}' which is not registered`,
					};
				}

				const { satisfies } = await import("./validate.js");
				if (!satisfies(depPkg.manifest.version, depRange)) {
					return {
						success: false,
						error: `Package '${name}' depends on '${depName}@${depRange}' but registered version is '${depPkg.manifest.version}'`,
					};
				}

				// Ensure dependency is enabled first
				if (depPkg.state !== "loaded") {
					// Don't create a circular loop via recursive enable; just reject
					if (depPkg.state === "registered" || depPkg.state === "disabled") {
						// Auto-enable dependency
						const depResult = await this.enable(depName);
						if (!depResult.success) {
							return {
								success: false,
								error: `Failed to enable dependency '${depName}': ${depResult.error}`,
							};
						}
					}
				}
			}
		}

		pkg.state = "enabling";
		this.emitEvent("enabled", name);

		try {
			const extension = await this.loadPackage(pkg);

			pkg.extension = extension;
			pkg.state = "loaded";
			pkg.error = undefined;
			this.emitEvent("loaded", name);

			return { success: true, extension };
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			pkg.state = "registered";
			pkg.error = errorMsg;
			this.emitEvent("error", name, errorMsg);
			return { success: false, error: `Failed to enable '${name}': ${errorMsg}` };
		}
	}

	/**
	 * Disable a loaded extension.
	 *
	 * Transitions the package from "loaded" to "disabled".
	 * The extension data is preserved but will not receive events.
	 */
	async disable(name: string): Promise<{ success: true } | { success: false; error: string }> {
		const pkg = this.packages.get(name);
		if (!pkg) {
			return { success: false, error: `Package '${name}' is not registered` };
		}

		if (pkg.state === "disabled" || pkg.state === "registered") {
			return { success: true }; // already disabled
		}

		if (pkg.state === "disabling") {
			return { success: false, error: `Package '${name}' is already being disabled` };
		}

		if (pkg.state === "enabling") {
			return { success: false, error: `Package '${name}' is currently being enabled, wait for completion` };
		}

		// Check if any other loaded extension depends on this one
		for (const [otherName, otherPkg] of this.packages) {
			if (otherPkg.state === "loaded" && otherPkg.manifest.dependencies) {
				if (otherPkg.manifest.dependencies[name]) {
					return {
						success: false,
						error: `Cannot disable '${name}': '${otherName}' depends on it`,
					};
				}
			}
		}

		pkg.state = "disabling";
		pkg.error = undefined;

		// Deactivate the extension: clean up event handlers, tools, etc.
		// The extension data stays for re-enable without re-loading
		pkg.state = "disabled";
		this.emitEvent("disabled", name);

		return { success: true };
	}

	/**
	 * Unregister a package from the registry.
	 *
	 * Disables it first if loaded, then removes it entirely.
	 */
	async unregister(name: string): Promise<{ success: true } | { success: false; error: string }> {
		const pkg = this.packages.get(name);
		if (!pkg) {
			return { success: false, error: `Package '${name}' is not registered` };
		}

		// Disable first if loaded
		if (pkg.state === "loaded") {
			const disableResult = await this.disable(name);
			if (!disableResult.success) {
				return disableResult;
			}
		}

		this.packages.delete(name);
		this.inlineFactories.delete(name);
		this.emitEvent("unloaded", name);

		return { success: true };
	}

	/**
	 * Get a registered package by name.
	 */
	getPackage(name: string): ExtensionPackage | undefined {
		return this.packages.get(name);
	}

	/**
	 * Get all registered packages.
	 */
	getAllPackages(): ExtensionPackage[] {
		return Array.from(this.packages.values());
	}

	/**
	 * Get all loaded extensions.
	 */
	getLoadedExtensions(): Extension[] {
		const loaded: Extension[] = [];
		for (const pkg of this.packages.values()) {
			if (pkg.state === "loaded" && pkg.extension) {
				loaded.push(pkg.extension);
			}
		}
		return loaded;
	}

	/**
	 * Get the shared runtime, if bound.
	 */
	getRuntime(): ExtensionRuntime | null {
		return this.runtime;
	}

	/**
	 * Set the shared runtime (called by RuntimeHost.bindRuntime).
	 */
	setRuntime(runtime: ExtensionRuntime): void {
		this.runtime = runtime;
	}

	/**
	 * Get the number of registered packages.
	 */
	get size(): number {
		return this.packages.size;
	}

	/**
	 * Internal: load an extension for a package.
	 */
	private async loadPackage(pkg: ExtensionPackage): Promise<Extension> {
		// Check for inline factory first
		const factory = this.inlineFactories.get(pkg.manifest.name);
		if (factory) {
			return this.loadFactory(factory, pkg);
		}

		// Load from directory
		return this.loadFromDirectory(pkg);
	}

	/**
	 * Load an inline factory extension.
	 */
	private async loadFactory(factory: ExtensionFactory, _pkg: ExtensionPackage): Promise<Extension> {
		const runtime = createExtensionRuntime();
		const { loadExtensionFromFactory } = await import("./loader.js");
		const extension = await loadExtensionFromFactory(factory, this.cwd, this.eventBus, runtime);
		return extension;
	}

	/**
	 * Load an extension from its package directory.
	 */
	private async loadFromDirectory(pkg: ExtensionPackage): Promise<Extension> {
		await import("./loader.js");

		// Check for package.json with entry point, or index.ts/js
		const dir = pkg.directory;
		const pkgJsonPath = path.join(dir, "package.json");
		let entryPoints: string[] = [];

		if (fs.existsSync(pkgJsonPath)) {
			const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
			const piExts = pkgJson.pi?.extensions;
			if (Array.isArray(piExts)) {
				entryPoints = piExts.map((e: string) => path.resolve(dir, e));
			}
		}

		if (entryPoints.length === 0) {
			// Fall back to index.ts or index.js
			const indexTs = path.join(dir, "index.ts");
			const indexJs = path.join(dir, "index.js");
			if (fs.existsSync(indexTs)) {
				entryPoints = [indexTs];
			} else if (fs.existsSync(indexJs)) {
				entryPoints = [indexJs];
			}
		}

		if (entryPoints.length === 0) {
			throw new Error(
				`No extension entry point found in ${dir}. Expected package.json with pi.extensions, index.ts, or index.js`,
			);
		}

		// Load via existing loader
		const _runtime = createExtensionRuntime();
		const result = await loadExtensions(entryPoints, this.cwd, this.eventBus);

		if (result.errors.length > 0) {
			throw new Error(
				`Failed to load extension entries: ${result.errors.map((e) => `[${e.path}] ${e.error}`).join("; ")}`,
			);
		}

		if (result.extensions.length === 0) {
			throw new Error("No extensions were loaded from the entry points");
		}

		// Return the first extension (a package typically has one main extension)
		return result.extensions[0];
	}

	/**
	 * Get the current pi version string (delegates to validate module).
	 */
	private getPiVersionString(): string {
		return getPiVersion();
	}
}
