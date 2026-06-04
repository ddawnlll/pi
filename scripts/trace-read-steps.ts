import { existsSync } from "node:fs";
import { resolveReadPath } from "../packages/coding-agent/src/core/tools/path-utils.js";

const cwd = "/Users/hootie/src/pi";
const path = "packages/coding-agent/src/core/token-context/types.ts";

console.log("STEP 1: resolveReadPath");
const absolutePath = resolveReadPath(path, cwd);
console.log("absolutePath:", absolutePath);

console.log("STEP 2: check exists");
console.log("exists:", existsSync(absolutePath));

// Now manually do what the execute function does
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { constants } from "node:fs";

console.log("STEP 3: access");
await fsAccess(absolutePath, constants.R_OK);
console.log("access OK");

console.log("STEP 4: readFile");
const buffer = await fsReadFile(absolutePath);
console.log("read OK:", buffer.length, "bytes");

console.log("STEP 5: truncation");
const textContent = buffer.toString("utf-8");
const allLines = textContent.split("\n");
const totalFileLines = allLines.length;
console.log("lines:", totalFileLines);
console.log("offset: 1, limit: 450");
const startLine = Math.max(0, 1 - 1);
console.log("startLine:", startLine);
const endLine = Math.min(startLine + 450, allLines.length);
console.log("endLine:", endLine);
const selectedContent = allLines.slice(startLine, endLine).join("\n");
console.log("selectedContent length:", selectedContent.length);
console.log("DONE - all steps passed, no hang");
