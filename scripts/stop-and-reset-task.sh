#!/bin/bash
# Stop the current running task V2 P15-P20 and reset it to restart

set -e
cd /home/erfolg/src/pi

echo "=== Step 1: Update task.json to stop running phases ==="

python3 << 'EOF'
import json
from datetime import datetime

task_file = ".pi/tasks/tsk_1779385484068_nr6hqxr/task.json"

with open(task_file, 'r') as f:
    task = json.load(f)

# Mark p15 as complete (already is)
# Mark p16 as failed (it was stuck)
# Mark p17 as failed (same execution as p16)
# We'll restart from p16

for phase in task['phases']:
    if phase['id'] == 'p15':
        phase['status'] = 'complete'
        print(f"P15: marked complete")
    elif phase['id'] in ['p16', 'p17']:
        phase['status'] = 'failed'
        phase['execution'] = None  # Clear the bad execution reference
        print(f"Phase {phase['id']}: marked failed, cleared execution")
    elif phase['id'] in ['p18', 'p19', 'p20']:
        phase['status'] = 'pending'
        phase['execution'] = None
        print(f"Phase {phase['id']}: reset to pending")

# Reset task to running so it can restart
task['status'] = 'running'

with open(task_file, 'w') as f:
    json.dump(task, f, indent=2)

print(f"\nTask reset complete. Status: {task['status']}")
EOF

echo ""
echo "=== Step 2: Clear stale executions from activeExecutions ==="
echo "(Handled on server restart)"

echo ""
echo "=== Step 3: Kill any running node processes for pi ==="

# Find and kill any running pi processes (careful - don't kill this shell)
pids=$(ps aux | grep -E "(node.*web-server|pi web-server)" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "Found processes: $pids"
    # This is dangerous - let's just document what needs to be done
    echo "Please manually restart the web server with: npm run dev --workspace=packages/web-ui"
else
    echo "No running web-server processes found"
fi

echo ""
echo "=== Task stopped and reset ==="
echo "Next step: Restart the web server to apply the fixes"
