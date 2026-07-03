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
import { resolveCanonicalMessageText } from "../shared/canonicalMessageText";
import { astPerfModeController, type AstPerfMode } from "../shared/astPerfMode";
import { logger } from "../../../utils/logger";

const SELECTORS = {
  userContent: [
    ".fbb737a4",
    "[class*='user'] > div",
    ":scope > div",
  ],
  assistantContent: [
    ".ds-markdown",
    "[class*='ds-markdown']",
  ],
  roleAnchors: [
    ".ds-message",
    "[class*='ds-message']",
    "[data-message-author-role='user']",
    "[data-message-author-role='assistant']",
    "[data-role='user']",
    "[data-role='assistant']",
    "[data-author='user']",
    "[data-author='assistant']",
    "[data-testid*='user']",
    "[data-testid*='assistant']",
    "[class*='user-message']",
    "[class*='assistant-message']",
    "[class*='message-user']",
    "[class*='message-assistant']",
  ],
  turnBlocks: [
    "[data-message-id]",
    "[data-testid*='message']",
    "[data-testid*='chat-message']",
    ".ds-message",
    "[class*='ds-message']",
    "article",
    "[role='listitem']",
  ],
  messageContent: [
    ".ds-markdown",
    "[class*='ds-markdown']",
    "[data-testid*='message-content']",
    "[data-testid*='response-content']",
    ".markdown",
    ".prose",
    "div[class*='markdown']",
    "div[class*='content']",
    ".ds-message",
    "[class*='ds-message']",
    "[class*='message']",
    "article",
  ],
  title: ["main h1", "header h1", "title"],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='stream']",
    "[data-testid*='typing']",
    "[class*='stream']",
    "[class*='typing']",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "aside",
    "[role='navigation']",
    "[role='complementary']",
    "[data-testid*='composer']",
    "[contenteditable='true']",
    "textarea",
    "input",
  ],
  uiNoiseSelectors: [
    "button",
    "svg",
    "textarea",
    "input",
    "iframe",
    "canvas",
    "[role='button']",
    ".ds-icon-button",
    ".ds-atom-button",
    ".ds-focus-ring",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^deepseek can make mistakes\.?/i,
    /^\u5df2\u601d\u8003.*$/i,
    /^\u5185\u5bb9\u7531\s*AI\s*\u751f\u6210.*$/i,
  ],
  sourceTimes: ["time[datetime]", "article time[datetime]"],
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

