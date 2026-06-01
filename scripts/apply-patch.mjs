import { readFileSync, writeFileSync } from "fs";

const filePath = "/Users/hootie/src/pi/packages/coding-agent/src/core/plan-parser.ts";
let content = readFileSync(filePath, "utf8");

// Find the exact boundaries of parseMarkdownHeadings
const fnStart = content.indexOf("function parseMarkdownHeadings(");
const commentStart = content.lastIndexOf("/**", fnStart);
const sigEnd = content.indexOf("} {", fnStart);
const bracePos = content.indexOf("{", sigEnd);
let depth = 1, pos = bracePos + 1;
while (depth > 0 && pos < content.length) {
  if (content[pos] === "{") depth++;
  if (content[pos] === "}") depth--;
  pos++;
}
const oldBlock = content.substring(commentStart, pos);
console.log("Old block:", oldBlock.length, "chars");

// Helper: build regex patterns with proper escaping
const BS = "\\";
function re(template) {
  // template uses \\n for newline, \\s for whitespace, etc.
  // Replace double-backslash sequences with single-backslash + char
  return template.replace(/\\(.)/g, (_, c) => BS + c);
}

// Test the helper
const testResult = re(`[\\s\\S]*`);
console.log("re test:", JSON.stringify(testResult), "expected: [\\\\s\\\\S]*");

