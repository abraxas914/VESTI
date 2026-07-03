import type { ChatSummaryData } from "../types";

export interface SummaryCardLabels {
  coreQuestion?: string;
  thinkingJourney?: string;
  step?: string;
  example?: string;
  keyInsights?: string;
  unresolvedThreads?: string;
  metaObservations?: string;
  thinkingStyle?: string;
  emotionalTone?: string;
  depth?: string;
  nextSteps?: string;
  fallback?: string;
}

interface StructuredSummaryCardProps {
  data: ChatSummaryData;
  compact?: boolean;
  labels?: SummaryCardLabels;
}

function FallbackBadge({ label }: { label?: string }) {
  return (
    <span className="tag-paper inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium text-text-tertiary font-sans">
      {label ?? "Fallback plain text"}
    </span>
  );
}

function SectionEyebrow({ children, compact = false }: {
  children: string;
  compact?: boolean;
}) {
  return (
    <h4
      className={`mb-2 font-medium uppercase tracking-[0.05em] text-text-secondary font-sans ${
        compact ? "text-[11px]" : "text-[12px]"
      }`}
    >
      {children}
    </h4>
  );
}

export function StructuredSummaryCard({ data, compact = false, labels }: StructuredSummaryCardProps) {
  const bodyTextClass = compact
    ? "text-[13px] text-text-primary"
    : "text-reading-lg text-text-primary";

  return (
    <article
      className={`vesti-artifact card-shadow-warm rounded-card border border-border-subtle
    bg-bg-surface text-text-primary ${
      compact
        ? "px-4 py-4 text-[13px]"
        : "px-6 py-6 text-body-lg"
    }`}
    >
      <header className="mb-6 grid gap-3">
        <h3
          className={compact
            ? "text-[15px] leading-[1.4] text-text-primary font-medium"
            : "text-[20px] leading-[1.4] text-text-primary font-medium"}
        >
          {data.meta.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {data.meta.tags.map((tag) => (
            <span
              key={tag}
              className="tag-paper inline-flex items-center rounded-[6px] px-2 py-0.5 text-[13px] font-medium text-text-secondary font-sans"
            >
              {tag}
            </span>
          ))}
          {data.meta.fallback && <FallbackBadge label={labels?.fallback} />}
        </div>
      </header>

      <section className="mb-6 rounded-r-lg border-l-4 border-border-default bg-bg-secondary px-4 py-3">
        <SectionEyebrow compact={compact}>{labels?.coreQuestion ?? "Core Question"}</SectionEyebrow>
        <p className={bodyTextClass}>{data.core_question}</p>
      </section>

      <section className="mb-6">
        <SectionEyebrow compact={compact}>{labels?.thinkingJourney ?? "Thinking Journey"}</SectionEyebrow>
        <ol className="space-y-3 text-text-primary">
          {data.thinking_journey.map((item) => (
            <li key={`${item.step}-${item.speaker}-${item.assertion}`} className="rounded-md border border-border-subtle p-3">
              <p className="mb-1 text-[11px] font-medium text-text-secondary font-sans">
                {labels?.step ?? "Step"} {item.step} · {item.speaker}
              </p>
              <p className={bodyTextClass}>{item.assertion}</p>
              {item.real_world_anchor && (
                <p className={`mt-1.5 text-text-tertiary ${compact ? "text-[12px]" : "text-[13px]"}`}>
                  <span className="font-medium text-text-secondary">{labels?.example ?? "Example: "}</span>
                  {item.real_world_anchor}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-6">
        <SectionEyebrow compact={compact}>{labels?.keyInsights ?? "Key Insights"}</SectionEyebrow>
        <ul className="space-y-3 text-text-primary">
          {data.key_insights.map((item, index) => (
            <li key={`${item.term}-${index}`} className="rounded-md border border-border-subtle p-3">
              <p className={`font-medium ${compact ? "text-[13px]" : ""}`}>{item.term}</p>
              <p className={`mt-1 text-text-secondary ${compact ? "text-[13px]" : ""}`}>
                {item.definition}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {data.unresolved_threads.length > 0 && (
        <section className="mb-6">
          <SectionEyebrow compact={compact}>{labels?.unresolvedThreads ?? "Unresolved Threads"}</SectionEyebrow>
          <ul className={`list-disc space-y-3 pl-6 text-text-primary ${compact ? "text-[13px]" : ""}`}>
            {data.unresolved_threads.map((item, index) => (
              <li key={`${item}-${index}`} className="pl-1">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-6 rounded-lg border border-border-subtle bg-bg-secondary/60 px-4 py-3">
        <SectionEyebrow compact={compact}>{labels?.metaObservations ?? "Meta Observations"}</SectionEyebrow>
        <p className={`text-text-primary ${compact ? "text-[13px]" : ""}`}>
          <span className="font-medium">{labels?.thinkingStyle ?? "Thinking style:"}</span> {data.meta_observations.thinking_style}
        </p>
        <p className={`text-text-primary ${compact ? "text-[13px]" : ""}`}>
          <span className="font-medium">{labels?.emotionalTone ?? "Emotional tone:"}</span> {data.meta_observations.emotional_tone}
        </p>
        <p className={`text-text-primary ${compact ? "text-[13px]" : ""}`}>
          <span className="font-medium">{labels?.depth ?? "Depth:"}</span> {data.meta_observations.depth_level}
        </p>
      </section>

      {data.actionable_next_steps.length > 0 && (
        <section>
          <SectionEyebrow compact={compact}>{labels?.nextSteps ?? "Next Steps"}</SectionEyebrow>
          <ul className="space-y-3">
            {data.actionable_next_steps.map((item, index) => (
              <li
                key={`${item}-${index}`}
                className={`flex items-start gap-2 text-text-primary ${compact ? "text-[13px]" : ""}`}
              >
                <input
                  aria-label={`action-item-${index + 1}`}
                  type="checkbox"
                  disabled
                  className="mt-1 h-3.5 w-3.5 rounded border-border-default"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
