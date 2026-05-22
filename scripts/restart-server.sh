#!/bin/bash
# scripts/restart-server.sh - Safely restart the web server

set -e

echo "=== Checking for existing processes ==="

# Find and kill any existing server processes
OLD_PIDS=$(lsof -ti :3000 2>/dev/null || true)
if [ -n "$OLD_PIDS" ]; then
    echo "Killing existing server processes: $OLD_PIDS"
    echo "$OLD_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Also kill any orphaned tsx processes
pkill -f "tsx.*src/index.ts" 2>/dev/null || true
sleep 1

# Verify port is free
if lsof -i :3000 > /dev/null 2>&1; then
    echo "ERROR: Port 3000 still in use"
    exit 1
fi

echo "=== Starting server fresh ==="
cd packages/web-server && npm run dev &
SERVER_PID=$!

echo "=== Waiting for server to be ready ==="
sleep 4

# Test if server is healthy
if curl -s http://127.0.0.1:3000/api/health > /dev/null; then
    echo "Server is running on port 3000"
    echo "Dashboard should be at http://localhost:5176"
else
    echo "ERROR: Server failed to start"
    exit 1
fi
