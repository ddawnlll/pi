# Python Flask Web Server Test — Phase 1

**Version:** 1.0  
**Last Updated:** 2026-05-11  
**Purpose:** Test Pi's PostgreSQL-backed multi-project autonomous execution system with a simple Python Flask web server

---

# Part 1 — Phase Plan

## 0. TL;DR / Compact Mental Model

**Phase:** 1  
**One-line goal:** Create a working Python Flask web server with frontend to test Pi's autonomous execution  
**Why now:** Validate the new PostgreSQL-backed execution system with a real-world test case  
**Blast radius:** Only affects /tmp/test-python-webserver directory (isolated test environment)  
**Rollback path:** Delete /tmp/test-python-webserver directory  
**Done when:** Flask backend serves API, frontend displays data, integration tests pass

---

## 1. Header

| Field | Value |
|---|---|
| Phase | 1 |
| Title | Python Flask Web Server with Frontend |
| Status | Planned |
| Last updated | 2026-05-11 |
| Delivery status | Not started |
| Target environment | Local /tmp directory |
| Primary focus | Test autonomous execution system |
| Product-code changes | Forbidden (test project only) |

### 1.1 RACI

| Workstream | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|---|---|---|---|---|
| 1.A — Python Environment Setup | Pi Worker | Pi Lead | User | User |
| 1.B — Backend API Implementation | Pi Worker | Pi Lead | User | User |
| 1.C — Frontend Development | Pi Worker | Pi Lead | User | User |
| 1.D — Integration Testing | Pi Worker | Pi Lead | User | User |

---

## 2. Purpose

This phase creates a simple Python Flask web server with a frontend to test Pi's new PostgreSQL-backed multi-project autonomous execution system. The test validates:

1. **Multi-workspace execution**: Four workspaces with dependencies
2. **PostgreSQL state persistence**: Real-time dashboard monitoring
3. **Parallel execution**: Workspaces 1.B and 1.C can run in parallel
4. **Integration testing**: Automated verification of the complete system

The project is intentionally simple (Flask API + HTML/CSS/JS frontend) to focus on testing the execution infrastructure rather than complex application logic.

---

## 3. What Carried Over — Must Stay Stable

* [ ] No modifications to Pi codebase
* [ ] No modifications to system Python installation
* [ ] Test project isolated in /tmp directory
* [ ] No network dependencies beyond localhost

---

## 4. Background / What Was Wrong

Pi's execution system was recently upgraded to support PostgreSQL-backed multi-project execution with real-time dashboard monitoring. This test validates that the new system works end-to-end with a realistic project.

---

## 5. Current Failure State / Known Blockers

* `test-python-webserver` = not implemented
* `PostgreSQL execution validation` = not tested
* `Dashboard monitoring` = not validated with real execution

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Python venv creation fails | low | medium | Use system Python3, fallback to --without-pip |
| Port 5000 already in use | medium | low | Kill existing process or use different port |
| CORS issues | low | low | Configure flask-cors properly |
| Integration test timing | medium | low | Add sleep delays between server start and tests |

---

## 7. Workstreams

### 7.A — Setup Python Environment and Project Structure

**Goal:** Create project directory structure and Python virtual environment

**Requirements:**
* Create /tmp/test-python-webserver directory structure
* Create Python virtual environment in backend/venv
* Create requirements.txt with Flask and flask-cors
* Install dependencies in virtual environment
* Create README.md with setup instructions

**Acceptance Criteria:**
* Project directory exists with backend/ and frontend/ subdirectories
* Virtual environment created and functional
* requirements.txt contains Flask>=2.3.0 and flask-cors>=4.0.0
* Dependencies installed successfully
* README.md documents project structure and setup

---

### 7.B — Implement Flask Backend API

**Goal:** Create Flask REST API with health check and data endpoints

**Requirements:**
* Create app.py with Flask application
* Implement GET /api/health endpoint
* Implement GET /api/items endpoint (returns list)
* Implement POST /api/items endpoint (adds to list)
* Configure CORS for frontend access
* Use in-memory list for data storage

**Acceptance Criteria:**
* Flask app imports successfully
* Health endpoint returns {"status": "ok"}
* Items endpoints work with in-memory storage
* CORS headers configured
* App can start on port 5000 without errors

---

### 7.C — Create Frontend HTML/CSS/JS

**Goal:** Build simple frontend that interacts with Flask API

**Requirements:**
* Create index.html with semantic HTML structure
* Create style.css with responsive design
* Create script.js with fetch API calls
* Display items from GET /api/items
* Add form to POST new items
* Show error messages for failed requests

**Acceptance Criteria:**
* HTML validates and displays properly
* CSS provides clean, responsive layout
* JavaScript successfully calls API endpoints
* Items display in a list
* Form submits new items
* Error handling shows user-friendly messages

---

### 7.D — Integration Testing and Verification

**Goal:** Verify complete system works end-to-end

**Requirements:**
* Create test_integration.sh script
* Start Flask backend on port 5000
* Test health endpoint returns 200
* Test GET /api/items returns valid JSON
* Test POST /api/items adds items successfully
* Verify CORS headers present
* Create TEST_RESULTS.md with results

