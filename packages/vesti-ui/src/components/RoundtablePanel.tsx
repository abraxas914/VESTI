import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Loader2, Users } from "lucide-react";
import type {
  DashboardLabels,
  RoundtablePersonaId,
  RoundtableResult,
  StorageApi,
  UiThemeMode,
} from "../types";
import { SendToMenu } from "./SendToMenu";
import { buildRoundtableMarkdown } from "../lib/exploreMarkdown";

// AI 圆桌 (Roundtable): a self-contained Explore sub-mode. Convene 2-3 persona
// "seats" on the configured LLM + a Moderator synthesis. The host wires
// storage.runRoundtable; this component owns only its own UI state.

interface RoundtablePanelProps {
  storage: StorageApi;
  themeMode?: UiThemeMode;
  labels: DashboardLabels["roundtable"];
  /** Localized "Send to…" labels (from the library block) for exporting the synthesis. */
  sendToLabels?: DashboardLabels["library"];
}

const SELECTABLE: RoundtablePersonaId[] = [
  "skeptic",
  "optimist",
  "pragmatist",
  "domain_expert",
  "devils_advocate",
];
const MAX_SEATS = 3;

function renderMarkdown(text: string): { __html: string } {
  try {
    return { __html: DOMPurify.sanitize(marked.parse(text) as string) };
  } catch {
    return { __html: "" };
  }
}

export function RoundtablePanel({ storage, labels, sendToLabels }: RoundtablePanelProps) {
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState<RoundtablePersonaId[]>([
    "skeptic",
    "optimist",
    "pragmatist",
  ]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RoundtableResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: RoundtablePersonaId): string =>
    ({
      skeptic: labels.personaSkeptic,
      optimist: labels.personaOptimist,
      pragmatist: labels.personaPragmatist,
      domain_expert: labels.personaDomainExpert,
      devils_advocate: labels.personaDevilsAdvocate,
      moderator: "Moderator",
    })[id];

  const togglePersona = (id: RoundtablePersonaId) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= MAX_SEATS) return prev;
      return [...prev, id];
    });
  };

  const run = async () => {
    const q = question.trim();
    if (!q) {
      setError(labels.needQuestion);
      return;
    }
    if (!storage.runRoundtable || selected.length === 0) return;
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await storage.runRoundtable(q, selected);
      setResult(res);
    } catch (e) {
      setError((e as Error)?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-onboarding-target="roundtable-card"
      className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl">
        <h3 className="flex items-center gap-2 text-[15px] font-medium text-text-primary">
          <Users className="h-4 w-4" strokeWidth={1.8} />
          {labels.title}
        </h3>
        <p className="mt-1 text-[12px] text-text-tertiary">{labels.subtitle}</p>

        {/* Question */}
        <textarea
          data-onboarding-target="roundtable-input"
          data-onboarding-action="roundtable-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={labels.questionPlaceholder}
          rows={3}
          className="mt-4 w-full resize-y rounded-xl border border-border-subtle bg-bg-primary px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent-primary"
        />

        {/* Persona picker */}
        <div className="mt-3">
          <div className="mb-1.5 text-[12px] text-text-secondary">{labels.personasLabel}</div>
          <div className="flex flex-wrap gap-2">
            {SELECTABLE.map((id) => {
              const active = selected.includes(id);
              // At the seat cap, dim + disable the unselected personas so the
              // 4th click isn't silently ignored.
              const atCap = !active && selected.length >= MAX_SEATS;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => togglePersona(id)}
                  disabled={atCap}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                    active
                      ? "border-accent-primary bg-accent-primary-light text-accent-primary"
                      : atCap
                        ? "cursor-not-allowed border-border-subtle text-text-tertiary opacity-40"
                        : "border-border-subtle text-text-secondary hover:bg-bg-tertiary"
                  }`}
                >
                  {nameOf(id)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            data-onboarding-target="roundtable-send"
            data-onboarding-action="roundtable-send"
            type="button"
            onClick={() => void run()}
            disabled={loading || selected.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? labels.running : labels.run}
          </button>
          {/* Keep the latency reassurance visible during the wait, not only before it. */}
          <span className="text-[11px] text-text-tertiary">{labels.latencyHint}</span>
        </div>

        {error ? <p className="mt-3 text-[12px] text-red-600">{error}</p> : null}

        {!result && !loading && !error ? (
          <p className="mt-8 text-center text-[12px] text-text-tertiary">{labels.empty}</p>
        ) : null}

        {result ? (
          <div className="mt-6">
            {/* Promote the synthesis into the user's workflow */}
            {sendToLabels ? (
              <div className="mb-2 flex justify-end">
                <SendToMenu
                  storage={storage}
                  labels={sendToLabels}
                  payload={{
                    title: `${labels.title} — ${result.question}`.slice(0, 120),
                    markdown: buildRoundtableMarkdown(result, labels),
                  }}
                />
              </div>
            ) : null}
            {/* Seats */}
            <div className="mb-2 text-[12px] font-medium text-text-secondary">{labels.seatsTitle}</div>
            <div className="flex flex-col gap-3">
              {result.seatTurns.map((turn, i) => (
                <div
                  key={`${turn.personaId}-${i}`}
                  className="rounded-xl border border-border-subtle bg-bg-surface-card p-3.5"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-primary-light text-[10px] font-semibold text-accent-primary"
                    >
                      {nameOf(turn.personaId).slice(0, 1)}
                    </span>
                    <span className="text-[12.5px] font-semibold text-accent-primary">
                      {nameOf(turn.personaId)}
                    </span>
                  </div>
                  {turn.ok ? (
                    <div
                      className="prose-vesti text-[13px] leading-relaxed text-text-secondary"
                      dangerouslySetInnerHTML={renderMarkdown(turn.content)}
                    />
                  ) : (
                    <div className="text-[12px] text-red-600">{turn.error || "—"}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Synthesis */}
            {result.synthesis ? (
              <div className="mt-5 rounded-xl border border-border-subtle bg-bg-surface-card p-4">
                <div className="mb-3 text-[13px] font-semibold text-text-primary">
                  {labels.synthesisTitle}
                </div>
                <SynthSection title={labels.consensus} items={result.synthesis.consensus} />
                <SynthSection title={labels.disagreements} items={result.synthesis.disagreements} />
                {result.synthesis.recommendation ? (
                  <div className="mt-3">
                    <div className="text-[12px] font-medium text-text-secondary">
                      {labels.recommendation}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-text-primary">
                      {result.synthesis.recommendation}
                    </p>
                  </div>
                ) : null}
                <SynthSection title={labels.openQuestions} items={result.synthesis.openQuestions} />
              </div>
            ) : result.synthesisRaw ? (
              <div className="mt-5 whitespace-pre-wrap rounded-xl border border-border-subtle bg-bg-surface-card p-4 text-[13px] text-text-secondary">
                {result.synthesisRaw}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SynthSection({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[12px] font-medium text-text-secondary">{title}</div>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-text-primary">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary/60" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
