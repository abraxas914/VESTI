
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  CheckSquare,
  ChevronRight,
  Clipboard,
  Download,
  FileText,
  Filter,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { ResizablePanelDivider } from "../components/ResizablePanelDivider";
import { useResizableWidth } from "../hooks/use-resizable-width";
import type {
  Conversation,
  ExploreAgentPlan,
  ExploreAskOptions,
  ExploreContextCandidate,
  ExploreLabels,
  ExploreMessage,
  ExploreMode,
  ExploreSearchScope,
  ExploreSearchScopeMode,
  ExploreSession,
  ExploreToolCall,
  ExploreToolName,
  StorageApi,
  UiThemeMode,
} from "../types";

function rotateArray<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) return items.slice();
  const normalized = ((offset % items.length) + items.length) % items.length;
  if (normalized === 0) return items.slice();
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function getStarterDeck(decks: readonly StarterDeck[], seed: number): StarterDeck {
  return decks[((seed % decks.length) + decks.length) % decks.length];
}

function normalizeStarterSeed(text: string, max = 44): string {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trim()}...`;
}

function extractConversationCue(conversation: Conversation, untitledLabel: string): string {
  const title = normalizeStarterSeed(conversation.title || "");
  const normalizedUntitled = untitledLabel.trim().toLowerCase();
  if (
    title &&
    title.toLowerCase() !== "untitled" &&
    title.toLowerCase() !== normalizedUntitled
  ) {
    return title;
  }

  return normalizeStarterSeed(conversation.snippet || "");
}

function buildLibraryStarterPrompts(
  conversations: Conversation[],
  fallbackPrompts: StarterPromptCard[],
  revision: number,
  labels: ExploreLabels
): StarterPromptCard[] {
  const rotatedConversations = rotateArray(conversations, revision);
  const prompts: StarterPromptCard[] = [];
  const seen = new Set<string>();

  for (const conversation of rotatedConversations) {
    const cue = extractConversationCue(conversation, labels.untitled);
    if (!cue) continue;

    const key = cue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    prompts.push({
      title: labels.libraryStarter.titleTemplate.replace("{cue}", cue),
      prompt: labels.libraryStarter.promptTemplate.replace("{cue}", cue),
      detail: labels.libraryStarter.detail,
    });

    if (prompts.length >= 2) {
      break;
    }
  }

  for (const fallback of fallbackPrompts) {
    prompts.push(fallback);
    if (prompts.length >= 4) {
      break;
    }
  }

  return prompts;
}

type ExploreTabProps = {
  storage: StorageApi;
  themeMode?: UiThemeMode;
  onOpenConversation?: (conversationId: number) => void;
  labels: ExploreLabels;
};

type DrawerTab = "plan" | "tool_calls" | "sources" | "context_draft";
type ContextSaveStatus = "idle" | "saving" | "saved" | "error";
type StarterDeckStatus = "loading" | "ready";

interface StarterPromptCard {
  title: string;
  prompt: string;
  detail: string;
}

interface StarterDeck {
  eyebrow: string;
  title: string;
  description: string;
  privacyTip: string;
  capabilityHint: string;
  prompts: readonly StarterPromptCard[];
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function groupSessionsByTime(sessions: ExploreSession[]): {
  today: ExploreSession[];
  yesterday: ExploreSession[];
  earlier: ExploreSession[];
} {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;

  return sessions.reduce(
    (groups, session) => {
      if (session.updatedAt >= startOfToday) {
        groups.today.push(session);
      } else if (session.updatedAt >= startOfYesterday) {
        groups.yesterday.push(session);
      } else {
        groups.earlier.push(session);
      }
      return groups;
    },
    { today: [], yesterday: [], earlier: [] } as {
      today: ExploreSession[];
      yesterday: ExploreSession[];
      earlier: ExploreSession[];
    }
  );
}

function summarizeToolCalls(toolCalls: ExploreToolCall[], labels: ExploreLabels): string {
  if (!toolCalls.length) return labels.noToolCalls;
  const failed = toolCalls.filter((toolCall) => toolCall.status === "failed").length;
  const totalMs = toolCalls.reduce((sum, toolCall) => sum + (toolCall.durationMs || 0), 0);
  const seconds = (totalMs / 1000).toFixed(1);
  if (failed > 0) {
    return labels.toolCallsSummaryFailed
      .replace("{count}", String(toolCalls.length))
      .replace("{failed}", String(failed))
      .replace("{seconds}", seconds);
  }
  return labels.toolCallsSummary
    .replace("{count}", String(toolCalls.length))
    .replace("{seconds}", seconds);
}

function buildSearchScope(
  mode: ExploreSearchScopeMode,
  conversationIds: number[]
): ExploreSearchScope {
  if (mode === "selected" && conversationIds.length > 0) {
    return {
      mode: "selected",
      conversationIds,
    };
  }

  return { mode: "all" };
}

function getSearchScopeSummary(searchScope: ExploreSearchScope | undefined, labels: ExploreLabels): string {
  if (searchScope?.mode === "selected") {
    const count = searchScope.conversationIds?.length ?? 0;
    return count > 0 ? `${count} ${labels.selected}` : labels.selected;
  }
  return labels.allConversations;
}

function getIntentLabel(plan: ExploreAgentPlan | undefined, labels: ExploreLabels): string {
  if (!plan) return labels.unknown;
  return labels.intentLabels[plan.intent];
}

function getPathLabel(plan: ExploreAgentPlan | undefined, labels: ExploreLabels): string {
  if (!plan) return labels.unknown;
  return labels.pathLabels[plan.preferredPath];
}

function getResolvedTimeScopeLabel(plan?: ExploreAgentPlan): string | null {
  if (plan?.resolvedTimeScope) {
    return `${plan.resolvedTimeScope.label} (${plan.resolvedTimeScope.startDate} to ${plan.resolvedTimeScope.endDate})`;
  }
  if (plan?.requestedTimeScope?.label) {
    return plan.requestedTimeScope.label;
  }
  if (
    plan?.requestedTimeScope?.preset &&
    plan.requestedTimeScope.preset !== "none"
  ) {
    return plan.requestedTimeScope.preset.replace(/_/g, " ");
  }
  return null;
}

function isTimeScopedPlan(plan?: ExploreAgentPlan): boolean {
  return plan?.preferredPath === "weekly_summary";
}

function getSourceBadgeLabel(
  candidateOrSource: Pick<ExploreContextCandidate, "similarity" | "matchType">,
  plan: ExploreAgentPlan | undefined,
  labels: ExploreLabels
): string {
  if (candidateOrSource.matchType === "time_scope" || isTimeScopedPlan(plan)) {
    return labels.inRange;
  }
  return `${candidateOrSource.similarity}%`;
}

function triggerTxtDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExploreTab({
  storage,
  themeMode = "light",
  onOpenConversation,
  labels,
}: ExploreTabProps) {
  const modeStages = labels.modeStages;
  const starterDecks = labels.starterDecks;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mode, setMode] = useState<ExploreMode>("agent");
  const [sessions, setSessions] = useState<ExploreSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ExploreMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const justCreatedSessionRef = useRef<string | null>(null);
  const starterDeckTimerRef = useRef<number | null>(null);

  const [inputValue, setInputValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegeneratingSources, setIsRegeneratingSources] = useState(false);
  const [searchStageIndex, setSearchStageIndex] = useState(0);
  const [submitMode, setSubmitMode] = useState<ExploreMode>("agent");
  const [searchScopeMode, setSearchScopeMode] = useState<ExploreSearchScopeMode>("all");
  const [selectedScopeConversationIds, setSelectedScopeConversationIds] = useState<number[]>([]);
  const [scopeChooserOpen, setScopeChooserOpen] = useState(false);
  const [scopeSearchQuery, setScopeSearchQuery] = useState("");
  const [scopeResults, setScopeResults] = useState<Conversation[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ExploreSession | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [drawerMessageId, setDrawerMessageId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("tool_calls");
  const [contextDraft, setContextDraft] = useState("");
  const [selectedContextConversationIds, setSelectedContextConversationIds] = useState<
    number[]
  >([]);
  const [contextSaveStatus, setContextSaveStatus] = useState<ContextSaveStatus>("idle");
  const [drawerNotice, setDrawerNotice] = useState<string | null>(null);
  const [starterDeckRevision, setStarterDeckRevision] = useState(0);
  const [starterDeckStatus, setStarterDeckStatus] = useState<StarterDeckStatus>("loading");
  const [starterCards, setStarterCards] = useState<StarterPromptCard[]>([]);
  const sidebarPane = useResizableWidth({
    storageKey: "vesti.explore.sidebar-width",
    defaultWidth: 256,
    minWidth: 216,
    maxWidth: 360,
  });
  const drawerPane = useResizableWidth({
    storageKey: "vesti.explore.drawer-width",
    defaultWidth: 390,
    minWidth: 320,
    maxWidth: 520,
    direction: -1,
    getMaxWidth: () => {
      if (typeof window === "undefined") {
        return 520;
      }

      const availableWidth =
        window.innerWidth -
        (sidebarOpen ? sidebarPane.width : 0) -
        360;
      return Math.max(320, availableWidth);
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const groupedSessions = useMemo(() => groupSessionsByTime(sessions), [sessions]);
  const activeSearchScope = useMemo(
    () => buildSearchScope(searchScopeMode, selectedScopeConversationIds),
    [searchScopeMode, selectedScopeConversationIds]
  );
  const currentSession = sessions.find((session) => session.id === currentSessionId);
  const drawerMessage = messages.find((message) => message.id === drawerMessageId) ?? null;
  const drawerPlan = drawerMessage?.agentMeta?.plan;
  const drawerCandidates = drawerMessage?.agentMeta?.contextCandidates ?? [];
  const drawerToolCalls = drawerMessage?.agentMeta?.toolCalls ?? [];
  const starterDeck = useMemo(
    () => getStarterDeck(starterDecks, starterDeckRevision),
    [starterDecks, starterDeckRevision]
  );
  const starterPrompts = useMemo(
    () => rotateArray(starterDeck.prompts, starterDeckRevision),
    [starterDeck.prompts, starterDeckRevision]
  );
  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (currentSessionId) {
      if (justCreatedSessionRef.current === currentSessionId) {
        justCreatedSessionRef.current = null;
        return;
      }
      loadMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (currentSessionId) {
      setStarterDeckStatus("ready");
      return;
    }

    setStarterDeckStatus("loading");
    if (starterDeckTimerRef.current !== null) {
      window.clearTimeout(starterDeckTimerRef.current);
    }
    let cancelled = false;

    const minDelay = new Promise<void>((resolve) => {
      starterDeckTimerRef.current = window.setTimeout(() => {
        starterDeckTimerRef.current = null;
        resolve();
      }, 320);
    });

    void (async () => {
      let nextCards = starterPrompts;
      try {
        const conversations = await storage.getConversations();
        nextCards = buildLibraryStarterPrompts(conversations, starterPrompts, starterDeckRevision, labels);
      } catch {
        nextCards = starterPrompts;
      }

      await minDelay;
      if (cancelled) return;
      setStarterCards(nextCards);
      setStarterDeckStatus("ready");
    })();

    return () => {
      cancelled = true;
      if (starterDeckTimerRef.current !== null) {
        window.clearTimeout(starterDeckTimerRef.current);
        starterDeckTimerRef.current = null;
      }
    };
  }, [currentSessionId, starterDeckRevision, starterPrompts, storage.getConversations, labels]);

  useEffect(() => {
    if (renameTarget && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameTarget]);

  useEffect(() => {
    if (!isSubmitting) {
      setSearchStageIndex(0);
      return;
    }
    const stages = modeStages[submitMode];
    const timer = setInterval(() => {
      setSearchStageIndex((prev) => (prev + 1) % stages.length);
    }, 900);
    return () => clearInterval(timer);
  }, [isSubmitting, submitMode, modeStages]);

  useEffect(() => {
    if (!scopeChooserOpen) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setScopeLoading(true);
        setScopeError(null);
        try {
          const data = await storage.getConversations({
            search: scopeSearchQuery.trim() || undefined,
          });
          if (cancelled) return;
          setScopeResults(data.slice(0, 80));
        } catch (err) {
          if (cancelled) return;
          console.error("[Explore] Failed to load scope conversations:", err);
          setScopeError((err as Error)?.message ?? labels.failedToLoadConversations);
        } finally {
          if (!cancelled) {
            setScopeLoading(false);
          }
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scopeChooserOpen, scopeSearchQuery, storage, labels]);

  const loadSessions = async () => {
    if (!storage.listExploreSessions) return;
    setSessionsLoading(true);
    try {
      const data = await storage.listExploreSessions(50);
      setSessions(data);
    } catch (err) {
      console.error("[Explore] Failed to load sessions:", err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const loadMessages = async (sessionId: string) => {
    if (!storage.getExploreMessages) return;
    setMessagesLoading(true);
    try {
      const data = await storage.getExploreMessages(sessionId);
      setMessages(data || []);
    } catch (err) {
      console.error("[Explore] Failed to load messages:", err);
    } finally {
      setMessagesLoading(false);
    }
  };

  const toggleScopeConversation = (conversationId: number) => {
    setSelectedScopeConversationIds((prev) => {
      if (prev.includes(conversationId)) {
        return prev.filter((id) => id !== conversationId);
      }
      return [...prev, conversationId];
    });
  };

  const applySelectedScope = () => {
    if (selectedScopeConversationIds.length > 0) {
      setSearchScopeMode("selected");
    } else {
      setSearchScopeMode("all");
    }
    setScopeChooserOpen(false);
  };

  const resetSearchScope = () => {
    setSearchScopeMode("all");
    setSelectedScopeConversationIds([]);
    setScopeChooserOpen(false);
  };

  const getAssistantQuery = (message: ExploreMessage): string => {
    const agentQuery = message.agentMeta?.query?.trim();
    if (agentQuery) {
      return agentQuery;
    }

    const index = messages.findIndex((item) => item.id === message.id);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor];
      if (candidate.role === "user" && candidate.content.trim()) {
        return candidate.content.trim();
      }
    }

    return "";
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setInputValue("");
    setError(null);
    setDrawerMessageId(null);
    setDrawerNotice(null);
    setStarterDeckRevision((prev) => prev + 1);
    setStarterDeckStatus("loading");
  };

  const openDrawer = (message: ExploreMessage, tab: DrawerTab) => {
    setDrawerMessageId(message.id);
    setDrawerTab(tab);
    setDrawerNotice(null);
    setContextSaveStatus("idle");
    const nextDraft = message.agentMeta?.contextDraft ?? "";
    const candidates = message.agentMeta?.contextCandidates ?? [];
    const selectedFromMessage = message.agentMeta?.selectedContextConversationIds ?? [];
    const selected =
      selectedFromMessage.length > 0
        ? selectedFromMessage
        : candidates.map((candidate) => candidate.conversationId);
    setContextDraft(nextDraft);
    setSelectedContextConversationIds(selected);
  };

  const handleSubmit = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSubmitting) return;

    if (!storage.askKnowledgeBase) {
      setError(labels.exploreUnavailable);
      return;
    }

    if (searchScopeMode === "selected" && selectedScopeConversationIds.length === 0) {
      setError(labels.chooseAtLeastOne);
      setScopeChooserOpen(true);
      return;
    }

    setSubmitMode(mode);
    setIsSubmitting(true);
    setError(null);
    const requestOptions: ExploreAskOptions = {
      searchScope: activeSearchScope,
    };
    const requestLimit =
      activeSearchScope.mode === "selected"
        ? Math.max(5, activeSearchScope.conversationIds?.length ?? 0)
        : 5;

    const optimisticUserMessage: ExploreMessage = {
      id: generateId(),
      sessionId: currentSessionId || "temp",
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, optimisticUserMessage]);
    setInputValue("");

    try {
      const result = await storage.askKnowledgeBase(
        trimmed,
        currentSessionId || undefined,
        requestLimit,
        mode,
        requestOptions
      );

      if (!currentSessionId) {
        justCreatedSessionRef.current = result.sessionId;
        setCurrentSessionId(result.sessionId);
      }

      const aiMessage: ExploreMessage = {
        id: generateId(),
        sessionId: result.sessionId,
        role: "assistant",
        content: result.answer,
        sources: result.sources,
        agentMeta: result.agent,
        timestamp: Date.now(),
      };

      if (!currentSessionId) {
        setMessages([optimisticUserMessage, aiMessage]);
      } else {
        setMessages((prev) => [...prev, aiMessage]);
      }

      await loadSessions();
    } catch (err) {
      console.error("[Explore] Submit error:", err);
      setError((err as Error)?.message ?? labels.failedToRetrieveAnswer);
      setMessages((prev) => prev.filter((message) => message.id !== optimisticUserMessage.id));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!storage.deleteExploreSession) return;
    if (!confirm(labels.deleteConversationConfirm)) return;

    try {
      await storage.deleteExploreSession(sessionId);
      if (currentSessionId === sessionId) {
        handleNewChat();
      }
      await loadSessions();
    } catch (err) {
      console.error("[Explore] Failed to delete session:", err);
    }
  };

  const handleStartRename = (session: ExploreSession, event: React.MouseEvent) => {
    event.stopPropagation();
    setRenameTarget(session);
    setRenameValue(session.title);
  };

  const handleSubmitRename = async () => {
    if (!renameTarget || !storage.renameExploreSession) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameTarget.title) {
      setRenameTarget(null);
      return;
    }

    try {
      await storage.renameExploreSession(renameTarget.id, trimmed);
      await loadSessions();
      setRenameTarget(null);
    } catch (err) {
      console.error("[Explore] Failed to rename session:", err);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const toggleContextSelection = (conversationId: number) => {
    setSelectedContextConversationIds((prev) => {
      if (prev.includes(conversationId)) {
        return prev.filter((id) => id !== conversationId);
      }
      return [...prev, conversationId];
    });
  };

  const handleSaveContextDraft = async () => {
    if (!drawerMessage) return;
    const agentMeta = drawerMessage.agentMeta;
    if (!agentMeta) return;

    const normalizedIds = selectedContextConversationIds.filter((id) =>
      drawerCandidates.some((candidate) => candidate.conversationId === id)
    );

    setContextSaveStatus("saving");
    setDrawerNotice(null);
    try {
      if (storage.updateExploreMessageContext) {
        await storage.updateExploreMessageContext(
          drawerMessage.id,
          contextDraft,
          normalizedIds
        );
      }

      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== drawerMessage.id) return message;
          return {
            ...message,
            agentMeta: {
              ...agentMeta,
              contextDraft,
              selectedContextConversationIds: normalizedIds,
            },
          };
        })
      );

      setContextSaveStatus("saved");
      setDrawerNotice(
        storage.updateExploreMessageContext
          ? labels.contextDraftSaved
          : labels.savedLocally
      );
    } catch (err) {
      console.error("[Explore] Failed to save context draft:", err);
      setContextSaveStatus("error");
      setDrawerNotice((err as Error)?.message ?? labels.failedToSaveContext);
    }
  };

  const handleCopyContextDraft = async () => {
    if (!contextDraft.trim()) return;
    try {
      await navigator.clipboard.writeText(contextDraft);
      setDrawerNotice(labels.copiedToClipboard);
    } catch {
      setDrawerNotice(labels.clipboardUnavailable);
    }
  };

  const handleDownloadContextDraft = () => {
    if (!contextDraft.trim()) return;
    const filename = `explore-context-${Date.now()}.txt`;
    triggerTxtDownload(contextDraft, filename);
    setDrawerNotice(labels.downloaded.replace("{filename}", filename));
  };

  const handleStartChatWithContext = () => {
    handleNewChat();
    setInputValue(contextDraft);
    setDrawerNotice(null);
    textareaRef.current?.focus();
  };

  const handleRegenerateWithSelectedSources = async () => {
    if (!drawerMessage || !currentSessionId || !storage.askKnowledgeBase) return;

    const normalizedIds = selectedContextConversationIds.filter((id) =>
      drawerCandidates.some((candidate) => candidate.conversationId === id)
    );

    if (normalizedIds.length === 0) {
      setDrawerNotice(labels.selectAtLeastOneSource);
      return;
    }

    const query = getAssistantQuery(drawerMessage);
    if (!query) {
      setDrawerNotice(labels.couldNotDetermineQuery);
      return;
    }

    setIsRegeneratingSources(true);
    setDrawerNotice(null);

    try {
      if (storage.updateExploreMessageContext) {
        await storage.updateExploreMessageContext(
          drawerMessage.id,
          contextDraft,
          normalizedIds
        );
      }

      await storage.askKnowledgeBase(
        query,
        currentSessionId,
        Math.max(normalizedIds.length, 1),
        "agent",
        {
          searchScope: {
            mode: "selected",
            conversationIds: normalizedIds,
          },
        }
      );

      setDrawerMessageId(null);
      await loadMessages(currentSessionId);
      await loadSessions();
      setDrawerNotice(
        labels.regeneratedNotice.replace("{count}", String(normalizedIds.length))
      );
    } catch (err) {
      console.error("[Explore] Failed to regenerate from selected sources:", err);
      setDrawerNotice((err as Error)?.message ?? labels.failedToRegenerate);
    } finally {
      setIsRegeneratingSources(false);
    }
  };

  const renderSessionItem = (session: ExploreSession) => {
    const isActive = session.id === currentSessionId;
    const isRenaming = renameTarget?.id === session.id;

    return (
      <div
        key={session.id}
        onClick={() => setCurrentSessionId(session.id)}
        className={`group relative flex items-center gap-2 rounded-lg px-3 py-2 transition-all ${
          isActive ? "bg-bg-surface-card-active" : "cursor-pointer hover:bg-bg-surface-card"
        }`}
      >
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSubmitRename();
                  if (event.key === "Escape") setRenameTarget(null);
                }}
                onBlur={handleSubmitRename}
                className="flex-1 rounded border border-border-default bg-bg-primary px-2 py-1 text-sm font-sans text-text-primary focus:border-accent-primary focus:outline-none"
              />
            </div>
          ) : (
            <>
              <p className="truncate text-sm font-sans text-text-primary">{session.title || labels.untitledSession}</p>
              <p className="truncate text-xs font-sans text-text-tertiary">
                {session.preview || labels.noMessages}
              </p>
            </>
          )}
        </div>

        {!isRenaming && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(event) => handleStartRename(session, event)}
              className="rounded p-1 text-text-tertiary hover:bg-bg-surface-card hover:text-text-primary"
              title={labels.rename}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={(event) => handleDeleteSession(session.id, event)}
              className="rounded p-1 text-text-tertiary hover:bg-bg-surface-card hover:text-[#B42318]"
              title={labels.delete}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderToolCallItem = (toolCall: ExploreToolCall, index: number) => {
    const statusTone =
      toolCall.status === "failed"
        ? "text-danger"
        : toolCall.status === "completed"
          ? "text-success"
          : "text-text-tertiary";
    const description = toolCall.description || labels.toolExplanations[toolCall.name];

    return (
      <div key={toolCall.id} className="rounded-lg border border-border-subtle bg-bg-surface-card p-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[13px] font-medium text-text-primary">
            {index + 1}. {labels.toolLabels[toolCall.name]}
          </p>
          <span className={`text-[11px] font-sans uppercase ${statusTone}`}>
            {toolCall.status === "completed"
              ? labels.toolStatus.completed
              : toolCall.status === "failed"
                ? labels.toolStatus.failed
                : toolCall.status}
          </span>
        </div>
        <p className="mb-2 text-[11px] font-sans text-text-tertiary">
          {(toolCall.durationMs / 1000).toFixed(2)}s
        </p>
        {description && (
          <p className="mb-2 text-xs font-sans text-text-secondary">{description}</p>
        )}
        {toolCall.inputSummary && (
          <p className="mb-1 text-xs font-sans text-text-secondary">
            <span className="font-medium text-text-primary">{labels.inputLabel}</span> {toolCall.inputSummary}
          </p>
        )}
        {toolCall.outputSummary && (
          <p className="text-xs font-sans text-text-secondary">
            <span className="font-medium text-text-primary">{labels.outputLabel}</span> {toolCall.outputSummary}
          </p>
        )}
        {toolCall.error && (
          <p className="mt-1 text-xs font-sans text-danger">
            <span className="font-medium">{labels.errorLabel}</span> {toolCall.error}
          </p>
        )}
      </div>
    );
  };

  const renderMessage = useCallback(
    (message: ExploreMessage) => {
      const isUser = message.role === "user";
      const html = isUser
        ? null
        : DOMPurify.sanitize(marked.parse(message.content, { gfm: true, breaks: false }) as string);

      const hasSources = message.sources && message.sources.length > 0;
      const toolCalls = message.agentMeta?.toolCalls ?? [];
      const hasToolCalls = message.agentMeta?.mode === "agent" && toolCalls.length > 0;
      const scopeSummary = getSearchScopeSummary(message.agentMeta?.searchScope, labels);
      const plan = message.agentMeta?.plan;
      const timeScopeLabel = getResolvedTimeScopeLabel(plan);

      return (
        <div key={message.id} className={`py-4 ${isUser ? "bg-bg-tertiary/50" : ""}`}>
          <div className="mx-auto max-w-3xl px-4">
            <div className="flex gap-4">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                  isUser
                    ? "bg-accent-primary text-text-inverse"
                    : "border border-border-subtle bg-bg-surface-card"
                }`}
              >
                {isUser ? (
                  <span className="text-sm font-sans font-medium">U</span>
                ) : (
                  <span className="text-sm">V</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs font-sans text-text-tertiary">{isUser ? labels.you : labels.assistantName}</p>

                {isUser ? (
                  <p className="whitespace-pre-wrap text-base font-sans text-text-primary">
                    {message.content}
                  </p>
                ) : (
                  <div
                    className="prose prose-slate dark:prose-invert max-w-none prose-headings:text-text-primary prose-p:leading-relaxed prose-p:text-text-primary prose-li:leading-relaxed prose-li:text-text-primary prose-strong:text-text-primary prose-em:text-text-primary prose-code:text-text-primary prose-a:text-accent-primary prose-blockquote:text-text-secondary"
                    dangerouslySetInnerHTML={{ __html: html || "" }}
                  />
                )}

                {!isUser && hasToolCalls && (
                  <div className="mt-3 rounded-lg border border-border-subtle bg-bg-surface-card px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {plan && (
                          <button
                            onClick={() => openDrawer(message, "plan")}
                            className="inline-flex items-center gap-1.5 text-xs font-sans text-text-secondary hover:text-text-primary"
                          >
                            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                            {labels.plan}
                          </button>
                        )}
                        <button
                          onClick={() => openDrawer(message, "tool_calls")}
                          className="inline-flex items-center gap-1.5 text-xs font-sans text-text-secondary hover:text-text-primary"
                        >
                          <Wrench className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {labels.toolCalls}
                        </button>
                      </div>
                      <p className="text-xs font-sans text-text-tertiary">
                        {summarizeToolCalls(toolCalls, labels)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {plan && (
                        <>
                          <p className="text-[11px] font-sans text-text-tertiary">
                            {labels.intentPrefix} {getIntentLabel(plan, labels)}
                          </p>
                          <p className="text-[11px] font-sans text-text-tertiary">
                            {labels.routePrefix} {getPathLabel(plan, labels)}
                          </p>
                        </>
                      )}
                      {timeScopeLabel && (
                        <p className="text-[11px] font-sans text-text-tertiary">
                          {labels.timePrefix} {timeScopeLabel}
                        </p>
                      )}
                      <p className="text-[11px] font-sans text-text-tertiary">
                        {labels.scopePrefix} {scopeSummary}
                      </p>
                      <button
                        onClick={() => openDrawer(message, "sources")}
                        className="inline-flex items-center gap-1.5 text-xs font-sans text-text-secondary hover:text-text-primary"
                      >
                        <Filter className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {labels.sourceControls}
                      </button>
                    </div>
                    {message.agentMeta?.contextDraft && (
                      <button
                        onClick={() => openDrawer(message, "context_draft")}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-sans text-accent-primary hover:text-accent-primary/80"
                      >
                        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {labels.openContextDraft}
                      </button>
                    )}
                  </div>
                )}

                {!isUser && (
                  <div className="mt-4 border-t border-border-subtle pt-4">
                    <p className="mb-2 text-[11px] font-sans uppercase tracking-wider text-text-tertiary">
                      {labels.sources}
                    </p>
                    {hasSources ? (
                      <div className="flex flex-wrap gap-2">
                        {message.sources!.map((source) => (
                          <button
                            key={source.id}
                            onClick={() => onOpenConversation?.(source.id)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-bg-surface-card px-2.5 py-1 text-xs font-sans text-text-secondary transition-colors hover:bg-bg-surface-card-hover"
                          >
                            <span className="max-w-[120px] truncate">{source.title}</span>
                            <span className="text-accent-primary">
                              {getSourceBadgeLabel(source, plan, labels)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-sans italic text-text-tertiary">
                        {labels.noRelevantConversations}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    },
    [onOpenConversation, labels]
  );

  const renderEmptyState = () => {
    const loadingStarterDeck = starterDeckStatus === "loading";
    const visibleStarterCards = starterCards.length > 0 ? starterCards : starterPrompts;
    const cardCount = loadingStarterDeck ? 4 : visibleStarterCards.length;

    return (
      <div className="flex flex-1 items-start px-4 py-6 md:px-6 md:py-8">
        <div className="w-full space-y-4">
          <section className="relative overflow-hidden rounded-[28px] border border-border-subtle bg-bg-tertiary shadow-[0_18px_70px_rgba(0,0,0,0.08)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.16),transparent_24%)]" />
            <div className="relative p-5 md:p-8">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 lg:pr-10">
                  <p className="text-[10px] font-sans uppercase tracking-[0.4em] text-text-tertiary">
                    {starterDeck.eyebrow}
                  </p>
                  <h1 className="mt-3 text-3xl font-[family-name:var(--font-lora)] font-normal leading-tight text-text-primary md:text-[40px]">
                    {starterDeck.title}
                  </h1>
                  <p className="mt-3 max-w-[920px] text-sm leading-6 text-text-secondary md:text-[15px]">
                    {starterDeck.description}
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 justify-self-start rounded-full border border-border-subtle bg-bg-primary/80 px-3 py-1.5 text-xs font-sans text-text-secondary shadow-sm backdrop-blur lg:justify-self-end">
                  {loadingStarterDeck ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-primary" />
                  ) : (
                    <span className="h-2.5 w-2.5 rounded-full bg-accent-primary" />
                  )}
                  <span>{loadingStarterDeck ? (labels.loadingStarterIdeas ?? "Loading starter ideas") : (labels.starterDeckReady ?? "Starter deck ready")}</span>
                </div>
              </div>

              <div className="mt-6">
                <div className="rounded-[24px] border border-border-subtle bg-bg-primary/90 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.05)] backdrop-blur">
                  <div className="relative overflow-hidden rounded-[22px] border border-border-default bg-bg-primary">
                    <textarea
                      ref={textareaRef}
                      value={inputValue}
                      onChange={(event) => setInputValue(event.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={labels.askPlaceholder ?? "Ask your knowledge base, summarize a week, or trace a decision trail..."}
                      rows={5}
                      className="min-h-[168px] w-full resize-none bg-transparent px-5 py-5 pr-24 text-base font-sans text-text-primary placeholder:text-text-tertiary focus:outline-none"
                    />
                    <div className="absolute bottom-4 right-4">
                      <button
                        onClick={handleSubmit}
                        disabled={!inputValue.trim() || isSubmitting}
                        className="inline-flex items-center gap-1.5 rounded-full bg-accent-primary px-4 py-2 text-xs font-sans font-medium text-text-inverse transition-colors hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSubmitting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {labels.send ?? "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <p className="text-xs font-sans uppercase tracking-wider text-text-tertiary">
                  {labels.starterPrompts ?? "Starter prompts"}
                </p>
                <p className="mt-1 text-sm font-sans text-text-secondary">
                  {labels.choosePromptHint ?? "Choose one to populate the composer, then edit it before sending."}
                </p>
              </div>
              <p className="text-xs font-sans text-text-tertiary">
                {loadingStarterDeck ? (labels.refreshingSuggestions ?? "Refreshing suggestions...") : (labels.cardsUpdateHint ?? "Cards update on every new chat.")}
              </p>
            </div>

            {loadingStarterDeck ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: cardCount }).map((_, index) => (
                  <div
                    key={`starter-skeleton-${index}`}
                    className="h-full rounded-[24px] border border-border-subtle bg-bg-surface-card p-4"
                  >
                    <div className="h-9 w-9 animate-pulse rounded-xl bg-bg-secondary" />
                    <div className="mt-5 h-5 w-4/5 animate-pulse rounded-full bg-bg-secondary" />
                    <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-bg-secondary" />
                    <div className="mt-2 h-4 w-11/12 animate-pulse rounded-full bg-bg-secondary" />
                    <div className="mt-4 h-3 w-2/3 animate-pulse rounded-full bg-bg-secondary" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {visibleStarterCards.map((card, index) => (
                  <button
                    key={`${card.title}-${index}`}
                    type="button"
                    onClick={() => {
                      setInputValue(card.prompt);
                      setError(null);
                      textareaRef.current?.focus();
                    }}
                    className="group flex h-full flex-col rounded-[24px] border border-border-subtle bg-bg-surface-card p-4 text-left font-sans shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-primary/30 hover:bg-bg-surface-card-hover hover:shadow-[0_18px_34px_rgba(15,23,42,0.12)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <span className="text-[11px] font-sans uppercase tracking-wider text-text-tertiary">
                        {labels.fillComposer}
                      </span>
                    </div>
                    <p className="mt-5 text-[15px] font-sans font-medium text-text-primary">{card.title}</p>
                    <p className="mt-2 text-sm font-sans leading-6 text-text-secondary">{card.detail}</p>
                    <p className="mt-4 text-xs font-sans text-text-tertiary">{card.prompt}</p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex h-full">
      {sidebarOpen ? (
        <>
          <div
            className="shrink-0 bg-bg-tertiary"
            style={{ width: `${sidebarPane.width}px` }}
          >
            <div className="flex h-full flex-col">
              <div className="border-b border-border-subtle p-3">
                <button
                  onClick={handleNewChat}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                    themeMode === "dark"
                      ? "bg-bg-secondary text-text-primary hover:bg-bg-surface-card-hover"
                      : "bg-accent-primary text-text-inverse hover:bg-accent-primary/90"
                  }`}
                >
                  <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
                  <span className="text-sm font-sans font-medium">{labels.newChat ?? "New Chat"}</span>
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-2">
                {sessionsLoading ? (
                  <div className="py-4 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent-primary" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="py-4 text-center text-xs font-sans text-text-tertiary">
                    {labels.noConversationsYet ?? "No conversations yet"}
                  </div>
                ) : (
                  <>
                    {groupedSessions.today.length > 0 && (
                      <div>
                        <p className="px-3 py-1 text-[10px] font-sans uppercase tracking-wider text-text-tertiary">
                          {labels.today ?? "Today"}
                        </p>
                        <div className="space-y-0.5">{groupedSessions.today.map(renderSessionItem)}</div>
                      </div>
                    )}
                    {groupedSessions.yesterday.length > 0 && (
                      <div>
                        <p className="px-3 py-1 text-[10px] font-sans uppercase tracking-wider text-text-tertiary">
                          {labels.yesterday ?? "Yesterday"}
                        </p>
                        <div className="space-y-0.5">
                          {groupedSessions.yesterday.map(renderSessionItem)}
                        </div>
                      </div>
                    )}
                    {groupedSessions.earlier.length > 0 && (
                      <div>
                        <p className="px-3 py-1 text-[10px] font-sans uppercase tracking-wider text-text-tertiary">
                          {labels.earlier ?? "Earlier"}
                        </p>
                        <div className="space-y-0.5">{groupedSessions.earlier.map(renderSessionItem)}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <ResizablePanelDivider
            ariaLabel={labels.resizeSidebarAria}
            onPointerDown={sidebarPane.handlePointerDown}
            onNudge={sidebarPane.nudgeWidth}
            isDragging={sidebarPane.isDragging}
          />
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col bg-bg-primary">
        <div className="flex h-12 items-center justify-between border-b border-border-subtle px-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-bg-surface-card hover:text-text-primary"
              title={sidebarOpen ? labels.closeSidebar : labels.openSidebar}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
              )}
            </button>
            {currentSession && (
              <h2 className="max-w-[200px] truncate text-sm font-sans text-text-primary">
                {currentSession.title}
              </h2>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border-subtle bg-bg-surface-card p-0.5">
              <button
                onClick={() => setMode("agent")}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  mode === "agent"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.agent}
              </button>
              <button
                onClick={() => setMode("classic")}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  mode === "classic"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.classic}
              </button>
            </div>
            <div className="inline-flex rounded-md border border-border-subtle bg-bg-surface-card p-0.5">
              <button
                onClick={() => setSearchScopeMode("all")}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  activeSearchScope.mode === "all"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.all}
              </button>
              <button
                onClick={() => {
                  if (selectedScopeConversationIds.length === 0) {
                    setScopeChooserOpen(true);
                  } else {
                    setSearchScopeMode("selected");
                  }
                }}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  activeSearchScope.mode === "selected"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.selected}
              </button>
            </div>
            <button
              onClick={() => setScopeChooserOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-surface-card px-3 py-1.5 text-xs font-sans text-text-secondary transition-colors hover:bg-bg-surface-card-hover hover:text-text-primary"
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.7} />
              {getSearchScopeSummary(activeSearchScope, labels)}
            </button>
            {currentSessionId && (
              <button
                onClick={handleNewChat}
                className="rounded-lg bg-bg-surface-card px-3 py-1.5 text-sm font-sans text-text-primary transition-colors hover:bg-bg-surface-card-hover"
              >
                {labels.newChat}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !currentSessionId ? (
            renderEmptyState()
          ) : messagesLoading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent-primary" />
            </div>
          ) : (
            <>
              {messages.map(renderMessage)}

              {isSubmitting && (
                <div className="py-4">
                  <div className="mx-auto max-w-3xl px-4">
                    <div className="flex gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle bg-bg-surface-card">
                        <span className="text-sm">V</span>
                      </div>
                      <div className="flex-1">
                        <p className="mb-1 text-xs font-sans text-text-tertiary">{labels.assistantName}</p>
                        <div className="flex items-center gap-2 text-text-primary">
                          <Loader2 className="h-4 w-4 animate-spin text-accent-primary" />
                          <span className="text-sm font-sans">
                            {modeStages[submitMode][searchStageIndex]}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="py-4">
                  <div className="mx-auto max-w-3xl px-4">
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-sans text-red-700">{error}</p>
                      <button
                        onClick={() => setError(null)}
                        className="mt-2 text-xs font-sans text-red-600 hover:text-red-800"
                      >
                        {labels.dismiss}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>
        {!(messages.length === 0 && !currentSessionId) && (
          <div className="border-t border-border-subtle p-4">
            <div className="mx-auto max-w-3xl">
              <div className="relative flex items-end gap-2 rounded-lg border border-border-default bg-bg-primary transition-all focus-within:border-accent-primary focus-within:ring-2 focus-within:ring-accent-primary/20">
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    mode === "agent"
                      ? (labels.askAgentPlaceholder ?? "Ask your knowledge base (Agent mode)...")
                      : (labels.askClassicPlaceholder ?? "Ask your knowledge base (Classic mode)...")
                  }
                  rows={1}
                  className="max-h-32 flex-1 resize-none bg-transparent px-4 py-3 text-base font-sans text-text-primary placeholder:text-text-tertiary focus:outline-none"
                  style={{ minHeight: "48px" }}
                />
                <div className="p-2">
                  <button
                    onClick={handleSubmit}
                    disabled={!inputValue.trim() || isSubmitting}
                    className="rounded-md bg-accent-primary p-2 text-text-inverse transition-all hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              </div>
              <div className="mt-2 text-center text-xs font-sans text-text-tertiary">
                <p>
                  {mode === "agent"
                    ? (labels.agentModeDesc ?? "Agent mode shows the planner route, tool calls, source controls, and editable context drafts.")
                    : (labels.classicModeDesc ?? "Classic mode searches your history and returns concise source-grounded answers.")}
                </p>
                <p className="mt-1">
                  {labels.currentScopePrefix} {getSearchScopeSummary(activeSearchScope, labels)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {drawerMessage ? (
        <>
          <ResizablePanelDivider
            ariaLabel={labels.resizeDrawerAria}
            onPointerDown={drawerPane.handlePointerDown}
            onNudge={(delta) => drawerPane.nudgeWidth(-delta)}
            isDragging={drawerPane.isDragging}
          />
          <aside
            className="z-20 flex shrink-0 flex-col bg-bg-primary"
            style={{ width: `${drawerPane.width}px` }}
          >
          <div className="flex h-12 items-center justify-between border-b border-border-subtle px-3">
            <div className="flex min-w-0 items-center gap-2">
              <Wrench className="h-4 w-4 text-text-secondary" strokeWidth={1.7} />
              <p className="truncate text-sm font-sans text-text-primary">{labels.executionDetails}</p>
            </div>
            <button
              onClick={() => setDrawerMessageId(null)}
              className="rounded-md p-1 text-text-tertiary hover:bg-bg-surface-card hover:text-text-primary"
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          <div className="border-b border-border-subtle px-3 py-2">
            <div className="inline-flex rounded-md border border-border-subtle bg-bg-surface-card p-0.5">
              <button
                onClick={() => setDrawerTab("plan")}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  drawerTab === "plan"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.plan}
              </button>
              <button
                onClick={() => setDrawerTab("tool_calls")}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  drawerTab === "tool_calls"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.toolCalls}
              </button>
              <button
                onClick={() => setDrawerTab("sources")}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  drawerTab === "sources"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.sources}
              </button>
              <button
                onClick={() => setDrawerTab("context_draft")}
                className={`rounded px-2.5 py-1 text-xs font-sans transition-colors ${
                  drawerTab === "context_draft"
                    ? "bg-accent-primary text-text-inverse"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {labels.contextDraft}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {drawerTab === "plan" ? (
              <div className="space-y-4">
                {drawerPlan ? (
                  <>
                    <div className="rounded-lg border border-border-subtle bg-bg-surface-card p-3">
                      <p className="mb-1 text-xs font-sans uppercase tracking-wider text-text-tertiary">
                        {labels.plannerDecision}
                      </p>
                      <div className="space-y-1.5 text-sm font-sans text-text-primary">
                        <p>{labels.intentPrefix} {getIntentLabel(drawerPlan, labels)}</p>
                        <p>{labels.routePrefix} {getPathLabel(drawerPlan, labels)}</p>
                        <p>{labels.sourceLimitPrefix} {drawerPlan.sourceLimit}</p>
                        <p>{labels.summaryTargetPrefix} {drawerPlan.summaryTargetCount}</p>
                        {getResolvedTimeScopeLabel(drawerPlan) && (
                          <p>{labels.timeScopePrefix} {getResolvedTimeScopeLabel(drawerPlan)}</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border-subtle bg-bg-surface-card p-3">
                      <p className="mb-1 text-xs font-sans uppercase tracking-wider text-text-tertiary">
                        {labels.whyThisRoute}
                      </p>
                      <p className="text-sm font-sans text-text-primary">
                        {drawerPlan.reason}
                      </p>
                      {drawerPlan.answerGoal && (
                        <p className="mt-2 text-xs font-sans text-text-secondary">
                          {labels.goalPrefix} {drawerPlan.answerGoal}
                        </p>
                      )}
                      {drawerPlan.clarifyingQuestion && (
                        <p className="mt-2 text-xs font-sans text-text-secondary">
                          {labels.clarificationPrefix} {drawerPlan.clarifyingQuestion}
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border border-border-subtle bg-bg-surface-card p-3">
                      <p className="mb-2 text-xs font-sans uppercase tracking-wider text-text-tertiary">
                        {labels.plannedTools}
                      </p>
                      <div className="space-y-2">
                        {(drawerPlan.toolPlan ?? []).map((toolName, index) => (
                          <div key={`${toolName}-${index}`} className="rounded-md bg-bg-primary p-2">
                            <p className="text-sm font-sans text-text-primary">
                              {index + 1}. {labels.toolLabels[toolName]}
                            </p>
                            <p className="mt-1 text-xs font-sans text-text-secondary">
                              {labels.toolExplanations[toolName]}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <p className="text-[11px] font-sans text-text-tertiary">
                      {labels.plannerFootnote}
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-sans text-text-tertiary">
                    {labels.noPlannerMetadata}
                  </p>
                )}
              </div>
            ) : drawerTab === "tool_calls" ? (
              <div className="space-y-3">
                {drawerToolCalls.length > 0 ? (
                  drawerToolCalls.map(renderToolCallItem)
                ) : (
                  <p className="text-sm font-sans text-text-tertiary">
                    {labels.noToolCallsRecorded}
                  </p>
                )}
              </div>
            ) : drawerTab === "sources" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-border-subtle bg-bg-surface-card p-3">
                  <p className="mb-1 text-xs font-sans uppercase tracking-wider text-text-tertiary">
                    {labels.activeQuery}
                  </p>
                  <p className="text-sm font-sans text-text-primary">
                    {getAssistantQuery(drawerMessage) || labels.unavailable}
                  </p>
                  <p className="mt-2 text-xs font-sans text-text-tertiary">
                    {labels.scopePrefix} {getSearchScopeSummary(drawerMessage.agentMeta?.searchScope, labels)}
                  </p>
                  {getResolvedTimeScopeLabel(drawerPlan) && (
                    <p className="mt-1 text-xs font-sans text-text-tertiary">
                      {labels.timeScopePrefix} {getResolvedTimeScopeLabel(drawerPlan)}
                    </p>
                  )}
                  <p className="mt-1 text-xs font-sans text-text-tertiary">
                    {labels.selectedSourcesPrefix} {selectedContextConversationIds.length} / {drawerCandidates.length}
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-sans uppercase tracking-wider text-text-tertiary">
                    {labels.candidateSources}
                  </p>
                  {drawerCandidates.length > 0 ? (
                    <div className="space-y-2">
                      {drawerCandidates.map((candidate) => {
                        const selected = selectedContextConversationIds.includes(
                          candidate.conversationId
                        );
                        return (
                          <div
                            key={candidate.conversationId}
                            className="rounded-lg border border-border-subtle bg-bg-surface-card p-2.5"
                          >
                            <div className="mb-1 flex items-start justify-between gap-2">
                              <button
                                onClick={() => toggleContextSelection(candidate.conversationId)}
                                className="inline-flex items-center gap-1.5 text-left text-xs font-sans text-text-secondary hover:text-text-primary"
                              >
                                {selected ? (
                                  <CheckSquare className="h-3.5 w-3.5 text-accent-primary" />
                                ) : (
                                  <Square className="h-3.5 w-3.5" />
                                )}
                                <span className="line-clamp-2">{candidate.title}</span>
                              </button>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-sans text-accent-primary">
                                  {getSourceBadgeLabel(candidate, drawerPlan, labels)}
                                </span>
                                <button
                                  onClick={() => onOpenConversation?.(candidate.conversationId)}
                                  className="text-[11px] font-sans text-text-secondary hover:text-text-primary"
                                >
                                  {labels.open}
                                </button>
                              </div>
                            </div>
                            {candidate.summarySnippet && (
                              <p className="mb-1 text-xs font-sans text-text-secondary">
                                {candidate.summarySnippet}
                              </p>
                            )}
                            {candidate.selectionReason && (
                              <p className="mb-1 text-[11px] font-sans text-text-tertiary">
                                {candidate.selectionReason}
                              </p>
                            )}
                            {candidate.excerpt && (
                              <p className="text-[11px] font-sans text-text-tertiary">
                                {candidate.excerpt}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm font-sans text-text-tertiary">
                      {labels.noContextCandidates}
                    </p>
                  )}
                </div>

                {drawerNotice && (
                  <p
                    className={`text-xs font-sans ${
                      contextSaveStatus === "error" ? "text-danger" : "text-text-secondary"
                    }`}
                  >
                    {drawerNotice}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSaveContextDraft}
                    disabled={contextSaveStatus === "saving"}
                    className="rounded-md bg-accent-primary px-3 py-1.5 text-xs font-sans text-text-inverse transition-colors hover:bg-accent-primary/90 disabled:opacity-50"
                  >
                    {contextSaveStatus === "saving" ? labels.saving : labels.saveSelection}
                  </button>
                  <button
                    onClick={handleRegenerateWithSelectedSources}
                    disabled={isRegeneratingSources}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-xs font-sans text-text-secondary hover:bg-bg-surface-card disabled:opacity-50"
                  >
                    {isRegeneratingSources ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {labels.regenerateAnswer}
                  </button>
                  <button
                    onClick={() => setDrawerTab("context_draft")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-xs font-sans text-text-secondary hover:bg-bg-surface-card"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {labels.openDraft}
                  </button>
                </div>

                <p className="text-[11px] font-sans text-text-tertiary">
                  {labels.regenerationFootnote}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-sans uppercase tracking-wider text-text-tertiary">
                    {labels.draftEditable}
                  </p>
                  <textarea
                    value={contextDraft}
                    onChange={(event) => {
                      setContextDraft(event.target.value);
                      setContextSaveStatus("idle");
                    }}
                    rows={14}
                    className="w-full resize-y rounded-lg border border-border-default bg-bg-primary p-3 text-sm font-sans text-text-primary focus:border-accent-primary focus:outline-none"
                  />
                </div>

                {drawerNotice && (
                  <p
                    className={`text-xs font-sans ${
                      contextSaveStatus === "error" ? "text-danger" : "text-text-secondary"
                    }`}
                  >
                    {drawerNotice}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSaveContextDraft}
                    disabled={contextSaveStatus === "saving"}
                    className="rounded-md bg-accent-primary px-3 py-1.5 text-xs font-sans text-text-inverse transition-colors hover:bg-accent-primary/90 disabled:opacity-50"
                  >
                    {contextSaveStatus === "saving" ? labels.saving : labels.save}
                  </button>
                  <button
                    onClick={handleCopyContextDraft}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-xs font-sans text-text-secondary hover:bg-bg-surface-card"
                  >
                    <Clipboard className="h-3.5 w-3.5" />
                    {labels.copy}
                  </button>
                  <button
                    onClick={handleDownloadContextDraft}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-xs font-sans text-text-secondary hover:bg-bg-surface-card"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {labels.downloadTxt}
                  </button>
                  <button
                    onClick={handleStartChatWithContext}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-xs font-sans text-text-secondary hover:bg-bg-surface-card"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {labels.newChatPrefill}
                  </button>
                </div>
              </div>
            )}
          </div>
          </aside>
        </>
      ) : null}

      {scopeChooserOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="flex h-[min(720px,90vh)] w-full max-w-3xl flex-col rounded-2xl border border-border-subtle bg-bg-primary shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <div>
                <p className="text-sm font-sans font-medium text-text-primary">
                  {labels.chooseConversationsTitle ?? "Choose Conversations"}
                </p>
                <p className="mt-1 text-xs font-sans text-text-tertiary">
                  {labels.chooseConversationsDesc ?? "Search, preview, and pick the conversations the agent is allowed to use."}
                </p>
              </div>
              <button
                onClick={() => setScopeChooserOpen(false)}
                className="rounded-md p-1 text-text-tertiary hover:bg-bg-surface-card hover:text-text-primary"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            <div className="border-b border-border-subtle px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                  <input
                    value={scopeSearchQuery}
                    onChange={(event) => setScopeSearchQuery(event.target.value)}
                    placeholder={labels.searchByTitlePlaceholder ?? "Search by title or snippet..."}
                    className="w-full rounded-lg border border-border-default bg-bg-primary py-2 pl-9 pr-3 text-sm font-sans text-text-primary focus:border-accent-primary focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => {
                    setSearchScopeMode("selected");
                    applySelectedScope();
                  }}
                  className="rounded-md bg-accent-primary px-3 py-2 text-xs font-sans text-text-inverse transition-colors hover:bg-accent-primary/90"
                >
                  {labels.applySelected ?? "Apply Selected"}
                </button>
                <button
                  onClick={resetSearchScope}
                  className="rounded-md border border-border-default px-3 py-2 text-xs font-sans text-text-secondary hover:bg-bg-surface-card"
                >
                  {labels.useAll ?? "Use All"}
                </button>
              </div>
              <p className="mt-2 text-xs font-sans text-text-tertiary">
                {selectedScopeConversationIds.length === 0
                  ? (labels.noConversationsSelected ?? "0 conversations selected")
                  : selectedScopeConversationIds.length === 1
                    ? (labels.oneConversationSelected ?? "1 conversation selected")
                    : (labels.multipleConversationsSelected ?? "{count} conversations selected").replace("{count}", String(selectedScopeConversationIds.length))}
              </p>
              {scopeError && <p className="mt-2 text-xs font-sans text-danger">{scopeError}</p>}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {scopeLoading ? (
                <div className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent-primary" />
                </div>
              ) : scopeResults.length === 0 ? (
                <div className="py-10 text-center text-sm font-sans text-text-tertiary">
                  {labels.noSearchResults ?? "No conversations match this search."}
                </div>
              ) : (
                <div className="space-y-2">
                  {scopeResults.map((conversation) => {
                    const selected = selectedScopeConversationIds.includes(conversation.id);
                    return (
                      <div
                        key={conversation.id}
                        className="rounded-xl border border-border-subtle bg-bg-surface-card p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            onClick={() => toggleScopeConversation(conversation.id)}
                            className="flex min-w-0 flex-1 items-start gap-2 text-left"
                          >
                            {selected ? (
                              <CheckSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-primary" />
                            ) : (
                              <Square className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-tertiary" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-sans text-text-primary">
                                {conversation.title}
                              </p>
                              <p className="mt-1 text-xs font-sans text-text-tertiary">
                                {conversation.platform} · {new Date(conversation.updated_at).toLocaleDateString()}
                              </p>
                              <p className="mt-2 line-clamp-2 text-xs font-sans text-text-secondary">
                                {conversation.snippet || (labels.noPreviewAvailable ?? "No preview available")}
                              </p>
                            </div>
                          </button>
                          <button
                            onClick={() => onOpenConversation?.(conversation.id)}
                            className="text-xs font-sans text-text-secondary hover:text-text-primary"
                          >
                            {labels.open ?? "Open"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
