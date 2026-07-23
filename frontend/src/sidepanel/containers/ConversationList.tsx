import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "~lib/i18n";
import type {
  Conversation,
  ConversationMatchSummary,
  Message,
  Platform,
  Topic,
} from "~lib/types";
import {
  getConversationCaptureFreshnessAt,
  getConversationFirstCapturedAt,
  getConversationOriginAt,
  getConversationSourceCreatedAt,
} from "~lib/conversations/timestamps";
import {
  deleteConversation,
  getConversations,
  getMessages,
  getTopics,
  searchConversationMatchesByText,
  updateConversationTitle,
} from "~lib/services/storageService";
import { buildMessageFallbackDisplayText } from "~lib/utils/messageContentPackage";
import { parseQuery, scoreText } from "~lib/search/textSearch";
import {
  getSearchReadiness,
  normalizeSearchQuery,
  shouldRunFullTextSearch,
} from "~lib/utils/searchReadiness";
import { trackCardActionClick } from "~lib/services/telemetry";
import type { DatePreset } from "../types/timelineFilters";
import { ConversationCard } from "../components/ConversationCard";
import { SearchLineIcon, SearchSlashIcon } from "../components/ThreadSearchIcons";

interface ConversationListProps {
  searchQuery: string;
  datePreset: DatePreset;
  selectedPlatforms: Set<Platform>;
  onSelect: (conversation: Conversation) => void;
  refreshToken: number;
  resultSummaryMap: Record<number, ConversationMatchSummary>;
  onResultSummaryMapChange: (next: Record<number, ConversationMatchSummary>) => void;
  anchorConversationId?: number | null;
  onAnchorConsumed?: () => void;
  onBodySearchStarted?: () => void;
  onBodySearchResolved?: (summaries: ConversationMatchSummary[]) => void;
  // Batch selection support
  isBatchMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelection?: (id: number) => void;
  onSelectFromMenu?: (id: number) => void;
  onFilteredConversationsChange?: (conversations: Conversation[]) => void;
  onConversationsLoaded?: (conversations: Conversation[]) => void;
  bottomInsetPx?: number;
  /** Order/group by the conversation's own time ("origin") or capture time. */
  sortMode?: "origin" | "capture";
  /** Optional time-window filter (from the timeline scrubber), in the active mode. */
  timeRange?: { start: number; end: number } | null;
}

