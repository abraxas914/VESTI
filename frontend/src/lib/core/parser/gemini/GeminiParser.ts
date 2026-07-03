import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import type { AstNode, AstRoot } from "../../../types/ast";
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
import {
  createMessageAttachment,
  inferMimeFromLabel,
  sanitizeAttachmentLabel,
} from "../../../utils/messageAttachments";
import { logger } from "../../../utils/logger";

const SELECTORS = {
  roleAnchors: [
    "[data-message-author-role='user']",
    "[data-message-author-role='assistant']",
    "[data-message-author-role='model']",
    "[data-role='user']",
    "[data-role='assistant']",
    "[data-role='model']",
    "[data-testid*='user']",
    "[data-testid*='model']",
    "[data-testid*='assistant']",
    "[class*='user-query']",
    "[class*='model-response']",
    "[class*='message-user']",
    "[class*='message-model']",
  ],
  turnBlocks: [
    "main [data-message-id]",
    "main [data-testid*='message']",
    "main [role='listitem']",
    "main article",
    "main [class*='message']",
    "main [class*='response']",
  ],
  messageContent: [
    "[data-testid*='message-content']",
    "[data-testid*='response-content']",
    ".markdown",
    ".prose",
    "div[class*='markdown']",
    "div[class*='message-content']",
    "div[class*='response-content']",
  ],
  title: [".conversation.selected", ".conversation-title-container", "header h1", "nav h1", "title"],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='streaming']",
    "[data-testid*='typing']",
    ".typing",
    ".result-streaming",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "[role='navigation']",
    "[data-testid*='composer']",
    "[contenteditable='true']",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^help$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^gemini can make mistakes\.?/i,
  ],
  sourceTimes: ["main time[datetime]", "article time[datetime]"],
  userAttachmentContainers: [".file-preview-container"],
  userAttachmentImages: [
    ".file-preview-container img[data-test-id='uploaded-img']",
    ".file-preview-container img[alt*='uploaded image']",
  ],
  userAttachmentInteractive: [
    ".file-preview-container button[aria-label]",
    ".file-preview-container [role='button'][aria-label]",
    ".file-preview-container [aria-label]",
  ],
};

const SESSION_ID_QUERY_KEYS = [
  "conversation",
  "conversation_id",
  "chat",
  "chat_id",
  "id",
  "cid",
];

const SESSION_ID_PATTERNS = [
  /\/app\/([a-zA-Z0-9_-]{8,})/i,
  /\/chat\/([a-zA-Z0-9_-]{8,})/i,
  /\/c\/([a-zA-Z0-9_-]{8,})/i,
];

const INVALID_SESSION_IDS = new Set(["app", "new", "chat", "conversation"]);
const INVALID_GENERIC_TITLES = new Set(["chats", "gemini", "google gemini"]);
const MAX_FALLBACK_TITLE_LENGTH = 120;
const GEMINI_USER_PREFIX_PATTERN = /^[\s\u200B\uFEFF]*you said(?:\s*[:\-])?\s*/i;
const TITLE_BOUNDARY_CHARS = ["\n", "。", "？", "!", "！", "?"];

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

