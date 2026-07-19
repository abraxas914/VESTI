import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { useI18n } from "~lib/i18n";
import type { Conversation, Message } from "~lib/types";
import {
  buildReaderTimestampFooterModel,
} from "~lib/conversations/timestamps";
import { getMessages } from "~lib/services/storageService";
import { PlatformTag } from "../components/PlatformTag";
import { MessageBubble } from "../components/MessageBubble";
import { ReaderTimestampFooter } from "../components/ReaderTimestampFooter";
import { ChatBubbleLineIcon } from "../components/ThreadSearchIcons";
import {
  buildOccurrenceIndexMap,
  buildReaderSearchArtifacts,
  type MessageRenderPlan,
  type OccurrenceIndexMap,
  type ReaderSidecarTarget,
} from "../lib/readerSearch";
import {
  createSearchModel,
  resolveMessageOrder,
} from "../lib/threadsSearchReducer";
import type {
  ReaderSearchModel,
  ThreadsEvent,
  ThreadsState,
} from "../types/threadsSearch";
import { shouldRunFullTextSearch } from "~lib/utils/searchReadiness";

interface ReaderViewProps {
  conversation: Conversation;
  onBack: () => void;
  refreshToken: number;
  mode: ThreadsState["mode"];
  searchQuery: string;
  firstMatchedMessageId: number | null;
  searchModel: ReaderSearchModel | null;
  dispatch: (event: ThreadsEvent) => void;
}

