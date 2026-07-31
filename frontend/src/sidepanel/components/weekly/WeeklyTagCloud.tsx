import { useState } from "react";
import type { WeeklyGrowthTag } from "~lib/types";

interface WeeklyTagCloudProps {
  tags?: WeeklyGrowthTag[];
  emptyLabel: string;
  onSelect?: (tag: WeeklyGrowthTag) => void;
}

export function WeeklyTagCloud({
  tags = [],
  emptyLabel,
  onSelect,
}: WeeklyTagCloudProps) {
  const [activeName, setActiveName] = useState<string | null>(null);

  if (tags.length === 0) {
    return <p className="text-vesti-xs text-text-tertiary">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag, index) => {
        const name = tag.name?.trim();
        if (!name) return null;
        const isActive = activeName === name;
        const fontSize = 11 + Math.round(Math.max(0, tag.weight ?? 0) * 7);
        return (
          <button
            type="button"
            key={`${name}-${index}`}
            aria-pressed={isActive}
            title={`${name} · ${tag.count ?? 0}`}
            onClick={() => {
              setActiveName((current) => (current === name ? null : name));
              onSelect?.(tag);
            }}
            className={`rounded-full border px-2.5 py-1 leading-none transition-all ${
              isActive
                ? "scale-110 border-accent-primary bg-accent-primary-light text-text-primary"
                : "border-border-subtle bg-surface-card text-text-secondary hover:border-border-focus"
            }`}
            style={{ fontSize: `${fontSize}px` }}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
