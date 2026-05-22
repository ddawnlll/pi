import React, { useCallback, useEffect, useRef, useState } from "react";

interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	debounceMs?: number;
}

export function SearchInput({
	value,
	onChange,
	placeholder = "Search...",
	debounceMs = 300,
}: SearchInputProps) {
	const [local, setLocal] = useState(value);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Sync external value changes
	useEffect(() => {
		setLocal(value);
	}, [value]);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const v = e.target.value;
			setLocal(v);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => onChange(v), debounceMs);
		},
		[onChange, debounceMs],
	);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	return (
		<div className="relative">
			<svg
				className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={2}
			>
				<circle cx="11" cy="11" r="8" />
				<line x1="21" y1="21" x2="16.65" y2="16.65" />
			</svg>
			<input
				type="text"
				value={local}
				onChange={handleChange}
				placeholder={placeholder}
				className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
			/>
		</div>
	);
}
