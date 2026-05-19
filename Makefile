# ──────────────────────────────────────────────────────────────────────────────
# Pi Development Makefile
# Targets: install | env | db | server | dashboard | dev | logs | clean | help
# ──────────────────────────────────────────────────────────────────────────────

SHELL := /bin/bash
.PHONY: help install build dashboard-install env db db-create db-migrate db-drop \
        server dashboard dev dev-server dev-dashboard stop logs clean \
        stack-up stack-down stack-down-hard

# ── Load environment ──────────────────────────────────────────────────────────
# Sources .env at the repo root for PG* and PORT vars.
ifneq (,$(wildcard .env))
    include .env
    export
endif

# ── Paths ─────────────────────────────────────────────────────────────────────
AI_DIR        := packages/ai
SERVER_DIR    := packages/web-server
DB_DIR        := packages/db
DASHBOARD_DIR := packages/web-ui/dashboard
LOG_DIR       := .logs
SERVER_LOG    := $(LOG_DIR)/server.log
DASHBOARD_LOG := $(LOG_DIR)/dashboard.log
SERVER_PID    := $(LOG_DIR)/server.pid
DASHBOARD_PID := $(LOG_DIR)/dashboard.pid
ENV_FILE      := .env
ENV_EXAMPLE   := .env.example

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  Pi Development Targets"
	@echo "  ──────────────────────────────────────────────────────────────"
	@echo "  make install       Install all npm dependencies"
	@echo "  make build         Build db + coding-agent (required before server)"
	@echo "  make dashboard-install  Install dashboard dependencies separately"
	@echo "  make env           Create .env with auto-detected PG user"
	@echo "  make db            Bootstrap: create DB + run migrations"
	@echo "  make db-create     Create the PostgreSQL database only"
	@echo "  make db-migrate    Run pending migrations only"
	@echo "  make db-drop       Drop the database (destructive)"
	@echo "  make pi            Run pi TUI from local dist (dev build)"
	@echo "  make server        API server (foreground)"
	@echo "  make dashboard     Dashboard Vite dev server (foreground)"
	@echo "  make dev           Start both server + dashboard in background"
	@echo "  make dev-server    Start API server in background"
	@echo "  make dev-dashboard  Start dashboard in background"
	@echo "  make stop          Stop background services (by PID file)"
	@echo "  make logs          Tail service logs"
	@echo "  make stack-up      Full bootstrap: env + install + build + db + dev"
	@echo "  make stack-down    Stop services (preserves data)"
	@echo "  make stack-down-hard  Stop services + drop database"
	@echo "  make clean         Remove all node_modules"
	@echo ""

# ── Install ───────────────────────────────────────────────────────────────────

install:
	npm install

# ── Build (dependency order) ─────────────────────────────────────────────────

build:
	@echo "Building packages in dependency order..."
	@cd $(AI_DIR) && npm run build
	@cd $(DB_DIR) && npm run build
	@cd $(SERVER_DIR)/../coding-agent && npm run build
	@cd $(SERVER_DIR) && npm run build
	@echo "Build complete."

# ── Dashboard deps (not in npm workspace) ────────────────────────────────────

dashboard-install:
	@echo "Installing dashboard dependencies..."
	@cd $(DASHBOARD_DIR) && npm install
	@echo "Dashboard dependencies installed."

# ── Environment ───────────────────────────────────────────────────────────────

env:
	@if [ -f $(ENV_FILE) ]; then \
		cp $(ENV_FILE) $(ENV_FILE).bak 2>/dev/null || true; \
		echo "Backed up existing $(ENV_FILE) to $(ENV_FILE).bak"; \
	fi
	@printf '%s\n' \
		"# PostgreSQL Database Configuration" \
		"PGHOST=localhost" \
		"PGPORT=5432" \
		"PGDATABASE=pi_executor" \
		"PGUSER=$(shell whoami)" \
		"PGPASSWORD=" \
		"" \
		"# Server Configuration" \
		"PORT=3000" \
		"PI_PROJECT_NAME=default" \
		> $(ENV_FILE)
	@echo "Wrote $(ENV_FILE) with detected user '$(shell whoami)'."

