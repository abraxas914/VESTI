import {
  formatArtifactDescriptor,
  getArtifactExcerptText,
} from "@vesti/content-package";
import type { Message, Platform, SearchMatchSurface } from "~lib/types";
import type { AstNode, AstRoot } from "~lib/types/ast";
import {
  astNodeToPlainText,
  extractAstPlainText,
  inspectAstStructure,
  type AstStructureStats,
} from "~lib/utils/astText";
import {
  buildMessageFallbackDisplayText,
  resolveCanonicalBodyText,
} from "~lib/utils/messageContentPackage";
import { normalizeSearchQuery, shouldRunFullTextSearch } from "~lib/utils/searchReadiness";
import type { ReaderOccurrence } from "../types/threadsSearch";

const MIN_AST_COVERAGE_RATIO = 0.55;
const MIN_MATH_AST_COVERAGE_RATIO = 0.2;
const MIN_TEXT_LENGTH_FOR_AST_CHECK = 120;
const CLAUDE_RICH_AST_COVERAGE_FLOOR = 0.22;
const GEMINI_USER_PREFIX_PATTERN = /^[\s\u200B\uFEFF]*you said(?:\s*[:\-])?\s*/i;
const LANGUAGE_TOKEN_PATTERN = /^[a-z0-9+#.-]{1,24}$/i;
const LANGUAGE_NOISE_TOKENS = new Set([
  "copy",
  "copied",
  "code",
  "plain",
  "plaintext",
  "text",
]);
const FALLBACK_SEGMENT_PATTERN = /(```[\s\S]*?```|\*\*.*?\*\*)/g;

export interface MessageRenderPlan {
  mode: "ast" | "fallback";
  renderAst: AstRoot | null;
}

export interface ReaderSearchArtifacts {
  occurrences: ReaderOccurrence[];
  renderPlanByMessageId: Record<number, MessageRenderPlan>;
  sidecarTargetMap: Record<string, ReaderSidecarTarget>;
}

export interface ReaderOccurrenceIndex {
  index: number;
  occurrence: ReaderOccurrence;
}

export type OccurrenceIndexMap = Record<string, ReaderOccurrenceIndex[]>;

export interface ReaderSidecarTarget {
  section: "sources" | "attachments" | "artifacts";
  surface: Exclude<SearchMatchSurface, "body" | "annotation">;
  itemKey: string;
}

export interface HighlightSegment {
  text: string;
  occurrenceIndex: number | null;
}

export type FallbackSegmentType = "text" | "bold" | "code_block";

export interface FallbackSegment {
  type: FallbackSegmentType;
  text: string;
  nodeKey: string;
}

interface TextOccurrence {
  charOffset: number;
  length: number;
}

interface OccurrenceIndexRef {
  current: number;
}

export function buildReaderSearchArtifacts(params: {
  messages: Message[];
  platform: Platform;
  query: string;
}): ReaderSearchArtifacts {
  const { messages, platform, query } = params;
  const normalizedQuery = normalizeSearchQuery(query);
  const renderPlanByMessageId: Record<number, MessageRenderPlan> = {};
  const occurrences: ReaderOccurrence[] = [];
  const sidecarTargetMap: Record<string, ReaderSidecarTarget> = {};
  const occurrenceIndexRef: OccurrenceIndexRef = { current: 0 };
  const shouldIndexQuery = shouldRunFullTextSearch(normalizedQuery);

  for (const message of messages) {
    const renderPlan = resolveMessageRenderPlan(message, platform);
    renderPlanByMessageId[message.id] = renderPlan;
    if (!shouldIndexQuery) {
      continue;
    }

    if (renderPlan.mode === "ast" && renderPlan.renderAst) {
      appendAstOccurrences(
        occurrences,
        occurrenceIndexRef,
        message.id,
        renderPlan.renderAst,
        normalizedQuery
      );
    } else {
      appendFallbackOccurrences(
        occurrences,
        occurrenceIndexRef,
        message.id,
        buildMessageFallbackDisplayText(message),
        normalizedQuery
      );
    }

    appendSidecarOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message,
      normalizedQuery
    );
  }

  return { occurrences, renderPlanByMessageId, sidecarTargetMap };
}

