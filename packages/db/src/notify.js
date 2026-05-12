"use strict";
/**
 * LISTEN/NOTIFY client with reconnection logic.
 *
 * Provides a client that listens on PostgreSQL channels for real-time events
 * and emits them as typed callbacks. Includes automatic reconnection with
 * exponential backoff.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyClient = void 0;
const pg_1 = __importDefault(require("pg"));
const config_js_1 = require("./config.js");
const { Client } = pg_1.default;
/**
 * Default reconnection configuration
 */
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30000;
/**
 * LISTEN/NOTIFY client
 *
 * Connects to PostgreSQL and listens on specified channels.
 * Automatically reconnects with exponential backoff on disconnection.
 */
class NotifyClient {
    client = null;
    channels = new Set();
    handlers = new Map();
    config;
    reconnectAttempt = 0;
    reconnectTimer = null;
    shouldReconnect = true;
    connected = false;
    constructor(config) {
        this.config = config !== null && config !== void 0 ? config : (0, config_js_1.loadDbConfig)();
    }
    /**
     * Connect to PostgreSQL and start listening on all registered channels.
     */
    async connect() {
        this.shouldReconnect = true;
        try {
            this.client = new Client({
                host: this.config.host,
                port: this.config.port,
                database: this.config.database,
                user: this.config.user,
                password: this.config.password,
                ssl: this.config.ssl,
            });
            this.client.on("notification", (msg) => {
                if (msg.channel && msg.payload) {
                    this.dispatch(msg.channel, msg.payload);
                }
            });
            this.client.on("error", (err) => {
                console.error("[notify] Client error:", err.message);
                this.handleDisconnect();
            });
            this.client.on("end", () => {
                this.handleDisconnect();
            });
            await this.client.connect();
            this.connected = true;
            this.reconnectAttempt = 0;
            // Re-register channels
            for (const channel of this.channels) {
                await this.client.query(`LISTEN ${channel}`);
            }
            console.log(`[notify] Connected, listening on ${this.channels.size} channels`);
        }
        catch (err) {
            console.error("[notify] Connection failed:", err instanceof Error ? err.message : String(err));
            this.scheduleReconnect();
        }
    }
    /**
     * Disconnect and stop reconnecting.
     */
    async disconnect() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.client) {
            try {
                await this.client.end();
            }
            catch (_a) {
                // Ignore errors during disconnect
            }
            this.client = null;
        }
        this.connected = false;
    }
    /**
     * Register a channel to listen on.
     *
     * @param channel - Channel name
     * @param handler - Event handler
     */
    on(channel, handler) {
        this.channels.add(channel);
        if (!this.handlers.has(channel)) {
            this.handlers.set(channel, new Set());
        }
        this.handlers.get(channel).add(handler);
        // If already connected, start listening on this channel
        if (this.connected && this.client) {
            this.client.query(`LISTEN ${channel}`).catch((err) => {
                console.error(`[notify] Failed to LISTEN on ${channel}:`, err.message);
            });
        }
    }
    /**
     * Remove a channel handler.
     *
     * @param channel - Channel name
     * @param handler - Handler to remove
     */
    off(channel, handler) {
        const handlers = this.handlers.get(channel);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.handlers.delete(channel);
                this.channels.delete(channel);
                // UNLISTEN if we have no more handlers
                if (this.connected && this.client) {
                    this.client.query(`UNLISTEN ${channel}`).catch(() => { });
                }
            }
        }
    }
    /**
     * Check if currently connected.
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Dispatch a notification to registered handlers.
     */
    dispatch(channel, payload) {
        const handlers = this.handlers.get(channel);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(channel, payload);
                }
                catch (err) {
                    console.error(`[notify] Handler error on channel ${channel}:`, err);
                }
            }
        }
    }
    /**
     * Handle connection loss.
     */
    handleDisconnect() {
        this.connected = false;
        this.client = null;
        if (this.shouldReconnect) {
            console.log("[notify] Disconnected, scheduling reconnect");
            this.scheduleReconnect();
        }
    }
    /**
     * Schedule a reconnection attempt with exponential backoff.
     */
    scheduleReconnect() {
        if (!this.shouldReconnect)
            return;
        const delay = Math.min(DEFAULT_RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt), DEFAULT_RECONNECT_MAX_MS);
        console.log(`[notify] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempt++;
            this.connect().catch((err) => {
                console.error("[notify] Reconnect failed:", err.message);
            });
        }, delay);
    }
}
exports.NotifyClient = NotifyClient;
