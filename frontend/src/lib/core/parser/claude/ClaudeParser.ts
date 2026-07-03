import type { IParser, ParsedMessage } from "../IParser";
import type { MessageArtifact, Platform } from "../../../types";
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
import { queryShallowestAppShellText } from "../shared/appShellInterceptor";
import { resolveCanonicalMessageText } from "../shared/canonicalMessageText";
import { astPerfModeController, type AstPerfMode } from "../shared/astPerfMode";
import { createMessageArtifact } from "../../../utils/messageArtifacts";
import { logger } from "../../../utils/logger";
import { serializeAstRootToMarkdown } from "../../../utils/astMarkdown";

const SELECTORS = {
  userPrimaryNodes: ["[data-testid='user-message']", "[data-testid*='user-message']"],
  roleAnchors: [
    "[data-author='user']",
    "[data-author='human']",
    "[data-author='assistant']",
    "[data-message-author-role='user']",
    "[data-message-author-role='assistant']",
    "[data-testid*='user-message']",
    "[data-testid*='human-message']",
    "[data-testid*='assistant-message']",
    "[data-testid*='assistant']",
    "[data-testid*='claude-message']",
    "[data-testid*='model-message']",
    "[data-testid*='response-message']",
    "[class*='user-message']",
    "[class*='font-user-message']",
    "[class*='claude-message']",
    "[class*='font-claude-message']",
  ],
  copyActionAnchors: ["[data-testid='action-bar-copy']"],
  messageContainers: [
    "main div.group.relative",
    "main [data-testid*='message']",
    "main [role='listitem']",
  ],
  roleAncestorHints: ["[data-author]", "[data-message-author-role]", "[data-testid]"],
  messageContent: [
    ".standard-markdown",
    ".progressive-markdown",
    "[class*='font-claude-response-body']",
    "[data-testid*='message-content']",
    "[data-testid='user-message']",
    ".markdown",
    ".prose",
    "div[class*='whitespace-pre-wrap']",
    "div[class*='font-claude-message']",
    "div[class*='font-user-message']",
  ],
  aiContentLeaves: [
    ".standard-markdown",
    ".progressive-markdown",
    "[class*='font-claude-response-body']",
    "[data-testid*='assistant-message'] .markdown",
    "[data-testid*='assistant-message'] .prose",
  ],
  artifactRoots: [
    "#markdown-artifact",
    "[data-testid='markdown-artifact']",
    "[data-testid*='artifact-root']",
    "[data-testid*='artifact-panel']",
  ],
  artifactFallbackRoots: [
    "[data-testid*='artifact']",
    "[data-testid*='preview']",
    "[aria-label*='artifact' i]",
    "[aria-label*='preview' i]",
    "[id*='artifact']",
    "[id*='preview']",
    "[class*='artifact']",
    "[class*='preview']",
  ],
  artifactContentSignals: [
    ".standard-markdown",
    ".progressive-markdown",
    "table",
    "pre code",
    ".katex",
    "blockquote",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "iframe",
    "canvas",
  ],
  appShellTitle: ["div.truncate.font-base-bold"],
  sidebarTitle: ["span.truncate.text-sm.whitespace-nowrap"],
  title: ["nav h1", "h1", "title"],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='stream']",
    ".typing",
    ".cursor",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "[role='navigation']",
    "[data-testid*='composer']",
    "[data-testid*='chat-input']",
    "[data-testid='chat-input']",
    "[contenteditable='true']",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^search chats$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^message copied$/i,
    /^thought for\s+\d+s(?:\s+show more)?(?:\s+done)?\s*$/i,
    /^searching for\b.*$/i,
    /^result$/i,
    /^done$/i,
    /^taking longer than usual\..*$/i,
    /^trying again shortly.*$/i,
    /^attempt \d+$/i,
    /^claude can make mistakes\.?/i,
  ],
  removableContentSelectors: [
    "form",
    "footer",
    "nav",
    "button",
    "svg",
    "[role='navigation']",
    "[role='button']",
    "[role='status']",
    "[aria-live]",
    "[data-testid*='composer']",
    "[data-testid*='action-bar']",
    "[data-testid*='copy']",
    "[data-testid*='retry']",
    "[data-testid*='share']",
    "[class*='action-bar']",
    "[class*='toolbar']",
    "[class*='group/status']",
    "[class*='group/row']",
    "#markdown-artifact",
    ".sr-only",
    "[contenteditable='true']",
  ],
  sourceTimes: ["main time[datetime]", "article time[datetime]"],
};

