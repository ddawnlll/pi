# PY2 — Frontend

## Task

Create a minimal frontend for the Python web app. Pure HTML + vanilla JavaScript. No build step, no npm, no external dependencies.

## Files to create

### frontend/index.html

A simple HTML page with:
- A doctype and html lang="en"
- A head with meta charset and viewport, and a title "Pi Gauntlet App"
- A body with a `<div id="root">` containing:
  - An `<h1>` with text "Pi Gauntlet Python Web App"
  - A `<div id="items">` with text "Loading..."
- A script tag loading `app.js`

### frontend/app.js

A simple JavaScript file that:
- Uses an IIFE or plain function
- Fetches `/api/items` on load
- If items exist, renders each item's name in a div inside `#items`
- If no items, shows "No items yet."
- On fetch error, shows "Error loading items."
- No external libraries (no React, Vue, jQuery, etc.)
- No build step required

## Constraints

- Pure HTML and vanilla JavaScript only
- No npm, no node_modules, no package.json for frontend
- No CSS framework dependency
- No external CDN resources
- Must work when served by the Python backend server at `/`

## Validation

Verify the files exist and contain expected markers:
```
python -c "
import os
with open('frontend/index.html') as f: html = f.read()
assert '<div id=\"root\">' in html
assert 'Pi Gauntlet' in html
assert 'app.js' in html
with open('frontend/app.js') as f: js = f.read()
assert 'loadItems' in js or 'fetch' in js
print('OK')
"
```
