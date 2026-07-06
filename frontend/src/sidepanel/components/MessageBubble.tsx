import { formatArtifactDescriptor, getArtifactExcerptText } from "@vesti/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Check, ChevronDown, Link2, Paperclip, Sparkles } from "lucide-react";
import type { Message, Platform } from "~lib/types";
import type { AstRoot } from "~lib/types/ast";
import { useI18n } from "~lib/i18n";
import { AstMessageRenderer } from "./AstMessageRenderer";
import { PLATFORM_TONE } from "./platformTone";
import { ReaderSidecarDisclosure } from "./ReaderSidecarDisclosure";
import {
  buildMessageFallbackDisplayText,
  buildMessagePreviewText,
  resolveCanonicalBodyText,
} from "~lib/utils/messageContentPackage";
import {
  buildFallbackSegments,
  buildHighlightSegments,
  resolveMessageRenderPlan,
  type MessageRenderPlan,
  type OccurrenceIndexMap,
  type ReaderSidecarTarget,
} from "../lib/readerSearch";

const COLLAPSE_THRESHOLD_PX = 110;
const COLLAPSED_MAX_HEIGHT_PX = 86;
const COLLAPSE_FADE_HEIGHT_PX = 37;
const COPY_FEEDBACK_MS = 1400;
const FENCE_LANGUAGE_PATTERN = /^[a-z0-9+#.-]{1,24}$/i;
const FENCE_LANGUAGE_NOISE_TOKENS = new Set([
  "copy",
  "copied",
  "code",
  "plain",
  "plaintext",
  "text",
]);

interface MessageBubbleProps {
  message: Message;
  platform: Platform;
  renderPlan?: MessageRenderPlan | null;
  occurrenceIndexMap?: OccurrenceIndexMap | null;
  sidecarTargetMap?: Record<string, ReaderSidecarTarget> | null;
  currentIndex?: number | null;
}

export function MessageBubble({
  message,
  platform,
  renderPlan,
  occurrenceIndexMap,
  sidecarTargetMap,
  currentIndex,
}: MessageBubbleProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sidecarsRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const plan = renderPlan ?? resolveMessageRenderPlan(message, platform);
  const shouldUseAst = plan.mode === "ast" && plan.renderAst;
  const indexMap = occurrenceIndexMap ?? {};
  const activeIndex = typeof currentIndex === "number" ? currentIndex : null;
  const activeSidecarTarget = resolveActiveSidecarTarget(
    indexMap,
    sidecarTargetMap ?? {},
    activeIndex
  );
  const canonicalBodyText = resolveCanonicalBodyText(message);
  const renderedFallbackText =
    canonicalBodyText || buildMessagePreviewText(message);
  const copyText = buildMessageFallbackDisplayText(message);

  const renderHighlightSegments = (text: string, nodeKey: string) => {
    const segments = buildHighlightSegments(text, indexMap[nodeKey]);
    if (segments.length === 1 && segments[0].occurrenceIndex === null) {
      return segments[0].text;
    }
    return segments.map((segment, index) => {
      if (segment.occurrenceIndex === null) {
        return <span key={`tx-${nodeKey}-${index}`}>{segment.text}</span>;
      }
      const isActive = segment.occurrenceIndex === activeIndex;
      const className = isActive
        ? "rounded-xs bg-accent-primary px-0.5 text-text-inverse ring-1 ring-border-focus"
        : "rounded-xs bg-accent-primary-light px-0.5 text-text-primary ring-1 ring-border-focus";
      return (
        <mark
          key={`hl-${nodeKey}-${index}`}
          data-occurrence-index={segment.occurrenceIndex}
          className={className}
        >
          {segment.text}
        </mark>
      );
    });
  };

  const isAi = message.role === "ai";
  const shouldCollapse = canCollapse && !isExpanded;
  const citationCount = message.citations?.length ?? 0;
  const attachmentCount = message.attachments?.length ?? 0;
  const artifactCount = message.artifacts?.length ?? 0;
  const hasSidecars = citationCount > 0 || attachmentCount > 0 || artifactCount > 0;

  useLayoutEffect(() => {
    const bodyEl = bodyRef.current;
    if (!bodyEl) {
      setCanCollapse(false);
      return;
    }

    let frameId = 0;
    const measure = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        const nextCanCollapse = bodyEl.scrollHeight > COLLAPSE_THRESHOLD_PX;
        setCanCollapse((prev) => (prev === nextCanCollapse ? prev : nextCanCollapse));
      });
    };

    measure();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(bodyEl);
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
    };
  }, [message.id, renderedFallbackText, plan.mode, plan.renderAst]);

  useEffect(() => {
    if (!canCollapse) {
      setIsExpanded(false);
    }
  }, [canCollapse]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeSidecarTarget || activeSidecarTarget.itemKey.indexOf(`msg-${message.id}:`) !== 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const selector = `[data-sidecar-item-key="${escapeAttributeValue(
        activeSidecarTarget.itemKey
      )}"]`;
      const target = sidecarsRef.current?.querySelector(selector);
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeSidecarTarget, message.id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(copyText).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  return (
    <div className={`reader-turn ${isAi ? "reader-turn-ai" : "reader-turn-user"}`}>
      <div className="reader-turn-header">
        <span
          className={`reader-role-label ${
            isAi
              ? `reader-role-label-model ${PLATFORM_TONE[platform].text}`
              : "reader-role-label-user"
          }`}
        >
          {isAi ? platform : t.message.you}
        </span>

        <button
          type="button"
          aria-label="Copy message"
          onClick={handleCopy}
          className="reader-turn-copy-btn"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <div
        className={`reader-turn-body-wrap ${shouldCollapse ? "is-collapsed" : ""} ${canCollapse ? "with-expand" : ""}`}
        style={shouldCollapse ? { maxHeight: `${COLLAPSED_MAX_HEIGHT_PX}px` } : undefined}
      >
        <div
          ref={bodyRef}
          className={`reader-turn-body ${isAi ? "reader-turn-body-model" : "reader-turn-body-user"}`}
        >
          {shouldUseAst && plan.renderAst ? (
            <AstMessageRenderer
              root={plan.renderAst as AstRoot}
              messageId={message.id}
              occurrenceIndexMap={indexMap}
              currentIndex={activeIndex}
            />
          ) : (
            <div className="reader-fallback-content whitespace-pre-wrap">
              {renderFallbackContent(renderedFallbackText, message.id, renderHighlightSegments)}
            </div>
          )}
        </div>
        {shouldCollapse ? (
          <div
            className="reader-turn-fade-mask"
            style={{ height: `${COLLAPSE_FADE_HEIGHT_PX}px` }}
          />
        ) : null}
      </div>

      <div className={`reader-expand-row ${canCollapse ? "has-btn" : ""}`}>
        {canCollapse ? (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className={`reader-expand-btn ${isExpanded ? "open" : ""}`}
          >
            {isExpanded ? t.common.collapse : t.common.expand}
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      {hasSidecars ? (
        <div ref={sidecarsRef} className="reader-turn-sidecars">
          {citationCount > 0 ? (
            <div className="reader-sidecar-block">
              <ReaderSidecarDisclosure
                title={citationCount === 1 ? t.message.source : t.message.sources}
                count={citationCount}
                icon={<Link2 className="h-3.5 w-3.5" />}
                forceOpen={activeSidecarTarget?.section === "sources"}
              >
                <div className="reader-sidecar-list">
                  {(message.citations ?? []).map((citation, index) => {
                    const itemKey = `msg-${message.id}:source[${index}]`;
                    const isActive = activeSidecarTarget?.itemKey === itemKey;

                    return (
                      <a
                        key={`${citation.href}-${index}`}
                        href={citation.href}
                        target="_blank"
                        rel="noreferrer"
                        data-sidecar-item-key={itemKey}
                        className={`reader-sidecar-row reader-sidecar-row-link ${
                          isActive ? "reader-sidecar-row-active" : ""
                        }`}
                      >
                        <div className="reader-sidecar-row-title">
                          {renderHighlightSegments(citation.label, `${itemKey}:label`)}
                        </div>
                        <div className="reader-sidecar-row-meta">
                          {renderHighlightSegments(citation.host, `${itemKey}:host`)}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </ReaderSidecarDisclosure>
            </div>
          ) : null}

          {attachmentCount > 0 ? (
            <div className="reader-sidecar-block">
              <ReaderSidecarDisclosure
                title={attachmentCount === 1 ? t.message.attachment : t.message.attachments}
                count={attachmentCount}
                icon={<Paperclip className="h-3.5 w-3.5" />}
                trayVariant="compact"
                forceOpen={activeSidecarTarget?.section === "attachments"}
              >
                <div className="reader-sidecar-list">
                  {(message.attachments ?? []).map((attachment, index) => {
                    const itemKey = `msg-${message.id}:attachment[${index}]`;
                    const isActive = activeSidecarTarget?.itemKey === itemKey;
                    const secondaryLabel =
                      attachment.label && attachment.label !== attachment.indexAlt
                        ? attachment.label
                        : null;

                    return (
                      <div
                        key={`${attachment.indexAlt}-${attachment.label ?? index}`}
                        data-sidecar-item-key={itemKey}
                        className={`reader-sidecar-row reader-sidecar-row-attachment ${
                          isActive ? "reader-sidecar-row-active" : ""
                        }`}
                      >
                        <div className="reader-sidecar-row-title">
                          {renderHighlightSegments(attachment.indexAlt, `${itemKey}:indexAlt`)}
                        </div>
                        {secondaryLabel ? (
                          <div className="reader-sidecar-row-meta">
                            {renderHighlightSegments(secondaryLabel, `${itemKey}:label`)}
                          </div>
                        ) : null}
                        {attachment.mime ? (
                          <div className="reader-sidecar-row-meta">
                            {renderHighlightSegments(attachment.mime, `${itemKey}:mime`)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </ReaderSidecarDisclosure>
            </div>
          ) : null}

          {artifactCount > 0 ? (
            <div className="reader-sidecar-block">
              <ReaderSidecarDisclosure
                title={artifactCount === 1 ? t.message.artifact : t.message.artifacts}
                count={artifactCount}
                icon={<Sparkles className="h-3.5 w-3.5" />}
                forceOpen={activeSidecarTarget?.section === "artifacts"}
              >
                <div className="reader-sidecar-list">
                  {(message.artifacts ?? []).map((artifact, index) => {
                    const itemKey = `msg-${message.id}:artifact[${index}]`;
                    const isActive = activeSidecarTarget?.itemKey === itemKey;
                    const excerpt = getArtifactExcerptText(artifact, {
                      maxLines: 2,
                      maxCharsPerLine: 100,
                    });

                    return (
                      <div
                        key={`${artifact.kind}-${artifact.label ?? index}`}
                        data-sidecar-item-key={itemKey}
                        className={`reader-sidecar-row ${
                          isActive ? "reader-sidecar-row-active" : ""
                        }`}
                      >
                        <div className="reader-sidecar-row-title">
                          {renderHighlightSegments(
                            artifact.label || artifact.kind,
                            `${itemKey}:title`
                          )}
                        </div>
                        <div className="reader-sidecar-row-meta">
                          {renderHighlightSegments(
                            formatArtifactDescriptor(artifact),
                            `${itemKey}:descriptor`
                          )}
                        </div>
                        {excerpt ? (
                          <div className="reader-sidecar-row-excerpt">
                            {renderHighlightSegments(excerpt, `${itemKey}:excerpt`)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </ReaderSidecarDisclosure>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function resolveActiveSidecarTarget(
  occurrenceIndexMap: OccurrenceIndexMap,
  sidecarTargetMap: Record<string, ReaderSidecarTarget>,
  activeIndex: number | null
): ReaderSidecarTarget | null {
  if (activeIndex === null) {
    return null;
  }

  for (const [nodeKey, indexes] of Object.entries(occurrenceIndexMap)) {
    if (!sidecarTargetMap[nodeKey]) {
      continue;
    }
    if (indexes.some((entry) => entry.index === activeIndex)) {
      return sidecarTargetMap[nodeKey];
    }
  }

  return null;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderFallbackContent(
  text: string,
  messageId: number,
  renderHighlightedText: (text: string, nodeKey: string) => React.ReactNode
): React.ReactNode {
  const segments = buildFallbackSegments(text, messageId);
  return segments.map((segment, index) => {
    if (segment.type === "code_block") {
      const { code, language } = parseFallbackFencedCode(segment.text);
      return <FallbackCodeBlockView key={`code-${index}`} code={code} language={language} />;
    }
    if (segment.type === "bold") {
      return (
        <strong key={`bold-${index}`}>
          {renderHighlightedText(segment.text, segment.nodeKey)}
        </strong>
      );
    }
    return (
      <span key={`text-${index}`}>
        {renderHighlightedText(segment.text, segment.nodeKey)}
      </span>
    );
  });
}

interface FallbackCodeBlockViewProps {
  code: string;
  language: string;
}

function FallbackCodeBlockView({ code, language }: FallbackCodeBlockViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  return (
    <div className="reader-ast-code-block">
      <div className="reader-ast-code-head">
        <span className="reader-ast-code-lang">{language}</span>
        <button
          type="button"
          className="reader-ast-code-copy"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3" strokeWidth={1.75} /> : <Copy className="h-3 w-3" strokeWidth={1.75} />}
          {copied ? t.common.copied : t.common.copy}
        </button>
      </div>
      <pre className="reader-ast-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function parseFallbackFencedCode(part: string): { code: string; language: string } {
  const raw = part.slice(3, -3).replace(/^\r?\n/, "");
  const normalized = raw.replace(/\r\n?/g, "\n").trimEnd();
  const firstNewline = normalized.indexOf("\n");

  if (firstNewline < 0) {
    return {
      code: normalized,
      language: "plain",
    };
  }

  const maybeLanguage = normalizeFenceLanguage(normalized.slice(0, firstNewline));
  if (!maybeLanguage) {
    return {
      code: normalized,
      language: "plain",
    };
  }

  return {
    code: normalized.slice(firstNewline + 1),
    language: maybeLanguage,
  };
}

function normalizeFenceLanguage(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const prefixed = normalized.match(/^(?:language|lang)[:_\-\s]*([a-z0-9+#.-]{1,24})$/i);
  const token = (prefixed?.[1] ?? normalized).toLowerCase();
  if (!FENCE_LANGUAGE_PATTERN.test(token) || FENCE_LANGUAGE_NOISE_TOKENS.has(token)) {
    return null;
  }
  return token;
}

