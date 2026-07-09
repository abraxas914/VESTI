import type { DashboardLabels, LearnProfile, StorageApi } from "../types";
import { SendToMenu } from "./SendToMenu";
import { buildLearnMarkdown } from "../lib/exploreMarkdown";

// "学习 Learn": presentational view of the locally-computed learning map —
// knowledge domains (with a depth mix), a glossary of things learned, and open
// loops. The host computes the profile + passes localized labels.

interface LearnCardProps {
  profile?: LearnProfile;
  labels: DashboardLabels["learn"];
  onOpenConversation?: (conversationId: number) => void;
  storage?: StorageApi;
  sendToLabels?: DashboardLabels["library"];
}

export function LearnCard({ profile, labels, onOpenConversation, storage, sendToLabels }: LearnCardProps) {
  const confidenceLabel: Record<string, string> = {
    low: labels.confidenceLow,
    medium: labels.confidenceMedium,
    high: labels.confidenceHigh,
  };

  if (!profile || !profile.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-10 text-center">
        <h3 className="text-[15px] font-medium text-text-primary">{labels.title}</h3>
        <p className="mt-2 max-w-md text-[13px] text-text-tertiary">{labels.insufficient}</p>
        {labels.insufficientHint ? (
          <p className="mt-3 max-w-sm text-[12px] text-text-tertiary/70">{labels.insufficientHint}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-medium text-text-primary">{labels.title}</h3>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 ${
                  profile.confidence === "low"
                    ? "bg-bg-tertiary text-text-tertiary"
                    : profile.confidence === "medium"
                      ? "bg-accent-primary-light text-accent-primary"
                      : "bg-green-500/10 text-green-600"
                }`}
              >
                {labels.confidenceLabel}: {confidenceLabel[profile.confidence] || profile.confidence}
              </span>
              <span>{labels.sample.replace("{n}", String(profile.sampleSize))}</span>
            </div>
          </div>
          {storage && sendToLabels ? (
            <SendToMenu
              storage={storage}
              labels={sendToLabels}
              payload={{ title: labels.title, markdown: buildLearnMarkdown(profile, labels) }}
            />
          ) : null}
        </div>
        <p className="mt-1 text-[12px] text-text-tertiary">{labels.subtitle}</p>
        {profile.confidence === "low" && labels.insufficientHint ? (
          <p className="mt-1 text-[11.5px] text-text-tertiary">{labels.insufficientHint}</p>
        ) : null}

        {/* Domains */}
        {profile.domains.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-[12px] font-medium text-text-secondary">{labels.domainsTitle}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {profile.domains.map((d) => {
                const total = Math.max(1, d.deep + d.moderate + d.superficial);
                const deepPct = Math.round((d.deep / total) * 100);
                const modPct = Math.round((d.moderate / total) * 100);
                return (
                  <div
                    key={`${d.topicId ?? "null"}`}
                    className="rounded-xl border border-border-subtle bg-bg-surface-card p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">
                        {d.name || labels.uncategorized}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-tertiary">
                        {labels.domainConversations.replace("{n}", String(d.count))}
                      </span>
                    </div>
                    {d.deep + d.moderate + d.superficial > 0 && (
                      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                        <div className="bg-accent-primary" style={{ width: `${deepPct}%` }} />
                        <div className="bg-accent-primary/50" style={{ width: `${modPct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Glossary */}
        {profile.glossary.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[12px] font-medium text-text-secondary">{labels.glossaryTitle}</div>
            <ul className="flex flex-col gap-2">
              {profile.glossary.map((g) => (
                <li
                  key={g.term}
                  className={`rounded-lg border border-border-subtle bg-bg-surface-card p-2.5 ${
                    g.conversationId && onOpenConversation ? "cursor-pointer hover:bg-bg-tertiary" : ""
                  }`}
                  onClick={
                    g.conversationId && onOpenConversation
                      ? () => onOpenConversation(g.conversationId as number)
                      : undefined
                  }
                >
                  <div className="text-[13px] font-medium text-text-primary">{g.term}</div>
                  {g.definition ? (
                    <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-text-secondary">
                      {g.definition}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Open loops */}
        <div className="mt-6">
          <div className="mb-2 text-[12px] font-medium text-text-secondary">{labels.openLoopsTitle}</div>
          {profile.openLoops.length === 0 ? (
            <p className="text-[11.5px] text-text-tertiary">{labels.openLoopsEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {profile.openLoops.map((loop, i) => (
                <li
                  key={`${loop.conversationId}-${i}`}
                  className={`flex items-start gap-2.5 text-[13px] leading-relaxed text-text-primary ${
                    onOpenConversation ? "cursor-pointer hover:text-accent-primary" : ""
                  }`}
                  onClick={onOpenConversation ? () => onOpenConversation(loop.conversationId) : undefined}
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary/60" />
                  <span>{loop.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
