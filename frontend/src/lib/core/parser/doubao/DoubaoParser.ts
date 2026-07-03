import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import {
  closestAnySelector,
  extractEarliestTimeFromSelectors,
  normalizeCandidateNodes,
  queryAllUnique,
  queryAllWithinUnique,
  queryFirst,
  queryFirstWithin,
  safeTextContent,
  uniqueNodesInDocumentOrder,
} from "../shared/selectorUtils";
import { extractAstFromElement } from "../shared/astExtractor";
import {
  cloneAndSanitizeMessageContent,
  getCitationNoiseProfile,
} from "../shared/citationNoise";
import { resolveCanonicalMessageText } from "../shared/canonicalMessageText";
import { astPerfModeController, type AstPerfMode } from "../shared/astPerfMode";
import { logger } from "../../../utils/logger";

const USER_ROLE_ANCHORS = [
  "[data-testid='send_message']",
  "[data-testid*='send_message']",
  "[data-role='user']",
  "[data-author='user']",
  "[data-message-author-role='user']",
  "[class*='user-message']",
  "[class*='message-user']",
  "[class*='send-message']",
];

const ASSISTANT_ROLE_ANCHORS = [
  "[data-testid='receive_message']",
  "[data-testid*='receive_message']",
  "[data-role='assistant']",
  "[data-author='assistant']",
  "[data-message-author-role='assistant']",
  "[class*='assistant-message']",
  "[class*='message-assistant']",
  "[class*='receive-message']",
  "[class*='bot-message']",
];

const ROLE_ANCESTOR_HINTS = [
  "[data-testid]",
  "[data-role]",
  "[data-author]",
  "[data-message-author-role]",
  "[class*='user-message']",
  "[class*='assistant-message']",
  "[class*='message-user']",
  "[class*='message-assistant']",
  "[class*='send-message']",
  "[class*='receive-message']",
];

const PREFERRED_MESSAGE_CONTENT = [
  "[data-testid='message_text_content']",
  "[data-testid*='message_text_content']",
  ".flow-markdown-body",
  "[class*='flow-markdown-body']",
  ".message-content-wrapper",
  "[class*='message-content']",
  ".markdown",
  ".prose",
  "div[class*='markdown']",
];

const AI_COT_LEAVES = [
  "[class*='collapse-wrapper']",
  "[class*='reasoning']",
  "[class*='thought']",
  "[data-testid*='thought']",
  "[data-testid*='reason']",
  "[class*='cot']",
];

const AI_FINAL_LEAVES = [
  ".flow-markdown-body",
  "[class*='flow-markdown-body']",
  "[class*='markdown-body']",
  "[class*='mdbox-theme']",
  "[class*='answer-markdown']",
  "[data-testid='message_text_content']",
  "[data-testid*='assistant-content']",
];

const DISCARD_CONTAINERS = [
  "form",
  "footer",
  "nav",
  "aside",
  "[role='navigation']",
  "[role='complementary']",
  "[data-testid*='composer']",
  "[contenteditable='true']",
  "[class*='edit-history']",
  "[data-testid*='edit-history']",
  "[class*='history-switch']",
  "[class*='pager']",
  "[class*='pagination']",
  "[class*='action-bar']",
];

const INLINE_NOISE_SELECTORS = [
  "[class*='search-card']",
  "[class*='search-widget']",
  "[class*='reference-count']",
  "[class*='references-count']",
  "[class*='table-header']",
  "[class*='actions-']",
  "[class*='action-btn']",
  "[class*='edit-history']",
  "[data-testid*='edit-history']",
  "[class*='history-switch']",
  "[class*='pager']",
  "[class*='pagination']",
  "[class*='action-bar']",
  "[class*='message-action-button']",
  "[class*='overflow-list']",
  "[class*='tool-button']",
  "[class*='operation']",
  "[class*='dropdown-tooltip']",
  "[data-popupid]",
  "button",
  "svg",
];

const DIVIDER_SELECTORS = ["hr", "[class*='divider']", "[class*='separator']", "[class*='border-b']"];

