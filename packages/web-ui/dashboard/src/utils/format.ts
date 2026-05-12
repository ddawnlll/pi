/**
 * Format elapsed milliseconds to h m s display.
 */
export function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

/**
 * Status → Tailwind text color class map.
 */
export const statusColorMap: Record<string, string> = {
	running: "text-green-500",
	paused: "text-yellow-500",
	completed: "text-blue-500",
	failed: "text-red-500",
};

export function getStatusColorClass(status: string): string {
	return statusColorMap[status] ?? "text-gray-500";
}

/**
 * Format token count for display (e.g., 142000 → "142k", 1200000 → "1.2M").
 */
export function formatTokens(count: number | undefined | null): string {
	if (count === undefined || count === null) return "\u2014";
	if (count >= 1_000_000) {
		const m = count / 1_000_000;
		return `${m.toFixed(m % 1 === 0 ? 0 : 1)}M`;
	}
	if (count >= 1_000) {
		const k = count / 1_000;
		return `${k.toFixed(k % 1 === 0 ? 0 : 1)}k`;
	}
	return String(count);
}

/**
 * Format cost for display (e.g., 1.5 → "$1.50").
 */
export function formatCost(usd: number | undefined | null): string {
	if (usd === undefined || usd === null) return "\u2014";
	return `$${usd.toFixed(2)}`;
}

/**
 * Format a percentage (e.g., 0.753 → "75.3%").
 */
export function formatPercent(value: number | undefined | null): string {
	if (value === undefined || value === null) return "\u2014";
	return `${(value * 100).toFixed(1)}%`;
}
