/**
 * Browser stub for Node.js execution environment.
 * The web-ui doesn't use ExecutionEnv, but it's exported from @earendil-works/pi-agent-core
 * which causes Vite to try to bundle Node.js modules.
 */

export class NodeExecutionEnv {
	constructor() {
		throw new Error("NodeExecutionEnv is not available in browser environments");
	}
}

export type {
	ExecutionEnv,
	ExecutionEnvExecOptions,
	FileErrorCode,
	FileInfo,
	FileKind,
} from "@earendil-works/pi-agent-core";
