import React from "react";

interface LoadingSkeletonProps {
	variant: "card" | "row" | "chart" | "text";
	count?: number;
	className?: string;
}

function SkeletonBlock({ className, style }: { className: string; style?: React.CSSProperties }) {
	return (
		<div
			className={`animate-pulse rounded bg-stone-200 dark:bg-stone-700 ${className}`}
			style={style}
		/>
	);
}

function SkeletonCard() {
	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
			<SkeletonBlock className="h-4 w-3/4" />
			<SkeletonBlock className="h-3 w-1/2" />
			<SkeletonBlock className="h-3 w-full" />
			<div className="flex gap-2 pt-2">
				<SkeletonBlock className="h-6 w-16 rounded-full" />
				<SkeletonBlock className="h-6 w-20 rounded-full" />
			</div>
		</div>
	);
}

function SkeletonRow() {
	return (
		<div className="flex items-center gap-3 py-2 border-b border-stone-100 dark:border-stone-800">
			<SkeletonBlock className="h-3 w-3 rounded-full shrink-0" />
			<SkeletonBlock className="h-3 flex-1" />
			<SkeletonBlock className="h-3 w-16" />
		</div>
	);
}

function SkeletonChart() {
	return (
		<div className="space-y-2">
			<div className="flex items-end gap-1 h-24">
				{Array.from({ length: 8 }).map((_, i) => (
					<SkeletonBlock
						key={i}
						className="flex-1 rounded-t"
						style={{ height: `${30 + Math.random() * 70}%` }}
					/>
				))}
			</div>
			<SkeletonBlock className="h-3 w-1/3 mx-auto" />
		</div>
	);
}

function SkeletonText() {
	return (
		<div className="space-y-2">
			<SkeletonBlock className="h-3 w-full" />
			<SkeletonBlock className="h-3 w-5/6" />
			<SkeletonBlock className="h-3 w-4/6" />
		</div>
	);
}

export function LoadingSkeleton({
	variant,
	count = 1,
	className = "",
}: LoadingSkeletonProps) {
	const items = Array.from({ length: count });

	const renderItem = () => {
		switch (variant) {
			case "card":
				return <SkeletonCard />;
			case "row":
				return <SkeletonRow />;
			case "chart":
				return <SkeletonChart />;
			case "text":
				return <SkeletonText />;
		}
	};

	return (
		<div className={`space-y-3 ${className}`} role="status" aria-label="Loading">
			{items.map((_, i) => (
				<div key={i}>{renderItem()}</div>
			))}
		</div>
	);
}