# ── Database ──────────────────────────────────────────────────────────────────
# NOTE: These targets deliberately DO NOT inherit PG* from .env.
# The .env file is for the application at runtime. For bootstrap we
# auto-detect the local PostgreSQL user (your system username), which
# is the correct default for Homebrew / Postgres.app / apt installations.
# Override by passing vars on the command line, e.g.:
#   make db PGUSER_BOOT=postgres PGDATABASE_BOOT=pi

PGUSER_BOOT     ?= $(shell whoami)
PGHOST_BOOT     ?= localhost
PGPORT_BOOT     ?= 5432
PGDATABASE_BOOT ?= pi_executor

db-create:
	@echo "Creating database '$(PGDATABASE_BOOT)' if it does not exist..."
	@psql -h $(PGHOST_BOOT) -p $(PGPORT_BOOT) -U $(PGUSER_BOOT) -d postgres -tc \
		"SELECT 1 FROM pg_database WHERE datname = '$(PGDATABASE_BOOT)'" \
		| grep -q 1 \
		&& echo "Database already exists." \
		|| (echo "CREATE DATABASE \"$(PGDATABASE_BOOT)\"" \
			| psql -h $(PGHOST_BOOT) -p $(PGPORT_BOOT) -U $(PGUSER_BOOT) -d postgres \
			&& echo "Created database.")

db-migrate:
	@echo "Running pending migrations..."
	@cd $(DB_DIR) && \
		PGUSER=$(PGUSER_BOOT) \
		PGHOST=$(PGHOST_BOOT) \
		PGPORT=$(PGPORT_BOOT) \
		PGDATABASE=$(PGDATABASE_BOOT) \
		PGPASSWORD='' \
		npx tsx src/migrate.ts up

db: db-create db-migrate
	@echo "Database bootstrap complete."

db-drop:
	@echo "Dropping database '$(PGDATABASE_BOOT)'..."
	@psql -h $(PGHOST_BOOT) -p $(PGPORT_BOOT) -U $(PGUSER_BOOT) -d postgres -c \
		"DROP DATABASE IF EXISTS \"$(PGDATABASE_BOOT)\""
	@echo "Database dropped."

# ── Pi TUI (local dist) ────────────────────────────────────────────────

PI_CLI := packages/coding-agent/dist/cli.js

pi:
	@if [ ! -f $(PI_CLI) ]; then \
		echo "Local dist not found. Run 'make build' first."; \
		exit 1; \
	fi
	@echo "Starting pi from local dist..."
	@node packages/coding-agent/dist/cli.js

# ── Server (foreground) ───────────────────────────────────────────────────────

server:
	@echo "Starting API server (http://localhost:$(or $(PORT),3000))..."
	@cd $(SERVER_DIR) && npm run dev

# ── Dashboard (foreground) ────────────────────────────────────────────────────

dashboard:
	@echo "Starting dashboard dev server (http://localhost:5176)..."
	@cd $(DASHBOARD_DIR) && npm run dev

# ── Log directory ─────────────────────────────────────────────────────────────

$(LOG_DIR):
	@mkdir -p $(LOG_DIR)

# ── Background daemon mode (PID files + log files) ────────────────────────────
# Use these when you want services running in the background.
# PIDs are saved to $(LOG_DIR)/*.pid so 'make stop' can kill them.
# Logs go to $(LOG_DIR)/*.log, tail them with 'make logs'.

SERVER_PORT ?= $(or $(PORT),3000)

dev-server: | $(LOG_DIR)
	@PID=$$(nohup sh -c 'cd $(SERVER_DIR) && exec npx tsx --env-file=../../.env src/index.ts' \
		> $(abspath $(LOG_DIR))/server.log 2>&1 & echo $$!); \
	echo "$$PID" > $(abspath $(LOG_DIR))/server.pid; \
	echo "Starting API server in background (PID $$PID)..."; \
	sleep 4; \
	if kill -0 "$$PID" 2>/dev/null; then \
		echo "  API server running at http://localhost:$(SERVER_PORT)"; \
		echo "  Log: $(SERVER_LOG)"; \
	else \
		echo "  ERROR: API server failed to start. Check $(SERVER_LOG)"; \
	fi