export class GeminiParser implements IParser {
  private latestMessages: ParsedMessage[] = [];

  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("gemini.google.com")) {
      return "Gemini";
    }
    return null;
  }

  getConversationTitle(): string {
    const headingTitle = this.readTitleFromSelectors([SELECTORS.title[0]]);
    if (headingTitle) return headingTitle;

    const userDerivedTitle = this.buildTitleFromFirstUserMessage();
    if (userDerivedTitle) return userDerivedTitle;

    const fallbackTitle = this.readTitleFromSelectors(SELECTORS.title.slice(1));
    if (fallbackTitle) return fallbackTitle;

    const normalizedDocumentTitle = this.normalizeTitleCandidate(document.title);
    if (this.isUsableTitle(normalizedDocumentTitle)) {
      return normalizedDocumentTitle;
    }

    return "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Gemini");
    const selectorResult = this.extractUsingSelectorStrategy(perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Gemini", parseDurationMs);

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
      platform: "Gemini",
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "Gemini AST perf mode switched", {
        platform: "Gemini",
        from: modeUpdate.previousMode,
        to: modeUpdate.mode,
        parse_duration_ms: parseDurationMs,
        message_count: deduped.length,
      });
    }

    for (const message of deduped) {
      stats.roleDistribution[message.role] += 1;
    }

    this.latestMessages = deduped;
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
      anchors.map((anchor) => this.resolveAnchorNode(anchor)).filter(Boolean) as Element[]
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
      if (!this.hasParsedMessageSignal(parsed.message)) {
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

    const contentEl = queryFirstWithin(node, SELECTORS.messageContent);
    const rawText = this.cleanExtractedText(safeTextContent(contentEl ?? node));
    const fallbackText =
      role === "user" ? this.stripUserLabelPrefix(rawText) : rawText;
    const astResult = extractAstFromElement(contentEl ?? node, {
      platform: "Gemini",
      perfMode,
    });
    const contentAst = this.sanitizeUserAstPrefix(astResult.root, role);
    const textContent = resolveCanonicalMessageText({
      fallbackText,
      ast: contentAst,
      normalizeAstText: (value: string) =>
        role === "user"
          ? this.stripUserLabelPrefix(this.cleanExtractedText(value))
          : this.cleanExtractedText(value),
    });
    const attachments = role === "user" ? this.extractUserAttachments(node) : [];

    return {
      message: {
        role,
        textContent,
        contentAst,
        contentAstVersion: contentAst ? "ast_v2" : null,
        degradedNodesCount: astResult.degradedNodesCount,
        attachments,
        htmlContent: contentEl ? contentEl.innerHTML : undefined,
      },
      degradedNodesCount: astResult.degradedNodesCount,
      astNodeCount: astResult.astNodeCount,
    };
  }

  private extractUserAttachments(node: Element): ParsedMessage["attachments"] {
    type AttachmentCandidate = {
      kind: "image" | "file";
      element: Element;
      label?: string;
      mime?: string | null;
    };

    const containers = queryAllWithinUnique(node, SELECTORS.userAttachmentContainers).filter(
      (container) => this.hasAttachmentContainerSignal(container),
    );
    if (containers.length === 0) {
      return [];
    }

    const candidates: AttachmentCandidate[] = [];
    const seen = new Set<Element>();

    const pushCandidate = (candidate: AttachmentCandidate) => {
      if (seen.has(candidate.element)) {
        return;
      }
      seen.add(candidate.element);
      candidates.push(candidate);
    };

    for (const container of containers) {
      for (const image of queryAllWithinUnique(container, SELECTORS.userAttachmentImages)) {
        const root = image.closest("button, [role='button']") ?? image;
        const label = this.readAttachmentLabel(image);
        pushCandidate({
          kind: "image",
          element: root,
          label,
          mime: inferMimeFromLabel(label),
        });
      }

      for (const interactive of queryAllWithinUnique(container, SELECTORS.userAttachmentInteractive)) {
        const kind = this.classifyAttachmentKind(interactive);
        if (!kind) {
          continue;
        }

        const label = this.readAttachmentLabel(interactive);
        const mime = this.readMimeHint(interactive) ?? inferMimeFromLabel(label);
        pushCandidate({
          kind,
          element: interactive,
          label,
          mime,
        });
      }
    }

    candidates.sort((a, b) => {
      if (a.element === b.element) return 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });

    let imageCount = 0;
    let fileCount = 0;

    return candidates.flatMap((candidate) => {
      if (candidate.kind === "image") {
        imageCount += 1;
        const attachment = createMessageAttachment({
          indexAlt: `Uploaded image ${imageCount}`,
          label: candidate.label,
          mime: candidate.mime,
          occurrenceRole: "user_upload",
        });
        return attachment ? [attachment] : [];
      }

      fileCount += 1;
      const attachment = createMessageAttachment({
        indexAlt: `Uploaded file ${fileCount}`,
        label: candidate.label,
        mime: candidate.mime,
        occurrenceRole: "user_upload",
      });
      return attachment ? [attachment] : [];
    });
  }

  private hasAttachmentContainerSignal(container: Element): boolean {
    if (container.querySelector("[data-test-id='uploaded-img']")) {
      return true;
    }

    if (container.querySelector("[data-test-id='uploaded-file'], .new-file-preview-container")) {
      return true;
    }

    const text = safeTextContent(container);
    if (this.hasFileLikeSignal(text) || this.hasImageLikeSignal(text)) {
      return true;
    }

    return Array.from(container.querySelectorAll("[aria-label]")).some((element) => {
      const label = element.getAttribute("aria-label");
      return this.hasFileLikeSignal(label) || this.hasImageLikeSignal(label);
    });
  }

  private classifyAttachmentKind(element: Element): "image" | "file" | null {
    if (this.findFileAttachmentRoot(element)) {
      return "file";
    }

    if (this.hasUploadedImageSignal(element)) {
      return "image";
    }

    const label = [
      element.getAttribute("aria-label"),
      safeTextContent(element),
      this.readMimeHint(element),
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");

    if (this.hasImageLikeSignal(label)) {
      return "image";
    }

    if (this.hasFileLikeSignal(label)) {
      return "file";
    }

    return null;
  }

  private hasImageLikeSignal(value: string | null | undefined): boolean {
    if (typeof value !== "string") {
      return false;
    }
    return /(?:image|photo|picture|图片|照片|相片)/i.test(value);
  }

  private hasFileLikeSignal(value: string | null | undefined): boolean {
    if (typeof value !== "string") {
      return false;
    }
    return (
      /\.[a-z0-9]{2,8}\b/i.test(value) ||
      /\b(?:pdf|csv|json|html|txt|markdown|docx?|xlsx?|pptx?|zip)\b/i.test(value)
    );
  }

  private readAttachmentLabel(element: Element): string | undefined {
    const fileLabel = this.readFileAttachmentLabel(element);
    if (fileLabel) {
      return fileLabel;
    }

    const visible = sanitizeAttachmentLabel(safeTextContent(element));
    if (visible) {
      return visible;
    }
    return sanitizeAttachmentLabel(element.getAttribute("aria-label"));
  }

  private readMimeHint(element: Element): string | undefined {
    const fileMime = this.readFileAttachmentMime(element);
    if (fileMime) {
      return fileMime;
    }

    const text = safeTextContent(element);
    const mime = inferMimeFromLabel(text);
    if (mime) {
      return mime;
    }

    const aria = element.getAttribute("aria-label");
    const fromAria = inferMimeFromLabel(aria);
    return fromAria ?? undefined;
  }

  private hasUploadedImageSignal(element: Element): boolean {
    if (element.matches("[data-test-id='uploaded-img']")) {
      return true;
    }

    if (element.querySelector("[data-test-id='uploaded-img']")) {
      return true;
    }

    const alt = element.getAttribute("alt");
    return typeof alt === "string" && /uploaded image|上传图片/i.test(alt);
  }

  private findFileAttachmentRoot(element: Element): Element | null {
    if (element.matches("[data-test-id='uploaded-file'], .new-file-preview-container")) {
      return element;
    }
    return element.closest("[data-test-id='uploaded-file'], .new-file-preview-container");
  }

  private readFileAttachmentLabel(element: Element): string | undefined {
    const fileRoot = this.findFileAttachmentRoot(element);
    if (!fileRoot) {
      return undefined;
    }

    const nameEl = queryFirstWithin(fileRoot, [".new-file-name", "[class*='new-file-name']"]);
    const visibleName = sanitizeAttachmentLabel(safeTextContent(nameEl));
    if (visibleName) {
      return visibleName;
    }

    return sanitizeAttachmentLabel(fileRoot.getAttribute("aria-label")) ??
      sanitizeAttachmentLabel(element.getAttribute("aria-label"));
  }

  private readFileAttachmentMime(element: Element): string | undefined {
    const fileRoot = this.findFileAttachmentRoot(element);
    if (!fileRoot) {
      return undefined;
    }

    const typeEl = queryFirstWithin(fileRoot, [".new-file-type", "[class*='new-file-type']"]);
    const visibleType = inferMimeFromLabel(safeTextContent(typeEl));
    if (visibleType) {
      return visibleType ?? undefined;
    }

    const icon = queryFirstWithin(fileRoot, ["img[alt]", "[data-test-id='new-file-icon'][alt]"]);
    const iconAlt = icon?.getAttribute("alt");
    const fromIconAlt = inferMimeFromLabel(iconAlt);
    if (fromIconAlt) {
      return fromIconAlt ?? undefined;
    }

    return undefined;
  }

  private inferRole(node: Element): MessageRole | null {
    const attrRole =
      this.roleFromAttribute(node.getAttribute("data-message-author-role")) ??
      this.roleFromAttribute(node.getAttribute("data-role"));
    if (attrRole) return attrRole;

    const testIdRole = this.roleFromHint(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const classRole = this.roleFromHint(node.className?.toString() ?? "");
    if (classRole) return classRole;

    const ancestor = node.parentElement?.closest("[data-role], [data-testid], [class]");
    if (ancestor) {
      const ancestorRole =
        this.roleFromAttribute(ancestor.getAttribute("data-message-author-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-role")) ??
        this.roleFromHint(ancestor.getAttribute("data-testid")) ??
        this.roleFromHint(ancestor.className?.toString() ?? "");
      if (ancestorRole) return ancestorRole;
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
      normalized === "gemini"
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
      normalized.includes("gemini") ||
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

  private stripUserLabelPrefix(rawText: string): string {
    return rawText.replace(GEMINI_USER_PREFIX_PATTERN, "").trim();
  }

  private sanitizeUserAstPrefix(root: AstRoot | null, role: MessageRole): AstRoot | null {
    if (!root || role !== "user") {
      return root;
    }

    this.stripLeadingYouSaid(root.children);
    return root.children.length > 0 ? root : null;
  }

  private stripLeadingYouSaid(nodes: AstNode[]): boolean {
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
        const changed = this.stripLeadingYouSaid(node.children);
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

  private normalizeTitleCandidate(rawTitle: string): string {
    const compact = rawTitle.replace(/\s+/g, " ").trim();
    return this.stripUserLabelPrefix(compact);
  }

  private toConciseTitle(rawTitle: string): string {
    const normalized = this.normalizeTitleCandidate(rawTitle);
    if (!normalized) return "";

    let boundaryIndex = -1;
    for (const token of TITLE_BOUNDARY_CHARS) {
      const index = normalized.indexOf(token);
      if (index === -1) continue;
      if (boundaryIndex === -1 || index < boundaryIndex) {
        boundaryIndex = index;
      }
    }

    const bounded =
      boundaryIndex >= 0 ? normalized.slice(0, boundaryIndex + 1) : normalized;
    return bounded.slice(0, MAX_FALLBACK_TITLE_LENGTH).trim();
  }

  private isUsableTitle(title: string): boolean {
    if (!title) return false;
    return !INVALID_GENERIC_TITLES.has(title.toLowerCase());
  }

  private readTitleFromSelectors(selectors: string[]): string | null {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const normalized = this.toConciseTitle(safeTextContent(node));
      if (this.isUsableTitle(normalized)) {
        return normalized;
      }
    }
    return null;
  }

  private readFirstUserMessageFromDom(): string | null {
    const userNodes = queryAllUnique([
      "main [data-message-author-role='user']",
      "main [data-role='user']",
      "main [data-testid*='user']",
      "main [class*='user-query']",
      "main [class*='message-user']",
    ]);

    for (const node of userNodes) {
      const contentNode = queryFirstWithin(node, SELECTORS.messageContent);
      const candidate = this.toConciseTitle(safeTextContent(contentNode ?? node));
      if (this.isUsableTitle(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private buildTitleFromFirstUserMessage(): string | null {
    const domCandidate = this.readFirstUserMessageFromDom();
    if (domCandidate) return domCandidate;

    const messages = this.latestMessages.length > 0 ? this.latestMessages : this.getMessages();
    const firstUserMessage = messages.find(
      (message) => message.role === "user" && message.textContent.trim().length > 0
    );
    if (!firstUserMessage) return null;

    const normalized = this.toConciseTitle(firstUserMessage.textContent);
    if (!this.isUsableTitle(normalized)) return null;
    return normalized;
  }

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const mergeSignature = this.buildMergeSignature(message);
      let merged = false;

      for (let index = deduped.length - 1; index >= Math.max(0, deduped.length - 3); index -= 1) {
        const existing = deduped[index];
        if (existing.role !== message.role) {
          break;
        }
        if (this.buildMergeSignature(existing) !== mergeSignature) {
          continue;
        }

        deduped[index] = this.mergeParsedMessages(existing, message);
        merged = true;
        break;
      }

      if (!merged) {
        deduped.push(message);
      }
    }

    return deduped;
  }

  private mergeParsedMessages(primary: ParsedMessage, secondary: ParsedMessage): ParsedMessage {
    const mergedAttachments = this.mergeAttachments(primary.attachments, secondary.attachments);
    const mergedCitations = this.mergeCitations(primary.citations, secondary.citations);
    const mergedArtifacts = this.mergeArtifacts(primary.artifacts, secondary.artifacts);

    const preferredAst =
      this.getAstWeight(secondary.contentAst) > this.getAstWeight(primary.contentAst)
        ? secondary.contentAst
        : primary.contentAst;
    const preferredAstVersion =
      preferredAst === secondary.contentAst
        ? secondary.contentAstVersion ?? primary.contentAstVersion
        : primary.contentAstVersion ?? secondary.contentAstVersion;
    const preferredHtmlContent = this.pickPreferredTextBlock(primary.htmlContent, secondary.htmlContent);
    const preferredSnapshot = this.pickPreferredTextBlock(
      primary.normalizedHtmlSnapshot ?? undefined,
      secondary.normalizedHtmlSnapshot ?? undefined,
    );

    return {
      role: primary.role,
      textContent:
        secondary.textContent.trim().length > primary.textContent.trim().length
          ? secondary.textContent
          : primary.textContent,
      contentAst: preferredAst,
      contentAstVersion: preferredAstVersion,
      degradedNodesCount: Math.max(primary.degradedNodesCount ?? 0, secondary.degradedNodesCount ?? 0),
      citations: mergedCitations.length > 0 ? mergedCitations : undefined,
      attachments: mergedAttachments.length > 0 ? mergedAttachments : undefined,
      artifacts: mergedArtifacts.length > 0 ? mergedArtifacts : undefined,
      normalizedHtmlSnapshot: preferredSnapshot ?? undefined,
      htmlContent: preferredHtmlContent,
      timestamp: primary.timestamp ?? secondary.timestamp,
    };
  }

  private mergeAttachments(
    primary: ParsedMessage["attachments"],
    secondary: ParsedMessage["attachments"],
  ): NonNullable<ParsedMessage["attachments"]> {
    const merged = new Map<string, NonNullable<ParsedMessage["attachments"]>[number]>();

    for (const attachment of [...(primary ?? []), ...(secondary ?? [])]) {
      const key = JSON.stringify({
        indexAlt: attachment.indexAlt,
        label: attachment.label ?? null,
        mime: attachment.mime ?? null,
        occurrenceRole: attachment.occurrenceRole,
      });
      if (!merged.has(key)) {
        merged.set(key, attachment);
      }
    }

    return Array.from(merged.values());
  }

  private mergeCitations(
    primary: ParsedMessage["citations"],
    secondary: ParsedMessage["citations"],
  ): NonNullable<ParsedMessage["citations"]> {
    const merged = new Map<string, NonNullable<ParsedMessage["citations"]>[number]>();

    for (const citation of [...(primary ?? []), ...(secondary ?? [])]) {
      const key = JSON.stringify({
        href: citation.href,
        label: citation.label,
        host: citation.host,
      });
      if (!merged.has(key)) {
        merged.set(key, citation);
      }
    }

    return Array.from(merged.values());
  }

  private mergeArtifacts(
    primary: ParsedMessage["artifacts"],
    secondary: ParsedMessage["artifacts"],
  ): NonNullable<ParsedMessage["artifacts"]> {
    const merged = new Map<string, NonNullable<ParsedMessage["artifacts"]>[number]>();

    for (const artifact of [...(primary ?? []), ...(secondary ?? [])]) {
      const key = JSON.stringify({
        kind: artifact.kind,
        label: artifact.label ?? null,
        captureMode: artifact.captureMode ?? null,
        renderDimensions: artifact.renderDimensions ?? null,
        plainText: artifact.plainText ?? null,
        normalizedHtmlSnapshot: artifact.normalizedHtmlSnapshot ?? null,
        markdownSnapshot: artifact.markdownSnapshot ?? null,
      });
      if (!merged.has(key)) {
        merged.set(key, artifact);
      }
    }

    return Array.from(merged.values());
  }

  private getAstWeight(root: AstRoot | null | undefined): number {
    if (!root || !Array.isArray(root.children)) {
      return 0;
    }
    return root.children.length;
  }

  private pickPreferredTextBlock(
    primary: string | undefined,
    secondary: string | undefined,
  ): string | undefined {
    const primaryLength = primary?.trim().length ?? 0;
    const secondaryLength = secondary?.trim().length ?? 0;
    if (secondaryLength > primaryLength) {
      return secondary;
    }
    return primary;
  }

  private buildMergeSignature(message: ParsedMessage): string {
    const normalizedText = message.textContent.replace(/\s+/g, " ").trim();
    if (message.role === "user" && normalizedText.length > 0) {
      return [message.role, normalizedText].join("|");
    }

    return this.buildMessageSignature(message);
  }

  private buildMessageSignature(message: ParsedMessage): string {
    const attachmentSignature = JSON.stringify(
      (message.attachments ?? []).map((attachment) => ({
        indexAlt: attachment.indexAlt,
        label: attachment.label ?? null,
        mime: attachment.mime ?? null,
      })),
    );
    return [
      message.role,
      message.textContent.replace(/\s+/g, " ").trim(),
      attachmentSignature,
    ].join("|");
  }

  private hasParsedMessageSignal(message: ParsedMessage): boolean {
    return (
      message.textContent.trim().length > 0 ||
      (message.attachments?.length ?? 0) > 0 ||
      (message.citations?.length ?? 0) > 0 ||
      (message.artifacts?.length ?? 0) > 0
    );
  }

  private chooseBestExtraction(
    selectorResult: ExtractionResult,
    anchorResult: ExtractionResult
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
    logger.info("parser", "Gemini parse stats", stats);

    if (messages.length === 0) return;

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.debug("parser", "Gemini parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