export function buildOccurrenceIndexMap(
  occurrences: ReaderOccurrence[]
): OccurrenceIndexMap {
  const map: OccurrenceIndexMap = {};
  occurrences.forEach((occurrence: ReaderOccurrence, index: number) => {
    const list = map[occurrence.nodeKey];
    if (list) {
      list.push({ index, occurrence });
      return;
    }
    map[occurrence.nodeKey] = [{ index, occurrence }];
  });
  return map;
}

export function buildHighlightSegments(
  text: string,
  occurrenceIndexes: ReaderOccurrenceIndex[] | undefined
): HighlightSegment[] {
  if (!occurrenceIndexes || occurrenceIndexes.length === 0) {
    return [{ text, occurrenceIndex: null }];
  }

  const sorted = [...occurrenceIndexes].sort(
    (left: ReaderOccurrenceIndex, right: ReaderOccurrenceIndex) =>
      left.occurrence.charOffset - right.occurrence.charOffset
  );
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const entry of sorted) {
    const { charOffset, length } = entry.occurrence;
    if (charOffset < cursor) {
      continue;
    }
    if (charOffset > text.length) {
      continue;
    }
    const end = Math.min(text.length, charOffset + length);
    if (charOffset > cursor) {
      segments.push({
        text: text.slice(cursor, charOffset),
        occurrenceIndex: null,
      });
    }
    if (end > charOffset) {
      segments.push({
        text: text.slice(charOffset, end),
        occurrenceIndex: entry.index,
      });
      cursor = end;
    }
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), occurrenceIndex: null });
  }

  return segments;
}

export function buildFallbackSegments(
  text: string,
  messageId: number
): FallbackSegment[] {
  const parts = text.split(FALLBACK_SEGMENT_PATTERN);
  const segments: FallbackSegment[] = [];

  parts.forEach((part: string, index: number) => {
    if (!part) return;
    const nodeKey = buildFallbackNodeKey(messageId, index);
    if (part.startsWith("```") && part.endsWith("```")) {
      segments.push({ type: "code_block", text: part, nodeKey });
      return;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      segments.push({ type: "bold", text: part.slice(2, -2), nodeKey });
      return;
    }
    segments.push({ type: "text", text: part, nodeKey });
  });

  return segments;
}

export function resolveMessageRenderPlan(
  message: Message,
  platform: Platform
): MessageRenderPlan {
  const rawAst = message.content_ast;
  if (
    !rawAst ||
    rawAst.type !== "root" ||
    (message.content_ast_version !== "ast_v1" &&
      message.content_ast_version !== "ast_v2")
  ) {
    return { mode: "fallback", renderAst: null };
  }

  const renderAst = sanitizeAstForRender(rawAst, message.role, platform);
  const sourceTextLen = normalizeForCoverage(resolveCanonicalBodyText(message)).length;
  const astTextLen = normalizeForCoverage(extractAstPlainText(renderAst)).length;
  const astStats = inspectAstStructure(renderAst);
  const astCoverageRatio = sourceTextLen > 0 ? astTextLen / sourceTextLen : 1;
  const hasRenderableAst = renderAst.children.length > 0;
  const shouldUseAst =
    hasRenderableAst &&
    (sourceTextLen < MIN_TEXT_LENGTH_FOR_AST_CHECK ||
      (astStats.hasMath && astCoverageRatio >= MIN_MATH_AST_COVERAGE_RATIO) ||
      astCoverageRatio >= resolveCoverageFloor(platform, astStats));

  return {
    mode: shouldUseAst ? "ast" : "fallback",
    renderAst: shouldUseAst ? renderAst : null,
  };
}

