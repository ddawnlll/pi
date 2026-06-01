import { readFileSync, writeFileSync } from "fs";

const filePath =
  "/Users/hootie/src/pi/packages/coding-agent/src/core/plan-parser.ts";
let content = readFileSync(filePath, "utf8");

// --- Change 1: Object dependency normalization in normalizeQueue ---
const oldDepLine =
  "dependencies: Array.isArray(w.dependencies) ? w.dependencies : [],";

if (content.includes(oldDepLine)) {
  const newDepLines = [
    "// Normalize dependencies: handle both string arrays and object arrays with {id, type, reason}",
    "const rawDeps = Array.isArray(w.dependencies) ? w.dependencies : [];",
    "const deps = rawDeps.map((d: unknown) =>",
    'typeof d === "object" && d !== null && "id" in (d as Record<string, unknown>)',
    '? (d as Record<string, unknown>).id as string',
    ": String(d),",
    ").filter((id: string) => id.length > 0);",
    "",
    "dependencies: deps,",
  ];
  content = content.replace(
    oldDepLine,
    "\t\t" + newDepLines.join("\n\t\t"),
  );
  console.log("Change 1: applied");
} else {
  console.log("Change 1: already applied or not found");
}

// --- Change 2: Flexible extractJsonQueue ---
const oldExtractFn =
  "function extractJsonQueue(planContent: string): string | null {";
const extractFnIdx = content.indexOf(oldExtractFn);

if (extractFnIdx >= 0) {
  const commentStart = content.lastIndexOf("/**", extractFnIdx);
  const bodyStart = content.indexOf("{", extractFnIdx);
  let d = 1, i = bodyStart + 1;
  while (d > 0 && i < content.length) {
    if (content[i] === "{") d++;
    if (content[i] === "}") d--;
    i++;
  }

  const BS = "\\";
  const newBlock = [
    "/**",
    " * Try to parse a JSON string as an execution contract.",
    " *",
    " * An execution contract is a JSON object with a non-empty `workspaces`",
    " * array where each entry has at least an `id` field.",
    " */",
    "function looksLikeExecutionContract(json: string): boolean {",
    "\ttry {",
    "\t\tconst parsed = JSON.parse(json);",
    '\t\tif (!parsed || typeof parsed !== "object") return false;',
    "\t\tconst workspaces = parsed.workspaces;",
    "\t\tif (!Array.isArray(workspaces) || workspaces.length === 0) return false;",
    "\t\treturn workspaces.every((w: unknown) =>",
    '\t\t\ttypeof w === "object" && w !== null && typeof (w as Record<string, unknown>).id === "string",',
    "\t\t);",
    "\t} catch {",
    "\t\treturn false;",
    "\t}",
    "}",
    "",
    "/**",
    " * Extract execution contract JSON from plan content.",
    " *",
    " * Tries (in order):",
    " *  1. JSON code block under a # Part 3 heading (v2/v3 template format)",
    ' *  2. JSON code block under any heading containing "Execution Contract" or "JSON Contract"',
    " *  3. Any ```json code block in the document that looks like an execution contract",
    " *",
    " * @param planContent - Plan content",
    " * @returns JSON string or null if not found",
    " */",
    "function extractJsonQueue(planContent: string): string | null {",
    "\t// 1. Try # Part 3 section first (v2/v3 template format, backward compat)",
    `\tconst part3Match = planContent.match(/# Part 3[^${BS}n]*${BS}n([${BS}s${BS}S]*?)(?=${BS}n# Part [4-9]|${BS}n# Part 1[0-9]|$)/i);`,
    "\tif (part3Match) {",
    "\t\tconst part3Content = part3Match[1];",
    `\t\tconst jsonMatch = part3Content.match(/\\`\\`\\`json${BS}s*${BS}n([${BS}s${BS}S]*?)${BS}n\\`\\`\\`/);`,
    "\t\tif (jsonMatch) {",
    "\t\t\tconst json = jsonMatch[1].trim();",
    "\t\t\tif (looksLikeExecutionContract(json)) return json;",
    "\t\t}",
    "\t}",
    "",
    "\t// 2. Try any heading containing \"Execution Contract\" or \"JSON Contract\" (v4 template format)",
    `\tconst contractSectionMatch = planContent.match(/(?:#+|^)[^${BS}n]*Execution${BS}s*(?:JSON${BS}s*)?Contract[^${BS}n]*${BS}n([${BS}s${BS}S]*?)(?=${BS}n#|${BS}n---|$)/i);`,
    "\tif (contractSectionMatch) {",
    "\t\tconst sectionContent = contractSectionMatch[1];",
    `\t\tconst jsonMatch = sectionContent.match(/\\`\\`\\`json${BS}s*${BS}n([${BS}s${BS}S]*?)${BS}n\\`\\`\\`/);`,
    "\t\tif (jsonMatch) {",
    "\t\t\tconst json = jsonMatch[1].trim();",
    "\t\t\tif (looksLikeExecutionContract(json)) return json;",
    "\t\t}",
    "\t}",
    "",
    "\t// 3. Scan ALL ```json blocks in the document and try each one",
    `\tconst allJsonBlocks = planContent.matchAll(/\\`\\`\\`json${BS}s*${BS}n([${BS}s${BS}S]*?)${BS}n\\`\\`\\`/g);`,
    "\tfor (const match of allJsonBlocks) {",
    "\t\tconst json = match[1].trim();",
    "\t\tif (looksLikeExecutionContract(json)) {",
    "\t\t\treturn json;",
    "\t\t}",
    "\t}",
    "",
    "\treturn null;",
    "}",
  ].join("\n");

  content = content.substring(0, commentStart) + newBlock + content.substring(i);
  console.log("Change 2: applied");
} else {
  console.log("Change 2: already applied or not found");
}

// --- Change 3: Already has flexible parseMarkdownHeadings ---
const hasNewMd = content.includes("function findWorkstreamSection");
if (hasNewMd) {
  console.log("Change 3: already applied");
} else {
  console.log("Change 3: NOT found - need to run apply-patch.mjs first");
}

// Verify
const opens = (content.match(/{/g) || []).length;
const closes = (content.match(/}/g) || []).length;
console.log("Braces:", opens, "open,", closes, "close, delta:", opens - closes);

writeFileSync(filePath, content, "utf8");
console.log("Written:", content.length, "bytes");