interface FilteredConversationItem {
  conversation: Conversation;
  matchedInMessagesOnly: boolean;
  summary?: ConversationMatchSummary;
  /** relevance score while a search is active (title + body); 0 otherwise */
  rankScore: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateTime(value: number): string {
  const date = new Date(value);
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function buildConversationCopyText(
  conversation: Conversation,
  messages: Message[]
): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title || "Untitled Conversation"}`);
  lines.push(`Platform: ${conversation.platform}`);
  lines.push(`Source URL: ${conversation.url || "N/A"}`);
  lines.push(`Started At: ${toLocalDateTime(getConversationOriginAt(conversation))}`);
  const sourceCreatedAt = getConversationSourceCreatedAt(conversation);
  if (sourceCreatedAt !== null) {
    lines.push(`Source Time: ${toLocalDateTime(sourceCreatedAt)}`);
  }
  lines.push(
    `First Captured At: ${toLocalDateTime(
      getConversationFirstCapturedAt(conversation)
    )}`
  );
  lines.push(
    `Last Captured At: ${toLocalDateTime(
      getConversationCaptureFreshnessAt(conversation)
    )}`
  );
  lines.push(`Last Modified: ${toLocalDateTime(conversation.updated_at)}`);
  lines.push(`Message Count: ${messages.length}`);
  lines.push("");

  for (const message of messages) {
    const role = message.role === "user" ? "User" : "AI";
    lines.push(`${role}: [${toLocalDateTime(message.created_at)}]`);
    lines.push(buildMessageFallbackDisplayText(message));
    lines.push("");
  }

  return lines.join("\n").trim();
}

function matchesSearch(conversation: Conversation, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return (
    conversation.title.toLowerCase().includes(normalizedQuery) ||
    conversation.snippet.toLowerCase().includes(normalizedQuery)
  );
}

function matchesDatePreset(timestamp: number, preset: DatePreset): boolean {
  if (preset === "all_time") return true;

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  if (preset === "today") {
    return timestamp >= startOfToday;
  }

  if (preset === "this_week") {
    const day = new Date(startOfToday).getDay();
    const offset = (day + 6) % 7; // Monday as week start
    const startOfWeek = startOfToday - offset * 24 * 60 * 60 * 1000;
    return timestamp >= startOfWeek;
  }

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return timestamp >= startOfMonth;
}

interface TopicOption {
  id: number;
  label: string;
}

// Progressive rendering: the first page mounts immediately, further pages
// append as the sentinel nears the viewport. Keeps initial mount (and every
// re-render while filtering) bounded at ~50 cards instead of the full library.
const LIST_PAGE_SIZE = 50;
const LIST_LOAD_MARGIN_PX = 400;

function flattenTopics(
  topics: Topic[],
  level: number = 0,
  acc: TopicOption[] = []
): TopicOption[] {
  for (const topic of topics) {
    const prefix = level > 0 ? `${"- ".repeat(level)}` : "";
    acc.push({ id: topic.id, label: `${prefix}${topic.name}` });
    if (topic.children && topic.children.length > 0) {
      flattenTopics(topic.children, level + 1, acc);
    }
  }
  return acc;
}

export function ConversationList({
  searchQuery,
  datePreset,
  selectedPlatforms,
  onSelect,
  refreshToken,
  resultSummaryMap,
  onResultSummaryMapChange,
  anchorConversationId,
  onAnchorConsumed,
  onBodySearchStarted,
  onBodySearchResolved,
  isBatchMode = false,
  selectedIds = new Set(),
  onToggleSelection,
  onSelectFromMenu,
  onFilteredConversationsChange,
  onConversationsLoaded,
  bottomInsetPx = 16,
  sortMode = "origin",
  timeRange = null,
}: ConversationListProps) {
  const { t } = useI18n();
  const timeOf = useCallback(
    (conversation: Conversation) =>
      sortMode === "capture"
        ? getConversationCaptureFreshnessAt(conversation)
        : getConversationOriginAt(conversation),
    [sortMode],
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMessageSearchPending, setIsMessageSearchPending] = useState(false);
  const fullTextCacheRef = useRef<Map<number, string>>(new Map());
  const queryCacheRef = useRef<Map<string, Record<number, ConversationMatchSummary>>>(
    new Map()
  );
  const searchRequestSeqRef = useRef(0);
  const searchDebounceRef = useRef<number | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const listSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastAnchorRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const searchReadiness = getSearchReadiness(normalizedSearchQuery);
  const shouldRunMessageSearch = shouldRunFullTextSearch(normalizedSearchQuery);
  const filterKey = useMemo(() => {
    const platforms = Array.from(selectedPlatforms).sort().join(",");
    return `${datePreset}|${platforms}`;
  }, [datePreset, selectedPlatforms]);
  const candidateConversationIds = useMemo(() => {
    if (!conversations.length) return [];
    return conversations
      .filter((conversation) => {
        const at = timeOf(conversation);
        if (!matchesDatePreset(at, datePreset)) {
          return false;
        }
        if (timeRange && (at < timeRange.start || at > timeRange.end)) {
          return false;
        }
        if (selectedPlatforms.size > 0 && !selectedPlatforms.has(conversation.platform)) {
          return false;
        }
        return true;
      })
      .map((conversation) => conversation.id);
  }, [conversations, datePreset, selectedPlatforms, timeOf, timeRange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    queryCacheRef.current.clear();
    onResultSummaryMapChange({});
    getConversations()
      .then((data) => {
        if (!cancelled) {
          setConversations(data);
          setLoading(false);
          onConversationsLoaded?.(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversations([]);
          setLoading(false);
          onConversationsLoaded?.([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, onConversationsLoaded]);

  useEffect(() => {
    const requestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestSeq;

    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    if (!shouldRunMessageSearch) {
      setIsMessageSearchPending(false);
      onResultSummaryMapChange({});
      return;
    }

    const cacheKey = `${normalizedSearchQuery}::${filterKey}`;
    const cached = queryCacheRef.current.get(cacheKey);
    if (cached) {
      setIsMessageSearchPending(false);
      onResultSummaryMapChange(cached);
      onBodySearchResolved?.(Object.values(cached));
      return;
    }

    if (candidateConversationIds.length === 0) {
      setIsMessageSearchPending(false);
      onResultSummaryMapChange({});
      onBodySearchResolved?.([]);
      return;
    }

    setIsMessageSearchPending(true);
    onBodySearchStarted?.();
    searchDebounceRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const summaries = await searchConversationMatchesByText({
            query: normalizedSearchQuery,
            conversationIds: candidateConversationIds,
          });
          if (requestSeq !== searchRequestSeqRef.current) {
            return;
          }
          const summaryMap: Record<number, ConversationMatchSummary> = {};
          for (const summary of summaries) {
            summaryMap[summary.conversationId] = summary;
          }
          queryCacheRef.current.set(cacheKey, summaryMap);
          onResultSummaryMapChange(summaryMap);
          onBodySearchResolved?.(summaries);
        } catch {
          if (requestSeq !== searchRequestSeqRef.current) {
            return;
          }
          onResultSummaryMapChange({});
          onBodySearchResolved?.([]);
        } finally {
          if (requestSeq === searchRequestSeqRef.current) {
            setIsMessageSearchPending(false);
          }
        }
      })();
    }, 180);

    return () => {
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [
    candidateConversationIds,
    filterKey,
    normalizedSearchQuery,
    onResultSummaryMapChange,
    shouldRunMessageSearch,
  ]);

  const isSearching = searchReadiness !== "empty";
  const parsedSearch = useMemo(
    () => (isSearching ? parseQuery(normalizedSearchQuery) : null),
    [isSearching, normalizedSearchQuery],
  );
  const filteredConversations = useMemo(() => {
    const convs = conversations ?? [];
    const items = convs.reduce<FilteredConversationItem[]>((acc, conversation) => {
      const baseMatch = matchesSearch(conversation, normalizedSearchQuery);
      const summary = shouldRunMessageSearch ? resultSummaryMap[conversation.id] : undefined;
      const textMatch = Boolean(summary);
      const matchesQuery = searchReadiness === "empty" ? true : baseMatch || textMatch;
      if (!matchesQuery) return acc;
      const at = timeOf(conversation);
      if (!matchesDatePreset(at, datePreset)) {
        return acc;
      }
      if (timeRange && (at < timeRange.start || at > timeRange.end)) {
        return acc;
      }
      if (selectedPlatforms.size > 0 && !selectedPlatforms.has(conversation.platform)) {
        return acc;
      }
      // Relevance = title match (weighted) + best body-match score.
      const titleScore = parsedSearch ? scoreText(conversation.title ?? "", parsedSearch) : 0;
      const rankScore = parsedSearch ? titleScore * 3 + (summary?.score ?? 0) : 0;
      acc.push({
        conversation,
        matchedInMessagesOnly: textMatch && !baseMatch,
        summary,
        rankScore,
      });
      return acc;
    }, []);
    // While searching, rank by relevance (ties: newer first); otherwise by time.
    if (isSearching) {
      items.sort(
        (a, b) => b.rankScore - a.rankScore || timeOf(b.conversation) - timeOf(a.conversation),
      );
    } else {
      items.sort((a, b) => timeOf(b.conversation) - timeOf(a.conversation));
    }
    return items;
  }, [
    isSearching,
    parsedSearch,
    conversations,
    datePreset,
    searchReadiness,
    normalizedSearchQuery,
    resultSummaryMap,
    selectedPlatforms,
    shouldRunMessageSearch,
    timeOf,
    timeRange,
  ]);

  useEffect(() => {
    let cancelled = false;
    getTopics()
      .then((data) => {
        if (!cancelled) {
          setTopics(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTopics([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const topicOptions = useMemo(() => flattenTopics(topics), [topics]);

  useEffect(() => {
    onFilteredConversationsChange?.(
      filteredConversations.map((item) => item.conversation)
    );
  }, [filteredConversations, onFilteredConversationsChange]);

  const grouped = useMemo(() => {
    // While searching, show one relevance-ranked list (don't re-bucket by time).
    if (isSearching) {
      if (filteredConversations.length === 0) return [];
      return [{ label: t.timeline.searchResults, items: filteredConversations }];
    }
    const now = Date.now();
    const today: FilteredConversationItem[] = [];
    const week: FilteredConversationItem[] = [];
    const older: FilteredConversationItem[] = [];

    for (const item of filteredConversations) {
      const diff = now - timeOf(item.conversation);
      if (diff < 86_400_000) today.push(item);
      else if (diff < 604_800_000) week.push(item);
      else older.push(item);
    }

    const labels =
      sortMode === "capture"
        ? {
            today: t.timeline.capturedToday,
            week: t.timeline.capturedThisWeek,
            earlier: t.timeline.capturedEarlier,
          }
        : {
            today: t.timeline.startedToday,
            week: t.timeline.startedThisWeek,
            earlier: t.timeline.startedEarlier,
          };

    const groups: { label: string; items: FilteredConversationItem[] }[] = [];
    if (today.length > 0) groups.push({ label: labels.today, items: today });
    if (week.length > 0) groups.push({ label: labels.week, items: week });
    if (older.length > 0) groups.push({ label: labels.earlier, items: older });
    return groups;
  }, [filteredConversations, timeOf, sortMode, t, isSearching]);

  // Restart progressive rendering from the first page whenever the user
  // changes the result set (search / filters / sort / time window). Data
  // reloads (refreshToken) intentionally do NOT reset: truncating the list
  // under the user's scroll position on a background capture would be jarring.
  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
  }, [normalizedSearchQuery, filterKey, sortMode, timeRange]);

  const hasMoreItems = visibleCount < filteredConversations.length;

  const visibleGroups = useMemo(() => {
    let remaining = visibleCount;
    const result: { label: string; items: FilteredConversationItem[] }[] = [];
    for (const group of grouped) {
      if (remaining <= 0) break;
      result.push({ label: group.label, items: group.items.slice(0, remaining) });
      remaining -= group.items.length;
    }
    return result;
  }, [grouped, visibleCount]);

  // Append the next page when the sentinel approaches the viewport.
  useEffect(() => {
    if (!hasMoreItems) return;
    const sentinel = listSentinelRef.current;
    const root = listContainerRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + LIST_PAGE_SIZE);
        }
      },
      { root, rootMargin: `${LIST_LOAD_MARGIN_PX}px 0px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreItems]);

  useEffect(() => {
    if (!anchorConversationId || loading) return;
    if (lastAnchorRef.current === anchorConversationId) return;
    const target = listContainerRef.current?.querySelector(
      `[data-conversation-id="${anchorConversationId}"]`
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      lastAnchorRef.current = anchorConversationId;
      onAnchorConsumed?.();
      return;
    }
    // The anchor card is beyond the rendered window — grow the window to cover
    // it; this effect re-runs after the grow and scrolls it into view.
    const anchorIndex = filteredConversations.findIndex(
      (item) => item.conversation.id === anchorConversationId
    );
    if (anchorIndex >= visibleCount) {
      setVisibleCount(anchorIndex + 1);
    }
  }, [
    anchorConversationId,
    visibleGroups,
    loading,
    onAnchorConsumed,
    filteredConversations,
    visibleCount,
  ]);

  const handleCopyFullText = useCallback(async (conversation: Conversation) => {
    const hasCache = fullTextCacheRef.current.has(conversation.id);
    trackCardActionClick({
      action_type: "copy_text",
      platform_source: conversation.platform,
      has_full_text_cache: hasCache,
      conversation_id: conversation.id,
    });

    try {
      let fullText = fullTextCacheRef.current.get(conversation.id);
      if (!fullText) {
        const messages = await getMessages(conversation.id);
        fullText = buildConversationCopyText(conversation, messages);
        fullTextCacheRef.current.set(conversation.id, fullText);
      }

      await navigator.clipboard.writeText(fullText);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleOpenSource = useCallback((conversation: Conversation) => {
    trackCardActionClick({
      action_type: "open_source_url",
      platform_source: conversation.platform,
      has_full_text_cache: null,
      conversation_id: conversation.id,
    });
    if (!conversation.url.trim()) return;
    window.open(conversation.url, "_blank", "noopener,noreferrer");
  }, []);

  const handleDeleteConversation = useCallback(
    async (id: number) => {
      const targetConversation = conversations.find((item) => item.id === id);
      if (!targetConversation) return;

      trackCardActionClick({
        action_type: "delete_conversation",
        platform_source: targetConversation.platform,
        has_full_text_cache: null,
        conversation_id: id,
      });

      await deleteConversation(id);
      fullTextCacheRef.current.delete(id);
      setConversations((prev) => prev.filter((item) => item.id !== id));
    },
    [conversations]
  );

  const handleRenameTitle = useCallback(
    async (conversationId: number, title: string) => {
      const targetConversation = conversations.find(
        (item) => item.id === conversationId
      );
      if (!targetConversation) return false;

      const normalizedTitle = title.trim();
      if (!normalizedTitle || normalizedTitle.length > 120) {
        return false;
      }

      trackCardActionClick({
        action_type: "rename_title",
        platform_source: targetConversation.platform,
        has_full_text_cache: null,
        conversation_id: conversationId,
      });

      try {
        const updatedConversation = await updateConversationTitle(
          conversationId,
          normalizedTitle
        );
        fullTextCacheRef.current.delete(conversationId);

        setConversations((prev) =>
          prev.map((item) =>
            item.id === conversationId
              ? { ...item, title: updatedConversation.title }
              : item
          )
        );
        return true;
      } catch (error) {
        console.error("Failed to rename conversation title", error);
        return false;
      }
    },
    [conversations]
  );

  const handleConversationUpdated = useCallback(
    (updatedConversation: Conversation) => {
      setConversations((prev) => {
        const next = prev.map((item) =>
          item.id === updatedConversation.id
            ? { ...item, ...updatedConversation }
            : item
        );
        // Update the MASTER list only. Search filtering lives in the
        // filteredConversations memo; filtering here would permanently prune
        // non-matching threads from state until a reload.
        return next.sort((a, b) => timeOf(b) - timeOf(a));
      });
    },
    [timeOf]
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-2.5 p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-md bg-surface-card"
          />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-vesti-sm text-text-tertiary">{t.timeline.noConversations}</p>
      </div>
    );
  }

  if (filteredConversations.length === 0) {
    const emptyLabel = isMessageSearchPending
      ? t.timeline.searchingMessages
      : t.timeline.noMatches;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex items-center gap-2 text-vesti-sm text-text-tertiary">
          {isMessageSearchPending ? (
            <SearchLineIcon className="h-4 w-4 text-text-tertiary" />
          ) : (
            <SearchSlashIcon className="h-4 w-4 text-text-tertiary" />
          )}
          <span>{emptyLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listContainerRef}
      className="vesti-scroll h-full min-h-0 flex flex-col gap-2 overflow-y-scroll px-4"
      style={{ paddingBottom: `${bottomInsetPx}px` }}
    >
      {visibleGroups.map((group) => (
        <div key={group.label}>
          <h4 className="-mx-4 sticky top-0 z-10 bg-bg-app px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
            {group.label}
          </h4>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => (
              <ConversationCard
                key={item.conversation.id}
                conversation={item.conversation}
                sortMode={sortMode}
                matchedInMessagesOnly={item.matchedInMessagesOnly}
                searchQuery={searchQuery}
                messageExcerpt={
                  item.matchedInMessagesOnly ? item.summary?.bestExcerpt ?? null : null
                }
                messageMatchSurface={
                  item.matchedInMessagesOnly ? item.summary?.firstMatchedSurface ?? null : null
                }
                onClick={() => onSelect(item.conversation)}
                onCopyFullText={handleCopyFullText}
                onOpenSource={handleOpenSource}
                onDelete={handleDeleteConversation}
                onRenameTitle={handleRenameTitle}
                topicOptions={topicOptions}
                onConversationUpdated={handleConversationUpdated}
                // Batch selection
                isBatchMode={isBatchMode}
                isSelected={selectedIds.has(item.conversation.id)}
                onToggleSelect={() => onToggleSelection?.(item.conversation.id)}
                onSelectFromMenu={() => onSelectFromMenu?.(item.conversation.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {hasMoreItems && (
        <div ref={listSentinelRef} className="h-1 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}