const NOISE_LINE_PATTERNS = [
  /^\d+\s*\/\s*\d+$/i,
  /^(?:\u7f16\u8f91\u5386\u53f2|\u5386\u53f2\u7248\u672c)$/i,
  /^(?:references?|\u53c2\u8003\u94fe\u63a5|\u5f15\u7528)\s*[:\uff1a]?\s*\d+$/i,
  /^(?:\u5c55\u5f00|\u6536\u8d77|show more|done|copy|edit|retry)$/i,
  /^(?:\u627e\u5230|\u68c0\u7d22\u5230)\s*\d+\s*\u7bc7?.*(?:\u8d44\u6599|\u53c2\u8003|\u7ed3\u679c).*$/i,
];

const SELECTORS = {
  userRoleAnchors: USER_ROLE_ANCHORS,
  assistantRoleAnchors: ASSISTANT_ROLE_ANCHORS,
  roleAncestorHints: ROLE_ANCESTOR_HINTS,
  roleAnchors: [
    "[data-testid='message-block-container']",
    ...USER_ROLE_ANCHORS,
    ...ASSISTANT_ROLE_ANCHORS,
  ],
  turnBlocks: [
    "[data-testid='message-block-container']",
    "[data-message-id]",
    "[class*='message-item']",
    "[class*='chat-item']",
    "article",
    "[role='listitem']",
  ],
  messageContent: [
    ...PREFERRED_MESSAGE_CONTENT,
    "[data-testid='message_text_content']",
    "[data-testid*='message-content']",
    ".message-content-wrapper",
    ".markdown",
    ".prose",
    "div[class*='content']",
  ],
  preferredMessageContent: PREFERRED_MESSAGE_CONTENT,
  aiCotLeaves: AI_COT_LEAVES,
  aiFinalLeaves: AI_FINAL_LEAVES,
  discardContainers: DISCARD_CONTAINERS,
  inlineNoiseSelectors: INLINE_NOISE_SELECTORS,
  dividerSelectors: DIVIDER_SELECTORS,
  title: [
    ".chat-title",
    ".conversation-title",
    ".session-title",
    "[role='heading']",
    "h1",
    "title",
  ],
  // Streaming indicators. Class-substring checks are scoped to inside a message
  // block so they can't match persistent page chrome (which would leave
  // isGenerating() permanently true and block every capture).
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='streaming']",
    "[data-testid='message-block-container'] [class*='typing']",
    "[data-testid='message-block-container'] [class*='stream']",
    "[data-message-id] [class*='typing']",
    "[data-message-id] [class*='stream']",
  ],
  noiseContainers: DISCARD_CONTAINERS,
  noiseTextPatterns: [
    /^new chat$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^doubao can make mistakes\.?/i,
    ...NOISE_LINE_PATTERNS,
  ],
  sourceTimes: ["time[datetime]", "article time[datetime]"],
};

const SESSION_ID_QUERY_KEYS = [
  "conversation",
  "conversation_id",
  "chat",
  "chat_id",
  "session",
  "session_id",
  "id",
];

const SESSION_ID_PATTERNS = [
  /\/chat\/([a-zA-Z0-9_-]{8,})/i,
  /\/conversation\/([a-zA-Z0-9_-]{8,})/i,
  /\/s\/([a-zA-Z0-9_-]{8,})/i,
];

const INVALID_SESSION_IDS = new Set([
  "chat",
  "new",
  "conversation",
  "session",
  "search",
  "history",
  "explore",
]);

type MessageRole = "user" | "ai";
type ExtractionSource = "selector" | "anchor";

interface AiSegmentStats {
  cot_detected: number;
  final_detected: number;
  cot_parse_failed: number;
  final_parse_failed: number;
  final_only_fallback_used: number;
}

interface ParserStats {
  source: ExtractionSource;
  totalCandidates: number;
  keptMessages: number;
  roleDistribution: Record<MessageRole, number>;
  droppedNoise: number;
  droppedUnknownRole: number;
  parse_duration_ms: number;
  perf_mode: AstPerfMode;
  next_perf_mode: AstPerfMode;
  degraded_nodes_count: number;
  ast_node_count: number;
  message_count: number;
  platform: Platform;
  ai_segment_stats: AiSegmentStats;
}

interface ExtractionResult {
  source: ExtractionSource;
  totalCandidates: number;
  droppedNoise: number;
  droppedUnknownRole: number;
  messages: ParsedMessage[];
  degradedNodesCount: number;
  astNodeCount: number;
  aiSegmentStats: AiSegmentStats;
}

