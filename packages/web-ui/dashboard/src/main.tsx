import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./index.css";

console.log("[main] Starting Pi Dashboard bootstrap...");
console.time("[main] bootstrap");

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 0,
			retry: false,
		},
	},
});
console.log("[main] QueryClient created");
console.timeLog("[main] bootstrap");

const root = document.getElementById("root");
if (!root) {
	console.error("[main] FATAL: Root element #root not found in DOM!");
	throw new Error("Root element #root not found");
}
console.log("[main] Root element found, mounting React...");
console.timeLog("[main] bootstrap");

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</React.StrictMode>,
);

console.log("[main] React.createRoot + render called");
console.timeEnd("[main] bootstrap");