export class DeepSeekParser implements IParser {
  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("chat.deepseek.com")) {
      return "DeepSeek";
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
    const perfMode = astPerfModeController.getMode("DeepSeek");
    const selectorResult = this.extractUsingSelectorStrategy(perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("DeepSeek", parseDurationMs);

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
      platform: "DeepSeek",
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "DeepSeek AST perf mode switched", {
        platform: "DeepSeek",
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

    const messages: ParsedMessage[] = [];
    let droppedUnknownRole = 0;
    let droppedNoise = normalized.droppedNoise;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of normalized.nodes) {
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
      };
    }

    const resolved = uniqueNodesInDocumentOrder(
      anchors.map((anchor) => this.resolveAnchorNode(anchor)).filter(Boolean) as Element[],
    );

    const messages: ParsedMessage[] = [];
    let droppedNoise = 0;
    let droppedUnknownRole = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of resolved) {
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
      combinedCandidates.push(turnNode);
    }

    return uniqueNodesInDocumentOrder(combinedCandidates);
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    const role = this.inferRole(node);
    if (!role) return null;

    const contentEl = this.resolveContentElement(node, role);
    if (!contentEl) {
      return null;
    }

    const sanitizedContent = this.sanitizeContentElement(contentEl);
    const ast = extractAstFromElement(sanitizedContent, {
      platform: "DeepSeek",
      perfMode,
    });
    const fallbackText = this.cleanExtractedText(this.extractVisibleText(sanitizedContent));
    const textContent = resolveCanonicalMessageText({
      fallbackText,
      ast: ast.root,
      normalizeAstText: (value: string) => this.cleanExtractedText(value),
    });

    if (!textContent) {
      return null;
    }

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
    };
  }

  private resolveContentElement(node: Element, role: MessageRole): Element | null {
    if (role === "ai") {
      const assistantContent = queryFirstWithin(node, SELECTORS.assistantContent);
      if (assistantContent) {
        return assistantContent;
      }
    }

    if (role === "user") {
      const directChildren = Array.from(node.children).filter(
        (child) => child instanceof Element && !this.isUiNoiseNode(child),
      );
      const firstTextBearingChild = directChildren.find(
        (child) => this.cleanExtractedText(this.extractVisibleText(child)).length > 0,
      );
      if (firstTextBearingChild) {
        return firstTextBearingChild;
      }

      const userContent = queryFirstWithin(node, SELECTORS.userContent);
      if (userContent) {
        return userContent;
      }
    }

    return queryFirstWithin(node, SELECTORS.messageContent);
  }

  private sanitizeContentElement(source: Element): Element {
    const clone = source.cloneNode(true) as Element;

    for (const selector of SELECTORS.uiNoiseSelectors) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
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

  private isUiNoiseNode(node: Element): boolean {
    return SELECTORS.uiNoiseSelectors.some((selector) => node.matches(selector));
  }

  private inferRole(node: Element): MessageRole | null {
    // Authoritative role attributes first. DeepSeek class names are content
    // hashes that rotate across builds; if the brittle class heuristic runs
    // first it can collapse every bubble to "ai" when the user-hash rotates,
    // overriding an explicit role attribute sitting right on the node.
    const attrRole =
      this.roleFromAttribute(node.getAttribute("data-message-author-role")) ??
      this.roleFromAttribute(node.getAttribute("data-role")) ??
      this.roleFromAttribute(node.getAttribute("data-author"));
    if (attrRole) return attrRole;

    const deepSeekClassRole = this.roleFromDeepSeekClass(node.className?.toString() ?? "");
    if (deepSeekClassRole) return deepSeekClassRole;

    const testIdRole = this.roleFromHint(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const classRole = this.roleFromHint(node.className?.toString() ?? "");
    if (classRole) return classRole;

    const ancestor = node.parentElement?.closest("[data-role], [data-author], [data-testid], [class]");
    if (ancestor) {
      const ancestorAttrRole =
        this.roleFromAttribute(ancestor.getAttribute("data-message-author-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-author"));
      if (ancestorAttrRole) return ancestorAttrRole;

      const deepSeekAncestorRole = this.roleFromDeepSeekClass(
        ancestor.className?.toString() ?? ""
      );
      if (deepSeekAncestorRole) return deepSeekAncestorRole;

      const ancestorRole =
        this.roleFromHint(ancestor.getAttribute("data-testid")) ??
        this.roleFromHint(ancestor.className?.toString() ?? "");
      if (ancestorRole) return ancestorRole;
    }

    return null;
  }

  private roleFromDeepSeekClass(value: string): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (!normalized.includes("ds-message")) {
      return null;
    }

    if (
      normalized.includes("d29f3d7d") ||
      normalized.includes("user") ||
      normalized.includes("human") ||
      normalized.includes("query") ||
      normalized.includes("prompt")
    ) {
      return "user";
    }

    return "ai";
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (
      normalized === "assistant" ||
      normalized === "model" ||
      normalized === "ai" ||
      normalized === "deepseek"
    ) {
      return "ai";
    }
    return null;
  }

  private roleFromHint(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (
      normalized.includes("user") ||
      normalized.includes("human") ||
      normalized.includes("prompt") ||
      normalized.includes("query")
    ) {
      return "user";
    }
    if (
      normalized.includes("assistant") ||
      normalized.includes("model") ||
      normalized.includes("deepseek") ||
      normalized.includes("response")
    ) {
      return "ai";
    }
    return null;
  }

  private cleanExtractedText(rawText: string): string {
    return rawText
      .replace(/\s+/g, " ")
      .replace(/^(copy|edit|retry)\s+/i, "")
      .trim();
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
    logger.info("parser", "DeepSeek parse stats", stats);

    if (messages.length === 0) {
      logger.debug("parser", "DeepSeek parser kept zero messages", {
        source: stats.source,
        totalCandidates: stats.totalCandidates,
        droppedNoise: stats.droppedNoise,
        droppedUnknownRole: stats.droppedUnknownRole,
      });
      return;
    }

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.debug("parser", "DeepSeek parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
