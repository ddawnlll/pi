# Phase P-DIAG — Execution Diagnostic Gauntlet

## 7. Workstreams

### diag.1 — Diagnostic workspace

# Part 3 — JSON Queue

```json
{
  "contractVersion": "4.0.0",
  "phase": "P-DIAG",
  "title": "Execution Diagnostic Gauntlet",
  "maxParallelWorkspaces": 2,
  "workspaces": [
    {
      "id": "diag.1",
      "title": "Diagnostic workspace",
      "goal": "Write one diagnostic artifact",
      "instructions": "Create a file in the temp repo",
      "executorPrompt": "Create docs/diagnostic.txt with the text OK.",
      "capabilities": {
        "canEdit": [
          "docs/diagnostic.txt"
        ]
      },
      "targetCommand": null
    }
  ]
}
```
