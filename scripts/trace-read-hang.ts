import { createReadToolDefinition } from "../packages/coding-agent/src/core/tools/read.js";
import { readFileSync, existsSync } from "node:fs";

// Monkey-patch to add tracing
const origExecute = createReadToolDefinition.prototype?.execute;
// Can't access prototype of a function result, so let's wrap differently

import { createAllToolDefinitions } from "../packages/coding-agent/src/core/tools/index.js";

const cwd = "/Users/hootie/src/pi";
const filePath = "packages/coding-agent/src/core/token-context/types.ts";

console.log("STEP 1: createAllToolDefinitions");
const tools = createAllToolDefinitions(cwd);
console.log("STEP 2: Got tools", Object.keys(tools));

console.log("STEP 3: readTool.execute");
const start = Date.now();

try {
  const promise = tools.read.execute(
    "test-id",
    { path: filePath, offset: 1, limit: 450 },
    undefined,
    undefined,
  );
  
  console.log("STEP 4: Got promise, waiting 2s...");
  
  // Wait with timeout
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("TIMEOUT after 5s")), 5000)
  );
  
  const result = await Promise.race([promise, timeoutPromise]);
  const elapsed = Date.now() - start;
  
  console.log(`STEP 5: DONE in ${elapsed}ms`);
  console.log("Result type:", typeof result);
  console.log("Keys:", Object.keys(result));
} catch(e) {
  console.log(`ERROR after ${Date.now() - start}ms:`, e.message);
  console.error(e.stack?.split("\n").slice(0, 5).join("\n"));
}
