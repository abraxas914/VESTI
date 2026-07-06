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
}

export function GraphLegend({ edgeLabel }: GraphLegendProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-sans text-text-tertiary">
      {LEGEND_ORDER.map((platform) => (
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
