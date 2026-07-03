import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  MessageSquare,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { useI18n } from "~lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { resolveTurnCount } from "~lib/capture/turn-metrics";
import {
  getConversationCaptureFreshnessAt,
  getConversationOriginAt,
} from "~lib/conversations/timestamps";
import type { Conversation, SearchMatchSurface } from "~lib/types";
import { updateConversationAndSync } from "~lib/services/syncActions";
import { PlatformTag } from "./PlatformTag";
import { splitWithHighlight } from "../lib/highlight";
import { getSearchMatchHintLabel } from "~lib/utils/messageSearchProjection";

const TOOLTIP_DELAY_MS = 200;
const COPY_FEEDBACK_MS = 1500;
const MAX_TITLE_LENGTH = 120;
const THREADS_OVERFLOW_CONTENT_CLASS =
  "w-44 max-h-64 overflow-y-auto rounded-lg border border-border-subtle bg-bg-primary/92 p-1 shadow-paper";
const THREADS_OVERFLOW_ITEM_CLASS =
  "min-h-8 rounded-md px-2.5 py-1.5 text-vesti-base font-medium text-text-primary focus:!bg-bg-secondary focus:!text-text-primary data-[highlighted]:!bg-bg-secondary data-[highlighted]:!text-text-primary [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-text-secondary";
const THREADS_OVERFLOW_SUBTRIGGER_CLASS =
  `${THREADS_OVERFLOW_ITEM_CLASS} data-[state=open]:!bg-bg-secondary data-[state=open]:!text-text-primary [&>svg:last-child]:h-3.5 [&>svg:last-child]:w-3.5 [&>svg:last-child]:text-text-tertiary`;
const THREADS_OVERFLOW_SEPARATOR_CLASS = "-mx-0 my-1 bg-border-subtle";

function formatRelativeTime(
  timestamp: number,
  labels: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string; monthsAgo: string }
): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return labels.justNow;
  if (minutes < 60) return `${minutes}${labels.minutesAgo}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${labels.hoursAgo}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}${labels.daysAgo}`;
  const months = Math.floor(days / 30);
  return `${months}${labels.monthsAgo}`;
}

interface ActionIconButtonProps {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  tone?: "default" | "danger";
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function ActionIconButton({
  label,
  icon,
  disabled = false,
  tone = "default",
  onClick,
}: ActionIconButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const startTooltip = () => {
    if (disabled) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setShowTooltip(true);
    }, TOOLTIP_DELAY_MS);
  };

  const stopTooltip = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowTooltip(false);
  };

  const toneClass =
    tone === "danger"
      ? "hover:bg-danger/10 hover:text-danger"
      : "hover:bg-accent-primary-light hover:text-accent-primary";

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={startTooltip}
        onMouseLeave={stopTooltip}
        onFocus={startTooltip}
        onBlur={stopTooltip}
        className={`flex h-6 w-6 items-center justify-center rounded-sm text-text-tertiary transition-[opacity,colors] [transition-duration:120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
          disabled
            ? "cursor-not-allowed opacity-35"
            : `opacity-60 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100 ${toneClass}`
        }`}
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-1 whitespace-nowrap rounded-sm bg-text-primary px-2 py-1 text-[10px] text-white shadow-popover">
          {label}
        </div>
      )}
    </div>
  );
}

interface ConversationCardProps {
  conversation: Conversation;
  onClick: () => void;
  onCopyFullText?: (conversation: Conversation) => Promise<boolean>;
  onOpenSource?: (conversation: Conversation) => void;
  onDelete?: (id: number) => Promise<void> | void;
  onRenameTitle?: (id: number, title: string) => Promise<boolean>;
  topicOptions?: { id: number; label: string }[];
  onConversationUpdated?: (conversation: Conversation) => void;
  matchedInMessagesOnly?: boolean;
  searchQuery?: string;
  messageExcerpt?: string | null;
  messageMatchSurface?: SearchMatchSurface | null;
  // Which time to surface on the card: the conversation's own time ("origin")
  // or when Vesti last captured it ("capture"). Mirrors the list sort mode.
  sortMode?: "origin" | "capture";
  // Batch selection support
  isBatchMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onSelectFromMenu?: () => void;
}

