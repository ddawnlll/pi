const fs = require("fs");
const filePath =
  "/Users/hootie/src/pi/packages/coding-agent/src/core/plan-parser.ts";
let c = fs.readFileSync(filePath, "utf8");

const fnSig =
  "function extractJsonQueue(planContent: string): string | null {";
const idx = c.indexOf(fnSig);
const commentStart = c.lastIndexOf("/**", idx);
const bodyStart = c.indexOf("{", idx);
let d = 1,
  ei = bodyStart + 1;
while (d > 0 && ei < c.length) {
  if (c[ei] === "{") d++;
  if (c[ei] === "}") d--;
  ei++;
}

const BS = "\\";
const TICK3 = "```";

const lines = [
  "/**",
  " * Try to parse a JSON string as an execution contract.",
  " */",
  "function looksLikeExecutionContract(json) {",
  "  try {",
  "    var p = JSON.parse(json);",
  '    return p && typeof p === "object" && Array.isArray(p.workspaces) && p.workspaces.length > 0;',
  "  } catch {",
  "    return false;",
  "  }",
  "}",
  "",
  "/**",
  " * Extract execution contract JSON. Tries Part 3, then Execution Contract heading, then all json blocks.",
  " */",
  "function extractJsonQueue(planContent) {",
  "  var JSON_BLOCK = /" + TICK3 + "json" + BS + BS + "s*" + BS + BS + "n([" + BS + BS + "s" + BS + BS + "S]*?)" + BS + BS + "n" + TICK3 + "/;",
  "  // 1. Try # Part 3 section",
  "  var m = planContent.match(/# Part 3[^" + BS + BS + "n]*" + BS + BS + "n([" + BS + BS + "s" + BS + BS + "S]*?)(?=" + BS + BS + "n# Part [4-9]|" + BS + BS + "n# Part 1[0-9]|$)/i);",
  "  if (m) { var jm = m[1].match(JSON_BLOCK); if (jm && looksLikeExecutionContract(jm[1].trim())) return jm[1].trim(); }",
  "  // 2. Try Execution Contract heading",
  "  m = planContent.match(/(?:#+|^)[^" + BS + BS + "n]*Execution" + BS + BS + "s*(?:JSON" + BS + BS + "s*)?Contract[^" + BS + BS + "n]*" + BS + BS + "n([" + BS + BS + "s" + BS + BS + "S]*?)(?=" + BS + BS + "n#|" + BS + BS + "n---|$)/i);",
  "  if (m) { var jm = m[1].match(JSON_BLOCK); if (jm && looksLikeExecutionContract(jm[1].trim())) return jm[1].trim(); }",
  "  // 3. Scan all json blocks",
  '  var re = new RegExp(JSON_BLOCK.source, "g");',
  "  while ((jm = re.exec(planContent)) !== null) {",
  "    if (looksLikeExecutionContract(jm[1].trim())) return jm[1].trim();",
  "  }",
  "  return null;",
  "}",
];

c = c.substring(0, commentStart) + lines.join("\n") + c.substring(ei);
fs.writeFileSync(filePath, c, "utf8");
console.log("Done, size:", c.length);