export function buildAstNodeKey(
  messageId: number,
  pathSegments: string[]
): string {
  if (pathSegments.length === 0) {
    return `msg-${messageId}`;
  }
  return `msg-${messageId}:${pathSegments.join(":")}`;
}

export function formatAstPathSegment(node: AstNode, index: number): string {
  return `${node.type}[${index}]`;
}

export function buildFallbackNodeKey(
  messageId: number,
  segmentIndex: number
): string {
  return `msg-${messageId}:fallback[${segmentIndex}]`;
}

export function sanitizeRootForRender(root: AstRoot): AstRoot {
  return {
    ...root,
    children: sanitizeLanguageLeakage(root.children),
  };
}

function appendAstOccurrences(
  occurrences: ReaderOccurrence[],
  occurrenceIndexRef: OccurrenceIndexRef,
  messageId: number,
  root: AstRoot,
  normalizedQuery: string
): void {
  const sanitizedRoot = sanitizeRootForRender(root);
  const walk = (node: AstNode, path: string[]): void => {
    if (node.type === "text") {
      appendOccurrencesFromText(
        occurrences,
        occurrenceIndexRef,
        messageId,
        "body",
        buildAstNodeKey(messageId, path),
        node.text,
        normalizedQuery
      );
      return;
    }

    if (node.type === "code_inline") {
      appendOccurrencesFromText(
        occurrences,
        occurrenceIndexRef,
        messageId,
        "body",
        buildAstNodeKey(messageId, path),
        node.text,
        normalizedQuery
      );
      return;
    }

    if (
      node.type === "code_block" ||
      node.type === "math" ||
      node.type === "table" ||
      node.type === "attachment" ||
      node.type === "br"
    ) {
      return;
    }

    if (
      node.type === "fragment" ||
      node.type === "p" ||
      node.type === "h1" ||
      node.type === "h2" ||
      node.type === "h3" ||
      node.type === "ul" ||
      node.type === "ol" ||
      node.type === "li" ||
      node.type === "strong" ||
      node.type === "em" ||
      node.type === "blockquote"
    ) {
      node.children.forEach((child: AstNode, index: number) => {
        walk(child, [...path, formatAstPathSegment(child, index)]);
      });
    }
  };

  sanitizedRoot.children.forEach((child: AstNode, index: number) => {
    walk(child, [formatAstPathSegment(child, index)]);
  });
}

function appendFallbackOccurrences(
  occurrences: ReaderOccurrence[],
  occurrenceIndexRef: OccurrenceIndexRef,
  messageId: number,
  text: string,
  normalizedQuery: string
): void {
  const segments = buildFallbackSegments(text, messageId);
  for (const segment of segments) {
    if (segment.type === "code_block") {
      continue;
    }
    appendOccurrencesFromText(
      occurrences,
      occurrenceIndexRef,
      messageId,
      "body",
      segment.nodeKey,
      segment.text,
      normalizedQuery
    );
  }
}