export function ConversationCard({
  conversation,
  onClick,
  onCopyFullText,
  onOpenSource,
  onDelete,
  onRenameTitle,
  topicOptions = [],
  onConversationUpdated,
  matchedInMessagesOnly = false,
  searchQuery = "",
  messageExcerpt = null,
  messageMatchSurface = null,
  sortMode = "origin",
  isBatchMode = false,
  isSelected = false,
  onToggleSelect,
  onSelectFromMenu,
}: ConversationCardProps) {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurSaveRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const suppressCardActivationRef = useRef(false);
  const suppressCardActivationTimerRef = useRef<number | null>(null);
  const hasSourceUrl = conversation.url.trim().length > 0;
  const turnCount = resolveTurnCount(
    conversation.turn_count,
    conversation.message_count
  );
  const snippetText =
    matchedInMessagesOnly && messageExcerpt
      ? messageExcerpt
      : conversation.snippet;
  const messageMatchHint = matchedInMessagesOnly
    ? getSearchMatchHintLabel(messageMatchSurface ?? "body")
    : null;

  const renderHighlightedText = (text: string) => {
    const segments = splitWithHighlight(text, searchQuery);
    if (segments.length === 1 && !segments[0].highlight) {
      return segments[0].text;
    }
    return segments.map((segment, index) =>
      segment.highlight ? (
        <mark
          key={`hl-${index}`}
          className="rounded-xs bg-accent-primary-light px-0.5 text-text-primary ring-1 ring-border-focus"
        >
          {segment.text}
        </mark>
      ) : (
        <span key={`tx-${index}`}>{segment.text}</span>
      )
    );
  };

  const canRename = Boolean(onRenameTitle) && !isSavingTitle;

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      if (suppressCardActivationTimerRef.current !== null) {
        window.clearTimeout(suppressCardActivationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isEditingTitle) {
      setDraftTitle(conversation.title);
    }
  }, [conversation.title, isEditingTitle]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!onCopyFullText) return;
    try {
      const ok = await onCopyFullText(conversation);
      if (!ok) return;
      setCopied(true);
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, COPY_FEEDBACK_MS);
    } catch {
      setCopied(false);
    }
  };

  const handleOpenSource = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasSourceUrl) return;
    if (onOpenSource) {
      onOpenSource(conversation);
      return;
    }
    window.open(conversation.url, "_blank", "noopener,noreferrer");
  };

  const handleDelete = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await onDelete?.(conversation.id);
  };

  const cancelTitleEdit = useCallback(() => {
    setDraftTitle(conversation.title);
    setIsEditingTitle(false);
    setIsSavingTitle(false);
    skipBlurSaveRef.current = false;
    saveInFlightRef.current = false;
  }, [conversation.title]);

  const commitTitleEdit = useCallback(async () => {
    if (!isEditingTitle || isSavingTitle || saveInFlightRef.current) return;

    const trimmedTitle = draftTitle.trim();
    if (!trimmedTitle || trimmedTitle.length > MAX_TITLE_LENGTH) {
      cancelTitleEdit();
      return;
    }

    if (trimmedTitle === conversation.title) {
      setIsEditingTitle(false);
      skipBlurSaveRef.current = false;
      return;
    }

    if (!onRenameTitle) {
      cancelTitleEdit();
      return;
    }

    saveInFlightRef.current = true;
    setIsSavingTitle(true);
    try {
      const saved = await onRenameTitle(conversation.id, trimmedTitle);
      if (!saved) {
        cancelTitleEdit();
        return;
      }
      setIsEditingTitle(false);
    } catch (error) {
      console.error("Failed to rename conversation title", error);
      cancelTitleEdit();
    } finally {
      saveInFlightRef.current = false;
      setIsSavingTitle(false);
      skipBlurSaveRef.current = false;
    }
  }, [
    cancelTitleEdit,
    conversation.id,
    conversation.title,
    draftTitle,
    isEditingTitle,
    isSavingTitle,
    onRenameTitle,
  ]);

  const handleStartTitleEdit = (
    event?: Pick<MouseEvent<HTMLButtonElement>, "stopPropagation">
  ) => {
    event?.stopPropagation();
    if (isSavingTitle) return;
    setDraftTitle(conversation.title);
    setIsEditingTitle(true);
  };

  const handleToggleStar = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      const updated = await updateConversationAndSync(conversation.id, {
        is_starred: !conversation.is_starred,
      });
      onConversationUpdated?.(updated);
    } catch (error) {
      console.error("Failed to update star status", error);
    }
  };

  const armSuppressCardActivation = useCallback(() => {
    suppressCardActivationRef.current = true;
    if (suppressCardActivationTimerRef.current !== null) {
      window.clearTimeout(suppressCardActivationTimerRef.current);
    }
    suppressCardActivationTimerRef.current = window.setTimeout(() => {
      suppressCardActivationRef.current = false;
      suppressCardActivationTimerRef.current = null;
    }, 0);
  }, []);

  const consumeSuppressCardActivation = useCallback(() => {
    if (!suppressCardActivationRef.current) {
      return false;
    }
    suppressCardActivationRef.current = false;
    if (suppressCardActivationTimerRef.current !== null) {
      window.clearTimeout(suppressCardActivationTimerRef.current);
      suppressCardActivationTimerRef.current = null;
    }
    return true;
  }, []);

  const closeOverflowMenu = useCallback(() => {
    setIsOverflowOpen(false);
  }, []);

  const handleCardClick = () => {
    if (consumeSuppressCardActivation()) {
      return;
    }
    if (isBatchMode) {
      onToggleSelect?.();
    } else {
      onClick();
    }
  };

  const handleOverflowAction = useCallback(
    async (action: () => void | Promise<void>) => {
      armSuppressCardActivation();
      closeOverflowMenu();
      await action();
    },
    [armSuppressCardActivation, closeOverflowMenu]
  );

  const handleTopicAssignment = async (value: string) => {
    const nextTopicId = value ? Number(value) : null;

    try {
      const updated = await updateConversationAndSync(conversation.id, {
        topic_id: Number.isNaN(nextTopicId) ? null : nextTopicId,
      });
      onConversationUpdated?.(updated);
    } catch (error) {
      console.error("Failed to update topic assignment", error);
    }
  };

  const showExpandedDetails = !isBatchMode && isHovered;
  const cardStateClass = isBatchMode
    ? isSelected
      ? "bg-accent-primary/8 ring-1 ring-accent-primary/25"
      : isHovered
        ? "bg-surface-card-hover"
        : "bg-surface-card"
    : isHovered
      ? "bg-surface-card-hover shadow-card-hover"
      : "bg-surface-card";

  return (
    <div
      role="button"
      tabIndex={0}
      data-conversation-id={conversation.id}
      onClick={handleCardClick}
      onFocus={() => setIsHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsHovered(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (consumeSuppressCardActivation()) {
          event.preventDefault();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCardClick();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group w-full cursor-pointer rounded-md p-3 text-left transition-all duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${cardStateClass}`}
    >
      <div className="flex items-center justify-between">
        <div className={`flex min-w-0 items-center ${isBatchMode ? "gap-2.5" : "gap-2"}`}>
          {isBatchMode && (
            <button
              type="button"
              aria-label={isSelected ? t.timeline.deselectConversation : t.timeline.selectConversation}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelect?.();
              }}
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                isSelected
                  ? "border-accent-primary bg-accent-primary"
                  : "border-text-tertiary/35 bg-bg-primary/70"
              }`}
            >
              {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={2} />}
            </button>
          )}
          <PlatformTag platform={conversation.platform} />
        </div>
        <div className="flex items-center gap-1">
          {!isBatchMode && (
            <ActionIconButton
              label={conversation.is_starred ? t.timeline.unstar : t.timeline.star}
              onClick={handleToggleStar}
              icon={
                <Star
                  className={
                    conversation.is_starred
                      ? "h-3.5 w-3.5 text-accent-primary"
                      : "h-3.5 w-3.5"
                  }
                  strokeWidth={1.75}
                  fill={conversation.is_starred ? "currentColor" : "none"}
                />
              }
            />
          )}
          <span
            className="text-vesti-xs text-text-tertiary"
            title={new Date(
              sortMode === "capture"
                ? getConversationCaptureFreshnessAt(conversation)
                : getConversationOriginAt(conversation),
            ).toLocaleString()}
          >
            {sortMode === "capture"
              ? `${t.timeline.lastCaptured} ${formatRelativeTime(getConversationCaptureFreshnessAt(conversation), t.timeline.relativeTime)}`
              : `${t.timeline.conversedAt} ${formatRelativeTime(getConversationOriginAt(conversation), t.timeline.relativeTime)}`}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex items-start gap-1">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={draftTitle}
            maxLength={MAX_TITLE_LENGTH}
            disabled={isSavingTitle}
            aria-label={t.timeline.editTitle}
            onChange={(event) => {
              setDraftTitle(event.target.value);
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                skipBlurSaveRef.current = true;
                void commitTitleEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                skipBlurSaveRef.current = true;
                cancelTitleEdit();
              }
            }}
            onBlur={() => {
              if (skipBlurSaveRef.current) {
                skipBlurSaveRef.current = false;
                return;
              }
              void commitTitleEdit();
            }}
            className="h-7 min-w-0 flex-1 rounded-sm border border-border-subtle bg-white px-2 text-vesti-sm text-text-primary outline-none focus:border-text-primary focus:ring-2 focus:ring-[rgba(26,25,24,0.12)]"
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-vesti-base font-medium tracking-tight text-text-primary">
            {renderHighlightedText(conversation.title)}
          </h3>
        )}

        {!isEditingTitle && !isBatchMode && (
          <div className="flex shrink-0 items-center gap-0.5">
            <DropdownMenu open={isOverflowOpen} onOpenChange={setIsOverflowOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t.timeline.moreActions}
                  onPointerDown={(event) => {
                    armSuppressCardActivation();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    armSuppressCardActivation();
                    event.stopPropagation();
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-text-tertiary opacity-60 transition-all duration-150 hover:bg-accent-primary-light hover:text-accent-primary hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus data-[state=open]:bg-bg-secondary data-[state=open]:text-text-primary data-[state=open]:opacity-100"
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className={THREADS_OVERFLOW_CONTENT_CLASS}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                }}
              >
                <DropdownMenuItem
                  disabled={!canRename}
                  className={THREADS_OVERFLOW_ITEM_CLASS}
                  onPointerDown={(event) => {
                    armSuppressCardActivation();
                    event.stopPropagation();
                  }}
                  onSelect={async (event) => {
                    event.stopPropagation();
                    if (!canRename) return;
                    await handleOverflowAction(() => {
                      handleStartTitleEdit();
                    });
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                  {t.timeline.rename}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    className={THREADS_OVERFLOW_SUBTRIGGER_CLASS}
                    onPointerDown={(event) => {
                      armSuppressCardActivation();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      armSuppressCardActivation();
                      event.stopPropagation();
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.6} />
                    {t.timeline.addToProject}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className={THREADS_OVERFLOW_CONTENT_CLASS}>
                    <DropdownMenuItem
                      className={THREADS_OVERFLOW_ITEM_CLASS}
                      onPointerDown={(event) => {
                        armSuppressCardActivation();
                        event.stopPropagation();
                      }}
                      onSelect={async (event) => {
                        event.stopPropagation();
                        await handleOverflowAction(async () => {
                          await handleTopicAssignment("");
                        });
                      }}
                    >
                      <span className="text-text-tertiary">{t.timeline.noGroup}</span>
                    </DropdownMenuItem>
                    {topicOptions.map((topic) => (
                      <DropdownMenuItem
                        key={topic.id}
                        className={THREADS_OVERFLOW_ITEM_CLASS}
                        onPointerDown={(event) => {
                          armSuppressCardActivation();
                          event.stopPropagation();
                        }}
                        onSelect={async (event) => {
                          event.stopPropagation();
                          await handleOverflowAction(async () => {
                            await handleTopicAssignment(String(topic.id));
                          });
                        }}
                      >
                        {topic.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator className={THREADS_OVERFLOW_SEPARATOR_CLASS} />
                <DropdownMenuItem
                  disabled={!onSelectFromMenu}
                  onPointerDown={(event) => {
                    armSuppressCardActivation();
                    event.stopPropagation();
                  }}
                  onSelect={async (event) => {
                    event.stopPropagation();
                    await handleOverflowAction(() => {
                      onSelectFromMenu?.();
                    });
                  }}
                  className={`${THREADS_OVERFLOW_ITEM_CLASS} focus:!bg-accent-primary-light data-[highlighted]:!bg-accent-primary-light`}
                >
                  <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.6} />
                  {t.timeline.select}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

      </div>

      {showExpandedDetails && (
        <div className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-150 ease-in-out">
          <div className="overflow-hidden">
            {messageMatchHint ? (
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
                {messageMatchHint}
              </p>
            ) : null}
            <p className="mt-1.5 line-clamp-2 text-vesti-sm leading-[1.5] text-text-secondary">
              {renderHighlightedText(snippetText)}
            </p>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex items-center gap-1 whitespace-nowrap text-vesti-xs text-text-tertiary">
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {conversation.message_count} {t.timeline.messages} · {turnCount} {t.timeline.turns}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <ActionIconButton
                  label={copied ? t.timeline.copied : t.timeline.copyFullText}
                  onClick={handleCopy}
                  icon={
                    copied ? (
                      <Check className="h-3.5 w-3.5 text-success" strokeWidth={1.75} />
                    ) : (
                      <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )
                  }
                />
                <ActionIconButton
                  label={
                    hasSourceUrl
                      ? t.timeline.goToOriginalUrl
                      : t.timeline.sourceUrlUnavailable
                  }
                  onClick={handleOpenSource}
                  disabled={!hasSourceUrl}
                  icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />}
                />
                <div className="mx-0.5 h-3.5 w-px bg-border-subtle" />
                <ActionIconButton
                  label={t.timeline.deleteConversation}
                  onClick={handleDelete}
                  tone="danger"
                  icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

