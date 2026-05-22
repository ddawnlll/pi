import React from "react";
import { OvernightPanel } from "../components/brain/overnight/OvernightPanel";

export function BrainOvernightPage() {
	return (
		<div className="p-6 max-w-lg mx-auto">
			<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200 mb-4">
				Overnight Run
			</h1>
			<OvernightPanel />
		</div>
	);
}
