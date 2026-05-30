# PY1 — Backend Web Server

## Task

Create a minimal Python backend web server using only the Python standard library (no pip, no external dependencies).

## Files to create

### backend/__init__.py

Empty file (package marker).

### backend/app.py

A tiny in-memory data API. Pure functions, no server logic.

Define:
- `get_items()` — returns a list of all items
- `add_item(name, description)` — adds an item, returns it with an auto-incremented id
- `get_item(item_id)` — returns a single item or None
- `clear_items()` — clears all items (for testing)

Store items in a module-level list. Use a module-level counter for ids.

### backend/server.py

An HTTP server using `http.server.HTTPServer` and `BaseHTTPRequestHandler`.

Endpoints:
- `GET /health` — return `{"ok": true}` as JSON
- `GET /api/items` — return the list of items as JSON
- `POST /api/items` — read JSON body with `name` and optional `description`, create item, return it as JSON with status 201
- `GET /` — serve `frontend/index.html` if it exists, otherwise return 404

The server must:
- Bind to `127.0.0.1` on a port from the `PORT` environment variable, or auto-discover a free port if `PORT=0`
- Write the actual port to stdout as `PORT=<number>` for the test harness
- Suppress default request logging to stderr during tests by overriding `log_message`
- Handle `KeyboardInterrupt` to shut down cleanly

Import `get_items` and `add_item` from `backend.app`.

## Constraints

- Use only Python standard library (`http.server`, `json`, `os`, `sys`, `socket`, `urllib.parse`)
- No Flask, FastAPI, Django, or any third-party packages
- No pip install
- No network calls to external services
- The server must be testable: start it, hit `/health`, hit `/api/items`, terminate it

## Validation

Run:
```
python -c "from backend.app import get_items, add_item, get_item, clear_items; clear_items(); add_item('test'); assert len(get_items()) == 1; print('OK')"
```
