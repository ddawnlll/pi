# WebSocket Log Streaming Implementation

## Overview

Implemented live worker log streaming via WebSockets for the pi web dashboard, replacing the previous SSE-based approach with real-time bidirectional communication.

## Changes Made

### 1. Backend - State Store Log Buffering

**File**: [`packages/coding-agent/src/core/json-state-store.ts`](packages/coding-agent/src/core/json-state-store.ts)

- Added in-memory log buffer (`Map<string, string[]>`) with 1000-line capacity per workspace
- Implemented [`appendWorkspaceLog()`](packages/coding-agent/src/core/json-state-store.ts:396) to persist logs to both buffer and file
- Implemented [`loadWorkspaceLog()`](packages/coding-agent/src/core/json-state-store.ts:420) to retrieve persisted logs
- Added [`getRecentWorkspaceLogs()`](packages/coding-agent/src/core/json-state-store.ts:433) for real-time buffer access

**File**: [`packages/coding-agent/src/core/state-store.ts`](packages/coding-agent/src/core/state-store.ts)

- Added optional method signatures to [`IStateStore`](packages/coding-agent/src/core/state-store.ts:84) interface:
  - `appendWorkspaceLog?()` - Append log lines
  - `loadWorkspaceLog?()` - Load persisted logs
  - `getRecentWorkspaceLogs?()` - Get in-memory buffer

### 2. Backend - WebSocket Server

**File**: [`packages/web-server/package.json`](packages/web-server/package.json)

- Added `@fastify/websocket` dependency (v11.0.1)

**File**: [`packages/web-server/src/index.ts`](packages/web-server/src/index.ts)

- Registered WebSocket plugin
- Added REST endpoint: `GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/logs`
  - Returns recent logs from buffer or file
- Added WebSocket endpoint: `ws://localhost:3000/api/ws/logs/:planExecId/:workspaceId`
  - Sends recent logs on connection
  - Polls for new logs every 1 second
  - Tracks last sent line count to avoid duplicates
  - Handles connection lifecycle (open, close, error)

### 3. Backend - Execution Summary

**File**: [`packages/web-server/src/plan-runner.ts`](packages/web-server/src/plan-runner.ts)

- Added [`generateExecutionSummary()`](packages/web-server/src/plan-runner.ts:245) function
- Generates human-readable summary with:
  - Plan title and phase
  - Workspace statistics (total, completed, failed, blocked, pending)
  - Success/failure indicator
- Summary is logged when execution completes or fails

### 4. Frontend - WebSocket Hook

**File**: [`packages/web-ui/dashboard/src/hooks/useWorkspaceLogStream.ts`](packages/web-ui/dashboard/src/hooks/useWorkspaceLogStream.ts) (NEW)

- Created custom React hook for WebSocket log streaming
- Features:
  - Automatic connection management
  - Message parsing (log, ready, error types)
  - Connection status tracking
  - Error handling
  - Auto-reconnect on parameter change

### 5. Frontend - UI Component

**File**: [`packages/web-ui/dashboard/src/components/WorkerDetail.tsx`](packages/web-ui/dashboard/src/components/WorkerDetail.tsx)

- Added live logs section with:
  - Connection status indicator (green pulse when connected)
  - Auto-scrolling log container
  - Monospace font for log readability
  - Empty state message
- Updated component to accept `planExecId` prop

**File**: [`packages/web-ui/dashboard/src/App.tsx`](packages/web-ui/dashboard/src/App.tsx)

- Updated [`WorkerDetail`](packages/web-ui/dashboard/src/App.tsx:388) usage to pass `planExecId`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ WorkerDetail Component                                  │ │
│  │  - Shows workspace details                              │ │
│  │  - Displays live logs with auto-scroll                  │ │
│  │  - Connection status indicator                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           │ uses                             │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ useWorkspaceLogStream Hook                              │ │
│  │  - Manages WebSocket connection                         │ │
│  │  - Parses log messages                                  │ │
│  │  - Tracks connection state                              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ WebSocket
                           │ ws://localhost:3000/api/ws/logs/:planExecId/:workspaceId
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Backend (Fastify + WebSocket)               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ WebSocket Endpoint                                      │ │
│  │  - Sends recent logs on connect                         │ │
│  │  - Polls for new logs (1s interval)                     │ │
│  │  - Tracks sent line count                               │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           │ reads from                       │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ JsonStateStore                                          │ │
│  │  - In-memory log buffer (1000 lines)                    │ │
│  │  - File-based persistence                               │ │
│  │  - getRecentWorkspaceLogs()                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ▲                                  │
│                           │ writes to                        │
│                           │                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ WorkspaceAgentExecutor                                  │ │
│  │  - Executes workspace tasks                             │ │
│  │  - Calls appendWorkspaceLog()                           │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Message Protocol

WebSocket messages use JSON format:

```typescript
// Log message
{
  type: "log",
  data: "[2026-05-12T13:00:00.000Z] Starting execution..."
}

// Ready signal (sent after initial logs)
{
  type: "ready"
}

// Error message
{
  type: "error",
  message: "Failed to load logs"
}
```

## Testing

To test the implementation:

1. Start the web server:
   ```bash
   cd packages/web-server
   npm run dev
   ```

2. Open the dashboard at `http://localhost:3000`

3. Upload and run a plan

4. Select a workspace to view live logs

5. Verify:
   - Connection status shows "Connected" with green pulse
   - Logs appear in real-time as workspace executes
   - Logs auto-scroll to bottom
   - Execution summary appears when plan completes

## Benefits

1. **Real-time updates**: Logs stream instantly as they're generated
2. **Efficient**: In-memory buffer reduces file I/O
3. **Scalable**: WebSocket connections are lightweight
4. **Reliable**: Automatic reconnection on connection loss
5. **User-friendly**: Visual connection status and auto-scrolling

## Future Enhancements

1. **PostgreSQL support**: Extend log buffering to DatabaseStateStore
2. **Log filtering**: Add client-side log level filtering
3. **Log search**: Implement search within logs
4. **Download logs**: Add button to download full log file
5. **Compression**: Compress log messages for large outputs
6. **Backpressure**: Handle slow clients with buffering limits
