import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import { extractEarliestTimeFromSelectors, queryAllUnique, queryAllWithinUnique, queryFirst, queryFirstWithin, safeTextContent, uniqueNodesInDocumentOrder } from "../shared/selectorUtils";
import { extractAstFromElement } from "../shared/astExtractor";
import { resolveCanonicalMessageText } from "../shared/canonicalMessageText";
import { astPerfModeController, type AstPerfMode } from "../shared/astPerfMode";
import { logger } from "../../../utils/logger";
import { createMessageArtifact } from "../../../utils/messageArtifacts";

const SELECTORS = {
  messageRoots: [".agent-chat__bubble"],
  userRoots: [".agent-chat__bubble--human"],
  aiRoots: [".agent-chat__bubble--ai"],
  userContent: [
    ".hyc-content-text",
    ".hyc-component-text .hyc-content-text",
    ".agent-chat__bubble__content",
  ],
  aiSpeechRoots: [
    ".agent-chat__speech-text",
    ".hyc-content-md",
    ".hyc-common-markdown",
  ],
  aiFinalNodes: [".hyc-common-markdown:not(.hyc-common-markdown-style-cot)"],
  cotParagraphs: [".hyc-component-deepsearch-cot__think__content__item-text .ybc-p"],
  title: [
    ".hyc-page-title",
    ".hyc-page-header h1",
    "main h1",
    "header h1",
    "title",
  ],
  // Streaming indicators. The class-substring checks are intentionally scoped
  // *inside* an AI bubble: unscoped `[class*='stream'|'typing'|'generating']`
  // selectors can match persistent page chrome (sidebars, banners, analytics
  // widgets), which would leave `isGenerating()` permanently true and block
  // every capture — the root-cause pattern behind "Yuanbao cannot capture".
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='streaming']",
    ".agent-chat__bubble--ai [class*='stream']",
    ".agent-chat__bubble--ai [class*='typing']",
    ".agent-chat__bubble--ai [class*='generating']",
  ],
  sourceTimes: ["time[datetime]", "article time[datetime]"],
  uiNoiseSelectors: [
    ".agent-chat__conv--ai__toolbar",
    ".agent-chat__conv--human__toolbar",
    ".agent-chat__question-toolbar",
    ".agent-chat__question-toolbar__copy-wrapper",
    ".agent-chat__toolbar",
    ".agent-chat__toolbar__left",
    ".agent-chat__toolbar__right",
    ".ToolbarCopy_copyIconWrap__PfQIm",
    ".ToolbarCopy_icon__5Odjl",
    ".ToolbarCopy_arrowIconWrap__GR0vU",
    ".Toolbar_icon__xGP8b",
    ".Repeat_icon__oL8u_",
    ".hyc-common-markdown__replace-appCard",
    ".hyc-common-markdown__replace-appCard-container",
    ".hyc-component-deepsearch-cot__think__header-container",
    ".hyc-component-deepsearch-cot__think__header__toggle",
    ".hyc-component-deepsearch-cot__think__content__item-search",
    ".hyc-component-deepsearch-cot__think__content__item__docs",
    ".hyc-component-deepsearch-cot__think__content__item__docs__number",
    ".hyc-component-deepsearch-cot__think__content__item__doc",
    ".hyc-component-deepsearch-cot__think__content__item__doc__title",
    ".hyc-component-deepsearch-cot__think__content__item__doc__title__text",
    ".agent-dialogue__tool",
    ".agent-dialogue__tool__download",
    ".index_pc_download_pure__iGyre",
    ".agent-dialogue__content--common__input",
    ".agent-chat__input-box",
    ".agent-dialogue__content-copyright",
    ".agent-chat__scroll-arrow",
    ".agent-dialogue__content-split-pane__code",
    "#yuanbao-canvas-container",
    ".hyc-card-box-process-list",
    "button",
    "svg",
  ],
  artifactPreview: [".hyc-card-box-process-list"],
  artifactCanvas: ["#yuanbao-canvas-container"],
  artifactCodePane: [".agent-dialogue__content-split-pane__code"],
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
  /\/chat\/[^/]+\/([a-zA-Z0-9-]{8,})/i,
  /\/chat\/([a-zA-Z0-9-]{8,})/i,
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