export function ReaderView({
  conversation,
  onBack,
  refreshToken,
  mode,
  searchQuery,
  firstMatchedMessageId,
  searchModel,
  dispatch,
}: ReaderViewProps) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadedConversationId, setLoadedConversationId] = useState<number | null>(null);
  const [renderPlanByMessageId, setRenderPlanByMessageId] = useState<
    Record<number, MessageRenderPlan>
  >({});
  const [sidecarTargetMap, setSidecarTargetMap] = useState<Record<string, ReaderSidecarTarget>>(
    {}
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hasQuery = shouldRunFullTextSearch(searchQuery);
  const occurrenceCount = searchModel?.occurrences.length ?? 0;
  const currentIndex = searchModel?.currentIndex ?? 0;
  const isLoading = mode === "reader_loading_messages";
  const isBuilding = mode === "reader_building_index";
  const isReady = mode === "reader_ready";
  const isPrimaryContentSettled =
    !isLoading && !isBuilding && loadedConversationId === conversation.id;
  const timestampFooter = useMemo(
    () => buildReaderTimestampFooterModel(conversation, t.reader.timestamp, locale),
    [conversation, t.reader.timestamp, locale]
  );

  const occurrenceIndexMap = useMemo<OccurrenceIndexMap>(() => {
    if (!searchModel || searchModel.occurrences.length === 0) {
      return {};
    }
    return buildOccurrenceIndexMap(searchModel.occurrences);
  }, [searchModel]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setLoadedConversationId(null);
    setRenderPlanByMessageId({});
    setSidecarTargetMap({});
    getMessages(conversation.id)
      .then((data) => {
        if (cancelled) return;
        const ordered = resolveMessageOrder(data);
        setMessages(ordered);
        setLoadedConversationId(conversation.id);
        dispatch({ type: "MESSAGES_LOADED", messages: ordered });
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([]);
        setLoadedConversationId(conversation.id);
        dispatch({ type: "MESSAGES_LOADED", messages: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.id, refreshToken, dispatch]);

  useEffect(() => {
    if (!isBuilding) return;
    const {
      occurrences,
      renderPlanByMessageId: plans,
      sidecarTargetMap: nextSidecarTargetMap,
    } = buildReaderSearchArtifacts({
      messages,
      platform: conversation.platform,
      query: searchQuery,
    });
    setRenderPlanByMessageId(plans);
    setSidecarTargetMap(nextSidecarTargetMap);
    const nextSearchModel = createSearchModel(
      searchQuery,
      firstMatchedMessageId,
      occurrences
    );
    dispatch({ type: "INDEX_BUILT", searchModel: nextSearchModel });
  }, [
    isBuilding,
    messages,
    conversation.platform,
    searchQuery,
    firstMatchedMessageId,
    dispatch,
  ]);

  useEffect(() => {
    if (!isReady) return;
    if (occurrenceCount === 0) return;
    const target = scrollRef.current?.querySelector(
      `[data-occurrence-index="${currentIndex}"]`
    );
    if (!(target instanceof HTMLElement)) return;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isReady, currentIndex, occurrenceCount]);

  useEffect(() => {
    if (!isReady || hasQuery || firstMatchedMessageId === null) return;
    const target = scrollRef.current?.querySelector(
      `[data-message-id="${firstMatchedMessageId}"]`
    );
    if (!(target instanceof HTMLElement)) return;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isReady, hasQuery, firstMatchedMessageId, messages.length]);

  const navDisabled = !isReady || occurrenceCount === 0;
  const navLabel = isLoading
    ? "Loading..."
    : isBuilding
      ? "Building index..."
      : occurrenceCount > 0
        ? `${currentIndex + 1} / ${occurrenceCount}`
        : "0 / 0";

  return (
    <div className="flex h-full flex-col">
      <header className="reader-view-header">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="reader-view-back-btn"
        >
          <ArrowLeft className="reader-view-back-icon" strokeWidth={1.75} />
        </button>

        <h2 className="reader-view-title min-w-0 flex-1 truncate text-vesti-base font-semibold text-text-primary">
          {conversation.title}
        </h2>

        <PlatformTag platform={conversation.platform} />

        <span className="reader-view-msg-count text-vesti-xs text-text-tertiary">
          <MessageSquare className="reader-view-msg-icon" strokeWidth={1.75} />
          {conversation.message_count} messages
        </span>
      </header>

      {hasQuery ? (
        <div className="reader-view-nav">
          <button
            type="button"
            aria-label="Previous occurrence"
            className="reader-view-nav-btn"
            disabled={navDisabled}
            onClick={() => {
              if (navDisabled) return;
              dispatch({ type: "PREV_OCCURRENCE" });
            }}
          >
            <ChevronUp className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <span className="reader-view-nav-count">{navLabel}</span>
          <button
            type="button"
            aria-label="Next occurrence"
            className="reader-view-nav-btn"
            disabled={navDisabled}
            onClick={() => {
              if (navDisabled) return;
              dispatch({ type: "NEXT_OCCURRENCE" });
            }}
          >
            <ChevronDown className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto vesti-scroll">
        {isLoading ? (
          <div className="reader-view-loading">
            <div className="flex items-center gap-2 text-vesti-sm text-text-tertiary">
              <ChatBubbleLineIcon className="h-4 w-4 text-text-tertiary" />
              <span>Loading messages...</span>
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="reader-view-loading-item">
                <div className="h-3 w-12 animate-pulse rounded bg-surface-card" />
                <div className="h-20 animate-pulse rounded-md bg-surface-card" />
              </div>
            ))}
          </div>
        ) : isBuilding ? (
          <div className="reader-view-loading">
            <div className="flex items-center gap-2 text-vesti-sm text-text-tertiary">
              <ChatBubbleLineIcon className="h-4 w-4 text-text-tertiary" />
              <span>Building search index...</span>
            </div>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="reader-view-loading-item">
                <div className="h-3 w-12 animate-pulse rounded bg-surface-card" />
                <div className="h-20 animate-pulse rounded-md bg-surface-card" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <p className="text-vesti-sm text-text-tertiary">No messages yet</p>
          </div>
        ) : (
          <div className="flex flex-col pb-2">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                platform={conversation.platform}
                renderPlan={renderPlanByMessageId[msg.id] ?? null}
                occurrenceIndexMap={occurrenceIndexMap}
                sidecarTargetMap={sidecarTargetMap}
                currentIndex={isReady ? currentIndex : null}
                isTarget={
                  !hasQuery &&
                  firstMatchedMessageId !== null &&
                  msg.id === firstMatchedMessageId
                }
              />
            ))}
          </div>
        )}
        {isPrimaryContentSettled ? (
          <ReaderTimestampFooter
            key={conversation.id}
            model={timestampFooter}
          />
        ) : null}
      </div>
    </div>
  );
}
