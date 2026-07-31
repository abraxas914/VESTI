import type { SVGProps } from "react";

export function InsightsWandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 13L10 6" />
      <path d="M10 2l.6.6M12 4l-.6-.6M10.6 2.6L11.4 3.4" />
      <path d="M10 6l1.5-1.5a1.5 1.5 0 00-2.1-2.1L8 3.9" />
      <path d="M13.5 2l.3-.3M13.8 3.5h-.5M14.5 2.8v-.5" />
    </svg>
  );
}
