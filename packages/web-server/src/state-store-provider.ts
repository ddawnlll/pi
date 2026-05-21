/**
 * Shared state store provider.
 *
 * Provides a singleton IStateStore instance and related helpers
 * shared across web-server modules (REST API, WebSocket, plan runner).
 *
 * This ensures all code paths use the SAME in-memory log buffers,
 * so WebSocket polling sees logs written by workspace execution.
 */

import { resolve } from "node:path";
import {
	createStateStore,
	detectStateStoreBackend,
	FileSettingsStorage,
	JsonStateStore,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

/**
 * Detect workspace root from environment or cwd.
 */
export function getWorkspaceRoot(): string {
	return process.env.PI_WORKSPACE_ROOT || resolve(process.cwd(), "../..");
}

/**
 * Global state store instance. Initialized lazily.
 */
let globalStateStore: ReturnType<typeof createStateStore> | null = null;
let globalSettingsManager: SettingsManager | null = null;

/**
 * Get or create the singleton state store.
 *
 * All consumers (REST endpoints, WebSocket handlers, plan runner)
 * call this function to ensure they operate on the same instance
 * with shared in-memory buffers and persistence.
 */
export function getStateStore() {
	if (!globalStateStore) {
		const workspaceRoot = getWorkspaceRoot();
		const backend = detectStateStoreBackend();

		console.log(`[state-store-provider] Backend: ${backend}, workspace root: ${workspaceRoot}`);

		globalStateStore = createStateStore({
			backend,
			workspaceRoot,
		});

		const actualBackend = globalStateStore.getBackendType();
		console.log(`[state-store-provider] Initialized with backend: ${actualBackend}`);
		if (actualBackend !== backend) {
			console.warn(
				`[state-store-provider] WARNING: Requested ${backend} but got ${actualBackend} (fallback occurred)`,
			);
		}
	}
	return globalStateStore;
}

/**
 * Get or create the singleton settings manager.
 */
export function getSettingsManager(): SettingsManager {
	if (!globalSettingsManager) {
		const workspaceRoot = getWorkspaceRoot();
		const storage = new FileSettingsStorage(workspaceRoot, resolve(process.cwd(), "../../.pi"));
		globalSettingsManager = SettingsManager.fromStorage(storage);
	}
	return globalSettingsManager;
}

/**
 * Get a JsonStateStore wrapper for legacy file access.
 *
 * @deprecated JSON state store is deprecated. All new state is stored in PostgreSQL.
 *   This function provides read-only access to previously-saved JSON state files
 *   for migration purposes. It may be removed in a future release.
 */
export function getJsonStateStore(): JsonStateStore {
	console.warn("[state-store-provider] WARNING: getJsonStateStore() is deprecated. Use PostgreSQL backend.");
	return new JsonStateStore(getWorkspaceRoot());
}
