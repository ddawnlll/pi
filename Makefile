# ──────────────────────────────────────────────────────────────────────────────
# Pi Development Makefile
# Targets: install | env | db | server | dashboard | dev | logs | clean | help
# ──────────────────────────────────────────────────────────────────────────────

SHELL := /bin/bash
.PHONY: help install build dashboard-install env db db-create db-migrate db-drop \
        server dashboard dev dev-server dev-dashboard stop logs clean \
        stack-up stack-down

# ── Load environment ──────────────────────────────────────────────────────────
# Sources .env at the repo root for PG* and PORT vars.
ifneq (,$(wildcard .env))
    include .env
    export
endif

# ── Paths ─────────────────────────────────────────────────────────────────────
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
	@echo "  ──────────────────────────────────────────────────────"
	@echo "  make install       Install all npm dependencies"
	@echo "  make build         Build db + coding-agent (required before server)"
	@echo "  make dashboard-install  Install dashboard dependencies separately"
	@echo "  make env           Create .env with auto-detected PG user"
	@echo "  make db            Bootstrap: create DB + run migrations"
	@echo "  make db-create     Create the PostgreSQL database only"
	@echo "  make db-migrate    Run pending migrations only"
	@echo "  make db-drop       Drop the database (destructive)"
	@echo "  make server        Web server (foreground)"
	@echo "  make dashboard     Vite dev server (foreground)"
	@echo "  make dev           Both server + dashboard (foreground)"
	@echo "  make dev-server    Server in background (tail logs)"
	@echo "  make dev-dashboard Dashboard in background (tail logs)"
	@echo "  make stop          Stop background processes"
	@echo "  make logs          Tail log files"
	@echo "  make stack-up      Full stack: env + install + db + dev"
	@echo "  make stack-down    Stack teardown: stop + db-drop"
	@echo "  make clean         Remove all node_modules"
	@echo ""

# ── Install ───────────────────────────────────────────────────────────────────

install:
	npm install

# ── Build (dependency order) ─────────────────────────────────────────────────

build:
	@echo "Building packages in dependency order..."
	@cd $(DB_DIR) && npm run build
	@cd $(SERVER_DIR)/../coding-agent && npm run build
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

# ── Server (backend) ──────────────────────────────────────────────────────────

server:
	@echo "Starting web server (http://localhost:$(or $(PORT),3000))..."
	@cd $(SERVER_DIR) && npm run dev

# ── Dashboard (frontend) ──────────────────────────────────────────────────────

dashboard:
	@echo "Starting dashboard (http://localhost:5176)..."
	@cd $(DASHBOARD_DIR) && npm run dev

# ── Dev: both foreground ──────────────────────────────────────────────────────

DEV_SERVER_PORT ?= $(or $(PORT),3000)

dev:
	@echo "Starting server on :$(DEV_SERVER_PORT) and dashboard on :5176..."
	@echo ""
	@echo "  Server    -> http://localhost:$(DEV_SERVER_PORT)"
	@echo "  Dashboard -> http://localhost:5176"
	@echo "  Ctrl-C to stop both"
	@echo ""
	@trap 'kill 0 2>/dev/null; exit' EXIT INT TERM; \
		cd $(SERVER_DIR) && npm run dev & \
		sleep 2; \
		cd $(DASHBOARD_DIR) && npm run dev

# ── Background daemon mode ────────────────────────────────────────────────────

$(LOG_DIR):
	@mkdir -p $(LOG_DIR)

dev-server: | $(LOG_DIR)
	@echo "Starting server in background (log: $(SERVER_LOG))..."
	@cd $(SERVER_DIR) && nohup npm run dev > $(SERVER_LOG) 2>&1 & echo $$! > $(SERVER_PID)
	@sleep 2
	@echo "Server started (PID: $$(cat $(SERVER_PID)))."
	@echo "  Tail: make logs"
	@echo "  Stop: make stop"

dev-dashboard: | $(LOG_DIR)
	@echo "Starting dashboard in background (log: $(DASHBOARD_LOG))..."
	@cd $(DASHBOARD_DIR) && nohup npm run dev > $(DASHBOARD_LOG) 2>&1 & echo $$! > $(DASHBOARD_PID)
	@sleep 2
	@echo "Dashboard started (PID: $$(cat $(DASHBOARD_PID)))."
	@echo "  Tail: make logs"
	@echo "  Stop: make stop"

stop:
	@echo "Stopping background processes..."
	@for f in $(SERVER_PID) $(DASHBOARD_PID); do \
		if [ -f "$$f" ]; then \
			kill "$$(cat $$f)" 2>/dev/null && echo "Killed $$f (PID $$(cat $$f))" || true; \
			rm -f "$$f"; \
		fi; \
	done
	@echo "Stopped."

# ── Logs ──────────────────────────────────────────────────────────────────────

logs:
	@if [ ! -d $(LOG_DIR) ]; then \
		echo "No logs directory. Start services with 'make dev-server' or 'make dev-dashboard' first."; \
		exit 1; \
	fi
	@echo "Tailing logs (Ctrl-C to stop)..."
	@if [ -f $(SERVER_LOG) ] && [ -f $(DASHBOARD_LOG) ]; then \
		echo ""; \
		tail -f $(SERVER_LOG) $(DASHBOARD_LOG); \
	elif [ -f $(SERVER_LOG) ]; then \
		echo ""; \
		echo "=== Server ===" && tail -f $(SERVER_LOG); \
	elif [ -f $(DASHBOARD_LOG) ]; then \
		echo ""; \
		echo "=== Dashboard ===" && tail -f $(DASHBOARD_LOG); \
	else \
		echo "No log files found."; \
		exit 1; \
	fi

# ── Stack: full bring-up ──────────────────────────────────────────────────────
# Runs everything needed to go from a fresh clone to a running system.

stack-up: env install build dashboard-install db dev

# ── Stack: full tear-down ─────────────────────────────────────────────────────
# Stops processes and drops the database. Leaves node_modules and .env intact
# so a subsequent stack-up is fast.

stack-down: stop db-drop
	@echo "Stack torn down."
	@echo "Run 'make stack-up' to rebuild."

# ── Clean ─────────────────────────────────────────────────────────────────────

clean:
	@echo "Removing node_modules..."
	@rm -rf node_modules packages/*/node_modules packages/web-ui/example/node_modules
	@echo "Done. Run 'make install' to reinstall."
