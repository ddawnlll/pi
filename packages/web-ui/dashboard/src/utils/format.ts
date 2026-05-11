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
