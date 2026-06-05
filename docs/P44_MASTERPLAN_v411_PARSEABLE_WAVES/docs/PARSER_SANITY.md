# Parser Sanity

Every plan file under `waves/` includes:

- `# Part 1 — Phase Plan`
- `## 7. Workstreams`
- at least one `### 7.A — ...` heading
- `# Part 3 — Machine-Readable Execution Contract`
- fenced JSON code block with `contractVersion: "4.1.1"`
- `# Part 4 — Machine-Readable Summary`

Do not parse index/docs/schema files as plans.