const TITLE_PLATFORM_SUFFIX_PATTERN =
  /\s*[-\u2013\u2014]\s*(ChatGPT|Claude|Gemini|DeepSeek|Qwen|Doubao|Kimi|Yuanbao)\s*$/i;

type MessageRole = "user" | "ai";

type ExtractionSource = "anchor" | "selector";

interface ParserStats {
  source: ExtractionSource;
  totalCandidates: number;
  keptMessages: number;
  roleDistribution: Record<MessageRole, number>;
  droppedUnknownRole: number;
  droppedNoise: number;
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
  messages: ParsedMessage[];
  totalCandidates: number;
  droppedUnknownRole: number;
  droppedNoise: number;
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ParsedNodeResult {
  message: ParsedMessage;
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ContentSnapshot {
  contentEl: Element | null;
  sanitizedContent: Element;
  textContent: string;
  artifacts: MessageArtifact[];
}

interface ClaudeArtifactSnapshot {
  renderDimensions: { width: number; height: number };
  plainText: string;
  normalizedHtmlSnapshot: string;
  markdownSnapshot: string | null;
}

interface ResolvedClaudeArtifact {
  root: Element;
  snapshot: ClaudeArtifactSnapshot;
}


export class ClaudeParser implements IParser {
  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("claude.ai")) {
      return "Claude";
    }
    return null;
  }

  getConversationTitle(): string {
    const appShellTitle = queryShallowestAppShellText(SELECTORS.appShellTitle, {
      excludeWithinSelectors: [
        "main article",
        ".standard-markdown",
        ".progressive-markdown",
        "[data-testid*='message-content']",
      ],
    });
    const cleanedAppShellTitle = this.cleanTitle(appShellTitle ?? "");
    if (cleanedAppShellTitle) return cleanedAppShellTitle;

    const sidebarTitle = queryShallowestAppShellText(SELECTORS.sidebarTitle, {
      excludeWithinSelectors: [
        "main article",
        ".standard-markdown",
        ".progressive-markdown",
        "[data-testid*='message-content']",
      ],
    });
    const cleanedSidebarTitle = this.cleanTitle(sidebarTitle ?? "");
    if (cleanedSidebarTitle) return cleanedSidebarTitle;

    const titleEl = queryFirst(SELECTORS.title);
    const title = this.cleanTitle(safeTextContent(titleEl));
    if (title) return title;

    const fallbackTitle = this.cleanTitle(document.title || "");
    if (fallbackTitle) return fallbackTitle;

    return "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Claude");
    const anchorExtraction = this.extractUsingAnchorStrategy(perfMode);
    const selectorExtraction = this.extractUsingSelectorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(anchorExtraction, selectorExtraction);

    const dedupedMessages = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Claude", parseDurationMs);

