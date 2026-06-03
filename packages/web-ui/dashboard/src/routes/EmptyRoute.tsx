import { History } from "lucide-react";

export function EmptyRoute() {
	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-3 text-stone-400 dark:text-stone-500">
			<History size={32} strokeWidth={1.2} />
			<p className="text-sm">Your Pi cockpit is ready. Upload a plan to begin.</p>
		</div>
	);
}
