"use client";

import {
  PLATFORM_FILTER_OPTIONS,
  getPlatformLabel,
} from "../../constants/platform";
import type { Platform } from "../../types";
import { GRAPH_PLATFORM_COLORS } from "./temporal-graph-utils";

const LEGEND_ORDER: Platform[] = [...PLATFORM_FILTER_OPTIONS];

interface GraphLegendProps {
  edgeLabel?: string;
  /** When provided, only these platforms are shown (e.g. those present in data). */
  platforms?: Platform[];
  /** Semantic groups (topic/project/platform) currently driving node colors.
   * When provided, replaces the platform swatches. */
  groups?: { key: string; label: string; color: string }[];
}

export function GraphLegend({ edgeLabel, platforms, groups }: GraphLegendProps) {
  const visible = platforms
    ? LEGEND_ORDER.filter((platform) => platforms.includes(platform))
    : LEGEND_ORDER;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-sans text-text-tertiary">
      {groups
        ? groups.map((group) => (
            <div key={group.key} className="flex items-center gap-1.5">
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <span>{group.label}</span>
            </div>
          ))
        : visible.map((platform) => (
            <div key={platform} className="flex items-center gap-1.5">
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ backgroundColor: GRAPH_PLATFORM_COLORS[platform] }}
              />
              <span>{getPlatformLabel(platform)}</span>
            </div>
          ))}
      <div className="flex items-center gap-1.5">
        <span className="h-px w-3.5 rounded-full bg-[rgba(100,98,90,0.45)] dark:bg-[rgba(180,178,168,0.45)]" />
        <span>{edgeLabel ?? "edge = semantic similarity"}</span>
      </div>
    </div>
  );
}
