/**
 * Execution Service — P40 Platform / Agent Separation
 */
export type { CommandHandlerResult } from "./command-handler.js";
export { handleExecutionCommand } from "./command-handler.js";
export type { ExecutionService } from "./execution-service.js";
export { createExecutionService } from "./execution-service.js";
export type { FailureClassification, FailureContext } from "./failure-classifier.js";
export { createFailureClassifier, FailureCategory, FailureClassifier } from "./failure-classifier.js";
export type { GitCallContext, GitOperationScope, GitResult, StaleLockInfo } from "./git-runner.js";
export { createGitRunner, GitRunner } from "./git-runner.js";
export { createExecutionReadModel } from "./query-handler.js";
