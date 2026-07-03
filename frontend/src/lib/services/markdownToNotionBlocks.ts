// Dependency-free Markdown → Notion blocks renderer. The frontend has no
// marked/remark, and our export Markdown is canonical (we generate it), so a
// line-based parser is reliable. Handles headings, bulleted/numbered lists, code
// fences, blockquotes, and paragraphs, with inline **bold** / `code`. Respects
// Notion's hard limits: 2000 chars per rich_text, 100 children per request.

export type NotionBlock = Record<string, unknown>;

const MAX_RICH_TEXT = 2000;
const MAX_CHILDREN = 100;

interface RichText {
  type: "text";
  text: { content: string };
  annotations?: { bold?: boolean; code?: boolean };
}

/** Split a string into ≤2000-char chunks (Notion rejects longer rich_text). */
function splitContent(content: string): string[] {
  if (content.length <= MAX_RICH_TEXT) return [content];
  const out: string[] = [];
  for (let i = 0; i < content.length; i += MAX_RICH_TEXT) {
    out.push(content.slice(i, i + MAX_RICH_TEXT));
  }
  return out;
}

function pushSegment(
  out: RichText[],
  content: string,
  annotations?: { bold?: boolean; code?: boolean },
): void {
  if (!content) return;
  for (const chunk of splitContent(content)) {
    out.push(annotations ? { type: "text", text: { content: chunk }, annotations } : { type: "text", text: { content: chunk } });
  }
}

/** Tokenize a line into Notion rich_text with **bold** and `code` annotations. */
function inlineRichText(text: string): RichText[] {
  const out: RichText[] = [];
  // Alternating match of `code` | **bold**; everything else is plain.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pushSegment(out, text.slice(last, m.index));
    if (m[1]) pushSegment(out, m[1].slice(1, -1), { code: true });
    else if (m[2]) pushSegment(out, m[2].slice(2, -2), { bold: true });
    last = re.lastIndex;
  }
  if (last < text.length) pushSegment(out, text.slice(last));
  if (out.length === 0) pushSegment(out, text);
  return out;
}

function block(type: string, rich: RichText[], extra?: Record<string, unknown>): NotionBlock {
  return { object: "block", type, [type]: { rich_text: rich, ...(extra ?? {}) } };
}

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: NotionBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code fence: collect until the closing ```
    const fence = trimmed.match(/^```(\w*)$/);
    if (fence) {
      const lang = fence[1] || "plain text";
      const code: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== "```") {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      const content = code.join("\n");
      blocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: splitContent(content).map((c) => ({ type: "text", text: { content: c } })),
          language: normalizeNotionLanguage(lang),
        },
      });
      continue;
    }

    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(block(`heading_${level}`, inlineRichText(heading[2])));
      i += 1;
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push(block("bulleted_list_item", inlineRichText(bullet[1])));
      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      blocks.push(block("numbered_list_item", inlineRichText(numbered[1])));
      i += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(block("quote", inlineRichText(quote[1])));
      i += 1;
      continue;
    }

    blocks.push(block("paragraph", inlineRichText(trimmed)));
    i += 1;
  }
  return blocks;
}

/** Notion accepts a fixed language enum; map unknowns to "plain text". */
function normalizeNotionLanguage(lang: string): string {
  const known = new Set([
    "bash", "c", "c++", "c#", "css", "go", "html", "java", "javascript", "json",
    "kotlin", "markdown", "php", "python", "ruby", "rust", "shell", "sql",
    "swift", "typescript", "yaml", "plain text",
  ]);
  const l = lang.toLowerCase();
  const alias: Record<string, string> = { js: "javascript", ts: "typescript", py: "python", sh: "shell", yml: "yaml", "c++": "c++", cpp: "c++", "c#": "c#", cs: "c#" };
  const resolved = alias[l] ?? l;
  return known.has(resolved) ? resolved : "plain text";
}

/** Split a flat block list into ≤100-block chunks for create/append calls. */
export function chunkNotionChildren(blocks: NotionBlock[]): NotionBlock[][] {
  const out: NotionBlock[][] = [];
  for (let i = 0; i < blocks.length; i += MAX_CHILDREN) {
    out.push(blocks.slice(i, i + MAX_CHILDREN));
  }
  return out;
}
