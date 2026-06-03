import React from "react";

interface SchedulePickerProps {
	value: "now" | "tonight" | "custom";
	onChange: (v: "now" | "tonight" | "custom") => void;
	customTime?: string;
	onCustomTimeChange?: (t: string) => void;
}

export function SchedulePicker({ value, onChange, customTime, onCustomTimeChange }: SchedulePickerProps) {
	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				{([
					{ value: "now", label: "Run Now" },
					{ value: "tonight", label: "Tonight" },
					{ value: "custom", label: "Custom" },
				] as const).map((opt) => (
					<button
						key={opt.value}
						onClick={() => onChange(opt.value)}
						className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
							value === opt.value
								? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
								: "bg-stone-100 dark:bg-stone-800 text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-700"
						}`}
					>
						{opt.label}
					</button>
				))}
			</div>
			{value === "custom" && onCustomTimeChange && (
				<input
					type="time"
					value={customTime ?? "22:00"}
					onChange={(e) => onCustomTimeChange(e.target.value)}
					className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200"
				/>
			)}
		</div>
	);
}
