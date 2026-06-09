#!/usr/bin/env bash
# pi-fork - Run pi from this repository with an isolated state directory
#
# Each fork gets its own isolated auth, settings, sessions, and extensions
# directory under ~/.pi/agent-forks/<fork-name>/. This lets you maintain
# multiple independent pi configurations (different providers, models,
# extensions) without conflict.
#
# Usage:
#   pi-fork                         Run pi with auto-named fork (current dir basename)
#   pi-fork <name>                  Run pi with named fork
#   pi-fork <name> -- <pi args>     Run pi with fork name + pi arguments
#   pi-fork --list                  List all existing forks
#   pi-fork --remove <name>         Remove a fork and all its data
#   pi-fork --help                  Show this help
#
# Examples:
#   pi-fork work                    # Run pi in "work" fork
#   pi-fork my-project              # Run pi in "my-project" fork
#   pi-fork -- -p "hello world"     # Auto-named fork with prompt flag
#   pi-fork --list                  # Show all forks

set -euo pipefail

# Resolve repo root (set at install time by Makefile, or relative to this script when run from repo)
PI_REPO="__PI_REPO_PATH__"
PI_EXEC="node "$PI_REPO/packages/coding-agent/dist/cli.js""
PI_FORKS_DIR="$HOME/.pi/agent-forks"

show_help() {
	cat <<EOF
Usage: pi-fork [fork-name] [pi args...]
       pi-fork --list
       pi-fork --remove <fork-name>
       pi-fork --help

Run pi from ${PI_REPO} with an isolated state directory.
Each fork has its own auth, settings, sessions, and extensions.

Commands:
  [fork-name] [args...]   Run pi with the given fork (defaults to current
                           directory basename), creates if missing
  --list                  List all existing forks
  --remove <fork-name>    Remove a fork and its data
  --help                  Show this help
EOF
}

list_forks() {
	if [ ! -d "$PI_FORKS_DIR" ]; then
		echo "No forks exist yet."
		exit 0
	fi
	echo "Existing pi forks:"
	for fork_dir in "$PI_FORKS_DIR"/*/; do
		if [ -d "$fork_dir" ]; then
			local name
			name=$(basename "$fork_dir")
			local size
			size=$(du -sh "$fork_dir" 2>/dev/null | cut -f1)
			echo "  $name  ($size)"
		fi
	done
}

remove_fork() {
	local fork_name="$1"
	local fork_dir="$PI_FORKS_DIR/$fork_name"
	if [ ! -d "$fork_dir" ]; then
		echo "Error: Fork '$fork_name' does not exist." >&2
		exit 1
	fi
	echo "Removing fork '$fork_name' ($(du -sh "$fork_dir" | cut -f1))..."
	rm -rf "$fork_dir"
	echo "Done."
}

ensure_fork() {
	local fork_name="$1"
	local fork_dir="$PI_FORKS_DIR/$fork_name"

	if [ ! -d "$fork_dir" ]; then
		echo "Creating new pi fork: $fork_name"
		mkdir -p "$fork_dir"

		# Copy default settings and auth from main agent dir if they exist
		if [ -f "$HOME/.pi/agent/settings.json" ]; then
			cp "$HOME/.pi/agent/settings.json" "$fork_dir/settings.json"
			echo "  - Copied settings from default pi"
		fi
		if [ -f "$HOME/.pi/agent/auth.json" ]; then
			cp "$HOME/.pi/agent/auth.json" "$fork_dir/auth.json"
			echo "  - Copied auth from default pi"
		fi
		if [ -f "$HOME/.pi/agent/models.json" ]; then
			cp "$HOME/.pi/agent/models.json" "$fork_dir/models.json"
			echo "  - Copied models from default pi"
		fi

		echo "Fork '$fork_name' created at $fork_dir"
	fi
}

fork_name_from_dir() {
	local name
	name=$(basename "$PWD")
	# Replace spaces/special chars with hyphens
	name=$(echo "$name" | tr ' _' '--' | tr -cd 'a-zA-Z0-9_-')
	if [ -z "$name" ]; then
		name="root"
	fi
	echo "$name"
}

# Check that the dist is built
if [ ! -f "$PI_REPO/packages/coding-agent/dist/cli.js" ]; then
	echo "Error: pi dist not found. Run 'make build' in $PI_REPO first." >&2
	exit 1
fi

# If no args, auto-name from current directory
if [ $# -eq 0 ]; then
	FORK_NAME=$(fork_name_from_dir)
	ensure_fork "$FORK_NAME"
	FORK_DIR="$PI_FORKS_DIR/$FORK_NAME"
	export PI_CODING_AGENT_DIR="$FORK_DIR"
	exec $PI_EXEC
fi

case "$1" in
	--help|-h)
		show_help
		;;
	--list|-l)
		list_forks
		;;
	--remove|-r)
		if [ $# -lt 2 ]; then
			echo "Error: --remove requires a fork name." >&2
			exit 1
		fi
		remove_fork "$2"
		;;
	--*)
		# A pi flag (e.g. --version, --model), auto-name and pass through
		FORK_NAME=$(fork_name_from_dir)
		ensure_fork "$FORK_NAME"
		FORK_DIR="$PI_FORKS_DIR/$FORK_NAME"
		export PI_CODING_AGENT_DIR="$FORK_DIR"
		exec $PI_EXEC "$@"
		;;
	-*)
		# A pi short flag (e.g. -p "hello"), auto-name and pass through
		FORK_NAME=$(fork_name_from_dir)
		ensure_fork "$FORK_NAME"
		FORK_DIR="$PI_FORKS_DIR/$FORK_NAME"
		export PI_CODING_AGENT_DIR="$FORK_DIR"
		exec $PI_EXEC "$@"
		;;
	*)
		# A fork name, optionally followed by pi args
		FORK_NAME="$1"
		shift
		ensure_fork "$FORK_NAME"
		FORK_DIR="$PI_FORKS_DIR/$FORK_NAME"
		export PI_CODING_AGENT_DIR="$FORK_DIR"
		exec $PI_EXEC "$@"
		;;
esac
