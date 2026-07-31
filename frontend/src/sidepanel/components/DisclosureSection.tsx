import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface DisclosureSectionProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function DisclosureSection({
  title,
  description,
  icon,
  children,
  defaultOpen = false,
}: DisclosureSectionProps) {
  return (
    <details
      open={defaultOpen || undefined}
      className="group rounded-xl border border-border-subtle bg-bg-surface/95"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start gap-2">
          {icon ? (
            <span className="mt-0.5 text-text-tertiary">{icon}</span>
          ) : null}
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-text-primary">
              {title}
            </span>
            {description ? (
              <span className="mt-0.5 block text-[11px] leading-[1.45] text-text-tertiary">
                {description}
              </span>
            ) : null}
          </span>
        </span>

        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200 group-open:rotate-180" />
      </summary>

      <div className="border-t border-border-subtle/90 px-4 pb-4 pt-3">
        {children}
      </div>
    </details>
  );
}