**Acceptance Criteria:**
* Backend starts without errors
* All API endpoints respond correctly
* CORS headers present in responses
* Frontend files accessible
* Integration script exits with code 0
* TEST_RESULTS.md documents all passing tests

---

## 8. Combined Implementation Order

```text
1.A → 1.B → 1.D
  ↘   1.C ↗
```

**Explanation:**
- 1.A must complete first (sets up environment)
- 1.B and 1.C can run in parallel (backend and frontend are independent)
- 1.D requires both 1.B and 1.C to complete (integration testing)

---

## 9. Definition of Done

Phase 1 is complete when ALL are true:

* [ ] Project directory structure created in /tmp/test-python-webserver
* [ ] Python virtual environment functional with Flask installed
* [ ] Flask backend serves API on port 5000
* [ ] Frontend HTML/CSS/JS files created and functional
* [ ] Integration tests pass (test_integration.sh exits 0)
* [ ] TEST_RESULTS.md documents successful execution
* [ ] Dashboard shows completed execution in PostgreSQL

---

## 10. Rollback Playbook

**Trigger conditions:**
* Integration tests fail after 3 retries
* System resources exhausted
* User requests cancellation

**Rollback procedure:**
1. Stop Flask server if running: `pkill -f "python.*app.py"`
2. Delete test directory: `rm -rf /tmp/test-python-webserver`
3. Verify cleanup: `test ! -d /tmp/test-python-webserver`

---

## 11. What Next Phase Inherits

Phase 2 (if created) inherits:
* Working Flask application structure
* Frontend/backend integration pattern
* Integration testing approach

Phase 2 may add:
* Database persistence (SQLite)
* User authentication
* Additional API endpoints

---

# Part 2 — Agent Brief

## Mission

Create a simple but complete Python Flask web server with frontend to validate Pi's PostgreSQL-backed autonomous execution system. Focus on clean, working code that demonstrates the execution infrastructure.

---

## Hard Requirements

1. **No system modifications**: Only create files in /tmp/test-python-webserver
2. **Use system Python3**: No custom Python installations
3. **Isolated environment**: Virtual environment for all dependencies
4. **No git operations**: This is a test project, not a repository
5. **Clean shutdown**: Kill Flask server after testing

---

## Execution Policies

```yaml
default_workers: 2
hard_cap_workers: 2
same_file_parallelism: false
auto_commit: false
auto_push: false
```

**Parallelism**: Workspaces 1.B and 1.C can run in parallel since they work on different directories.

**No commits**: This is a test project in /tmp, no git operations needed.

---

## Safety Stops

Hard stop execution only for:
* Attempts to modify files outside /tmp/test-python-webserver
* Attempts to install system-wide Python packages
* Attempts to use rm -rf on system directories
* Detection of secrets or credentials in code

---

# Part 3 — Machine-Readable Execution Contract

**Purpose:** This JSON structure is the authoritative execution contract for Pi's PostgreSQL-backed multi-project autonomous execution system. Pi parses this section first to build the execution plan.

**Validation:** This JSON must be valid and complete before execution begins. Use `pi plan doctor` to validate.

