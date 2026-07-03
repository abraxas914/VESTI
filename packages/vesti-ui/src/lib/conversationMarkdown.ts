import type { ChatSummaryData, Conversation, Message } from "../types";

// Pure Markdown builders for "Send to…". Built in the reader (which already holds
// the conversation, messages, and summary) so the export sinks just transport a
// ready Markdown string — Notion turns it into blocks in the background, Obsidian
// writes it to the vault in-page. No DB access, no context-boundary issues.

function roleLabel(role: string): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Message";
}

function fmtDate(ts: number | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/** Full transcript of a conversation as Markdown. */
export function buildConversationMarkdown(
  conversation: Conversation,
  messages: Message[],
): string {
  const date = fmtDate(conversation.source_created_at ?? conversation.created_at);
  const lines: string[] = [`# ${conversation.title || "Untitled conversation"}`, ""];
  const meta = [conversation.platform, date].filter(Boolean).join(" · ");
  if (meta) lines.push(`_${meta}_`, "");
  for (const m of messages) {
    const body = (m.content_text ?? "").trim();
    if (!body) continue;
    lines.push(`## ${roleLabel(m.role)}`, "", body, "");
  }
  return lines.join("\n").trim() + "\n";
}

/** The AI summary of a conversation as Markdown (V2 structured shape). */
export function buildSummaryMarkdown(
  conversation: Conversation,
  summary: ChatSummaryData,
): string {
  const date = fmtDate(conversation.source_created_at ?? conversation.created_at);
  const lines: string[] = [`# ${conversation.title || "Untitled conversation"} — Summary`, ""];
  const meta = [conversation.platform, date].filter(Boolean).join(" · ");
  if (meta) lines.push(`_${meta}_`, "");

  if (summary.core_question) {
    lines.push(`## ${summary.core_question}`, "");
  }
  if (summary.thinking_journey?.length) {
    lines.push("### Thinking Journey", "");
    for (const item of summary.thinking_journey) {
      lines.push(
        `**Step ${item.step} · ${item.speaker}**: ${item.assertion}${
          item.real_world_anchor ? `\n  _Example: ${item.real_world_anchor}_` : ""
        }`,
      );
    }
    lines.push("");
  }
  if (summary.key_insights?.length) {
    lines.push("### Key Insights", "");
    for (const item of summary.key_insights) {
      lines.push(`- **${item.term}**: ${item.definition}`);
    }
    lines.push("");
  }
  if (summary.unresolved_threads?.length) {
    lines.push("### Unresolved Threads", "");
    for (const item of summary.unresolved_threads) lines.push(`- ${item}`);
    lines.push("");
  }
  if (summary.actionable_next_steps?.length) {
    lines.push("### Next Steps", "");
    for (const item of summary.actionable_next_steps) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}
