import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import {
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
import { astPerfModeController, type AstPerfMode } from "../shared/astPerfMode";
import { logger } from "../../../utils/logger";

const SELECTORS = {
  explicitUserAnchors: [".user-content"],
  explicitAiAnchors: [".segment-container"],
  roleAnchors: [".user-content", ".segment-container"],
  turnBlocks: [".segment-container", ".user-content"],
  messageContent: [
    ".user-content",
    ".segment-container",
    ".segment-content-box",
    ".segment-content",
    ".markdown-container",
    ".markdown",
  ],
  headerNoiseContainers: [".chat-header", ".chat-header-content", ".chat-header-actions"],
  title: [".chat-title", ".conversation-title", "main h1", "header h1", "title"],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='stream']",
    "[data-testid*='typing']",
    "[class*='loading']",
    "[class*='stream']",
    "[class*='typing']",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "[role='navigation']",
    "[data-testid*='composer']",
    "[contenteditable='true']",
    ".segment-assistant-actions",
    ".upgrade-membership",
    ".okc-cards-container",
    ".chat-header",
    ".chat-header-content",
    ".chat-header-actions",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^kimi can make mistakes\.?/i,
    /^go premium$/i,
    /^\u53bb\u5347\u7ea7$/i,
  ],
  sourceTimes: ["time[datetime]", "article time[datetime]"],
  markdownLeaves: [".markdown"],
  uiNoiseSelectors: [
    ".toolcall-container",
    ".container-block",
    ".segment-assistant-actions",
    ".rag-tag",
    ".toolcall-title-container",
    ".segment-code-header",
    ".segment-code-header-content",
    ".segment-code-lang",
    ".segment-user-actions",
    ".segment-user-actions-content",
    ".table-actions",
    ".table-actions-icon",
    ".icon-button",
    ".simple-button",
    ".upgrade-membership",
    ".okc-cards-container",
    ".chat-header",
    ".chat-header-content",
    ".chat-header-actions",
    "button",
    "svg",
  ],
};

const TITLE_PLATFORM_SUFFIX_PATTERN =
  /\s*[-\u2013\u2014]\s*(ChatGPT|Claude|Gemini|DeepSeek|Qwen|Doubao|Kimi|Yuanbao)\s*$/i;
const SESSION_ID_QUERY_KEYS = [
  "conversation",
  "conversation_id",
  "thread",
  "thread_id",
  "chat",
  "chat_id",
  "session",
  "session_id",
  "id",
];

const SESSION_ID_PATTERNS = [
  /\/a\/chat\/s\/([a-zA-Z0-9_-]{8,})/i,
  /\/chat\/([a-zA-Z0-9_-]{8,})/i,
  /\/conversation\/([a-zA-Z0-9_-]{8,})/i,
  /\/c\/([a-zA-Z0-9_-]{8,})/i,
  /\/s\/([a-zA-Z0-9_-]{8,})/i,
];

const INVALID_SESSION_IDS = new Set([
  "chat",
  "new",
  "conversation",
  "session",
  "search",
  "library",
]);

const NOISE_LINE_PATTERNS = [
  /^(copy|edit|retry|like|dislike|share)$/i,
  /^(references?|\u5f15\u7528)$/i,
  /^\u53bb\u5347\u7ea7$/i,
];

type MessageRole = "user" | "ai";
type ExtractionSource = "selector" | "anchor";

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
}

interface ExtractionResult {
  source: ExtractionSource;
  totalCandidates: number;
  droppedNoise: number;
  droppedUnknownRole: number;
  messages: ParsedMessage[];
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ParsedNodeResult {
  message: ParsedMessage;
  degradedNodesCount: number;
  astNodeCount: number;
}

export class KimiParser implements IParser {
  detect(): Platform | null {
    const host = window.location.hostname;
    if (host === "www.kimi.com" || host === "kimi.com" || host === "kimi.moonshot.cn") {
      return "Kimi";
    }
    return null;
  }