```json
{
  "contractVersion": "2.1.0",
  "executionBackend": "postgres",
  "project": {
    "name": "test-python-webserver",
    "rootPath": "/home/erfolg/src/test2",
    "type": "repo",
    "tags": ["test", "python", "flask", "web-server"]
  },
  "planExecution": {
    "phase": "1",
    "title": "Python Flask Web Server with Frontend",
    "mode": "autonomous",
    "maxParallelWorkspaces": 2,
    "stateBackend": "postgres",
    "jsonFallbackEnabled": true,
    "dashboardEnabled": true,
    "autoCommit": false,
    "autoPush": false
  },
  "controls": {
    "allowPause": true,
    "allowStop": true,
    "allowCancel": true,
    "resumePolicy": "paused_or_stopped_only"
  },
  "safety": {
    "hardStops": [
      "secrets",
      "destructive_ops",
      "forbidden_files",
      "budget_violations",
      "dependency_cycles"
    ],
    "forbiddenCommands": [
      "git push",
      "git push --force",
      "rm -rf /",
      "rm -rf /*",
      "npm publish",
      "pip install --user",
      "sudo"
    ],
    "forbiddenFiles": [
      ".env*",
      "**/*.pem",
      "**/*.key",
      "**/credentials/**",
      "/etc/**",
      "/usr/**",
      "/home/**"
    ]
  },
  "workspaces": [
    {
      "id": "1.A",
      "title": "Setup Python Environment and Project Structure",
      "dependencies": [],
      "allowedFiles": [
        "/tmp/test-python-webserver/**"
      ],
      "forbiddenFiles": [
        "/etc/**",
        "/usr/**",
        "/home/**"
      ],
      "acceptanceCriteria": [
        "Project directory structure created",
        "Python virtual environment created in backend/venv",
        "requirements.txt created with Flask and flask-cors",
        "Virtual environment activated and dependencies installed",
        "README.md created with setup instructions"
      ],
      "targetCommand": "test -d /tmp/test-python-webserver/backend/venv && test -f /tmp/test-python-webserver/backend/requirements.txt",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "/tmp/test-python-webserver/**"
        ],
        "cannotEdit": [
          ".env*",
          "**/*.pem",
          "/etc/**",
          "/usr/**"
        ],
        "canRun": [
          "python3 -m venv",
          "pip install",
          "mkdir",
          "touch",
          "test",
          "echo"
        ],
        "cannotRun": [
          "rm -rf /",
          "git push",
          "sudo",
          "pip install --user"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "1.B",
      "title": "Implement Flask Backend API",
      "dependencies": ["1.A"],
      "allowedFiles": [
        "/tmp/test-python-webserver/backend/**"
      ],
      "forbiddenFiles": [
        "/tmp/test-python-webserver/backend/venv/**"
      ],
      "acceptanceCriteria": [
        "Flask app.py created with REST API",
        "Health check endpoint GET /api/health implemented",
        "Data endpoints GET /api/items and POST /api/items implemented",
        "CORS configured for frontend access",
        "In-memory data storage implemented",
        "App can start without errors"
      ],
      "targetCommand": "cd /tmp/test-python-webserver/backend && python3 -c \"import sys; sys.path.insert(0, '.'); from app import app; assert app is not None\"",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "/tmp/test-python-webserver/backend/**"
        ],
        "cannotEdit": [
          ".env*",
          "/tmp/test-python-webserver/backend/venv/**"
        ],
        "canRun": [
          "python3",
          "python3 -c",
          "cd"
        ],
        "cannotRun": [
          "rm -rf /",
          "git push",
          "sudo"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "1.C",
      "title": "Create Frontend HTML/CSS/JS",
      "dependencies": [],
      "allowedFiles": [
        "/tmp/test-python-webserver/frontend/**"
      ],
      "forbiddenFiles": [],
      "acceptanceCriteria": [
        "index.html created with proper structure",
        "style.css created with responsive design",
        "script.js created with API integration",
        "Frontend can display items from API",
        "Frontend can add new items via API",
        "Error handling implemented"
      ],
      "targetCommand": "test -f /tmp/test-python-webserver/frontend/index.html && test -f /tmp/test-python-webserver/frontend/style.css && test -f /tmp/test-python-webserver/frontend/script.js",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "low",
      "capabilityManifest": {
        "canEdit": [
          "/tmp/test-python-webserver/frontend/**"
        ],
        "cannotEdit": [],
        "canRun": [
          "test"
        ],
        "cannotRun": [
          "rm -rf /",
          "git push",
          "sudo"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    },
    {
      "id": "1.D",
      "title": "Integration Testing and Verification",
      "dependencies": ["1.B", "1.C"],
      "allowedFiles": [
        "/tmp/test-python-webserver/test_integration.sh",
        "/tmp/test-python-webserver/TEST_RESULTS.md"
      ],
      "forbiddenFiles": [
        "/tmp/test-python-webserver/backend/venv/**"
      ],
      "acceptanceCriteria": [
        "Backend starts successfully on port 5000",
        "Health check endpoint returns 200",
        "GET /api/items returns valid JSON",
        "POST /api/items successfully adds items",
        "CORS headers present in responses",
        "Frontend files are accessible",
        "Integration test script created and passes"
      ],
      "targetCommand": "bash /tmp/test-python-webserver/test_integration.sh",
      "roleBudget": "worker",
      "maxRetries": 3,
      "riskLevel": "medium",
      "capabilityManifest": {
        "canEdit": [
          "/tmp/test-python-webserver/test_integration.sh",
          "/tmp/test-python-webserver/TEST_RESULTS.md"
        ],
        "cannotEdit": [
          "/tmp/test-python-webserver/backend/venv/**"
        ],
        "canRun": [
          "bash",
          "curl",
          "python3",
          "pkill",
          "sleep",
          "cd"
        ],
        "cannotRun": [
          "rm -rf /",
          "git push",
          "sudo"
        ]
      },
      "telemetry": {
        "expectedEvents": [
          "workspace_started",
          "workspace_completed"
        ],
        "logLevel": "info"
      }
    }
  ]
}
```

---

# Part 4 — Machine-Readable Summary

**Purpose:** Phase-level execution metadata for Pi's autonomous executor.

```json
{
  "contractVersion": "2.1.0",
  "phase": "1",
  "title": "Python Flask Web Server with Frontend",
  "primaryGoal": "Create a working Flask web server with frontend to test Pi's PostgreSQL-backed autonomous execution system",
  "projectName": "test-python-webserver",
  "stateBackend": "postgres",
  "notInScope": [
    "Database persistence",
    "User authentication",
    "Production deployment",
    "Docker containerization",
    "CI/CD pipeline"
  ],
  "hardStops": [
    "secrets",
    "destructive_ops",
    "forbidden_files",
    "budget_violations"
  ],
  "completionGate": "Flask backend serves API, frontend displays data, integration tests pass, dashboard shows completed execution",
  "nextPhase": null
}
```

---

**End of Plan**
