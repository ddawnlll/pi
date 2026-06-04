import { createTokenContextRuntime } from "../packages/coding-agent/src/core/token-context/runtime.js";
import { DEFAULT_TOKEN_CONTEXT_CONFIG } from "../packages/coding-agent/src/core/token-context/types.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const config = {
    ...DEFAULT_TOKEN_CONTEXT_CONFIG,
    enabled: true,
    mode: "active_safe",
  };
  const runtime = createTokenContextRuntime(config);

  // Test a few representative files
  const files = [
    "packages/coding-agent/src/core/tools/read.ts",
    "packages/coding-agent/src/core/dag-analyzer.ts",
    "packages/coding-agent/src/core/token-context/runtime.ts",
    "packages/tui/src/tui.ts",
  ];

  for (const relPath of files) {
    const absPath = resolve(relPath);
    const content = readFileSync(absPath, "utf-8");
    const est = Math.ceil(content.length / 4);

    // beforeRead — will be miss since no snapshot
    const pre = runtime.beforeRead(absPath);
    console.log(`\n=== ${relPath} ===`);
    console.log(`beforeRead intercept: ${pre.intercept}`);
    console.log(`Raw est tokens: ${est}`);

    // trySmartRead
    const result = await runtime.trySmartRead(absPath, content);
    if (result) {
      console.log(`Smart read tokens: ${Math.ceil(result.compactContent.length / 4)}`);
      console.log(`Smart chars: ${result.compactContent.length} vs raw chars: ${content.length}`);
      console.log(`Adapter: ${result.adapterName}`);
      console.log(`Confidence: ${result.adapterConfidence}`);
      console.log(`mutationSafe: ${result.mutationSafe}`);
      console.log("--- OUTPUT ---");
      console.log(result.compactContent);
      console.log("--- END ---");
    } else {
      console.log(`NO SMART RESULT (tiny file or error)`);
    }

    // snapshot for hash cache
    runtime.afterRead(absPath, content, Math.ceil(content.length / 4));

    // re-read — should hit hash cache
    const pre2 = runtime.beforeRead(absPath);
    console.log(`Re-read beforeRead intercept: ${pre2.intercept}`);
    if (pre2.intercept && pre2.replacementContent) {
      console.log(`Hash cache output: ${pre2.replacementContent}`);
    }
  }
}
main().catch(console.error);
