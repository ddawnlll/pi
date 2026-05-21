#!/bin/bash
# Fix stuck execution: mark the running "Backend Server Setup" as complete
# This is a one-time fix for the data corruption

cd /home/erfolg/src/pi

# Backup first
cp .pi/executions.json .pi/executions.json.bak

# Fix the stuck execution - change status from "running" to "complete"
# and set completedAt to current time
python3 << 'EOF'
import json
from datetime import datetime

with open('.pi/executions.json', 'r') as f:
    executions = json.load(f)

for e in executions:
    if e.get('title') == 'Backend Server Setup' and e.get('status') == 'running':
        print(f"Fixing execution: {e['id']}")
        e['status'] = 'complete'
        e['completedAt'] = datetime.now().isoformat() + 'Z'
        print(f"  OLD status: running, completedAt: null")
        print(f"  NEW status: {e['status']}, completedAt: {e['completedAt']}")

with open('.pi/executions.json', 'w') as f:
    json.dump(executions, f, indent=2)

print("\nDone! Fixed executions.json")
EOF
