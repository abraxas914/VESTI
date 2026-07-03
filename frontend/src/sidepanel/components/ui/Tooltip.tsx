import React, { useEffect, useRef, useState } from "react";

// Lightweight, dependency-free hover/focus tooltip card. Shows a title and an
// optional one-line description after a short delay. Used for the dock and other
// feature affordances so users get a clear "what does this do" on hover. Mirrors
// the design tokens already used by ConversationCard's inline tooltip.

type TooltipSide = "left" | "right" | "top" | "bottom";

const SIDE_CLASSES: Record<TooltipSide, string> = {
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
};

interface TooltipProps {
  /** Bold title line. */
  title: string;
  /** Optional secondary description line (wraps). */
  description?: string;
  side?: TooltipSide;
  delayMs?: number;
  children: React.ReactNode;
}

export function Tooltip({
  title,
  description,
  side = "left",
  delayMs = 200,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => clear, []);

  const show = () => {
    clear();
    timerRef.current = window.setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  if (!title && !description) return <>{children}</>;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 w-max max-w-[200px] whitespace-normal rounded-md bg-text-primary px-2.5 py-1.5 text-left shadow-popover ${SIDE_CLASSES[side]}`}
        >
          <span className="block text-[11px] font-semibold leading-tight text-white">
            {title}
          </span>
          {description ? (
            <span className="mt-0.5 block text-[10px] leading-snug text-white/70">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
