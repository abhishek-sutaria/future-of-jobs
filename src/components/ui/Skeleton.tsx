export function Skeleton({ className = '', ...props }: { className?: string } & React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={`animate-pulse rounded bg-white/[0.06] ${className}`}
            {...props}
        />
    );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
    return (
        <div className="space-y-2.5">
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    className="h-3 rounded-full"
                    style={{ width: `${70 + Math.random() * 25}%` }}
                />
            ))}
        </div>
    );
}
