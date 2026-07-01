"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { ChatSummaryData, StorageApi, UiThemeMode } from "../types";
import type { DashboardLabels } from "../types";
import { useLibraryData } from "../contexts/library-data";
import { getPlatformBadgeStyle, getPlatformLabel } from "../constants/platform";
import { GraphLegend } from "./network/GraphLegend";
import { TemporalGraph } from "./network/TemporalGraph";
import { ThinkingMap } from "./network/ThinkingMapView";
import { TimeBar } from "./network/TimeBar";
import { buildThinkingMap } from "./network/thinkingMap";
import {
  GRAPH_HEIGHT,
  buildTemporalNetworkDataset,
  dayToProgress,
  getConversationOriginAt,
  getVisibleConversationCount,
  progressToDay,
  type GraphEdge,
} from "./network/temporal-graph-utils";

type NetworkView = "conversations" | "thinking";

const SUMMARY_FETCH_BATCH = 8;

interface NetworkTabProps {
  storage: StorageApi;
  themeMode?: UiThemeMode;
  isActive?: boolean;
  onSelectConversation?: (id: number) => void;
  labels?: DashboardLabels["network"];
}

type EdgeStatus = "idle" | "loading" | "ready" | "error";

const PLAYBACK_DURATION_MS = 8_000;

function formatDefaultInfo(totalDays: number, labels: DashboardLabels["network"]) {
  if (totalDays <= 0) return labels.noConversationsYet;
  return labels.replayInfo;
}

function formatBirthInfo(label: string, platform: string, labels: DashboardLabels["network"]) {
  if (label.trim().toLowerCase() === platform.trim().toLowerCase()) {
    return labels.newConversationOn.replace("{platform}", platform);
  }
  return labels.conversationOn.replace("{label}", label).replace("{platform}", platform);
}

function formatStartedLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

