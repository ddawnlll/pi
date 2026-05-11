/**
 * Database configuration with environment variable injection.
 *
 * All operational values are configurable — no hardcoded limits.
 * Follows the Phase 1 configuration rule (§G in architecture plan).
 */

export interface DbConfig {
	/** PostgreSQL host */
	host: string;
	/** PostgreSQL port */
	port: number;
	/** Database name */
	database: string;
	/** Database user */
	user: string;
	/** Database password */
	password: string;
	/** Maximum connection pool size */
	poolMax: number;
	/** Connection idle timeout in ms */
	idleTimeoutMs: number;
	/** Connection timeout in ms */
	connectionTimeoutMs: number;
	/** Maximum transaction retry attempts */
	maxRetries: number;
	/** Base backoff delay in ms for retries */
	retryBaseDelayMs: number;
	/** Maximum backoff delay in ms for retries */
	retryMaxDelayMs: number;
	/** SSL mode */
	ssl: boolean | { rejectUnauthorized: boolean };
}

export const DEFAULT_DB_CONFIG: DbConfig = {
	host: "localhost",
	port: 5432,
	database: "pi_executor",
	user: "pi",
	password: "",
	poolMax: 20,
	idleTimeoutMs: 30_000,
	connectionTimeoutMs: 5_000,
	maxRetries: 3,
	retryBaseDelayMs: 100,
	retryMaxDelayMs: 2_000,
	ssl: false,
};

/**
 * Load DB config from environment variables.
 * Falls back to defaults for missing values.
 */
export function loadDbConfig(overrides?: Partial<DbConfig>): DbConfig {
	const env = process.env;
	return {
		host: env.PGHOST ?? DEFAULT_DB_CONFIG.host,
		port: env.PGPORT ? Number(env.PGPORT) : DEFAULT_DB_CONFIG.port,
		database: env.PGDATABASE ?? DEFAULT_DB_CONFIG.database,
		user: env.PGUSER ?? DEFAULT_DB_CONFIG.user,
		password: env.PGPASSWORD ?? DEFAULT_DB_CONFIG.password,
		poolMax: env.PGPOOL_MAX ? Number(env.PGPOOL_MAX) : DEFAULT_DB_CONFIG.poolMax,
		idleTimeoutMs: env.PGIDLE_TIMEOUT ? Number(env.PGIDLE_TIMEOUT) : DEFAULT_DB_CONFIG.idleTimeoutMs,
		connectionTimeoutMs: env.PGCONN_TIMEOUT ? Number(env.PGCONN_TIMEOUT) : DEFAULT_DB_CONFIG.connectionTimeoutMs,
		maxRetries: env.PG_MAX_RETRIES ? Number(env.PG_MAX_RETRIES) : DEFAULT_DB_CONFIG.maxRetries,
		retryBaseDelayMs: env.PG_RETRY_BASE_DELAY ? Number(env.PG_RETRY_BASE_DELAY) : DEFAULT_DB_CONFIG.retryBaseDelayMs,
		retryMaxDelayMs: env.PG_RETRY_MAX_DELAY ? Number(env.PG_RETRY_MAX_DELAY) : DEFAULT_DB_CONFIG.retryMaxDelayMs,
		ssl: env.PGSSLMODE === "require" ? true : env.PGSSLMODE === "no-verify" ? { rejectUnauthorized: false } : false,
		...overrides,
	};
}
