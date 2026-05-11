// Browser stub for node:crypto
export function randomUUID() {
	return crypto.randomUUID();
}
export function randomBytes(size: number) {
	return crypto.getRandomValues(new Uint8Array(size));
}