interface ParserStats {
  source: "selector" | "anchor";
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
  source: "selector" | "anchor";
  totalCandidates: number;
  droppedNoise: number;
  droppedUnknownRole: number;
  messages: ParsedMessage[];
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ParsedRootResult {
  message: ParsedMessage;
  degradedNodesCount: number;
  astNodeCount: number;
}

export class YuanbaoParser implements IParser {
  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("yuanbao.tencent.com")) {
      return "Yuanbao";
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
    const perfMode = astPerfModeController.getMode("Yuanbao");
    const selectorResult = this.extractUsingSelectorStrategy(perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Yuanbao", parseDurationMs);

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
      platform: "Yuanbao",
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "Yuanbao AST perf mode switched", {
        platform: "Yuanbao",
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
    const match = queryFirst(SELECTORS.generating);
    if (match) {
      // Debug-level so it never reaches the chrome://extensions Errors panel,
      // but still lets us confirm whether a stuck streaming flag is blocking
      // capture from a user-pasted console log.
      logger.debug("parser", "Yuanbao isGenerating matched", {
        tag: match.tagName.toLowerCase(),
        className: (match.className?.toString() ?? "").slice(0, 120),
      });
      return true;
    }
    return false;
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
    const roots = uniqueNodesInDocumentOrder(queryAllUnique(SELECTORS.messageRoots));
    return this.buildMessagesFromRoots(roots, perfMode, "selector");
  }

  private extractUsingAnchorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const anchors = uniqueNodesInDocumentOrder([
      ...queryAllUnique(SELECTORS.userContent),
      ...queryAllUnique(SELECTORS.aiSpeechRoots),
      ...queryAllUnique(SELECTORS.aiFinalNodes),
    ]);
    const roots = uniqueNodesInDocumentOrder(
      anchors
        .map((anchor) => anchor.closest(".agent-chat__bubble"))
        .filter(Boolean) as Element[],
    );
    return this.buildMessagesFromRoots(roots, perfMode, "anchor");
  }

  private buildMessagesFromRoots(
    roots: Element[],
    perfMode: AstPerfMode,
    source: "selector" | "anchor",
  ): ExtractionResult {
    const aiRoots = roots.filter((root) => this.inferRole(root) === "ai");
    const latestAiRoot = aiRoots[aiRoots.length - 1] ?? null;
    const messages: ParsedMessage[] = [];
    let droppedNoise = 0;
    let droppedUnknownRole = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const root of roots) {
      const parsed = this.parseMessageRoot(root, perfMode, root === latestAiRoot);
      if (!parsed) {
        if (this.inferRole(root)) {
          droppedNoise += 1;
        } else {
          droppedUnknownRole += 1;
        }
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
      source,
      totalCandidates: roots.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private parseMessageRoot(
    root: Element,
    perfMode: AstPerfMode,
    isLatestAiRoot: boolean,
  ): ParsedRootResult | null {
    const role = this.inferRole(root);
    if (!role) {
      return null;
    }

    if (role === "user") {
      return this.parseUserRoot(root, perfMode);
    }

    return this.parseAiRoot(root, perfMode, isLatestAiRoot);
  }

  private parseUserRoot(root: Element, perfMode: AstPerfMode): ParsedRootResult | null {
    const contentSource = this.resolveUserContentRoot(root);
    const sanitized = this.sanitizeContentElement(contentSource ?? root);
    const fallbackText = this.cleanExtractedText(this.extractVisibleText(sanitized));
    if (!fallbackText) {
      return null;
    }

    const ast = extractAstFromElement(sanitized, {
      platform: "Yuanbao",
      perfMode,
    });
    const textContent = resolveCanonicalMessageText({
      fallbackText,
      ast: ast.root,
      normalizeAstText: (value: string) => this.cleanExtractedText(value),
    });

    return {
      message: {
        role: "user",
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

  private parseAiRoot(
    root: Element,
    perfMode: AstPerfMode,
    isLatestAiRoot: boolean,
  ): ParsedRootResult | null {
    const cotTexts: string[] = [];
    const merged = document.createElement("div");

    const cotNodes = queryAllWithinUnique(root, SELECTORS.cotParagraphs);
    if (cotNodes.length > 0) {
      const cotSection = document.createElement("section");
      cotSection.setAttribute("data-vesti-yuanbao-cot", "true");

      for (const cotNode of cotNodes) {
        const sanitizedCot = this.sanitizeContentElement(cotNode);
        const cotText = this.cleanExtractedText(this.extractVisibleText(sanitizedCot));
        if (!cotText) {
          continue;
        }

        cotTexts.push(cotText);
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-vesti-yuanbao-cot-fragment", "true");
        wrapper.appendChild(sanitizedCot);
        cotSection.appendChild(wrapper);
      }

      if (cotSection.childElementCount > 0) {
        merged.appendChild(cotSection);
      }
    }

    const finalSource = this.resolveAiFinalRoot(root) ?? this.resolveAiSpeechRoot(root);
    if (!finalSource) {
      return null;
    }

    const sanitizedFinal = this.sanitizeContentElement(finalSource);
    const finalText = this.cleanExtractedText(this.extractVisibleText(sanitizedFinal));
    if (!finalText && cotTexts.length === 0) {
      return null;
    }

    const finalSection = document.createElement("section");
    finalSection.setAttribute("data-vesti-yuanbao-final", "true");
    finalSection.appendChild(sanitizedFinal);
    merged.appendChild(finalSection);

    const fallbackText =
      cotTexts.length > 0 && finalText
        ? `${cotTexts.join("\n\n")}\n\n---\n\n${finalText}`
        : cotTexts.length > 0
          ? cotTexts.join("\n\n")
          : finalText;

    const ast = extractAstFromElement(merged, {
      platform: "Yuanbao",
      perfMode,
    });
    const textContent = resolveCanonicalMessageText({
      fallbackText,
      ast: ast.root,
      normalizeAstText: (value: string) => this.cleanExtractedText(value),
    });

    return {
      message: {
        role: "ai",
        textContent,
        contentAst: ast.root,
        contentAstVersion: ast.root ? "ast_v2" : null,
        degradedNodesCount: ast.degradedNodesCount,
        artifacts: this.collectArtifacts(root, isLatestAiRoot),
        htmlContent: merged.innerHTML,
      },
      degradedNodesCount: ast.degradedNodesCount,
      astNodeCount: ast.astNodeCount,
    };
  }

  private resolveUserContentRoot(root: Element): Element | null {
    return queryFirstWithin(root, SELECTORS.userContent);
  }

  private resolveAiSpeechRoot(root: Element): Element | null {
    return queryFirstWithin(root, SELECTORS.aiSpeechRoots);
  }

  private resolveAiFinalRoot(root: Element): Element | null {
    const finals = queryAllWithinUnique(root, SELECTORS.aiFinalNodes);
    return finals[finals.length - 1] ?? null;
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

  private inferRole(node: Element): MessageRole | null {
    if (node.matches(SELECTORS.userRoots.join(", "))) {
      return "user";
    }
    if (node.matches(SELECTORS.aiRoots.join(", "))) {
      return "ai";
    }

    const className = node.className?.toString() ?? "";
    if (className.includes("agent-chat__bubble--human")) {
      return "user";
    }
    if (className.includes("agent-chat__bubble--ai")) {
      return "ai";
    }

    return null;
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

  private cleanExtractedText(rawText: string): string {
    return rawText
      .replace(/\r/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter(
        (line) =>
          !/^(copy|edit|retry|like|dislike|share)$/i.test(line) &&
          !/^references?$/i.test(line) &&
          !/^\u5df2\u5b8c\u6210\u6df1\u5ea6\u641c\u7d22.*$/i.test(line) &&
          !/^\u627e\u5230\u4e86\s*\d+\s*\u7bc7\u76f8\u5173\u8d44\u6599$/i.test(line),
      )
      .join("\n")
      .trim();
  }

  private collectArtifacts(root: Element, isLatestAiRoot: boolean) {
    const artifacts = [];

    if (this.hasMeaningfulArtifactPreview(root)) {
      const artifact = createMessageArtifact({ kind: "preview", label: "Yuanbao preview" });
      artifact.captureMode = "presence_only";
      artifacts.push(artifact);
    }

    if (isLatestAiRoot && queryFirst(SELECTORS.artifactCanvas)) {
      const artifact = createMessageArtifact({ kind: "canvas", label: "Yuanbao canvas" });
      artifact.captureMode = "presence_only";
      artifacts.push(artifact);
    }

    if (isLatestAiRoot && queryFirst(SELECTORS.artifactCodePane)) {
      const artifact = createMessageArtifact({
        kind: "code_artifact",
        label: "Yuanbao split pane",
      });
      artifact.captureMode = "presence_only";
      artifacts.push(artifact);
    }

    return artifacts;
  }

  private hasMeaningfulArtifactPreview(root: Element): boolean {
    const preview = queryFirstWithin(root, SELECTORS.artifactPreview);
    if (!preview) {
      return false;
    }

    const className = preview.className?.toString() ?? "";
    const text = this.cleanExtractedText(this.extractVisibleText(preview));
    if (className.includes("--hidden") || preview.getAttribute("aria-hidden") === "true") {
      return text.length > 0;
    }

    return text.length > 0 || preview.childElementCount > 0;
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
    logger.info("parser", "Yuanbao parse stats", stats);

    if (messages.length === 0) {
      logger.debug("parser", "Yuanbao parser kept zero messages", {
        source: stats.source,
        totalCandidates: stats.totalCandidates,
        droppedNoise: stats.droppedNoise,
        droppedUnknownRole: stats.droppedUnknownRole,
      });
      return;
    }

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.debug("parser", "Yuanbao parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
