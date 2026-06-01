const fs = require("fs");
const filePath =
  "/Users/hootie/src/pi/packages/coding-agent/src/core/plan-parser.ts";
let content = fs.readFileSync(filePath, "utf8");

// Backslash character
const BS = "\\";

// --- Change 1: Object dependency normalization ---
const oldDepLine = "dependencies: Array.isArray(w.dependencies) ? w.dependencies : [],";
if (content.includes(oldDepLine)) {
  const indent = "\t\t";
  const newDeps = [
    "// Normalize dependencies: handle both string arrays and object arrays with {id, type, reason}",
    "const rawDeps = Array.isArray(w.dependencies) ? w.dependencies : [];",
    "const deps = rawDeps.map((d) =>",
    'typeof d === "object" && d !== null && "id" in d',
    "? d.id",
    ": String(d),",
    ").filter((id) => id.length > 0);",
    "",
    "dependencies: deps,",
  ];
  content = content.replace(oldDepLine, newDeps.map(l => indent + l).join("\n"));
  console.log("Change 1: applied");
} else {
  console.log("Change 1: already applied or not found");
}

// --- Change 2: Flexible extractJsonQueue ---
const oldExtract = "function extractJsonQueue(planContent: string): string | null {";
const idx = content.indexOf(oldExtract);
if (idx >= 0) {
  const commentStart = content.lastIndexOf("/**", idx);
  const bodyStart = content.indexOf("{", idx);
  let d = 1, i = bodyStart + 1;
  while (d > 0 && i < content.length) { if (content[i] === "{") d++; if (content[i] === "}") d--; i++; }

  const TICK3 = "```";
  const nl = "\n";
  const tb = "\t";

  const lines = [];
  lines.push("/**");
  lines.push(" * Try to parse a JSON string as an execution contract.");
  lines.push(" *");
  lines.push(" * An execution contract is a JSON object with a non-empty `workspaces`");
  lines.push(" * array where each entry has at least an `id` field.");
  lines.push(" */");
  lines.push("function looksLikeExecutionContract(json: string): boolean {");
  lines.push(tb + "try {");
  lines.push(tb + tb + "const parsed = JSON.parse(json);");
  lines.push(tb + tb + 'if (!parsed || typeof parsed !== "object") return false;');
  lines.push(tb + tb + "const workspaces = parsed.workspaces;");
  lines.push(tb + tb + "if (!Array.isArray(workspaces) || workspaces.length === 0) return false;");
  lines.push(tb + tb + "return workspaces.every((w) =>");
  lines.push(tb + tb + tb + 'typeof w === "object" && w !== null && typeof (w).id === "string",');
  lines.push(tb + tb + ");");
  lines.push(tb + "} catch {");
  lines.push(tb + tb + "return false;");
  lines.push(tb + "}");
  lines.push("}");
  lines.push("");
  lines.push("/**");
  lines.push(" * Extract execution contract JSON from plan content.");
  lines.push(" *");
  lines.push(" * Tries (in order):");
  lines.push(" *  1. JSON code block under a # Part 3 heading (v2/v3 template format)");
  lines.push(' *  2. JSON code block under any heading containing "Execution Contract" or "JSON Contract"');
  lines.push(" *  3. Any ```json code block in the document that looks like an execution contract");
  lines.push(" *");
  lines.push(" * @param planContent - Plan content");
  lines.push(" * @returns JSON string or null if not found");
  lines.push(" */");
  lines.push("function extractJsonQueue(planContent) {");
  lines.push(tb + "// 1. Try # Part 3 section first (v2/v3 template format, backward compat)");
  lines.push(tb + "var part3Match = planContent.match(/# Part 3[^" + BS + "n]*" + BS + "n([" + BS + "s" + BS + "S]*?)(?=" + BS + "n# Part [4-9]|" + BS + "n# Part 1[0-9]|$)/i);");
  lines.push(tb + "if (part3Match) {");
  lines.push(tb + tb + "var part3Content = part3Match[1];");
  lines.push(tb + tb + "var jsonMatch = part3Content.match(/" + TICK3 + "json" + BS + "s*" + BS + "n([" + BS + "s" + BS + "S]*?)" + BS + "n" + TICK3 + "/);");
  lines.push(tb + tb + "if (jsonMatch) {");
  lines.push(tb + tb + tb + "var json = jsonMatch[1].trim();");
  lines.push(tb + tb + tb + "if (looksLikeExecutionContract(json)) return json;");
  lines.push(tb + tb + "}");
  lines.push(tb + "}");
  lines.push("");
  lines.push(tb + "// 2. Try any heading containing \"Execution Contract\" or \"JSON Contract\" (v4 template format)");
  lines.push(tb + "var contractSectionMatch = planContent.match(/(?:#+|^)[^" + BS + "n]*Execution" + BS + "s*(?:JSON" + BS + "s*)?Contract[^" + BS + "n]*" + BS + "n([" + BS + "s" + BS + "S]*?)(?=" + BS + "n#|" + BS + "n---|$)/i);");
  lines.push(tb + "if (contractSectionMatch) {");
  lines.push(tb + tb + "var sectionContent = contractSectionMatch[1];");
  lines.push(tb + tb + "var jsonMatch = sectionContent.match(/" + TICK3 + "json" + BS + "s*" + BS + "n([" + BS + "s" + BS + "S]*?)" + BS + "n" + TICK3 + "/);");
  lines.push(tb + tb + "if (jsonMatch) {");
  lines.push(tb + tb + tb + "var json = jsonMatch[1].trim();");
  lines.push(tb + tb + tb + "if (looksLikeExecutionContract(json)) return json;");
  lines.push(tb + tb + "}");
  lines.push(tb + "}");
  lines.push("");
  lines.push(tb + "// 3. Scan ALL ```json blocks in the document and try each one");
  lines.push(tb + "var allJsonBlocks = planContent.matchAll(/" + TICK3 + "json" + BS + "s*" + BS + "n([" + BS + "s" + BS + "S]*?)" + BS + "n" + TICK3 + "/g);");
  lines.push(tb + "for (var match of allJsonBlocks) {");
  lines.push(tb + tb + "var json = match[1].trim();");
  lines.push(tb + tb + "if (looksLikeExecutionContract(json)) {");
  lines.push(tb + tb + tb + "return json;");
  lines.push(tb + tb + "}");
  lines.push(tb + "}");
  lines.push("");
  lines.push(tb + "return null;");
  lines.push("}");

  content = content.substring(0, commentStart) + lines.join("\n") + content.substring(i);
  console.log("Change 2: applied");
} else {
  console.log("Change 2: already applied or not found");
}

fs.writeFileSync(filePath, content, "utf8");
console.log("Written:", content.length, "bytes");

// Verify balance
const opens = (content.match(/{/g) || []).length;
const closes = (content.match(/}/g) || []).length;
console.log("Braces:", opens, "open,", closes, "close, delta:", opens - closes);
