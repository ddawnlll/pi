/**
 * PiLogger - Structured logging with JSON format support and correlation IDs.
 *
 * Usage:
 *   const log = new PiLogger({ planExecId: "abc-123" });
 *   log.info("Workspace execution started");
 *   log.error("Execution failed", { workspaceId: "ws-1" });
 *
 * Environment variables:
 *   PI_LOG_FORMAT=json  - emit structured JSON log lines (default: text)
 *   PI_LOG_LEVEL=debug  - minimum log level (default: info)
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	/** ISO-8601 timestamp */
	timestamp: string;
	/** Log severity level */
	level: LogLevel;
	/** Log message */
	message: string;
	/** Optional correlation / context fields */
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Level ordering
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const DEFAULT_LOG_LEVEL: LogLevel = "info";

// ---------------------------------------------------------------------------
// Environment helpers (memoised per-module load)
// ---------------------------------------------------------------------------

function resolveLogFormat(): "json" | "text" {
	return process.env.PI_LOG_FORMAT === "json" ? "json" : "text";
}

function resolveLogLevel(): LogLevel {
	const raw = process.env.PI_LOG_LEVEL as LogLevel | undefined;
	if (raw && LEVEL_ORDER[raw] !== undefined) return raw;
	return DEFAULT_LOG_LEVEL;
}

// ---------------------------------------------------------------------------
// PiLogger
// ---------------------------------------------------------------------------

export class PiLogger {
	private static defaultContext: Record<string, unknown> = {};

	private readonly context: Record<string, unknown>;
	private readonly format: "json" | "text";
	private readonly level: LogLevel;

	constructor(context?: Record<string, unknown>) {
		this.context = { ...PiLogger.defaultContext, ...context };
		this.format = resolveLogFormat();
		this.level = resolveLogLevel();
	}

	// -- Static defaults ----------------------------------------------------

	/**
	 * Set context fields that every PiLogger instance will include.
	 * Useful for process-wide fields (e.g. service name, version).
	 */
	static setDefaultContext(ctx: Record<string, unknown>): void {
		PiLogger.defaultContext = { ...ctx };
	}

	// -- Child loggers ------------------------------------------------------

	/**
	 * Derive a child logger that merges the supplied context on top of
	 * the parent's context. The parent is not affected.
	 */
	child(context: Record<string, unknown>): PiLogger {
		return new PiLogger({ ...this.context, ...context });
	}

	// -- Public API ---------------------------------------------------------

	debug(message: string, meta?: Record<string, unknown>): void {
		this.write("debug", message, meta);
	}

	info(message: string, meta?: Record<string, unknown>): void {
		this.write("info", message, meta);
	}

	warn(message: string, meta?: Record<string, unknown>): void {
		this.write("warn", message, meta);
	}

	error(message: string, meta?: Record<string, unknown>): void {
		this.write("error", message, meta);
	}

	// -- Internal -----------------------------------------------------------

	private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
		// Level gate
		if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			...this.context,
			...meta,
		};

		if (this.format === "json") {
			this.writeJson(entry);
		} else {
			this.writeText(level, entry, meta);
		}
	}

	private writeJson(entry: LogEntry): void {
		const line = JSON.stringify(entry);
		if (entry.level === "error") {
			process.stderr.write(`${line}\n`);
		} else {
			process.stdout.write(`${line}\n`);
		}
	}

	private writeText(level: LogLevel, entry: LogEntry, _meta?: Record<string, unknown>): void {
		const parts: string[] = [];

		// Correlation ID prefix
		if (entry.planExecId) {
			parts.push(`[${entry.planExecId}]`);
		}

		// Level tag
		const levelTag = level.toUpperCase().padEnd(5);
		parts.push(`[${levelTag}]`);

		parts.push(entry.message);

		const line = parts.join(" ");

		if (level === "error") {
			process.stderr.write(`${line}\n`);
		} else {
			process.stdout.write(`${line}\n`);
		}
	}
}