interface ParsedNodeResult {
  message: ParsedMessage;
  degradedNodesCount: number;
  astNodeCount: number;
  aiSegmentStats: AiSegmentStats;
}

interface ContentResolution {
  element: Element | null;
  aiSegmentStats: AiSegmentStats;
}

type SegmentBranch = "cot" | "final";

function createEmptyAiSegmentStats(): AiSegmentStats {
  return {
    cot_detected: 0,
    final_detected: 0,
    cot_parse_failed: 0,
    final_parse_failed: 0,
    final_only_fallback_used: 0,
  };
}

export class DoubaoParser implements IParser {
  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("www.doubao.com")) {
      return "Doubao";
    }
    return null;
  }

  getConversationTitle(): string {
    const titleEl = queryFirst(SELECTORS.title);
    const title = safeTextContent(titleEl);
    if (title) return title;
    return document.title || "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Doubao");
    const selectorResult = this.extractUsingSelectorStrategy(perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Doubao", parseDurationMs);

    const stats: ParserStats = {
      source: chosen.source,
      totalCandidates: chosen.totalCandidates,
      keptMessages: deduped.length,
      roleDistribution: { user: 0, ai: 0 },
      droppedNoise: chosen.droppedNoise + (chosen.messages.length - deduped.length),
      droppedUnknownRole: chosen.droppedUnknownRole,
      parse_duration_ms: parseDurationMs,
      perf_mode: perfMode,
      next_perf_mode: modeUpdate.mode,
      degraded_nodes_count: chosen.degradedNodesCount,
      ast_node_count: chosen.astNodeCount,
      message_count: deduped.length,
      platform: "Doubao",
      ai_segment_stats: chosen.aiSegmentStats,
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "Doubao AST perf mode switched", {
        platform: "Doubao",
        from: modeUpdate.previousMode,
        to: modeUpdate.mode,
        parse_duration_ms: parseDurationMs,
        message_count: deduped.length,
      });
    }

    for (const message of deduped) {
      stats.roleDistribution[message.role] += 1;
    }

    this.logStats(stats, deduped);
    return deduped;
  }

  isGenerating(): boolean {
    return queryFirst(SELECTORS.generating) !== null;
  }

  getSessionUUID(): string | null {
    try {
      const url = new URL(window.location.href);

      for (const key of SESSION_ID_QUERY_KEYS) {
        const value = url.searchParams.get(key);
        const normalized = this.normalizeSessionId(value);
        if (normalized) return normalized;
      }

      for (const pattern of SESSION_ID_PATTERNS) {
        const match = url.pathname.match(pattern);
        const normalized = this.normalizeSessionId(match?.[1] ?? null);
        if (normalized) return normalized;
      }
    } catch {
      return null;
    }

    return null;
  }

  getSourceCreatedAt(): number | null {
    return extractEarliestTimeFromSelectors(SELECTORS.sourceTimes);
  }

  private extractUsingSelectorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const rawCandidates = this.collectMessageCandidates();
    const normalized = normalizeCandidateNodes(rawCandidates, {
      minTextLength: 2,
      noiseContainerSelectors: SELECTORS.noiseContainers,
      noiseTextPatterns: SELECTORS.noiseTextPatterns,
    });
    const filteredCandidates = normalized.nodes.filter((candidate) =>
      this.isLikelyMessageCandidate(candidate),
    );

    const messages: ParsedMessage[] = [];
    let droppedUnknownRole = 0;
    let droppedNoise = normalized.droppedNoise + (normalized.nodes.length - filteredCandidates.length);
    let degradedNodesCount = 0;
    let astNodeCount = 0;
    const aiSegmentStats = createEmptyAiSegmentStats();

    for (const node of filteredCandidates) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (
        !parsed.message.textContent.trim() ||
        this.isLikelyNoiseText(parsed.message.textContent)
      ) {
        droppedNoise += 1;
        continue;
      }

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
      this.mergeAiSegmentStats(aiSegmentStats, parsed.aiSegmentStats);
    }

    return {
      source: "selector",
      totalCandidates: rawCandidates.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
      aiSegmentStats,
    };
  }

  private mergeAiSegmentStats(target: AiSegmentStats, source: AiSegmentStats): void {
    target.cot_detected += source.cot_detected;
    target.final_detected += source.final_detected;
    target.cot_parse_failed += source.cot_parse_failed;
    target.final_parse_failed += source.final_parse_failed;
    target.final_only_fallback_used += source.final_only_fallback_used;
  }

  private extractUsingAnchorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const anchors = queryAllUnique(SELECTORS.roleAnchors);
    if (anchors.length === 0) {
      return {
        source: "anchor",
        totalCandidates: 0,
        droppedNoise: 0,
        droppedUnknownRole: 0,
        messages: [],
        degradedNodesCount: 0,
        astNodeCount: 0,
        aiSegmentStats: createEmptyAiSegmentStats(),
      };
    }

    const resolved = uniqueNodesInDocumentOrder(
      anchors.map((anchor) => this.resolveAnchorNode(anchor)).filter(Boolean) as Element[],
    );
    const filtered = resolved.filter((candidate) => this.isLikelyMessageCandidate(candidate));

    const messages: ParsedMessage[] = [];
    let droppedNoise = resolved.length - filtered.length;
    let droppedUnknownRole = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;
    const aiSegmentStats = createEmptyAiSegmentStats();

    for (const node of filtered) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (
        !parsed.message.textContent.trim() ||
        this.isLikelyNoiseText(parsed.message.textContent)
      ) {
        droppedNoise += 1;
        continue;
      }
      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
      this.mergeAiSegmentStats(aiSegmentStats, parsed.aiSegmentStats);
    }

    return {
      source: "anchor",
      totalCandidates: resolved.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
      aiSegmentStats,
    };
  }

  private resolveAnchorNode(anchor: Element): Element | null {
    let current: Element | null = anchor;
    while (current) {
      if (SELECTORS.turnBlocks.some((selector) => current?.matches(selector))) {
        return current;
      }
      current = current.parentElement;
    }
    return anchor;
  }

  private collectMessageCandidates(): Element[] {
    const combinedCandidates: Element[] = [...queryAllUnique(SELECTORS.roleAnchors)];

    for (const turnNode of queryAllUnique(SELECTORS.turnBlocks)) {
      const splitNodes = queryAllWithinUnique(turnNode, SELECTORS.roleAnchors);
      if (splitNodes.length > 0) {
        combinedCandidates.push(...splitNodes);
        continue;
      }
      if (this.isLikelyMessageCandidate(turnNode)) {
        combinedCandidates.push(turnNode);
      }
    }

    return uniqueNodesInDocumentOrder(
      combinedCandidates.filter((candidate) => this.isLikelyMessageCandidate(candidate)),
    );
  }

  private isLikelyMessageCandidate(node: Element): boolean {
    if (this.isDiscardNode(node)) {
      return false;
    }

    if (SELECTORS.noiseContainers.some((selector) => node.closest(selector) !== null)) {
      return false;
    }

    const hasRoleMarker = this.hasUserMarker(node) || this.hasAssistantMarker(node);
    const preferredContent = queryFirstWithin(node, SELECTORS.preferredMessageContent);
    if (!hasRoleMarker && !preferredContent) {
      return false;
    }

    const contentEl = preferredContent ?? queryFirstWithin(node, SELECTORS.messageContent);
    const normalizedText = this.extractSanitizedText(contentEl ?? node);
    if (normalizedText.length < 2) {
      return false;
    }

    return !this.isLikelyNoiseText(normalizedText);
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    if (this.isDiscardNode(node)) {
      return null;
    }

    const role = this.inferRole(node);
    if (!role) return null;

    const resolvedContent = this.resolveContentElement(node, role);
    const contentEl = resolvedContent.element;
    if (contentEl && this.isDiscardNode(contentEl)) {
      return null;
    }

    const sanitizedContent = this.sanitizeContentElement(contentEl ?? node);
    const ast = extractAstFromElement(sanitizedContent, {
      platform: "Doubao",
      perfMode,
    });
    const fallbackText = this.cleanExtractedText(this.extractVisibleText(sanitizedContent));
    const textContent = resolveCanonicalMessageText({
      fallbackText,
      ast: ast.root,
      normalizeAstText: (value: string) => this.cleanExtractedText(value),
    });

    return {
      message: {
        role,
        textContent,
        contentAst: ast.root,
        contentAstVersion: ast.root ? "ast_v2" : null,
        degradedNodesCount: ast.degradedNodesCount,
        htmlContent: sanitizedContent.innerHTML,
      },
      degradedNodesCount: ast.degradedNodesCount,
      astNodeCount: ast.astNodeCount,
      aiSegmentStats: resolvedContent.aiSegmentStats,
    };
  }

  private resolveContentElement(node: Element, role: MessageRole): ContentResolution {
    const aiSegmentStats = createEmptyAiSegmentStats();
    const preferred = queryFirstWithin(node, SELECTORS.preferredMessageContent);
    if (role === "user") {
      return {
        element: preferred ?? queryFirstWithin(node, SELECTORS.messageContent),
        aiSegmentStats,
      };
    }

    let cotLeaves: Element[] = [];
    let finalLeaves: Element[] = [];

    try {
      cotLeaves = this.reduceSegmentLeaves(queryAllWithinUnique(node, SELECTORS.aiCotLeaves));
      if (cotLeaves.length > 0) {
        aiSegmentStats.cot_detected += 1;
      }
    } catch {
      aiSegmentStats.cot_parse_failed += 1;
    }

    try {
      finalLeaves = this.reduceSegmentLeaves(queryAllWithinUnique(node, SELECTORS.aiFinalLeaves));
      if (finalLeaves.length > 0) {
        aiSegmentStats.final_detected += 1;
      }
    } catch {
      aiSegmentStats.final_parse_failed += 1;
    }

    const segmented = this.buildSegmentedAiContainer(cotLeaves, finalLeaves, aiSegmentStats);
    if (segmented) {
      return { element: segmented, aiSegmentStats };
    }

    return {
      element: preferred ?? queryFirstWithin(node, SELECTORS.messageContent),
      aiSegmentStats,
    };
  }

  private buildSegmentedAiContainer(
    cotLeaves: Element[],
    finalLeaves: Element[],
    aiSegmentStats: AiSegmentStats,
  ): Element | null {
    const root = document.createElement("div");
    root.setAttribute("data-vesti-segment-root", "doubao");

    const hasCot = this.appendSegmentSection(
      root,
      "\u601d\u8003\u8fc7\u7a0b",
      cotLeaves,
      "cot",
      aiSegmentStats,
    );
    const hasFinal = this.appendSegmentSection(
      root,
      "\u6b63\u5f0f\u56de\u7b54",
      finalLeaves,
      "final",
      aiSegmentStats,
    );

    if (!hasCot && !hasFinal) {
      return null;
    }

    if (!hasCot && hasFinal) {
      aiSegmentStats.final_only_fallback_used += 1;
    }

    return root;
  }

  private appendSegmentSection(
    root: Element,
    headingText: string,
    leaves: Element[],
    branch: SegmentBranch,
    aiSegmentStats: AiSegmentStats,
  ): boolean {
    if (leaves.length === 0) {
      return false;
    }

    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = headingText;
    section.appendChild(heading);

    let appended = 0;
    const seenSignatures = new Set<string>();

    for (const leaf of leaves) {
      try {
        const sanitizedLeaf = this.sanitizeContentElement(leaf);
        const normalizedText = this.cleanExtractedText(this.extractVisibleText(sanitizedLeaf));
        if (!normalizedText || normalizedText.length < 2 || this.isLikelyNoiseText(normalizedText)) {
          continue;
        }

        const signature = normalizedText.replace(/\s+/g, " ").trim();
        if (seenSignatures.has(signature)) {
          continue;
        }

        seenSignatures.add(signature);
        section.appendChild(sanitizedLeaf);
        appended += 1;
      } catch {
        if (branch === "cot") {
          aiSegmentStats.cot_parse_failed += 1;
        } else {
          aiSegmentStats.final_parse_failed += 1;
        }
      }
    }

    if (appended === 0) {
      return false;
    }

    root.appendChild(section);
    return true;
  }

  private reduceSegmentLeaves(nodes: Element[]): Element[] {
    const unique = uniqueNodesInDocumentOrder(nodes);
    return unique.filter(
      (node, index) => !unique.some((candidate, candidateIndex) => candidateIndex !== index && node.contains(candidate)),
    );
  }

  private sanitizeContentElement(source: Element): Element {
    const { clone } = cloneAndSanitizeMessageContent(
      source,
      getCitationNoiseProfile("Doubao"),
    );

    for (const selector of SELECTORS.inlineNoiseSelectors) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    }

    clone.querySelectorAll("[class*='table-wrapper']").forEach((node) => {
      if (!(node instanceof Element)) {
        return;
      }

      const nestedTable = node.querySelector("[class*='table-body'] table");
      if (!nestedTable) {
        return;
      }

      const replacement =
        nestedTable.closest("[class*='table-container'], [class*='table-scroll-container']") ??
        nestedTable;
      node.replaceWith(replacement.cloneNode(true));
    });

    for (const selector of SELECTORS.dividerSelectors) {
      clone.querySelectorAll(selector).forEach((divider) => {
        divider.replaceWith(document.createTextNode("\n"));
      });
    }

    this.pruneEmptyNodes(clone);
    return clone;
  }

  private pruneEmptyNodes(root: Element): void {
    const emptyTextNodes: Node[] = [];
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (textWalker.nextNode()) {
      const current = textWalker.currentNode;
      if (!(current.textContent ?? "").trim()) {
        emptyTextNodes.push(current);
      }
    }

    for (const node of emptyTextNodes) {
      node.parentNode?.removeChild(node);
    }

    const descendants = Array.from(root.querySelectorAll("*")).reverse();
    for (const descendant of descendants) {
      if (descendant.tagName.toLowerCase() === "br") continue;
      const text = safeTextContent(descendant).replace(/\s+/g, " ").trim();
      if (descendant.childElementCount === 0 && text.length === 0) {
        descendant.remove();
      }
    }
  }

  private extractVisibleText(element: Element): string {
    if (element instanceof HTMLElement) {
      const innerText = (element.innerText || "").trim();
      if (innerText) {
        return innerText;
      }
    }
    return safeTextContent(element);
  }

  private extractSanitizedText(source: Element): string {
    const sanitized = this.sanitizeContentElement(source);
    const rawText = this.extractVisibleText(sanitized);
    return this.cleanExtractedText(rawText);
  }

  private isDiscardNode(node: Element): boolean {
    return SELECTORS.discardContainers.some((selector) => node.matches(selector));
  }

  private inferRole(node: Element): MessageRole | null {
    const testIdRole = this.roleFromTestId(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const attrRole =
      this.roleFromAttribute(node.getAttribute("data-role")) ??
      this.roleFromAttribute(node.getAttribute("data-author")) ??
      this.roleFromAttribute(node.getAttribute("data-message-author-role")) ??
      this.roleFromAttribute(node.getAttribute("role"));
    if (attrRole) return attrRole;

    const classRole = this.roleFromHint(node.className?.toString() ?? "");
    if (classRole) return classRole;

    if (this.hasUserMarker(node)) return "user";
    if (this.hasAssistantMarker(node)) return "ai";

    const descendantRole = this.roleFromDescendants(node);
    if (descendantRole) return descendantRole;

    const ancestor = node.parentElement
      ? closestAnySelector(node.parentElement, SELECTORS.roleAncestorHints)
      : null;
    if (ancestor) {
      const ancestorRole =
        this.roleFromTestId(ancestor.getAttribute("data-testid")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-author")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-message-author-role")) ??
        this.roleFromHint(ancestor.className?.toString() ?? "");
      if (ancestorRole) return ancestorRole;

      if (this.hasUserMarker(ancestor)) return "user";
      if (this.hasAssistantMarker(ancestor)) return "ai";
    }

    return null;
  }

  private roleFromTestId(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (/(^|[-_:])(send_message|user|human|prompt|query|question)([-_:]|$)/.test(normalized)) {
      return "user";
    }

    if (
      /(^|[-_:])(receive_message|assistant|model|doubao|ai|answer|reply|response)([-_:]|$)/.test(
        normalized,
      )
    ) {
      return "ai";
    }

    return this.roleFromHint(normalized);
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (
      normalized === "assistant" ||
      normalized === "model" ||
      normalized === "ai" ||
      normalized === "doubao"
    ) {
      return "ai";
    }
    return null;
  }

  private roleFromHint(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (/(^|[-_:])(user|human|prompt|query|question)([-_:]|$)/.test(normalized)) {
      return "user";
    }

    if (/(^|[-_:])(assistant|model|doubao|ai|answer|reply|response)([-_:]|$)/.test(normalized)) {
      return "ai";
    }

    if (
      normalized.includes("user") ||
      normalized.includes("human") ||
      normalized.includes("prompt") ||
      normalized.includes("query") ||
      normalized.includes("question")
    ) {
      return "user";
    }
    if (
      normalized.includes("assistant") ||
      normalized.includes("model") ||
      normalized.includes("doubao") ||
      normalized.includes("reply") ||
      normalized.includes("response")
    ) {
      return "ai";
    }
    return null;
  }

  private hasUserMarker(node: Element): boolean {
    const selector = SELECTORS.userRoleAnchors.join(", ");
    return node.matches(selector) || node.querySelector(selector) !== null;
  }

  private hasAssistantMarker(node: Element): boolean {
    const selector = SELECTORS.assistantRoleAnchors.join(", ");
    return node.matches(selector) || node.querySelector(selector) !== null;
  }

  private roleFromDescendants(node: Element): MessageRole | null {
    const userSelector = SELECTORS.userRoleAnchors.join(", ");
    const assistantSelector = SELECTORS.assistantRoleAnchors.join(", ");

    const hasUserDescendant = node.querySelector(userSelector) !== null;
    const hasAssistantDescendant = node.querySelector(assistantSelector) !== null;

    if (hasUserDescendant && !hasAssistantDescendant) return "user";
    if (hasAssistantDescendant && !hasUserDescendant) return "ai";
    return null;
  }

  private cleanExtractedText(rawText: string): string {
    let text = rawText.replace(/\r/g, "").replace(/\u00a0/g, " ");
    const lines = text.split("\n");
    const cleanedLines: string[] = [];

    for (const line of lines) {
      const normalizedLine = line.replace(/[ \t\f\v]+/g, " ").trim();
      if (!normalizedLine) {
        cleanedLines.push("");
        continue;
      }
      if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(normalizedLine))) {
        continue;
      }
      cleanedLines.push(normalizedLine);
    }

    text = cleanedLines.join("\n");
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }

  private isLikelyNoiseText(text: string): boolean {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return true;
    }

    if (SELECTORS.noiseTextPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return true;
    }

    return lines.every((line) => NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)));
  }

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const signature = `${message.role}|${message.textContent.replace(/\s+/g, " ").trim()}`;
      const isDuplicate = deduped.slice(Math.max(0, deduped.length - 2)).some((existing) => {
        const existingSignature = `${existing.role}|${existing.textContent
          .replace(/\s+/g, " ")
          .trim()}`;
        return existingSignature === signature;
      });

      if (!isDuplicate) {
        deduped.push(message);
      }
    }

    return deduped;
  }

  private chooseBestExtraction(
    selectorResult: ExtractionResult,
    anchorResult: ExtractionResult,
  ): ExtractionResult {
    const selectorScore = this.scoreExtraction(selectorResult);
    const anchorScore = this.scoreExtraction(anchorResult);

    if (selectorScore > anchorScore) return selectorResult;
    if (anchorScore > selectorScore) return anchorResult;
    return selectorResult.messages.length >= anchorResult.messages.length
      ? selectorResult
      : anchorResult;
  }

  private scoreExtraction(result: ExtractionResult): number {
    if (result.messages.length === 0) return 0;

    const userCount = result.messages.filter((message) => message.role === "user").length;
    const aiCount = result.messages.length - userCount;
    const balancedPairs = Math.min(userCount, aiCount);

    return balancedPairs * 8 + aiCount * 4 + userCount * 2 + result.messages.length;
  }

  private normalizeSessionId(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim();
    if (normalized.length < 8) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) return null;
    if (INVALID_SESSION_IDS.has(normalized.toLowerCase())) return null;
    return normalized;
  }

  private logStats(stats: ParserStats, messages: ParsedMessage[]): void {
    logger.info("parser", "Doubao parse stats", stats);

    if (messages.length === 0) {
      logger.debug("parser", "Doubao parser kept zero messages", {
        source: stats.source,
        totalCandidates: stats.totalCandidates,
        droppedNoise: stats.droppedNoise,
        droppedUnknownRole: stats.droppedUnknownRole,
      });
      return;
    }

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.debug("parser", "Doubao parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
