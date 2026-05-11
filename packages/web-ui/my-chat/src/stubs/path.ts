// Browser stub for node:path
export function join(...paths: string[]) {
	return paths.join("/");
}
export function resolve(...paths: string[]) {
	return paths.join("/");
}
export function isAbsolute(path: string) {
	return path.startsWith("/");
}
