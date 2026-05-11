# Pi Plan Dashboard - Quick Start

## Current Status

The dashboard UI and web server are built but not yet integrated with the executor. Here's how to run what exists:

## Setup Steps

### 1. Install Web Server Dependencies

```bash
cd packages/web-server
npm install
```

### 2. Create Mock Data (for testing the dashboard)

Create a `.pi` directory with mock data:

```bash
mkdir -p .pi/workspaces/workspace-a/attempts/1
mkdir -p .pi/workspaces/workspace-b/attempts/2

# Create mock plan-state.json
cat > .pi/plan-state.json << 'EOF'
{
  "title": "Test Plan",
  "phase": "execution",
  "status": "running",
  "elapsed": 45000,
  "queue": {
    "pending": 12,
    "active": 3,
    "blocked": 1,
    "complete": 44,
    "failed": 0
  },
  "workers": [
    {
      "id": "workspace-a",
      "stage": "active",
      "attempt": 1,
      "retries": 0,
      "snapshotPath": ".pi/workspaces/workspace-a/snapshot.md",
      "reportPath": ".pi/workspaces/workspace-a/report.md"
    },
    {
      "id": "workspace-b",
      "stage": "active",
      "attempt": 2,
      "retries": 1,
      "snapshotPath": ".pi/workspaces/workspace-b/snapshot.md",
      "reportPath": ".pi/workspaces/workspace-b/report.md"
    }
  ]
}
EOF

# Create mock execution journal
cat > .pi/execution-journal.ndjson << 'EOF'
{"timestamp":"2026-05-11T16:00:00.000Z","type":"started","workspaceId":"workspace-a","message":"workspace-a started"}
{"timestamp":"2026-05-11T16:01:00.000Z","type":"completed","workspaceId":"workspace-a","message":"workspace-a completed"}
{"timestamp":"2026-05-11T16:02:00.000Z","type":"started","workspaceId":"workspace-b","message":"workspace-b started"}
EOF

# Create mock worker logs
echo "Running tests..." > .pi/workspaces/workspace-a/attempts/1/stdout.log
echo "Test suite passed" >> .pi/workspaces/workspace-a/attempts/1/stdout.log
echo "All tests completed" >> .pi/workspaces/workspace-a/attempts/1/stdout.log

echo "Error: connection timeout" > .pi/workspaces/workspace-b/attempts/2/stderr.log
```

### 3. Start the Dashboard UI

The dashboard has its own Vite dev server configured:

```bash
cd packages/web-ui/dashboard
npm install  # Install dependencies (first time only)
npm run dev
```

This will start the dashboard on http://localhost:5176 (or another port if taken).

### 4. Start the Web Server

```bash
cd packages/web-server
npm run dev
```

This starts the API server on http://localhost:3000

### 5. Access the Dashboard

Open http://localhost:5176 (or the port shown in the terminal)

The dashboard will connect to the API server at http://localhost:3000

## What Works Now

- ✅ Dashboard UI renders with mock data
- ✅ API endpoints serve mock data
- ✅ Polling updates every 500ms
- ✅ Control buttons send commands (writes to `.pi/plan-control.json`)

## What Doesn't Work Yet

- ❌ SSE streaming (file watching needs real file changes)
- ❌ Actual plan execution (executor not integrated)
- ❌ CLI commands (`pi plan dashboard`, etc.)
- ❌ Atomic writes in executor
- ❌ Worker log persistence in executor

## Next Steps

To make this production-ready:

1. **Fix the executor** to write plan-state.json atomically
2. **Add worker log persistence** to the executor
3. **Add CLI commands** to start the dashboard
4. **Build configuration** for the dashboard
5. **Integration testing** with real plan execution

## Testing the Dashboard

Once the server is running with mock data:

1. The dashboard should show the mock plan state
2. Click on a worker to see its details
3. Try the control buttons (they'll write to `.pi/plan-control.json`)
4. Modify `.pi/plan-state.json` manually to see polling updates

## Architecture

```
Browser (Dashboard UI)
    ↓ HTTP polling (500ms)
    ↓ SSE streams
Web Server (Fastify)
    ↓ reads
.pi/plan-state.json
.pi/execution-journal.ndjson
.pi/workspaces/{id}/attempts/{n}/*.log
    ↑ writes
Executor (not yet integrated)
```
