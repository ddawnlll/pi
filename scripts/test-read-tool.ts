import { createReadToolDefinition } from "../packages/coding-agent/src/core/tools/read.js";
import { readFileSync, existsSync } from "node:fs";

async function main() {
  const cwd = process.argv[2] || "/Users/hootie/src/pi";
  const filePath = process.argv[3] || "packages/coding-agent/src/core/token-context/types.ts";
  const offset = process.argv[4] ? parseInt(process.argv[4]) : undefined;
  const limit = process.argv[5] ? parseInt(process.argv[5]) : undefined;

  console.log(`Testing: smart read ${filePath}:${offset ?? "?"}-${limit ?? "?"}`);
  console.log(`CWD: ${cwd}`);
  
  const absPath = cwd + "/" + filePath;
  if (!existsSync(absPath)) {
    console.error(`FILE NOT FOUND: ${absPath}`);
    process.exit(1);
  }

  console.log("Creating read tool...");
  const readTool = createReadToolDefinition(cwd);
  console.log("Executing read...");
  
  const start = Date.now();
  const result = await readTool.execute(
    "test-id",
    { path: filePath, offset, limit },
    undefined,
    undefined,
  );
  const elapsed = Date.now() - start;
  
  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  
  console.log(`DONE in ${elapsed}ms`);
  console.log(`Content length: ${text.length} chars`);
  console.log(`First 100 chars: ${text.slice(0, 100)}`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