function appendSidecarOccurrences(
  occurrences: ReaderOccurrence[],
  sidecarTargetMap: Record<string, ReaderSidecarTarget>,
  occurrenceIndexRef: OccurrenceIndexRef,
  message: Message,
  normalizedQuery: string
): void {
  (message.citations ?? []).forEach((citation, index) => {
    const itemKey = `msg-${message.id}:source[${index}]`;
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "source",
      "sources",
      itemKey,
      `${itemKey}:label`,
      citation.label,
      normalizedQuery
    );
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "source",
      "sources",
      itemKey,
      `${itemKey}:host`,
      citation.host,
      normalizedQuery
    );
  });

  (message.attachments ?? []).forEach((attachment, index) => {
    const itemKey = `msg-${message.id}:attachment[${index}]`;
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "attachment",
      "attachments",
      itemKey,
      `${itemKey}:indexAlt`,
      attachment.indexAlt,
      normalizedQuery
    );
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "attachment",
      "attachments",
      itemKey,
      `${itemKey}:label`,
      attachment.label ?? "",
      normalizedQuery
    );
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "attachment",
      "attachments",
      itemKey,
      `${itemKey}:mime`,
      attachment.mime ?? "",
      normalizedQuery
    );
  });

  (message.artifacts ?? []).forEach((artifact, index) => {
    const itemKey = `msg-${message.id}:artifact[${index}]`;
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "artifact",
      "artifacts",
      itemKey,
      `${itemKey}:title`,
      artifact.label || artifact.kind,
      normalizedQuery
    );
    const descriptor = describeArtifact(artifact);
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "artifact",
      "artifacts",
      itemKey,
      `${itemKey}:descriptor`,
      descriptor,
      normalizedQuery
    );
    const excerpt = buildArtifactExcerpt(artifact);
    appendSidecarFieldOccurrences(
      occurrences,
      sidecarTargetMap,
      occurrenceIndexRef,
      message.id,
      "artifact",
      "artifacts",
      itemKey,
      `${itemKey}:excerpt`,
      excerpt,
      normalizedQuery
    );
  });
}

function appendSidecarFieldOccurrences(
  occurrences: ReaderOccurrence[],
  sidecarTargetMap: Record<string, ReaderSidecarTarget>,
  occurrenceIndexRef: OccurrenceIndexRef,
  messageId: number,
  surface: Exclude<SearchMatchSurface, "body" | "annotation">,
  section: ReaderSidecarTarget["section"],
  itemKey: string,
  nodeKey: string,
  text: string,
  normalizedQuery: string
): void {
  if (!text) {
    return;
  }

  sidecarTargetMap[nodeKey] = { section, surface, itemKey };
  appendOccurrencesFromText(
    occurrences,
    occurrenceIndexRef,
    messageId,
    surface,
    nodeKey,
    text,
    normalizedQuery
  );
}

function appendOccurrencesFromText(
  occurrences: ReaderOccurrence[],
  occurrenceIndexRef: OccurrenceIndexRef,
  messageId: number,
  surface: SearchMatchSurface,
  nodeKey: string,
  text: string,
  normalizedQuery: string
): void {
  const matches = findTextOccurrences(text, normalizedQuery);
  for (const match of matches) {
    occurrences.push({
      occurrenceKey: `occ-${occurrenceIndexRef.current}`,
      messageId,
      surface,
      nodeKey,
      charOffset: match.charOffset,
      length: match.length,
    });
    occurrenceIndexRef.current += 1;
  }
}

function findTextOccurrences(
  text: string,
  normalizedQuery: string
): TextOccurrence[] {
  if (!shouldRunFullTextSearch(normalizedQuery)) {
    return [];
  }
  const lower = text.toLowerCase();
  const occurrences: TextOccurrence[] = [];
  let index = 0;
  while (index < text.length) {
    const matchIndex = lower.indexOf(normalizedQuery, index);
    if (matchIndex === -1) {
      break;
    }
    occurrences.push({ charOffset: matchIndex, length: normalizedQuery.length });
    index = matchIndex + normalizedQuery.length;
  }
  return occurrences;
}

function describeArtifact(artifact: NonNullable<Message["artifacts"]>[number]): string {
  return formatArtifactDescriptor(artifact);
}

function buildArtifactExcerpt(artifact: NonNullable<Message["artifacts"]>[number]): string {
  return getArtifactExcerptText(artifact, {
    maxLines: 2,
    maxCharsPerLine: 120,
    separator: " | ",
  });
}

