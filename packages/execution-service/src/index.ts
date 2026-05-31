/**
 * Execution Service — P40 Platform / Agent Separation
 */
export type { CommandHandlerResult } from "./command-handler.js";
export { handleExecutionCommand } from "./command-handler.js";
export { createExecutionReadModel } from "./query-handler.js";
export { createExecutionService } from "./execution-service.js";
export type { ExecutionService } from "./execution-service.js";
export type { GitOperationScope, GitCallContext, GitResult, StaleLockInfo } from "./git-runner.js";
export { GitRunner, createGitRunner } from "./git-runner.js";
export { FailureClassifier, createFailureClassifier } from "./failure-classifier.js";
export { FailureCategory } from "./failure-classifier.js";
export type { FailureClassification, FailureContext } from "./failure-classifier.js";
