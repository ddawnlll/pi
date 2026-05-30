# PY3 — Tests and Validation

## Task

Create a unittest test suite for the Python web app. Use only Python standard library `unittest`. No pytest, no external test runners.

## Files to create

### tests/__init__.py

Empty file (package marker).

### tests/test_backend.py

Unit tests for `backend.app` functions.

Test cases:
- `test_get_items_empty` — assert `get_items()` returns empty list
- `test_add_item` — add an item, assert name/description/id are correct
- `test_get_items_after_add` — add two items, assert length is 2
- `test_get_item_found` — add an item, get it by id, assert it exists
- `test_get_item_not_found` — assert `get_item(999)` returns None

Use `setUp` to call `clear_items()` before each test.

Import modules by adding the project root to `sys.path`.

### tests/test_frontend_assets.py

Frontend asset existence and content checks.

Test cases:
- `test_index_html_exists` — assert `frontend/index.html` is a file
- `test_index_html_has_root_div` — assert content contains `<div id="root">` and "Pi Gauntlet"
- `test_app_js_exists` — assert `frontend/app.js` is a file
- `test_app_js_has_loadItems` — assert content contains "loadItems" or "fetch"

### tests/test_integration.py

Full integration test that starts the server, hits endpoints, and terminates cleanly.

Test cases:
- `test_health_endpoint` — GET /health returns 200 and `{"ok": true}`
- `test_get_items_empty` — GET /api/items returns a list
- `test_create_item` — POST /api/items creates an item, returns 201 with the item data
- `test_index_html_served` — GET / returns 200 and content contains "Pi Gauntlet"

Integration test setup:
- Find a free port using `socket`
- Start `backend/server.py` as a subprocess with `PORT` env var
- Write port to a temp file via `PORT_FILE` env for the test harness
- Wait for `/health` to respond (up to 10 seconds with 200ms retry)
- Use `urllib.request` for HTTP calls (no `requests` library)
- In `tearDownClass`, terminate the subprocess, kill if needed, clean up port file

## Validation command

Run the full test suite:
```
python -m unittest discover -s tests -v
```

Expected: all tests pass, exit code 0.

## Constraints

- Python stdlib only: `unittest`, `subprocess`, `socket`, `json`, `os`, `sys`, `tempfile`, `time`, `urllib.request`, `urllib.error`
- No pytest
- No external HTTP client libraries
- No network calls to external services
- Server subprocess must be terminated in tearDown
- Port conflict handling: retry with different port if needed