function normalizeForCoverage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveCoverageFloor(
  platform: Platform,
  stats: AstStructureStats | null
): number {
  if (!stats) {
    return MIN_AST_COVERAGE_RATIO;
  }

  if (stats.hasBlockquote) {
    return CLAUDE_RICH_AST_COVERAGE_FLOOR;
  }

  const richClaudeAst =
    platform === "Claude" &&
    (
      stats.hasTable ||
      stats.hasList ||
      stats.hasCodeBlock ||
      (stats.hasMath && stats.blockNodes >= 2) ||
      stats.blockNodes >= 4
    );

  return richClaudeAst ? CLAUDE_RICH_AST_COVERAGE_FLOOR : MIN_AST_COVERAGE_RATIO;
}
function sanitizeAstForRender(
  root: AstRoot,
  role: Message["role"],
  platform: Platform
): AstRoot {
  if (role !== "user" || platform !== "Gemini") {
    return root;
  }

  const cloned = JSON.parse(JSON.stringify(root)) as AstRoot;
  stripLeadingGeminiPrefix(cloned.children);
  return cloned;
}

function stripLeadingGeminiPrefix(nodes: AstNode[]): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;

    if (node.type === "text") {
      const stripped = node.text.replace(GEMINI_USER_PREFIX_PATTERN, "");
      if (stripped !== node.text) {
        if (stripped.trim().length === 0) {
          nodes.splice(index, 1);
        } else {
          node.text = stripped;
        }
        return true;
      }

      if (node.text.trim().length === 0) {
        nodes.splice(index, 1);
        index -= 1;
        continue;
      }
      return false;
    }

    if (node.type === "br") {
      continue;
    }

    if (
      node.type === "fragment" ||
      node.type === "p" ||
      node.type === "h1" ||
      node.type === "h2" ||
      node.type === "h3" ||
      node.type === "ul" ||
      node.type === "ol" ||
      node.type === "li" ||
      node.type === "strong" ||
      node.type === "em" ||
      node.type === "blockquote"
    ) {
      const changed = stripLeadingGeminiPrefix(node.children);
      if (node.children.length === 0) {
        nodes.splice(index, 1);
        index -= 1;
        continue;
      }
      return changed;
    }

    return false;
  }

  return false;
}

function normalizeLanguageToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const prefixed = normalized.match(
    /^(?:language|lang)[:_\-\s]*([a-z0-9+#.-]{1,24})$/i
  );
  const token = (prefixed?.[1] ? prefixed[1] : normalized).toLowerCase();
  if (!LANGUAGE_TOKEN_PATTERN.test(token) || LANGUAGE_NOISE_TOKENS.has(token)) {
    return null;
  }
  return token;
}

function extractLanguageLeakToken(node: AstNode): string | null {
  if (node.type === "text") {
    return normalizeLanguageToken(node.text);
  }
  if (node.type !== "p") {
    return null;
  }
  const text = astNodeToPlainText(node).trim();
  return normalizeLanguageToken(text);
}

function sanitizeLanguageLeakage(nodes: AstNode[]): AstNode[] {
  const sanitizedChildren = nodes.map((node: AstNode) => {
    if (
      node.type === "fragment" ||
      node.type === "p" ||
      node.type === "h1" ||
      node.type === "h2" ||
      node.type === "h3" ||
      node.type === "ul" ||
      node.type === "ol" ||
      node.type === "li" ||
      node.type === "strong" ||
      node.type === "em" ||
      node.type === "blockquote"
    ) {
      return {
        ...node,
        children: sanitizeLanguageLeakage(node.children),
      };
    }
    return node;
  });

  const result: AstNode[] = [];
  for (let i = 0; i < sanitizedChildren.length; i += 1) {
    const current = sanitizedChildren[i];
    const next = sanitizedChildren[i + 1];
    if (next?.type === "code_block") {
      const codeLanguage = normalizeLanguageToken(next.language);
      const leakToken = current ? extractLanguageLeakToken(current) : null;
      if (codeLanguage && leakToken && codeLanguage === leakToken) {
        continue;
      }
    }
    result.push(current);
  }

  return result;
}
