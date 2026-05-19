import "@testing-library/jest-dom/vitest";

// Mock EventSource for tests that use SSE hooks
class MockEventSource {
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	readyState: number = 0;
	CONNECTING: number = 0;
	OPEN: number = 1;
	CLOSED: number = 2;

	constructor(_url: string) {
		// Auto-open in tests
		setTimeout(() => {
			this.readyState = this.OPEN;
			if (this.onopen) this.onopen();
		}, 0);
	}

	close() {
		this.readyState = this.CLOSED;
	}

	addEventListener(_event: string, _handler: (...args: unknown[]) => void) {
		// noop
	}

	removeEventListener(_event: string, _handler: (...args: unknown[]) => void) {
		// noop
	}

	dispatchEvent(_event: Event): boolean {
		return true;
	}
}

// @ts-expect-error - assign to globalThis for test environment
globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
