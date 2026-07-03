import { useState } from "react";
import { Check, Loader2, Share2 } from "lucide-react";
import type { ChatSummaryData, Conversation, Message, StorageApi } from "../types";
import { buildConversationMarkdown, buildSummaryMarkdown } from "../lib/conversationMarkdown";

// "Send to…" — promotes a conversation, its summary, OR any derived Explore output
// (AITI / Learn / Roundtable / answer) to Notion / Obsidian as ready Markdown.
// Two modes: pass a prebuilt `payload` (derived outputs), or pass a conversation
// (+messages/summary) for the scope picker. Per-message rich-copy lives on bubbles.

// Only the keys this menu uses (the host's library labels are loosely typed).
interface SendToLabels {
  sendToButton?: string;
  sendToNotionConversation?: string;
  sendToNotionSummary?: string;
  sendToObsidianConversation?: string;
  sendToObsidianSummary?: string;
  sendToNotion?: string;
  sendToObsidian?: string;
  sendToExporting?: string;
  sendToDone?: string;
  sendToFailed?: string;
}

interface SendToMenuProps {
  storage: StorageApi;
  labels: SendToLabels;
  /** Derived-output mode: a prebuilt payload (skips the conversation scope picker). */
  payload?: { title: string; markdown: string };
  /** Conversation mode: build from the open conversation + its summary. */
  conversation?: Conversation;
  messages?: Message[];
  summary?: ChatSummaryData | null;
}

type Target = "notion" | "obsidian";
type Scope = "conversation" | "summary";

export function SendToMenu({
  storage,
  labels,
  payload,
  conversation,
  messages,
  summary,
}: SendToMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const canNotion = !!storage.exportConversationToNotion;
  const canObsidian = !!storage.exportConversationToObsidian;
  if (!canNotion && !canObsidian) return null;
  if (!payload && !conversation) return null;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  // Resolve the {title, markdown} to send: a prebuilt payload, or built by scope.
  const resolvePayload = (scope: Scope): { title: string; markdown: string } => {
    if (payload) return payload;
    if (!conversation) return { title: "VESTI export", markdown: "" };
    const markdown =
      scope === "summary" && summary
        ? buildSummaryMarkdown(conversation, summary)
        : buildConversationMarkdown(conversation, messages ?? []);
    const title =
      (conversation.title || "VESTI export") + (scope === "summary" ? " — Summary" : "");
    return { title, markdown };
  };

  const run = async (target: Target, scope: Scope) => {
    setBusy(`${target}:${scope}`);
    setOpen(false);
    try {
      const { title, markdown } = resolvePayload(scope);
      if (target === "notion" && storage.exportConversationToNotion) {
        await storage.exportConversationToNotion({ title, markdown });
      } else if (target === "obsidian" && storage.exportConversationToObsidian) {
        await storage.exportConversationToObsidian({ title, markdown });
      }
      flash(labels.sendToDone ?? "Sent ✓");
    } catch (e) {
      flash(`${labels.sendToFailed ?? "Export failed"}: ${(e as Error)?.message ?? ""}`.trim());
    } finally {
      setBusy(null);
    }
  };

  const items: { target: Target; scope: Scope; label: string; show: boolean }[] = payload
    ? [
        { target: "notion", scope: "conversation", label: labels.sendToNotion ?? "Notion", show: canNotion },
        { target: "obsidian", scope: "conversation", label: labels.sendToObsidian ?? "Obsidian", show: canObsidian },
      ]
    : [
        {
          target: "notion",
          scope: "conversation",
          label: labels.sendToNotionConversation ?? "Notion — conversation",
          show: canNotion,
        },
        {
          target: "notion",
          scope: "summary",
          label: labels.sendToNotionSummary ?? "Notion — summary",
          show: canNotion && !!summary,
        },
        {
          target: "obsidian",
          scope: "conversation",
          label: labels.sendToObsidianConversation ?? "Obsidian — conversation",
          show: canObsidian,
        },
        {
          target: "obsidian",
          scope: "summary",
          label: labels.sendToObsidianSummary ?? "Obsidian — summary",
          show: canObsidian && !!summary,
        },
      ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!!busy}
        title={labels.sendToButton ?? "Send to…"}
        className="group inline-flex h-9 shrink-0 items-center gap-1.5 bg-transparent px-1 text-[12px] font-sans text-text-tertiary transition-colors duration-200 hover:text-text-primary disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Share2 strokeWidth={1.7} className="h-4 w-4 shrink-0" />
        )}
        <span className="text-[11px] uppercase tracking-[0.14em]">
          {busy ? labels.sendToExporting ?? "Exporting…" : labels.sendToButton ?? "Send to…"}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-border-subtle bg-bg-surface-card py-1 shadow-lg">
            {items
              .filter((it) => it.show)
              .map((it) => (
                <button
                  key={`${it.target}:${it.scope}`}
                  type="button"
                  onClick={() => void run(it.target, it.scope)}
                  className="block w-full px-3 py-2 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                >
                  {it.label}
                </button>
              ))}
          </div>
        </>
      )}

      {toast && (
        <div className="absolute right-0 top-full z-50 mt-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-bg-primary px-2.5 py-1.5 text-[11.5px] text-text-primary shadow-md">
          <Check className="h-3 w-3 text-accent-primary" />
          {toast}
        </div>
      )}
    </div>
  );
}