    const stats: ParserStats = {
      source: chosen.source,
      totalCandidates: chosen.totalCandidates,
      keptMessages: dedupedMessages.length,
      roleDistribution: { user: 0, ai: 0 },
      droppedUnknownRole: chosen.droppedUnknownRole,
      droppedNoise: chosen.droppedNoise + (chosen.messages.length - dedupedMessages.length),
      parse_duration_ms: parseDurationMs,
      perf_mode: perfMode,
      next_perf_mode: modeUpdate.mode,
      degraded_nodes_count: chosen.degradedNodesCount,
      ast_node_count: chosen.astNodeCount,
      message_count: dedupedMessages.length,
      platform: "Claude",
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "Claude AST perf mode switched", {
        platform: "Claude",
        from: modeUpdate.previousMode,
        to: modeUpdate.mode,
        parse_duration_ms: parseDurationMs,
        message_count: dedupedMessages.length,
      });
    }

    for (const message of dedupedMessages) {
      stats.roleDistribution[message.role] += 1;
    }

    this.logStats(stats, dedupedMessages);
    return dedupedMessages;
  }

  isGenerating(): boolean {
    return queryFirst(SELECTORS.generating) !== null;
  }

  getSessionUUID(): string | null {
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
    if (match && match[1]) return match[1];
    return null;
  }

  getSourceCreatedAt(): number | null {
    return extractEarliestTimeFromSelectors(SELECTORS.sourceTimes);
  }

  private extractUsingAnchorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const userNodes = queryAllUnique(SELECTORS.userPrimaryNodes);
    if (userNodes.length === 0) {
      return {
        source: "anchor",
        messages: [],
        totalCandidates: 0,
        droppedUnknownRole: 0,
        droppedNoise: 0,
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const container = this.findFlowContainer(userNodes);
    if (!container) {
      return {
        source: "anchor",
        messages: [],
        totalCandidates: userNodes.length,
        droppedUnknownRole: 0,
        droppedNoise: 0,
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const blocks = Array.from(container.children);
    const messages: ParsedMessage[] = [];
    let droppedNoise = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const block of blocks) {
      if (!(block instanceof Element)) {
        droppedNoise += 1;
        continue;
      }

      if (!this.isMessageBlockCandidate(block)) {
        droppedNoise += 1;
        continue;
      }

      const role: MessageRole = this.hasUserMarker(block) ? "user" : "ai";
      const snapshot = this.getContentSnapshot(block, role);
      if (!this.hasSnapshotSignal(snapshot)) {
        droppedNoise += 1;
        continue;
      }

      const parsed = this.buildParsedNode(
        role,
        snapshot,
        block,
        perfMode,
      );

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "anchor",
      messages,
      totalCandidates: blocks.length,
      droppedUnknownRole: 0,
      droppedNoise,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private findFlowContainer(userNodes: Element[]): Element | null {
    const firstUser = userNodes[0];
    if (!firstUser) return null;

    const main = document.querySelector("main");
    let current = firstUser.parentElement;
    let bestNode: Element | null = null;
    let bestScore = -1;

    while (current && current !== document.body) {
      if (main && !main.contains(current)) {
        current = current.parentElement;
        continue;
      }

      const children = Array.from(current.children);
      if (children.length < 2) {
        current = current.parentElement;
        continue;
      }

      const coveredUsers = userNodes.filter((node) => current!.contains(node)).length;
      if (coveredUsers === 0) {
        current = current.parentElement;
        continue;
      }

      const userChildren = children.filter((child) => this.hasUserMarker(child)).length;
      const messageLikeChildren = children.filter((child) => this.isMessageBlockCandidate(child)).length;
      const nonUserMessageChildren = children.filter(
        (child) => this.isMessageBlockCandidate(child) && !this.hasUserMarker(child),
      ).length;

      if (userChildren === 0 || messageLikeChildren < 2) {
        current = current.parentElement;
        continue;
      }

      const score =
        coveredUsers * 10 +
        userChildren * 6 +
        nonUserMessageChildren * 5 +
        messageLikeChildren -
        Math.abs(children.length - messageLikeChildren);

      if (score > bestScore) {
        bestScore = score;
        bestNode = current;
      }

      current = current.parentElement;
    }

    return bestNode;
  }

  private isMessageBlockCandidate(node: Element): boolean {
    if (SELECTORS.noiseContainers.some((selector) => node.matches(selector))) {
      return false;
    }

    const textContent = this.cleanExtractedText(safeTextContent(node));
    if (!textContent || textContent.length < 4) {
      return false;
    }

    if (SELECTORS.noiseTextPatterns.some((pattern) => pattern.test(textContent))) {
      return false;
    }

    if (node instanceof HTMLElement && node.offsetHeight < 5) {
      return false;
    }

    return true;
  }

  private hasUserMarker(node: Element): boolean {
    const userSelector = SELECTORS.userPrimaryNodes.join(", ");
    return node.matches(userSelector) || node.querySelector(userSelector) !== null;
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
      if (!this.hasParsedMessageSignal(parsed.message)) {
        droppedNoise += 1;
        continue;
      }

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "selector",
      messages,
      totalCandidates: rawCandidates.length,
      droppedUnknownRole,
      droppedNoise,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private chooseBestExtraction(anchor: ExtractionResult, selector: ExtractionResult): ExtractionResult {
    const anchorScore = this.scoreExtraction(anchor);
    const selectorScore = this.scoreExtraction(selector);

    if (anchorScore === 0 && selectorScore === 0) {
      return anchor;
    }

    if (anchorScore > selectorScore) {
      return anchor;
    }

    if (selectorScore > anchorScore) {
      return selector;
    }

    return anchor.messages.length >= selector.messages.length ? anchor : selector;
  }

  private scoreExtraction(result: ExtractionResult): number {
    if (result.messages.length === 0) return 0;

    const userCount = result.messages.filter((message) => message.role === "user").length;
    const aiCount = result.messages.length - userCount;
    const balancedPairs = Math.min(userCount, aiCount);

    return balancedPairs * 8 + aiCount * 4 + userCount * 2 + result.messages.length;
  }

  private collectMessageCandidates(): Element[] {
    const combinedCandidates: Element[] = [...queryAllUnique(SELECTORS.roleAnchors)];

    combinedCandidates.push(...this.collectCopyActionCandidates());

    for (const containerNode of queryAllUnique(SELECTORS.messageContainers)) {
      const splitNodes = queryAllWithinUnique(containerNode, SELECTORS.roleAnchors);
      if (splitNodes.length > 0) {
        combinedCandidates.push(...splitNodes);
        continue;
      }
      combinedCandidates.push(containerNode);
    }

    return uniqueNodesInDocumentOrder(combinedCandidates);
  }

  private collectCopyActionCandidates(): Element[] {
    const actionAnchors = queryAllUnique(SELECTORS.copyActionAnchors);
    const resolvedNodes: Element[] = [];

    for (const anchor of actionAnchors) {
      const resolved = this.resolveActionAnchorMessageNode(anchor);
      if (resolved) {
        resolvedNodes.push(resolved);
      }
    }

    return uniqueNodesInDocumentOrder(resolvedNodes);
  }

  private resolveActionAnchorMessageNode(anchor: Element): Element | null {
    let current: Element | null = anchor.parentElement;

    while (current) {
      if (SELECTORS.noiseContainers.some((selector) => current?.matches(selector))) {
        return null;
      }

      const text = this.extractMessageText(current, "ai");
      if (text.length < 12 || text.length > 12000) {
        current = current.parentElement;
        continue;
      }

      const hasUserMarker = this.hasUserMarker(current);
      if (hasUserMarker) {
        current = current.parentElement;
        continue;
      }

      const hasCopyAction =
        current.querySelector("[data-testid='action-bar-copy']") !== null ||
        current.matches("[data-testid='action-bar-copy']");

      if (hasCopyAction) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    const role = this.inferRole(node);
    if (!role) return null;

    const snapshot = this.getContentSnapshot(node, role);
    if (!this.hasSnapshotSignal(snapshot)) {
      return null;
    }

    return this.buildParsedNode(
      role,
      snapshot,
      node,
      perfMode,
    );
  }

  private buildParsedNode(
    role: MessageRole,
    snapshot: ContentSnapshot,
    node: Element,
    perfMode: AstPerfMode,
  ): ParsedNodeResult {
    const astSource = snapshot.sanitizedContent ?? snapshot.contentEl ?? node;
    const ast = extractAstFromElement(astSource, {
      platform: "Claude",
      perfMode,
    });
    const textContent = resolveCanonicalMessageText({
      fallbackText: snapshot.textContent,
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
        artifacts: snapshot.artifacts,
        htmlContent: astSource ? astSource.innerHTML : undefined,
      },
      degradedNodesCount: ast.degradedNodesCount,
      astNodeCount: ast.astNodeCount,
    };
  }

  private resolveContentElement(
    node: Element,
    role: MessageRole,
    excludedArtifactRoot: Element | null = null,
  ): Element | null {
    if (role === "user") {
      return (
        queryFirstWithin(node, SELECTORS.userPrimaryNodes) ||
        queryFirstWithin(node, SELECTORS.messageContent)
      );
    }

    const preferred = this.pickContentCandidate(
      node,
      [
        ".standard-markdown",
        ".progressive-markdown",
        "[class*='font-claude-response-body']",
      ],
      excludedArtifactRoot,
    );
    if (preferred) {
      return preferred;
    }

    const aiLeafNodes = queryAllWithinUnique(node, SELECTORS.aiContentLeaves).filter(
      (candidate) => !this.isArtifactSubtreeCandidate(candidate, excludedArtifactRoot),
    );
    if (aiLeafNodes.length > 1) {
      return this.findSharedContentContainer(aiLeafNodes, node) ?? node;
    }
    if (aiLeafNodes.length === 1) {
      return aiLeafNodes[0];
    }

    return this.pickContentCandidate(node, SELECTORS.messageContent, excludedArtifactRoot) ?? node;
  }

  private pickContentCandidate(
    root: Element,
    selectors: string[],
    excludedArtifactRoot: Element | null,
  ): Element | null {
    for (const candidate of queryAllWithinUnique(root, selectors)) {
      if (!this.isArtifactSubtreeCandidate(candidate, excludedArtifactRoot)) {
        return candidate;
      }
    }
    return null;
  }

  private isArtifactSubtreeCandidate(
    candidate: Element,
    excludedArtifactRoot: Element | null,
  ): boolean {
    if (!excludedArtifactRoot) {
      return false;
    }

    return (
      candidate === excludedArtifactRoot ||
      excludedArtifactRoot.contains(candidate) ||
      candidate.contains(excludedArtifactRoot)
    );
  }

  private findSharedContentContainer(nodes: Element[], boundary: Element): Element | null {
    const first = nodes[0];
    if (!first) return null;

    let current: Element | null = first;
    while (current && boundary.contains(current)) {
      const containsAll = nodes.every((node) => current?.contains(node));
      if (containsAll) {
        if (!SELECTORS.noiseContainers.some((selector) => current?.matches(selector))) {
          return current;
        }
      }

      if (current === boundary) {
        break;
      }
      current = current.parentElement;
    }

    return boundary;
  }

  private isNoiseText(text: string): boolean {
    return SELECTORS.noiseTextPatterns.some((pattern) => pattern.test(text));
  }

  private extractVisibleText(element: Element): string {
    if (element instanceof HTMLElement) {
      const visible = element.innerText;
      if (visible && visible.trim()) {
        return visible;
      }
    }

    return safeTextContent(element);
  }

  private sanitizeContentElement(source: Element, excludedRoots: Element[] = []): Element {
    const clone = source.cloneNode(true) as Element;
    for (const excludedRoot of excludedRoots) {
      this.removeMirroredDescendant(source, clone, excludedRoot);
    }
    const selector = SELECTORS.removableContentSelectors.join(", ");
    clone.querySelectorAll(selector).forEach((node) => node.remove());
    return clone;
  }

  private getContentSnapshot(node: Element, role: MessageRole): ContentSnapshot {
    const initialContentEl = this.resolveContentElement(node, role);
    const resolvedArtifact =
      role === "ai" ? this.resolveStandaloneArtifact(node, initialContentEl) : null;
    const contentEl =
      role === "ai"
        ? this.resolveContentElement(node, role, resolvedArtifact?.root ?? null)
        : initialContentEl;
    const baseEl = contentEl ?? node;
    const artifacts =
      role === "ai" && resolvedArtifact
        ? [this.createStandaloneArtifact(resolvedArtifact.snapshot)]
        : [];
    const sanitizedContent = this.sanitizeContentElement(
      baseEl,
      resolvedArtifact ? [resolvedArtifact.root] : [],
    );
    const rawText = this.cleanExtractedText(this.extractVisibleText(sanitizedContent));
    const textContent = this.isNoiseText(rawText) ? "" : rawText;

    return {
      contentEl,
      sanitizedContent,
      textContent,
      artifacts,
    };
  }

  private extractMessageText(node: Element, role: MessageRole): string {
    return this.getContentSnapshot(node, role).textContent;
  }

  private resolveStandaloneArtifact(
    messageRoot: Element,
    contentEl: Element | null,
  ): ResolvedClaudeArtifact | null {
    const explicitMatch = this.pickBestArtifactCandidate(
      queryAllWithinUnique(messageRoot, SELECTORS.artifactRoots),
      {
        messageRoot,
        contentEl,
        allowContentOverlap: true,
      },
    );
    if (explicitMatch) {
      return explicitMatch;
    }

    return this.pickBestArtifactCandidate(
      queryAllWithinUnique(messageRoot, SELECTORS.artifactFallbackRoots),
      {
        messageRoot,
        contentEl,
        allowContentOverlap: false,
      },
    );
  }

  private pickBestArtifactCandidate(
    candidates: Element[],
    options: {
      messageRoot: Element;
      contentEl: Element | null;
      allowContentOverlap: boolean;
    },
  ): ResolvedClaudeArtifact | null {
    let best: { match: ResolvedClaudeArtifact; score: number } | null = null;

    for (const candidate of uniqueNodesInDocumentOrder(candidates).slice(0, 16)) {
      if (!this.isArtifactCandidate(candidate, options)) {
        continue;
      }

      const snapshot = this.sanitizeClaudeArtifact(candidate);
      if (!this.hasArtifactPayload(snapshot)) {
        continue;
      }

      const score = this.scoreArtifactCandidate(candidate, snapshot);
      if (!best || score > best.score) {
        best = {
          match: {
            root: candidate,
            snapshot,
          },
          score,
        };
      }
    }

    return best?.match ?? null;
  }

  private isArtifactCandidate(
    candidate: Element,
    options: {
      messageRoot: Element;
      contentEl: Element | null;
      allowContentOverlap: boolean;
    },
  ): boolean {
    const { messageRoot, contentEl, allowContentOverlap } = options;
    if (candidate === messageRoot) {
      return false;
    }

    if (
      SELECTORS.noiseContainers.some((selector) => candidate.matches(selector) || candidate.closest(selector))
    ) {
      return false;
    }

    if (contentEl) {
      const overlapsContent =
        candidate === contentEl || candidate.contains(contentEl) || contentEl.contains(candidate);
      if (overlapsContent && !allowContentOverlap) {
        return false;
      }

      const swallowsContent = candidate === contentEl || candidate.contains(contentEl);
      if (swallowsContent && !this.hasStrongArtifactSignal(candidate)) {
        return false;
      }
    }

    if (!this.hasArtifactSignal(candidate)) {
      return false;
    }

    if (!this.hasArtifactContentSignal(candidate)) {
      return false;
    }

    if (
      candidate instanceof HTMLElement &&
      candidate.offsetHeight < 16 &&
      candidate.offsetWidth < 16 &&
      this.cleanExtractedText(this.extractVisibleText(candidate)).length < 40
    ) {
      return false;
    }

    return true;
  }

  private hasArtifactSignal(candidate: Element): boolean {
    return /(artifact|preview)/i.test(this.getArtifactSignalText(candidate));
  }

  private hasStrongArtifactSignal(candidate: Element): boolean {
    const signal = this.getArtifactSignalText(candidate);
    return /artifact/i.test(signal) || candidate.id === "markdown-artifact";
  }

  private getArtifactSignalText(candidate: Element): string {
    return [
      candidate.id,
      candidate.getAttribute("data-testid"),
      candidate.getAttribute("aria-label"),
      candidate.className?.toString() ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  private hasArtifactContentSignal(candidate: Element): boolean {
    if (queryFirstWithin(candidate, SELECTORS.artifactContentSignals)) {
      return true;
    }

    const plainText = this.cleanExtractedText(this.extractVisibleText(candidate));
    if (plainText.length >= 80) {
      return true;
    }

    return candidate.innerHTML.replace(/\s+/g, "").length >= 180;
  }

  private scoreArtifactCandidate(candidate: Element, snapshot: ClaudeArtifactSnapshot): number {
    let score = 0;
    const signal = this.getArtifactSignalText(candidate);

    if (candidate.id === "markdown-artifact") {
      score += 40;
    }
    if (/artifact/i.test(signal)) {
      score += 12;
    }
    if (/preview/i.test(signal)) {
      score += 6;
    }
    if (queryFirstWithin(candidate, [".standard-markdown", ".progressive-markdown"])) {
      score += 10;
    }
    if (candidate.querySelector("table")) {
      score += 4;
    }
    if (candidate.querySelector("pre code")) {
      score += 4;
    }
    if (candidate.querySelector(".katex")) {
      score += 4;
    }
    if (candidate.querySelector("iframe, canvas")) {
      score += 3;
    }
    if (snapshot.markdownSnapshot) {
      score += 5;
    }
    if (snapshot.plainText.trim()) {
      score += Math.min(6, Math.ceil(snapshot.plainText.length / 160));
    }
    if (snapshot.normalizedHtmlSnapshot.trim()) {
      score += Math.min(6, Math.ceil(snapshot.normalizedHtmlSnapshot.length / 400));
    }

    return score;
  }

  private hasArtifactPayload(snapshot: ClaudeArtifactSnapshot): boolean {
    return (
      snapshot.plainText.trim().length > 0 || snapshot.normalizedHtmlSnapshot.trim().length > 0
    );
  }

  private createStandaloneArtifact(snapshot: ClaudeArtifactSnapshot): MessageArtifact {
    const artifact = createMessageArtifact({
      kind: "standalone_artifact",
      label: this.inferArtifactLabel(snapshot.plainText),
    });

    artifact.captureMode = "standalone_artifact";
    artifact.renderDimensions = snapshot.renderDimensions;
    artifact.plainText = snapshot.plainText;
    artifact.normalizedHtmlSnapshot = snapshot.normalizedHtmlSnapshot;
    if (snapshot.markdownSnapshot) {
      artifact.markdownSnapshot = snapshot.markdownSnapshot;
    }

    return artifact;
  }

  private sanitizeClaudeArtifact(source: Element): ClaudeArtifactSnapshot {
    const clone = source.cloneNode(true) as Element;

    clone.querySelectorAll("button, svg, .h-8, [role='button'], [aria-label*='copy' i]").forEach((node) => {
      node.remove();
    });

    clone.querySelectorAll(".katex").forEach((node) => {
      const katex = node as Element;
      const annotation = katex.querySelector("annotation[encoding='application/x-tex']");
      if (!annotation?.textContent?.trim()) {
        return;
      }
      const tex = annotation.textContent.trim();
      const container = katex.closest(".katex-display") ?? katex;
      const textNode = document.createTextNode(
        container.classList.contains("katex-display") ? `\n$$\n${tex}\n$$\n` : `$${tex}$`,
      );
      container.parentNode?.replaceChild(textNode, container);
    });

    clone.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (!code) {
        return;
      }

      const className = code.className ?? "";
      const languageClass = className
        .split(/\s+/)
        .find((token) => token.startsWith("language-"));
      const language = languageClass ? languageClass.replace("language-", "") : "";
      const codeText = code.textContent ?? "";
      const wrapper = pre.closest("[class*='copy'], [class*='code']") ?? pre;
      const textNode = document.createTextNode(`\n\`\`\`${language}\n${codeText}\n\`\`\`\n`);
      wrapper.parentNode?.replaceChild(textNode, wrapper);
    });

    const plainText = this.cleanExtractedText(this.extractVisibleText(clone));
    const artifactAst = extractAstFromElement(clone, {
      platform: "Claude",
      perfMode: "full",
    });
    const markdownSnapshot = artifactAst.root
      ? this.cleanExtractedTextPreservingMarkdown(serializeAstRootToMarkdown(artifactAst.root))
      : null;
    const width = Math.max(source.clientWidth || 0, source.scrollWidth || 0);
    const height = Math.max(source.clientHeight || 0, source.scrollHeight || 0);

    return {
      renderDimensions: { width, height },
      plainText,
      normalizedHtmlSnapshot: clone.innerHTML,
      markdownSnapshot: markdownSnapshot && markdownSnapshot.length > 0 ? markdownSnapshot : null,
    };
  }

  private inferArtifactLabel(plainText: string): string | undefined {
    const firstLine = plainText.split("\n").map((line) => line.trim()).find(Boolean);
    return firstLine ? firstLine.slice(0, 80) : undefined;
  }

  private removeMirroredDescendant(source: Element, clone: Element, target: Element): void {
    if (source === target) {
      clone.innerHTML = "";
      return;
    }

    const path: number[] = [];
    let current: Element | null = target;

    while (current && current !== source) {
      const parent = current.parentElement;
      if (!parent) {
        return;
      }
      const index = Array.from(parent.children).indexOf(current);
      if (index === -1) {
        return;
      }
      path.push(index);
      current = parent;
    }

    if (current !== source) {
      return;
    }

    let mirrored: Element | null = clone;
    for (const index of path.reverse()) {
      mirrored = mirrored?.children.item(index) as Element | null;
      if (!mirrored) {
        return;
      }
    }

    mirrored.remove();
  }

  private inferRole(node: Element): MessageRole | null {
    const directRole = this.roleFromNodeAttributes(node);
    if (directRole) return directRole;

    const classRole = this.roleFromClassName(node.className?.toString() || "");
    if (classRole) return classRole;

    const testIdRole = this.roleFromTestId(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    if (this.hasUserMarker(node)) return "user";

    const hasCopyAction = node.querySelector("[data-testid='action-bar-copy']") !== null;
    if (hasCopyAction) {
      return "ai";
    }

    const aiDescendant = node.querySelector(
      "[data-testid*='assistant-message'], [data-testid*='claude-message'], [class*='claude-message']",
    );
    if (aiDescendant) return "ai";

    const ancestor = node.parentElement
      ? closestAnySelector(node.parentElement, SELECTORS.roleAncestorHints)
      : null;
    if (ancestor) {
      const ancestorRole = this.roleFromNodeAttributes(ancestor);
      if (ancestorRole) return ancestorRole;

      const ancestorClassRole = this.roleFromClassName(ancestor.className?.toString() || "");
      if (ancestorClassRole) return ancestorClassRole;

      const ancestorTestIdRole = this.roleFromTestId(ancestor.getAttribute("data-testid"));
      if (ancestorTestIdRole) return ancestorTestIdRole;
    }

    return null;
  }

  private roleFromNodeAttributes(node: Element): MessageRole | null {
    const author = this.roleFromAttribute(node.getAttribute("data-author"));
    if (author) return author;

    return this.roleFromAttribute(node.getAttribute("data-message-author-role"));
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (normalized === "assistant" || normalized === "ai" || normalized === "claude") {
      return "ai";
    }
    return null;
  }

  private roleFromClassName(value: string): MessageRole | null {
    const normalized = value.toLowerCase();
    if (!normalized) return null;

    if (normalized.includes("user-message")) return "user";
    if (normalized.includes("claude-message") || normalized.includes("assistant-message")) {
      return "ai";
    }

    return null;
  }

  private roleFromTestId(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (/(^|[-_:])(user|human)([-_:]|$)/.test(normalized)) return "user";
    if (/(^|[-_:])(assistant|claude|model|ai|response)([-_:]|$)/.test(normalized)) {
      return "ai";
    }

    if (normalized.includes("user") || normalized.includes("human")) return "user";
    if (
      normalized.includes("assistant") ||
      normalized.includes("claude") ||
      normalized.includes("model") ||
      normalized.includes("response")
    ) {
      return "ai";
    }

    return null;
  }

  private cleanExtractedText(rawText: string): string {
    let text = rawText;

    text = text.replace(/^Thought for\s+\d+s[\s\S]*?Show more\s*Done\s*/i, "");
    text = text.replace(/^Thought for\s+\d+s\s*/i, "");
    text = text.replace(/^Show more\s*Done\s*/i, "");

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^(Copy|Edit|Retry)\s+/i, "")
      .trim();

    return text;
  }

  private cleanExtractedTextPreservingMarkdown(rawText: string): string {
    return rawText
      .replace(/\r/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private cleanTitle(rawTitle: string): string {
    return rawTitle
      .replace(/\s+/g, " ")
      .replace(TITLE_PLATFORM_SUFFIX_PATTERN, "")
      .trim();
  }

  private hasSnapshotSignal(snapshot: ContentSnapshot): boolean {
    return snapshot.textContent.trim().length > 0 || snapshot.artifacts.length > 0;
  }

  private hasParsedMessageSignal(message: ParsedMessage): boolean {
    return message.textContent.trim().length > 0 || (message.artifacts?.length ?? 0) > 0;
  }

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const signature = this.buildMessageSignature(message);
      const isRecentDuplicate = deduped
        .slice(Math.max(0, deduped.length - 2))
        .some((existing) => {
          const existingSignature = this.buildMessageSignature(existing);
          return existingSignature === signature;
        });

      if (!isRecentDuplicate) {
        deduped.push(message);
      }
    }

    return deduped;
  }

  private buildMessageSignature(message: ParsedMessage): string {
    const normalizedText = message.textContent.replace(/\s+/g, " ").trim();
    const artifactSignature = (message.artifacts ?? [])
      .map((artifact) =>
        [
          artifact.kind,
          artifact.label ?? "",
          artifact.captureMode ?? "",
          artifact.plainText ?? "",
          artifact.markdownSnapshot ?? "",
          artifact.normalizedHtmlSnapshot ?? "",
        ].join("::"),
      )
      .join("||");

    return [message.role, normalizedText, artifactSignature].join("|");
  }

  private logStats(stats: ParserStats, messages: ParsedMessage[]): void {
    logger.info("parser", "Claude parse stats", stats);

    if (messages.length === 0) return;

    const hasSingleRole =
      stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;

    if (hasSingleRole) {
      logger.debug("parser", "Claude parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}