  getConversationTitle(): string {
    const titleEl = queryFirst(SELECTORS.title);
    const title = this.cleanTitle(safeTextContent(titleEl));
    if (title) return title;

    const fallbackTitle = this.cleanTitle(document.title || "");
    if (fallbackTitle) return fallbackTitle;

    return "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Kimi");
    const selectorResult = this.extractUsingSelectorStrategy(perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Kimi", parseDurationMs);

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
      platform: "Kimi",
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "Kimi AST perf mode switched", {
        platform: "Kimi",
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
    const scopedCandidates = rawCandidates.filter((candidate) => !this.isHeaderNoiseNode(candidate));
    const normalized = normalizeCandidateNodes(scopedCandidates, {
      minTextLength: 2,
      noiseContainerSelectors: SELECTORS.noiseContainers,
      noiseTextPatterns: SELECTORS.noiseTextPatterns,
    });

    const messages: ParsedMessage[] = [];
    let droppedUnknownRole = 0;
    let droppedNoise = normalized.droppedNoise + (rawCandidates.length - scopedCandidates.length);
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of normalized.nodes) {
      if (this.isHeaderNoiseNode(node)) {
        droppedNoise += 1;
        continue;
      }
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (!parsed.message.textContent.trim()) {
        droppedNoise += 1;
        continue;
      }

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "selector",
      totalCandidates: rawCandidates.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private extractUsingAnchorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const anchors = queryAllUnique(SELECTORS.turnBlocks).filter(
      (anchor) => !this.isHeaderNoiseNode(anchor),
    );
    if (anchors.length === 0) {
      return {
        source: "anchor",
        totalCandidates: 0,
        droppedNoise: 0,
        droppedUnknownRole: 0,
        messages: [],
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const resolved = uniqueNodesInDocumentOrder(
      anchors.map((anchor) => this.resolveAnchorNode(anchor)).filter(Boolean) as Element[],
    );
    const normalized = normalizeCandidateNodes(resolved, {
      minTextLength: 2,
      noiseContainerSelectors: SELECTORS.noiseContainers,
      noiseTextPatterns: SELECTORS.noiseTextPatterns,
    });

    const messages: ParsedMessage[] = [];
    let droppedNoise = normalized.droppedNoise;
    let droppedUnknownRole = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of normalized.nodes) {
      if (this.isHeaderNoiseNode(node)) {
        droppedNoise += 1;
        continue;
      }
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (!parsed.message.textContent.trim()) {
        droppedNoise += 1;
        continue;
      }
      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "anchor",
      totalCandidates: resolved.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private resolveAnchorNode(anchor: Element): Element | null {
    if (this.isHeaderNoiseNode(anchor)) return null;
    if (anchor.matches(".segment-container, .user-content")) {
      return anchor;
    }

    const scopedAncestor = anchor.closest(".segment-container, .user-content");
    if (scopedAncestor && !this.isHeaderNoiseNode(scopedAncestor)) {
      return scopedAncestor;
    }

    return null;
  }

  private collectMessageCandidates(): Element[] {
    const combinedCandidates: Element[] = [
      ...queryAllUnique(SELECTORS.explicitUserAnchors),
      ...queryAllUnique(SELECTORS.explicitAiAnchors),
      ...queryAllUnique(SELECTORS.roleAnchors),
      ...queryAllUnique(SELECTORS.turnBlocks),
    ];

    return uniqueNodesInDocumentOrder(combinedCandidates).filter(
      (candidate) => !this.isHeaderNoiseNode(candidate),
    );
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    if (this.isHeaderNoiseNode(node)) return null;

    const role = this.inferRole(node);
    if (!role) return null;

    const contentEl = this.resolveContentElement(node, role);
    if (!contentEl) return null;

    const sanitized = this.sanitizeContentElement(contentEl);
    const textContent = this.cleanExtractedText(this.extractVisibleText(sanitized));
    if (!textContent) return null;
    if (this.shouldDropHeaderScopedTitle(node, textContent)) return null;

    const ast = extractAstFromElement(sanitized, {
      platform: "Kimi",
      perfMode,
    });

    return {
      message: {
        role,
        textContent,
        contentAst: ast.root,
        contentAstVersion: ast.root ? "ast_v2" : null,
        degradedNodesCount: ast.degradedNodesCount,
        htmlContent: sanitized.innerHTML,
      },
      degradedNodesCount: ast.degradedNodesCount,
      astNodeCount: ast.astNodeCount,
    };
  }

  private resolveContentElement(node: Element, role: MessageRole): Element | null {
    if (this.isHeaderNoiseNode(node)) return null;

    if (role === "user") {
      if (node.matches(".user-content")) return node;
      const userNode = queryFirstWithin(node, [".user-content"]);
      if (!userNode || this.isHeaderNoiseNode(userNode)) return null;
      return userNode;
    }

    const segment = node.matches(".segment-container")
      ? node
      : (node.closest(".segment-container") ?? queryFirstWithin(node, [".segment-container"]));
    if (!segment || this.isHeaderNoiseNode(segment)) return null;

    const markdownLeaves = queryAllWithinUnique(segment, SELECTORS.markdownLeaves).filter(
      (leaf) => !leaf.closest(".toolcall-container") && !this.isHeaderNoiseNode(leaf),
    );

    if (markdownLeaves.length === 0) {
      return null;
    }

    if (markdownLeaves.length === 1) {
      return markdownLeaves[0];
    }

    const merged = document.createElement("div");
    merged.setAttribute("data-vesti-kimi-final-only", "true");
    for (const leaf of markdownLeaves) {
      const fragment = document.createElement("div");
      fragment.setAttribute("data-vesti-kimi-fragment", "true");
      fragment.appendChild(leaf.cloneNode(true));
      merged.appendChild(fragment);
    }
    return merged;
  }

  private sanitizeContentElement(source: Element): Element {
    const clone = source.cloneNode(true) as Element;

    for (const selector of SELECTORS.uiNoiseSelectors) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    }

    if (SELECTORS.headerNoiseContainers.some((selector) => clone.matches(selector))) {
      clone.textContent = "";
    }

    this.pruneEmptyNodes(clone);
    return clone;
  }

  private pruneEmptyNodes(root: Element): void {
    const emptyTextNodes: Node[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const current = walker.currentNode;
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

  private inferRole(node: Element): MessageRole | null {
    if (this.isHeaderNoiseNode(node)) return null;

    if (node.matches(".user-content")) return "user";
    if (node.matches(".segment-container")) return "ai";

    const scopedAncestor = node.closest(".user-content, .segment-container");
    if (scopedAncestor?.matches(".user-content")) return "user";
    if (scopedAncestor?.matches(".segment-container")) return "ai";

    const kimiClassRole = this.roleFromKimiClass(node.className?.toString() ?? "");
    if (kimiClassRole) return kimiClassRole;

    const attrRole =
      this.roleFromAttribute(node.getAttribute("data-message-author-role")) ??
      this.roleFromAttribute(node.getAttribute("data-role")) ??
      this.roleFromAttribute(node.getAttribute("data-author"));
    if (attrRole) return attrRole;

    const testIdRole = this.roleFromHint(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const classRole = this.roleFromHint(node.className?.toString() ?? "");
    if (classRole) return classRole;

    const ancestor = node.parentElement?.closest("[data-role], [data-author], [data-testid], [class]");
    if (ancestor) {
      const kimiAncestorRole = this.roleFromKimiClass(ancestor.className?.toString() ?? "");
      if (kimiAncestorRole) return kimiAncestorRole;

      const ancestorRole =
        this.roleFromAttribute(ancestor.getAttribute("data-message-author-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-author")) ??
        this.roleFromHint(ancestor.getAttribute("data-testid")) ??
        this.roleFromHint(ancestor.className?.toString() ?? "");
      if (ancestorRole) return ancestorRole;
    }

    return null;
  }

  private roleFromKimiClass(value: string): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (normalized.includes("user-content")) {
      return "user";
    }
    if (normalized.includes("segment-container")) {
      return "ai";
    }
    return null;
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (
      normalized === "assistant" ||
      normalized === "model" ||
      normalized === "ai" ||
      normalized === "kimi"
    ) {
      return "ai";
    }
    return null;
  }

  private roleFromHint(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (
      normalized.includes("user-content") ||
      normalized.includes("data-role=user") ||
      normalized.includes("author=user")
    ) {
      return "user";
    }
    if (
      normalized.includes("segment-container") ||
      normalized.includes("assistant") ||
      normalized.includes("data-role=assistant") ||
      normalized.includes("author=assistant")
    ) {
      return "ai";
    }
    return null;
  }

  private isHeaderNoiseNode(node: Element | null): boolean {
    if (!node) return false;
    return SELECTORS.headerNoiseContainers.some(
      (selector) => node.matches(selector) || node.closest(selector),
    );
  }

  private shouldDropHeaderScopedTitle(node: Element, textContent: string): boolean {
    if (!this.isHeaderNoiseNode(node)) {
      return false;
    }

    const normalizedText = textContent.replace(/\s+/g, " ").trim();
    if (!normalizedText) return true;

    const title = this.cleanTitle(this.getConversationTitle());
    if (!title) return true;

    return normalizedText === title.replace(/\s+/g, " ").trim();
  }

  private cleanExtractedText(rawText: string): string {
    const lines = rawText
      .replace(/\r/g, "")
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .filter((line) => !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)));

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  private cleanTitle(rawTitle: string): string {
    return rawTitle
      .replace(/\s+/g, " ")
      .replace(TITLE_PLATFORM_SUFFIX_PATTERN, "")
      .trim();
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
    logger.info("parser", "Kimi parse stats", stats);

    if (messages.length === 0) {
      logger.debug("parser", "Kimi parser kept zero messages", {
        source: stats.source,
        totalCandidates: stats.totalCandidates,
        droppedNoise: stats.droppedNoise,
        droppedUnknownRole: stats.droppedUnknownRole,
      });
      return;
    }

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.debug("parser", "Kimi parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