const newCode = [
  "/**",
  " * Try to find a workstream/workspace section in the plan markdown.",
  " *",
  " * Searches (in order):",
  " *  1. ## N. Workstreams (v2/v3 template format)",
  " *  2. # Part N -- Implementation Workspaces or # Part N -- Workstreams (v4 plan format)",
  " *  3. ## N. Implementation Workspaces or ## N. Workspace Specifications",
  " *  4. Any heading with \"Workstream\" in its text",
  " *",
  " * Returns the section content or null.",
  " */",
  "function findWorkstreamSection(planContent: string): string | null {",
  "\t// 1. ## N. Workstreams (v2/v3 template format)",
  re("\tconst v3Match = planContent.match(/## [0-9]+[. ]*Workstreams?([\\s\\S]*?)(?=\\n## [0-9]+[. ]|$)/im);"),
  "\tif (v3Match) return v3Match[1];",
  "",
  "\t// 2. # Part N -- Implementation Workspaces or # Part N -- Workstreams",
  re("\tconst v4Match = planContent.match(/^# Part [0-9]+[^\\n]*\\u2014[^\\n]*(?:Implementation\\s+Workspaces|Workstreams?)[^\\n]*\\n([\\s\\S]*?)(?=\\n# Part |$)/im);"),
  "\tif (v4Match) return v4Match[1];",
  "",
  "\t// 3. ## N. Implementation Workspaces or ## N. Workspace Specifications",
  re("\tconst namedSectionMatch = planContent.match(/## [0-9]+[. ]*(?:Implementation\\s+)?(?:Workspace|Workspaces|Workstreams?)[^\\n]*\\n([\\s\\S]*?)(?=\\n## [0-9]+[. ]|$)/im);"),
  "\tif (namedSectionMatch) return namedSectionMatch[1];",
  "",
  "\t// 4. Any heading with \"Workstream\" in its text",
  re("\tconst anyMatch = planContent.match(/(?:#+)\\s*[^\\n]*Workstream[^\\n]*\\n([\\s\\S]*?)(?=\\n#|\\n---|$)/im);"),
  "\tif (anyMatch) return anyMatch[1];",
  "",
  "\treturn null;",
  "}",
  "",
  "/**",
  " * Try to extract phase and title from plan content.",
  " */",
  "function extractPlanMetadata(planContent: string): { phase: string; title: string } {",
  '\tlet phase = "P2";',
  '\tlet title = "Untitled Phase";',
  "",
  "\t// Try # Phase P22 -- Title or # P42 -- Title",
  re("\tconst headingMatch = planContent.match(/^#\\s+(?:Phase\\s+)?(P\\d+)\\s*[\\u2014\\u2013]\\s*([^\\n]+)/im);"),
  "\tif (headingMatch) {",
  "\t\tphase = headingMatch[1];",
  "\t\ttitle = headingMatch[2].trim();",
  "\t}",
  "",
  "\t// Try Title: field",
  "\tif (!headingMatch) {",
  re("\t\tconst titleFieldMatch = planContent.match(/^(?:#+|[^\\n]*)\\n[^\\n]*\\nTitle[^\\n]*:\\s*([^\\n]+)/im);"),
  "\t\tif (titleFieldMatch) {",
  "\t\t\ttitle = titleFieldMatch[1].trim();",
  "\t\t}",
  "\t\tconst phaseMatch = planContent.match(/(?:Phase|P)(\\d+)/i);",
  "\t\tif (phaseMatch) {",
  '\t\t\tphase = "P" + phaseMatch[1];',
  "\t\t}",
  "\t}",
  "",
  "\treturn { phase, title };",
  "}",
  "",
  "/**",
  " * Parse Markdown headings as fallback",
  " *",
  " * Extracts workspace information from markdown headings.",
  ' * Supports:',
  " *  - ### 7.A -- Title (v2/v3 template)",
  " *  - ## P42.00 -- Title (v4-style workspace spec headings)",
  " *  - ### P42.00 -- Title",
  " *",
  " * @param planContent - Plan content",
  " * @returns Parse result with queue or errors",
  " */",
  "function parseMarkdownHeadings(planContent: string): { queue?: WorkspaceQueue; errors: string[] } {",
  "\tconst errors: string[] = [];",
  "\tconst workspaces: Workspace[] = [];",
  "",
  "\t// Extract phase and title",
  "\tconst { phase, title } = extractPlanMetadata(planContent);",
  "",
  "\t// Find workstream/workspace section",
  "\tconst workstreamContent = findWorkstreamSection(planContent);",
  "\tif (!workstreamContent) {",
  '\t\terrors.push("Could not find workstreams section");',
  "\t\treturn { errors };",
  "\t}",
  "",
  "\t// Parse individual workspaces at both ## and ### heading levels",
  "\t// Matches patterns like:",
  "\t//   ### 7.A -- Title  or  ### P42.00 -- Title  or  ## P42.00 -- Title",
  re("\tconst workstreamRegex = /(?:^|\\n)(#{1,3})\\s+([\\w.-]+)[^\\n]*\\u2014\\s*([^\\n]+)\\n([\\s\\S]*?)(?=\\n#{1,3}\\s+[\\w.-]+[^\\n]*\\u2014|$)/gi;"),
  "\tlet match: RegExpExecArray | null = workstreamRegex.exec(workstreamContent);",
  "",
  "\twhile (match !== null) {",
  "\t\tconst id = match[2];",
  "\t\tconst workspaceTitle = match[3].trim();",
  "\t\tconst content = match[4];",
  "",
  "\t\t// Skip non-workspace headings (like '### Goal', '### Allowed Files' which are subsections)",
  "\t\t// Workspace IDs typically have a number prefix (7.A, P42.00, W1, etc.)",
  "\t\tif (!/^(?:P?\\d+(?:\\.\\d+)?|\\w\\d)$/i.test(id)) {",
  "\t\t\tmatch = workstreamRegex.exec(workstreamContent);",
  "\t\t\tcontinue;",
  "\t\t}",
  "",
  '\t\t// Extract dependencies (look for "Dependencies:" or "Depends on:")',
  re("\t\tconst depsMatch = content.match(/(?:Dependencies|Depends on):\\s*([^\\n]+)/i);"),
  "\t\tconst dependencies: string[] = [];",
  "\t\tif (depsMatch) {",
  "\t\t\tconst depsStr = depsMatch[1];",
  '\t\t\t// Parse dependencies like "7.A, 7.B" or "None" or "[]"',
  "\t\t\tif (depsStr && !depsStr.match(/none|^\\[\\s*\\]$/i)) {",
  "\t\t\t\tdependencies.push(",
  "\t\t\t\t\t...depsStr",
  "\t\t\t\t\t\t.split(/[,\\s]+/)",
  "\t\t\t\t\t\t.map((d) => d.trim())",
  "\t\t\t\t\t\t.filter((d) => /^[\\w.-]+$/.test(d) && d.length > 0),",
  "\t\t\t\t);",
  "\t\t\t}",
  "\t\t}",
  "",
  "\t\t// Extract role budget (default to worker)",
  "\t\tconst roleMatch = content.match(/(?:Role|Budget):\\s*(\\w+)/i);",
  '\t\tconst roleBudget: TokenRole = (roleMatch?.[1]?.toLowerCase() as TokenRole) || "worker";',
  "",
  "\t\t// Extract max retries (default to 3)",
  "\t\tconst retriesMatch = content.match(/(?:Max\\s*)?Retries:\\s*(\\d+)/i);",
  "\t\tconst maxRetries = retriesMatch ? Number.parseInt(retriesMatch[1], 10) : 3;",
  "",
  "\t\tworkspaces.push({",
  "\t\t\tid,",
  "\t\t\ttitle: workspaceTitle,",
  "\t\t\tdependencies,",
  "\t\t\troleBudget,",
  "\t\t\tmaxRetries,",
  "\t\t});",
  "",
  "\t\tmatch = workstreamRegex.exec(workstreamContent);",
  "\t}",
  "",
  "\tif (workspaces.length === 0) {",
  '\t\terrors.push("No workspaces found in Markdown headings");',
  "\t\treturn { errors };",
  "\t}",
  "",
  "\treturn {",
  "\t\tqueue: {",
  "\t\t\tphase,",
  "\t\t\ttitle,",
  "\t\t\tmaxParallelWorkspaces: 3, // Default",
  "\t\t\tworkspaces,",
  "\t\t},",
  "\t\terrors: [],",
  "\t};",
  "}",
].join("\n");

// Verify the regex patterns don't have actual newlines
const lines = newCode.split("\n");
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Check for regex literals with newlines
  const regexMatch = line.match(/\/[^/]*\\n[^/]*\//);
  if (regexMatch) {
    // \n in the matched string is backslash+n (correct) if it shows as \\n in JSON
    const matchStr = regexMatch[0];
    if (matchStr.includes("\n")) {
      console.log("WARNING: Line", i, "has actual newline in regex:", line.substring(0, 80));
    }
  }
}

// Count braces
const opens = (newCode.match(/{/g) || []).length;
const closes = (newCode.match(/}/g) || []).length;
console.log("New block braces:", opens, "open,", closes, "close, delta:", opens - closes);

// Replace
content = content.substring(0, commentStart) + newCode + content.substring(pos);

// Final brace check
const totalOpens = (content.match(/{/g) || []).length;
const totalCloses = (content.match(/}/g) || []).length;
console.log("Total braces:", totalOpens, "open,", totalCloses, "close, delta:", totalOpens - totalCloses);

writeFileSync(filePath, content, "utf8");
console.log("Written:", content.length, "bytes");
