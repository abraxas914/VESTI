import { useCallback, useMemo, useRef } from "react";

// Draggable, two-handle time-range scrubber for the conversation list. Drag the
// handles to filter conversations into a [start, end] window over the active
// timestamp (conversation time vs capture time). A light histogram shows where
// conversations cluster. Presentational only — the page owns the domain/range
// state and applies the filter.

interface TimelineScrubberProps {
  domainMin: number;
  domainMax: number;
  /** Current selected window. */
  start: number;
  end: number;
  /** Counts per equal-width time bucket across [domainMin, domainMax]. */
  histogram: number[];
  onChange: (start: number, end: number) => void;
  onReset: () => void;
  locale: string;
  resetLabel: string;
  /** True when the selection is the full domain (reset disabled). */
  isFull: boolean;
}

export function TimelineScrubber({
  domainMin,
  domainMax,
  start,
  end,
  histogram,
  onChange,
  onReset,
  locale,
  resetLabel,
  isFull,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const span = Math.max(1, domainMax - domainMin);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale || "en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [locale],
  );

  const pct = useCallback(
    (t: number) => ((Math.min(domainMax, Math.max(domainMin, t)) - domainMin) / span) * 100,
    [domainMin, domainMax, span],
  );

  const timeAtClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return domainMin;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      return domainMin + Math.min(1, Math.max(0, ratio)) * span;
    },
    [domainMin, span],
  );

  const startDrag = useCallback(
    (handle: "start" | "end") => (event: React.PointerEvent) => {
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [],
  );

  const onMove = useCallback(
    (handle: "start" | "end") => (event: React.PointerEvent) => {
      if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;
      const t = timeAtClientX(event.clientX);
      if (handle === "start") {
        onChange(Math.min(t, end), end);
      } else {
        onChange(start, Math.max(t, start));
      }
    },
    [timeAtClientX, onChange, start, end],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      const el = event.currentTarget as HTMLElement;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    },
    [],
  );

  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax <= domainMin) {
    return null;
  }

  const startPct = pct(start);
  const endPct = pct(end);
  const maxCount = Math.max(1, ...histogram);

  return (
    <div className="px-1 pb-1 pt-0.5">
      <div className="mb-1 flex items-center justify-between text-[10.5px] text-text-tertiary">
        <span>{fmt.format(new Date(start))}</span>
        <button
          type="button"
          onClick={onReset}
          disabled={isFull}
          className="rounded px-1.5 py-0.5 text-[10.5px] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-secondary disabled:opacity-40"
        >
          {resetLabel}
        </button>
        <span>{fmt.format(new Date(end))}</span>
      </div>

      <div ref={trackRef} className="relative h-9 select-none">
        {/* histogram */}
        <div className="absolute inset-0 flex items-end gap-[1px]">
          {histogram.map((count, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-bg-tertiary"
              style={{ height: `${Math.max(4, (count / maxCount) * 100)}%` }}
            />
          ))}
        </div>

        {/* selected band */}
        <div
          className="absolute top-0 bottom-0 rounded-sm bg-accent-primary-light"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />

        {/* handles */}
        <button
          type="button"
          aria-label="range start"
          onPointerDown={startDrag("start")}
          onPointerMove={onMove("start")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
          style={{ left: `${startPct}%` }}
        >
          <span className="absolute left-1/2 top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-primary" />
        </button>
        <button
          type="button"
          aria-label="range end"
          onPointerDown={startDrag("end")}
          onPointerMove={onMove("end")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
          style={{ left: `${endPct}%` }}
        >
          <span className="absolute left-1/2 top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-primary" />
        </button>
      </div>
    </div>
  );
}