export function NetworkTab({
  storage,
  themeMode = "light",
  isActive = true,
  onSelectConversation,
  labels: providedLabels,
}: NetworkTabProps) {
  const labels = providedLabels ?? ({} as DashboardLabels["network"]);
  const { conversations, topics } = useLibraryData();
  const [currentDay, setCurrentDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [playbackToken, setPlaybackToken] = useState(0);
  const [infoText, setInfoText] = useState(labels.noConversationsYet ?? "No conversations captured yet.");
  const [graphResetToken, setGraphResetToken] = useState(0);
  const [scrubToken, setScrubToken] = useState(0);
  const [edgeStatus, setEdgeStatus] = useState<EdgeStatus>("idle");
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [networkView, setNetworkView] = useState<NetworkView>("conversations");
  const [summariesById, setSummariesById] = useState<Map<number, ChatSummaryData>>(
    () => new Map()
  );
  const [summariesLoading, setSummariesLoading] = useState(false);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playbackOriginRef = useRef<number | null>(null);
  const playbackStartProgressRef = useRef(0);
  const currentDayRef = useRef(0);
  const previousDayRef = useRef(0);
  const previousScrubTokenRef = useRef(0);
  const previousIsActiveRef = useRef(isActive);
  const previousTotalDaysRef = useRef(0);

  const dataset = useMemo(
    () => buildTemporalNetworkDataset(conversations, edges),
    [conversations, edges]
  );
  const baseDataset = useMemo(
    () => buildTemporalNetworkDataset(conversations, []),
    [conversations]
  );
  const totalDays = dataset.data.totalDays;
  const topicMap = useMemo(() => {
    const map = new Map<number, string>();
    const walk = (items: typeof topics) => {
      items.forEach((topic) => {
        map.set(topic.id, topic.name);
        if (topic.children) walk(topic.children);
      });
    };
    walk(topics);
    return map;
  }, [topics]);
  const conversationsById = useMemo(
    () => new Map(conversations.map((conversation) => [conversation.id, conversation])),
    [conversations]
  );

  // Load cached summaries (bounded concurrency) only while in thinking-map view.
  useEffect(() => {
    if (networkView !== "thinking") return;

    const getSummary = storage.getSummary;
    if (!getSummary) {
      setSummariesById(new Map());
      setSummariesLoading(false);
      return;
    }

    const targetIds = conversations
      .filter((conversation) => !conversation.is_trash)
      .map((conversation) => conversation.id);

    if (targetIds.length === 0) {
      setSummariesById(new Map());
      setSummariesLoading(false);
      return;
    }

    let cancelled = false;
    setSummariesLoading(true);

    const run = async () => {
      const collected = new Map<number, ChatSummaryData>();
      for (let start = 0; start < targetIds.length; start += SUMMARY_FETCH_BATCH) {
        if (cancelled) return;
        const batch = targetIds.slice(start, start + SUMMARY_FETCH_BATCH);
        const results = await Promise.all(
          batch.map((id) =>
            getSummary(id)
              .then((summary) => ({ id, summary }))
              .catch(() => ({ id, summary: null as ChatSummaryData | null }))
          )
        );
        for (const { id, summary } of results) {
          if (summary) collected.set(id, summary);
        }
      }
      if (!cancelled) {
        setSummariesById(collected);
        setSummariesLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [networkView, conversations, storage]);

  const thinkingMap = useMemo(
    () => buildThinkingMap(conversations, summariesById, topicMap),
    [conversations, summariesById, topicMap]
  );
  const selectedConcept = useMemo(
    () =>
      selectedConceptId
        ? thinkingMap.concepts.find((concept) => concept.id === selectedConceptId) ?? null
        : null,
    [thinkingMap.concepts, selectedConceptId]
  );

  const handleSelectConcept = useCallback((conceptId: string | null) => {
    setSelectedConceptId(conceptId);
  }, []);

  const handleSwitchView = useCallback((view: NetworkView) => {
    setNetworkView(view);
    setSelectedConceptId(null);
  }, []);
  const conversationIdsKey = useMemo(
    () => baseDataset.data.nodes.map((node) => node.id).join(","),
    [baseDataset.data.nodes]
  );
  const visibleCount = useMemo(
    () => getVisibleConversationCount(dataset.data.nodes, currentDay),
    [currentDay, dataset.data.nodes]
  );
  const selectedGraphNode = useMemo(
    () => dataset.data.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [dataset.data.nodes, selectedNodeId]
  );
  const selectedConversation = useMemo(
    () => (selectedNodeId !== null ? conversationsById.get(selectedNodeId) ?? null : null),
    [conversationsById, selectedNodeId]
  );
  const connectedNodes = useMemo(() => {
    if (selectedNodeId === null) return [];

    return dataset.data.edges
      .filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
      .map((edge) => {
        const neighborId = edge.source === selectedNodeId ? edge.target : edge.source;
        const neighborNode = dataset.data.nodes.find((node) => node.id === neighborId);
        const neighborConversation = conversationsById.get(neighborId) ?? null;
        return {
          id: neighborId,
          weight: edge.weight,
          node: neighborNode ?? null,
          conversation: neighborConversation,
          topicName:
            neighborConversation?.topic_id !== null && neighborConversation?.topic_id !== undefined
              ? topicMap.get(neighborConversation.topic_id) ?? null
              : null,
        };
      })
      .sort((left, right) => {
        if (right.weight !== left.weight) return right.weight - left.weight;
        const leftOriginAt = left.node?.originAt ?? Number.POSITIVE_INFINITY;
        const rightOriginAt = right.node?.originAt ?? Number.POSITIVE_INFINITY;
        if (leftOriginAt !== rightOriginAt) return leftOriginAt - rightOriginAt;
        return left.id - right.id;
      });
  }, [conversationsById, dataset.data.edges, dataset.data.nodes, selectedNodeId, topicMap]);
  const highlightedNodeIds = useMemo(
    () => connectedNodes.map((entry) => entry.id),
    [connectedNodes]
  );

  useEffect(() => {
    currentDayRef.current = currentDay;
  }, [currentDay]);

  useEffect(() => {
    if (!selectedGraphNode) return;
    if (selectedGraphNode.timelineDay > currentDay) {
      setSelectedNodeId(null);
    }
  }, [currentDay, selectedGraphNode]);

  const stopPlayback = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    playbackOriginRef.current = null;
    setPlaying(false);
  }, []);

  const resetTimeline = useCallback(
    (
      nextDay = 0,
      options: {
        hardReset?: boolean;
        scrub?: boolean;
        nextInfoText?: string;
      } = {}
    ) => {
      const { hardReset = true, scrub = false, nextInfoText } = options;
      const clampedDay = Math.max(0, Math.min(totalDays, nextDay));

      stopPlayback();
      setCurrentDay(clampedDay);
      currentDayRef.current = clampedDay;
      previousDayRef.current = clampedDay;

      if (hardReset) {
        setGraphResetToken((token) => token + 1);
      }

      if (scrub) {
        setScrubToken((token) => token + 1);
      } else {
        previousScrubTokenRef.current = 0;
        setScrubToken(0);
      }

      if (typeof nextInfoText === "string") {
        setInfoText(nextInfoText);
      }
    },
    [stopPlayback, totalDays]
  );

  const startReplay = useCallback(() => {
    if (totalDays <= 0) return;

    resetTimeline(0, {
      hardReset: true,
      scrub: false,
      nextInfoText: formatDefaultInfo(totalDays, labels),
    });
    setScrubbing(false);
    playbackStartProgressRef.current = 0;
    setPlaybackToken((token) => token + 1);
    setPlaying(true);
  }, [resetTimeline, totalDays]);

  useEffect(() => {
    const conversationIds = baseDataset.data.nodes.map((node) => node.id);
    let cancelled = false;

    if (conversationIds.length < 2) {
      setEdges([]);
      setEdgeStatus("ready");
      setEdgeError(null);
      return () => {
        cancelled = true;
      };
    }

    if (!storage.getAllEdges) {
      setEdges([]);
      setEdgeStatus("error");
      setEdgeError(labels.edgeLoadingUnavailable ?? "Semantic edge loading is unavailable in this environment.");
      return () => {
        cancelled = true;
      };
    }

    setEdgeStatus("loading");
    setEdgeError(null);

    storage
      .getAllEdges({ threshold: 0.4, conversationIds })
      .then((result) => {
        if (cancelled) return;
        setEdges((result ?? []).map((edge) => ({ ...edge })));
        setEdgeStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[Network] getAllEdges error:", error);
        setEdges([]);
        setEdgeStatus("error");
        setEdgeError(labels.edgePlaybackUnavailable ?? "Semantic edge playback is temporarily unavailable.");
      });

    return () => {
      cancelled = true;
    };
  }, [baseDataset.data.nodes, conversationIdsKey, storage]);

  useEffect(() => {
    const previousTotalDays = previousTotalDaysRef.current;
    previousTotalDaysRef.current = totalDays;

    if (totalDays <= 0) {
      resetTimeline(0, {
        hardReset: true,
        scrub: false,
        nextInfoText: formatDefaultInfo(0, labels),
      });
      return;
    }

    if (currentDayRef.current > totalDays) {
      setCurrentDay(totalDays);
      currentDayRef.current = totalDays;
      previousDayRef.current = totalDays;
    }

    if (isActive && previousTotalDays <= 0 && totalDays > 0) {
      startReplay();
      return;
    }

    if (!playing && currentDayRef.current === 0 && scrubToken === 0) {
      setInfoText(formatDefaultInfo(totalDays, labels));
    }
  }, [isActive, labels, playing, resetTimeline, scrubToken, startReplay, totalDays]);

  useEffect(() => {
    const wasActive = previousIsActiveRef.current;
    previousIsActiveRef.current = isActive;

    if (!isActive) {
      stopPlayback();
      return;
    }

    if (!wasActive && totalDays > 0) {
      startReplay();
    }
  }, [isActive, startReplay, stopPlayback, totalDays]);

  useEffect(() => {
    if (!playing || totalDays <= 0) return;

    playbackOriginRef.current = null;
    playbackStartProgressRef.current = dayToProgress(currentDayRef.current, totalDays);

    const tick = (timestamp: number) => {
      if (playbackOriginRef.current === null) {
        playbackOriginRef.current =
          timestamp - playbackStartProgressRef.current * PLAYBACK_DURATION_MS;
      }

      const progress = Math.max(
        0,
        Math.min(1, (timestamp - playbackOriginRef.current) / PLAYBACK_DURATION_MS)
      );
      const nextDay = progressToDay(progress, totalDays);

      currentDayRef.current = nextDay;
      setCurrentDay(nextDay);

      if (progress >= 1) {
        animationFrameRef.current = null;
        playbackOriginRef.current = null;
        setPlaying(false);
        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      playbackOriginRef.current = null;
    };
  }, [playbackToken, playing, totalDays]);

  useEffect(() => {
    const previousDay = previousDayRef.current;
    const didScrub = previousScrubTokenRef.current !== scrubToken;

    if (totalDays > 0 && !playing && currentDay === 0 && scrubToken === 0) {
      previousDayRef.current = 0;
      setInfoText(formatDefaultInfo(totalDays, labels));
      return;
    }

    if (didScrub) {
      previousScrubTokenRef.current = scrubToken;
      previousDayRef.current = currentDay;
      setInfoText(`${visibleCount} ${labels.conversationsVisible ?? "conversations visible"}`);
      return;
    }

    if (currentDay > previousDay) {
      let latestBirth: (typeof dataset.data.nodes)[number] | undefined;
      for (let index = dataset.data.nodes.length - 1; index >= 0; index -= 1) {
        const node = dataset.data.nodes[index];
        if (node.timelineDay <= previousDay) break;
        if (node.timelineDay <= currentDay) {
          latestBirth = node;
          break;
        }
      }

      if (latestBirth) {
        setInfoText(formatBirthInfo(latestBirth.label, latestBirth.platform, labels));
      } else if (!playing) {
        setInfoText(`${visibleCount} ${labels.conversationsVisible ?? "conversations visible"}`);
      }
    } else if (!playing && totalDays > 0 && currentDay > 0) {
      setInfoText(`${visibleCount} ${labels.conversationsVisible ?? "conversations visible"}`);
    }

    previousDayRef.current = currentDay;
  }, [
    currentDay,
    dataset.data.nodes,
    labels,
    playing,
    scrubToken,
    totalDays,
    visibleCount,
  ]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const handleReplay = useCallback(() => {
    setSelectedNodeId(null);
    startReplay();
  }, [startReplay]);

  const handleScrubStart = useCallback(() => {
    stopPlayback();
    setScrubbing(true);
  }, [stopPlayback]);

  const handleScrubChange = useCallback(
    (day: number) => {
      const nextDay = Math.max(0, Math.min(totalDays, day));
      stopPlayback();
      setCurrentDay(nextDay);
      currentDayRef.current = nextDay;
      setScrubToken((token) => token + 1);
    },
    [stopPlayback, totalDays]
  );

  const handleScrubEnd = useCallback(() => {
    setScrubbing(true);
  }, []);

  const handleNodeFocus = useCallback(
    (nodeId: number) => {
      stopPlayback();
      setScrubbing(false);
      setSelectedNodeId(nodeId);
    },
    [stopPlayback]
  );

  const handleCloseDrawer = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleViewInLibrary = useCallback(() => {
    if (selectedNodeId !== null && onSelectConversation) {
      onSelectConversation(selectedNodeId);
      setSelectedNodeId(null);
    }
  }, [onSelectConversation, selectedNodeId]);

  const edgeMessage =
    edgeStatus === "error"
      ? edgeError
      : edgeStatus === "ready" && dataset.data.nodes.length > 1 && dataset.data.edges.length === 0
        ? labels.noSemanticLinks ?? "No semantic links yet. Playback still shows how conversations accumulated over time."
        : null;

  const viewToggle = (
    <div className="inline-flex rounded-full border border-border-subtle bg-bg-primary p-0.5">
      {(
        [
          ["conversations", labels.conversationMapView ?? "Conversations"] as const,
          ["thinking", labels.thinkingMapView ?? "Thinking map"] as const,
        ]
      ).map(([view, label]) => {
        const isActive = networkView === view;
        return (
          <button
            key={view}
            type="button"
            onClick={() => handleSwitchView(view)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-sans transition-colors ${
              isActive
                ? "bg-accent-primary text-text-inverse"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  if (networkView === "thinking") {
    return (
      <div className="h-full overflow-y-auto bg-bg-tertiary">
        <div className="flex min-h-full w-full flex-col gap-4 px-6 py-8 md:px-8">
          {viewToggle}

          {summariesLoading ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <p className="text-sm font-sans text-text-secondary">
                {labels.loadingThinkingMap ?? "Building your thinking map..."}
              </p>
            </div>
          ) : thinkingMap.concepts.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <p className="max-w-md text-center text-sm font-sans text-text-secondary">
                {labels.thinkingMapEmpty ??
                  "Generate conversation summaries in the Library first — the thinking map is built from the key insights inside them."}
              </p>
            </div>
          ) : (
            <>
              {thinkingMap.gaps.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-sans font-medium uppercase tracking-[0.08em] text-text-tertiary">
                    {labels.gapInsightTitle ?? "Threads you haven't connected"}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {thinkingMap.gaps.slice(0, 3).map((gap) => (
                      <button
                        key={`${gap.a.id}|${gap.b.id}`}
                        type="button"
                        onClick={() => handleSelectConcept(gap.a.id)}
                        className="max-w-xs rounded-lg border border-border-subtle bg-bg-surface-card px-3 py-2 text-left text-xs font-sans text-text-secondary transition-colors hover:bg-bg-secondary"
                      >
                        {(labels.gapInsightTemplate ?? "You explored {a} and {b} but never linked them")
                          .replace("{a}", gap.a.term)
                          .replace("{b}", gap.b.term)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="relative h-[420px] rounded-lg bg-bg-tertiary">
                <ThinkingMap
                  map={thinkingMap}
                  themeMode={themeMode}
                  selectedConceptId={selectedConceptId}
                  onSelectConcept={handleSelectConcept}
                  onSelectConversation={onSelectConversation}
                  height={GRAPH_HEIGHT}
                />
              </div>

              {selectedConcept && (
                <div className="rounded-lg border border-border-subtle bg-bg-primary p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <h2 className="text-lg font-serif font-normal text-text-primary">
                      {selectedConcept.term}
                    </h2>
                    <button
                      type="button"
                      onClick={() => handleSelectConcept(null)}
                      className="shrink-0 text-text-secondary transition-colors hover:text-text-primary"
                      aria-label={labels.close ?? "Close"}
                    >
                      <X strokeWidth={1.5} className="h-4 w-4" />
                    </button>
                  </div>

                  {selectedConcept.definition && (
                    <p className="mb-3 text-sm font-sans text-text-secondary">
                      {selectedConcept.definition}
                    </p>
                  )}

                  <p className="mb-4 text-[11px] font-sans text-text-tertiary">
                    {(labels.conceptMentionedIn ?? "Across {count} conversations").replace(
                      "{count}",
                      String(selectedConcept.count)
                    )}
                  </p>

                  <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-[0.08em] text-text-tertiary">
                    {labels.relatedConversations ?? "Related conversations"}
                  </h3>
                  <div className="space-y-2">
                    {selectedConcept.conversationIds.map((conversationId) => {
                      const conversation = conversationsById.get(conversationId);
                      const title =
                        conversation?.title?.trim() ||
                        (labels.conversationN ?? "Conversation {id}").replace(
                          "{id}",
                          String(conversationId)
                        );
                      return (
                        <button
                          key={conversationId}
                          type="button"
                          onClick={() => onSelectConversation?.(conversationId)}
                          className="flex w-full items-start justify-between gap-3 rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2 text-left transition-colors hover:bg-bg-secondary"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-sans text-text-primary">
                              {title}
                            </div>
                            {conversation && (
                              <div className="mt-1 text-[11px] font-sans text-text-tertiary">
                                {getPlatformLabel(conversation.platform)}
                              </div>
                            )}
                          </div>
                          <ArrowRight
                            strokeWidth={1.5}
                            className="h-4 w-4 shrink-0 text-text-tertiary"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <GraphLegend edgeLabel={labels.edgeSemanticSimilarity} />
        </div>
      </div>
    );
  }

  if (dataset.data.nodes.length === 0) {
    return (
      <div className="h-full overflow-y-auto bg-bg-tertiary">
        <div className="flex min-h-full w-full flex-col justify-center gap-3 px-6 py-8 md:px-8">
          {viewToggle}
          <div className="max-w-sm">
            <p className="text-sm font-medium text-text-primary">
              {labels.emptyTitle ?? "Your temporal network will appear here."}
            </p>
            <p className="mt-2 text-sm font-sans text-text-secondary">
              {labels.emptyDesc ?? "Capture a few conversations first, then reopen Network to watch the graph evolve over time."}
            </p>
          </div>
          <GraphLegend edgeLabel={labels.edgeSemanticSimilarity} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-bg-tertiary">
      <div className="flex min-h-full w-full flex-col justify-center gap-4 px-6 py-8 md:px-8">
        {viewToggle}
        <div className="relative h-[420px] bg-bg-tertiary">
          {edgeStatus === "loading" && (
            <div className="pointer-events-none absolute left-0 top-0 z-10 rounded-full bg-bg-primary/85 px-2.5 py-1 text-[11px] font-sans text-text-tertiary backdrop-blur-sm">
              {labels.buildingGraph ?? "Building graph..."}
            </div>
          )}
          <TemporalGraph
            data={dataset.data}
            currentDay={currentDay}
            height={GRAPH_HEIGHT}
            themeMode={themeMode}
            scrubbing={scrubbing}
            resetToken={graphResetToken}
            selectedNodeId={selectedNodeId}
            highlightedNodeIds={highlightedNodeIds}
            onNodeClick={handleNodeFocus}
            onBackgroundClick={handleCloseDrawer}
          />
        </div>

        <div className="text-[11px] font-sans text-text-tertiary">
          {labels.trendLabel ?? "Trend · daily new conversations"}
        </div>

        <TimeBar
          totalDays={totalDays}
          dayCounts={dataset.dayCounts}
          currentDay={currentDay}
          themeMode={themeMode}
          onChange={handleScrubChange}
          onScrubStart={handleScrubStart}
          onScrubEnd={handleScrubEnd}
          ariaLabel={labels.trendScrubberAriaLabel}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={handleReplay}
            className="rounded-full border border-border-subtle bg-bg-primary px-3 py-1.5 text-[12px] font-sans text-text-primary transition-colors hover:bg-bg-secondary"
          >
            {labels.replay ?? "Replay"}
          </button>

          <span className="text-[11px] font-sans text-text-tertiary">
            {labels.dragHint ?? "Drag the trend line to pause on a moment."}
          </span>
        </div>

        {edgeMessage && (
          <div className="text-[11px] font-sans text-text-secondary">{edgeMessage}</div>
        )}

        <div className="min-h-[16px] text-[11px] font-sans text-text-tertiary">{infoText}</div>

        <GraphLegend edgeLabel={labels.edgeSemanticSimilarity} />
      </div>

      {selectedGraphNode && selectedConversation && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={handleCloseDrawer}
          />
          <div className="fixed bottom-0 right-0 top-0 z-50 w-[min(24rem,92vw)] overflow-y-auto bg-bg-primary shadow-2xl">
            <div className="p-4">
              <button
                type="button"
                onClick={handleCloseDrawer}
                className="mb-4 flex items-center gap-2 text-sm font-sans text-text-secondary transition-colors hover:text-text-primary"
              >
                <X strokeWidth={1.5} className="h-4 w-4" />
                <span>{labels.close ?? "Close"}</span>
              </button>

              <h2 className="mb-3 text-lg font-serif font-normal text-text-primary">
                {selectedConversation.title || selectedGraphNode.label}
              </h2>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-md px-2 py-0.5 text-[11px] font-sans font-medium leading-none"
                  style={getPlatformBadgeStyle(selectedConversation.platform, themeMode)}
                >
                  {getPlatformLabel(selectedConversation.platform)}
                </span>
                <span className="text-xs font-sans text-text-tertiary">
                  {labels.started ?? "Started"} {formatStartedLabel(getConversationOriginAt(selectedConversation))}
                </span>
                {selectedConversation.topic_id !== null && topicMap.get(selectedConversation.topic_id) && (
                  <span className="text-xs font-sans text-text-tertiary">
                    · {topicMap.get(selectedConversation.topic_id)}
                  </span>
                )}
                {selectedConversation.is_starred && (
                  <span className="text-xs font-sans text-text-tertiary">· {labels.starred ?? "Starred"}</span>
                )}
              </div>

              <div className="mb-6 rounded-lg bg-bg-surface-card p-3">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-sans text-text-secondary">
                  <span>{selectedConversation.message_count ?? 0} {labels.messages ?? "messages"}</span>
                  <span>{connectedNodes.length} {labels.semanticLinks ?? "semantic links"}</span>
                </div>
                <p className="text-xs font-sans text-text-secondary">
                  {selectedConversation.snippet?.trim()
                    ? selectedConversation.snippet
                    : labels.noPreviewSnippet ?? "No preview snippet available for this conversation yet."}
                </p>
              </div>

              {selectedConversation.tags.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-[0.08em] text-text-tertiary">
                    {labels.tags ?? "Tags"}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedConversation.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border-subtle px-2 py-1 text-[11px] font-sans text-text-secondary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-6">
                <h3 className="mb-2 text-xs font-sans font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  {labels.connectedConversations ?? "Connected conversations"}
                </h3>
                {connectedNodes.length === 0 ? (
                  <p className="text-xs font-sans text-text-secondary">
                    {labels.noSemanticLinksForNode ?? "No semantic links for this node yet."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {connectedNodes.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedNodeId(entry.id)}
                        className="flex w-full items-start justify-between gap-3 rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2 text-left transition-colors hover:bg-bg-secondary"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-sans text-text-primary">
                            {entry.conversation?.title || entry.node?.label || (labels.conversationN ?? "Conversation {id}").replace("{id}", String(entry.id))}
                          </div>
                          <div className="mt-1 text-[11px] font-sans text-text-tertiary">
                            {entry.conversation
                              ? getPlatformLabel(entry.conversation.platform)
                              : labels.unknownPlatform ?? "Unknown platform"}
                            {entry.topicName ? ` · ${entry.topicName}` : ""}
                            {entry.node && entry.node.timelineDay > currentDay
                              ? ` · ${labels.appearsLaterInReplay ?? "appears later in replay"}`
                              : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-[11px] font-sans text-text-secondary">
                          {(entry.weight * 100).toFixed(0)}%
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {onSelectConversation && (
                <button
                  type="button"
                  onClick={handleViewInLibrary}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-primary px-4 py-2.5 text-sm font-sans font-medium text-text-inverse transition-all hover:bg-accent-primary/90"
                >
                  <span>{labels.viewInLibrary ?? "View in Library"}</span>
                  <ArrowRight strokeWidth={1.5} className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