dev-dashboard: | $(LOG_DIR)
	@PID=$$(nohup sh -c 'cd $(DASHBOARD_DIR) && exec npx vite --port 5176' \
		> $(abspath $(LOG_DIR))/dashboard.log 2>&1 & echo $$!); \
	echo "$$PID" > $(abspath $(LOG_DIR))/dashboard.pid; \
	echo "Starting dashboard dev server in background (PID $$PID)..."; \
	sleep 4; \
	if kill -0 "$$PID" 2>/dev/null; then \
		echo "  Dashboard running at http://localhost:5176"; \
		echo "  Log: $(DASHBOARD_LOG)"; \
	else \
		echo "  ERROR: Dashboard failed to start. Check $(DASHBOARD_LOG)"; \
	fi

# ── Dev: start both in background ─────────────────────────────────────────────
# This creates .logs/server.pid, .logs/dashboard.pid and corresponding .log files.
# Use 'make stop' to shut down, 'make logs' to tail output.

dev: | $(LOG_DIR) dev-server dev-dashboard
	@echo ""
	@echo "  ──────────────────────────────────────────"
	@echo "    API server    http://localhost:$(SERVER_PORT)"
	@echo "    Dashboard     http://localhost:5176"
	@echo "    Logs          $(LOG_DIR)/"
	@echo "  ──────────────────────────────────────────"
	@echo "  Stop:  make stop"
	@echo "  Logs:  make logs"

# ── Stop: kill by PID file ───────────────────────────────────────────────────

stop:
	@echo "Stopping services..."
	@found=0; \
	for f in $(SERVER_PID) $(DASHBOARD_PID); do \
		name=$$(basename $$f .pid); \
		if [ -f "$$f" ]; then \
			PID=$$(cat $$f); \
			if kill -0 $$PID 2>/dev/null; then \
				kill $$PID 2>/dev/null && echo "  Stopped $$name (PID $$PID)" || true; \
			else \
				echo "  $$name (PID $$PID) already exited"; \
			fi; \
			rm -f "$$f"; \
			found=1; \
		else \
			echo "  $$name not running (no PID file)"; \
		fi; \
	done; \
	if [ $$found -eq 1 ] || [ -f $(SERVER_PID) ] || [ -f $(DASHBOARD_PID) ]; then \
		: ; \
	fi
	@echo "Done."

# ── Logs: tail live output ────────────────────────────────────────────────────

logs:
	@if [ ! -d $(LOG_DIR) ]; then \
		echo "No logs directory. Start services with 'make dev' first."; \
		exit 1; \
	fi
	@echo "Tailing logs (Ctrl-C to stop)..."
	@FILES=(); \
	[ -f $(SERVER_LOG) ]    && FILES+=("$(SERVER_LOG)"); \
	[ -f $(DASHBOARD_LOG) ] && FILES+=("$(DASHBOARD_LOG)"); \
	if [ $${#FILES[@]} -eq 0 ]; then \
		echo "No log files found in $(LOG_DIR)/."; \
		exit 1; \
	fi; \
	tail -f "$${FILES[@]}"

# ── Stack: full bring-up (background) ────────────────────────────────────────
# Runs everything needed to go from a fresh clone to a running system.
# Starts services in background with PID tracking and log files.

stack-up: env install build dashboard-install db dev
	@echo ""
	@echo "  Stack is up. Open http://localhost:5176 in your browser."
	@echo "  Stop:  make stack-down"
	@echo "  Logs:  make logs"

# ── Stack: full tear-down (stops processes, keeps data) ──────────────────────
# Stops services. Leaves database, node_modules, and .env intact.

stack-down: stop
	@echo ""
	@echo "  Stack torn down. Data preserved in database."
	@echo "  Restart with: make stack-up"

# ── Stack: full tear-down including database drop ────────────────────────────
# Stops processes AND drops all data.

stack-down-hard: stop db-drop
	@echo ""
	@echo "  Full stack tear-down with database drop complete."

# ── Clean ─────────────────────────────────────────────────────────────────────

clean:
	@echo "Removing node_modules..."
	@rm -rf node_modules packages/*/node_modules packages/web-ui/example/node_modules
	@echo "Done. Run 'make install' to reinstall."
