import React from "react";

interface PaginationProps {
	page: number;
	total: number;
	limit?: number;
	onPageChange: (page: number) => void;
}

export function Pagination({ page, total, limit = 20, onPageChange }: PaginationProps) {
	const totalPages = Math.max(1, Math.ceil(total / limit));
	if (totalPages <= 1) return null;

	const pages: (number | "ellipsis")[] = [];
	// Always show first, last, and current ±2
	for (let i = 1; i <= totalPages; i++) {
		if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
			pages.push(i);
		} else if (pages[pages.length - 1] !== "ellipsis") {
			pages.push("ellipsis");
		}
	}

	return (
		<div className="flex items-center justify-center gap-1 py-3">
			<button
				onClick={() => onPageChange(page - 1)}
				disabled={page <= 1}
				className="px-2 py-1 text-xs rounded text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed"
			>
				Prev
			</button>
			{pages.map((p, i) =>
				p === "ellipsis" ? (
					<span key={`e-${i}`} className="px-1 text-xs text-stone-400">
						...
					</span>
				) : (
					<button
						key={p}
						onClick={() => onPageChange(p)}
						className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
							p === page
								? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
								: "text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
						}`}
					>
						{p}
					</button>
				),
			)}
			<button
				onClick={() => onPageChange(page + 1)}
				disabled={page >= totalPages}
				className="px-2 py-1 text-xs rounded text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed"
			>
				Next
			</button>
		</div>
	);
}
