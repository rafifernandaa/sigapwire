import type { KeyboardEvent } from "react";

/**
 * WAI-ARIA APG keyboard handler for horizontal role="tablist" bars.
 * Supports ArrowLeft, ArrowRight, Home, and End with automatic focus + activation.
 */
export function handleTabListKeyDown<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  orderedIds: readonly T[],
  currentId: T,
  onSelect: (nextId: T) => void,
  tabIdPrefix: string,
): void {
  const index = orderedIds.indexOf(currentId);
  if (index === -1 || orderedIds.length <= 1) return;

  let nextIndex: number | null = null;
  if (event.key === "ArrowRight") {
    nextIndex = (index + 1) % orderedIds.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (index - 1 + orderedIds.length) % orderedIds.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = orderedIds.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  const nextId = orderedIds[nextIndex];
  onSelect(nextId);
  const nextEl = document.getElementById(`${tabIdPrefix}-tab-${nextId}`);
  nextEl?.focus();
}

export function CardListSkeleton({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="space-y-3"
    >
      <p className="sr-only">{label}</p>
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="sw-card p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="sw-skeleton-bar h-4 w-16" />
            <div className="sw-skeleton-bar h-4 w-24" />
            <div className="sw-skeleton-bar h-4 w-14" />
          </div>
          <div className="sw-skeleton-bar h-5 w-3/4" />
          <div className="sw-skeleton-bar h-3.5 w-full" />
          <div className="sw-skeleton-bar h-3.5 w-2/3" />
        </div>
      ))}
    </div>
  );
}
