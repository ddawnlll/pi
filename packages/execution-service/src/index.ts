/**
 * Execution Service — P40 Platform / Agent Separation
 */
export type { CommandHandlerResult } from "./command-handler.js";
export { handleExecutionCommand } from "./command-handler.js";
export { createExecutionReadModel } from "./query-handler.js";
export { createExecutionService } from "./execution-service.js";
export type { ExecutionService } from "./execution-service.js";
