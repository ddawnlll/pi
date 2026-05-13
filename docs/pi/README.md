# Pi Docs Export

This directory contains auto-generated documentation from Pi plan executions.
All content here is exported from the `.pi/` execution archive.

## Directory Structure

```
docs/pi/
  plans/
    {planExecId}.md          Living plan markdown (copied from .pi/plans)
  executions/
    {planExecId}/
      summary.md              Human-readable execution summary
      original-plan.md        Copy of the original plan
      safety-warnings.md      Extracted safety warnings
      commits.md              Git commits made during execution
      test-results.md         Test results from workspaces
      follow-ups.md           Outstanding follow-ups / TODOs
      workspaces/
        {workspaceId}/
          verdict.md          Workspace verdict summary
```

## Configuration

Docs export is controlled by the `DocsExportConfig.enabled` flag.
When disabled, no files are written to this directory.

## Safety

- All writes are constrained to `docs/pi/` (path traversal is blocked)
- Forbidden file patterns (.env, .pem, .key, .ssh, etc.) are never exported
- This directory should be safe to commit to version control
