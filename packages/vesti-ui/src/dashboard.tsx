"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Database,
  Loader2,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { DataManagementPanel } from "./components/DataManagementPanel";
import { LibraryDataProvider } from "./contexts/library-data";
import { ExploreTab } from "./tabs/explore-tab";
import { AitiCard } from "./components/AitiCard";
import { LearnCard } from "./components/LearnCard";
import { RoundtablePanel } from "./components/RoundtablePanel";
import { LibraryTab } from "./tabs/library-tab";
import { NetworkTab } from "./tabs/network-tab";
import { PromptsTab } from "./tabs/prompts-tab";
import type { AitiProfile, DashboardLabels, LearnProfile, PlazaData, StorageApi, UiThemeMode } from "./types";
import type { NotionDatabaseOption, NotionSettings } from "./notion-integration";
import {
  connectToNotion,
  disconnectNotion,
  formatNotionErrorMessage,
  getNotionSettings,
  isNotionConnected,
  isNotionExportConfigured,
  listNotionDatabases,
  selectNotionDatabase,
} from "./notion-integration";

type Tab = "library" | "explore" | "network" | "prompts";
type DrawerView = "settings" | "data";
type ReturnTab = Exclude<Tab, "library">;
type DashboardNavRequest = {
  tab?: unknown;
  requestedAt?: unknown;
};
type ThemeSyncStatus = "idle" | "syncing" | "error";

const DASHBOARD_NAV_REQUEST_KEY = "vesti_dashboard_open_tab";

const DEFAULT_LABELS: DashboardLabels = {
  tabs: { library: "LIBRARY", explore: "EXPLORE", network: "KNOWLEDGE GRAPH", prompts: "PROMPTS" },
  nav: {
    backToExplore: "Back to Explore",
    backToNetwork: "Back to Knowledge Graph",
    dashboardSections: "Dashboard sections",
    closeDrawer: "Close drawer backdrop",
  },
  settings: {
    settings: "Settings",
    dataOperations: "Data Operations",
    appearance: "Appearance",
    modelIntegration: "Model / Integration",
    themeShared: "Shared with dock appearance.",
    themeSharedDark: "Dark mode is active.",
    themeSharedLight: "Light mode is active.",
    syncingAppearance: "Syncing appearance...",
    changesStayInSync: "Changes here stay in sync with the dock settings panel.",
    modelscopeKeyPlaceholder: "Paste your ModelScope key",
    savedLocally: "Saved locally",
    saveFailed: "Save failed",
    storedInChromeStorage: "Stored in chrome.storage.local",
    availableInExtension: "Available in extension only",
    notionWorkspaceConnected: "Notion workspace connected",
    connectToNotion: "Connect to Notion",
    legacyToken: "Legacy token detected. Reconnect to upgrade to official OAuth.",
    oauthFlowDesc: "Opens the official Notion authorization flow.",
    connecting: "Connecting...",
    change: "Change",
    connect: "Connect",
    searchSharedDatabases: "Search shared databases",
    loadingSharedDatabases: "Loading shared databases...",
    noDatabasesLoaded: "No databases loaded yet.",
    chooseDatabase: "Choose a database to enable export",
    actionFailed: "Action failed",
    notionConnected: "Notion connected.",
    notionDisconnected: "Notion disconnected.",
    settingsSaved: "Saved locally",
  },
  library: {
    allConversations: "All Conversations",
    starred: "Starred",
    recent: "Recent",
    folders: "FOLDERS",
    myNotes: "My Notes",
    exporting: "Exporting...",
    notion: "Notion",
    general: "General",
    libraryNavigation: "Library navigation",
    conversationCount: "conversations",
    noMessages: "No messages captured yet.",
    loadingMessages: "Loading messages...",
    you: "You",
    untitled: "Untitled",
    newNote: "New Note",
    saving: "Saving...",
    unsavedChanges: "Unsaved changes",
    noNoteYet: "No note yet",
    deleteNote: "Delete note",
    exitSplitView: "Exit split view",
    deleteNotAvailable: "Delete is not available yet.",
    renameNotAvailable: "Renaming is not available yet.",
    deleteFolderNotAvailable: "Deleting folders is not available yet.",
    renameFolderFailed: "Failed to rename folder.",
    deleteFolderFailed: "Failed to delete folder.",
    updateStarFailed: "Failed to update star.",
    renameConversationFailed: "Failed to rename conversation.",
    newFolderPrompt: "New folder name",
    renameFolderPrompt: "Rename folder",
    renameConversationPrompt: "Rename conversation",
    deleteConversationLabel: "Delete conversation",
    initiatingPipeline: "Initiating pipeline...",
    extractingCore: "Extracting core question...",
    generatingInsights: "Generating insights...",
    savingSummary: "Saving summary...",
    loadRelatedFailed: "Failed to load related conversations",
    loadMessagesFailed: "Failed to load messages",
    directoryExportNotSupported: "This browser surface does not support local directory export.",
    directorySelectionCancelled: "Directory selection was cancelled.",
    saveBeforeExport: "Save the current note before exporting it.",
    exportFailed: "Could not export this note to Obsidian.",
  },
  explore: {},
  network: {
    emptyTitle: "Your knowledge graph will appear here.",
    emptyDesc: "Capture a few conversations first, then reopen the Knowledge Graph to watch it evolve over time.",
    noConversationsYet: "No conversations captured yet.",
    replayInfo: "This replay runs the full timeline in 8 seconds, even when everything was captured today.",
    newConversationOn: "+ New conversation on {platform}",
    conversationOn: "+ {label} · {platform}",
    buildingGraph: "Building graph...",
    trendLabel: "Trend · daily new conversations",
    noSemanticLinks: "No semantic links yet. Playback still shows how conversations accumulated over time.",
    dragHint: "Drag the trend line to pause on a moment.",
    replay: "Replay",
    edgeLoadingUnavailable: "Semantic edge loading is unavailable in this environment.",
    edgePlaybackUnavailable: "Semantic edge playback is temporarily unavailable.",
    close: "Close",
    started: "Started",
    messages: "messages",
    semanticLinks: "semantic links",
    noPreviewSnippet: "No preview snippet available for this conversation yet.",
    tags: "Tags",
    connectedConversations: "Connected conversations",
    noSemanticLinksForNode: "No semantic links for this node yet.",
    viewInLibrary: "View in Library",
    edgeSemanticSimilarity: "edge = semantic similarity",
    trendScrubberAriaLabel: "Conversation trend scrubber",
    conversationsVisible: "conversations visible",
    appearsLaterInReplay: "appears later in replay",
    starred: "Starred",
    unknownPlatform: "Unknown platform",
    conversationN: "Conversation {id}",
  },
  prompts: {
    title: "Prompt Library",
    summary: "{count} prompts",
    extractFromChats: "Extract from chats",
    extracting: "Extracting…",
    extractTooltip: "Scan recent conversations for reusable prompts",
    newPrompt: "New prompt",
    searchPlaceholder: "Search prompts…",
    favorites: "Favorites",
    allCategories: "All categories",
    sortRecent: "Recent",
    sortQuality: "Quality",
    sortUsage: "Most used",
    loading: "Loading prompts…",
    emptyNone: "No prompts yet.",
    emptyFiltered: "No prompts match the current filters.",
    emptyHint: "Extract reusable prompts from your captured conversations, or add one manually.",
    retry: "Retry",
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    copy: "Copy prompt",
    deleteAria: "Delete prompt",
    closeEditor: "Close editor",
    editorNew: "New prompt",
    editorEdit: "Edit prompt",
    fieldTitle: "Trigger",
    titlePlaceholder: "Short trigger to recall this prompt (optional)",
    fieldBody: "Prompt",
    bodyPlaceholder: "Write your reusable prompt. Use {{variables}} for placeholders.",
    improveTooltip: "Rewrite this draft into a stronger prompt (uses your configured LLM)",
    improving: "Improving…",
    improveWithAI: "Improve with AI",
    fieldCategory: "Category",
    categoryPlaceholder: "e.g. Coding",
    fieldTags: "Tags (comma-sep)",
    tagsPlaceholder: "code, review",
    markFavorite: "Mark as favorite (常用)",
    openSource: "Open source conversation",
    save: "Save",
    cancel: "Cancel",
    deleteBtn: "Delete",
    usedTimes: "used {n}×",
    scorePoor: "Basic",
    scoreGood: "Good",
    scoreHigh: "High-value",
    toastBodyEmpty: "Prompt body cannot be empty.",
    toastSaved: "Prompt saved.",
    toastDuplicate: "An identical prompt already exists.",
    toastUpdated: "Prompt updated.",
    toastSaveFailed: "Failed to save prompt.",
    toastDeleted: "Prompt deleted.",
    toastDeleteFailed: "Failed to delete prompt.",
    toastFavoriteFailed: "Failed to update favorite.",
    toastCopied: "Copied to clipboard.",
    toastClipboard: "Clipboard unavailable.",
    toastImproved: "Prompt improved with AI.",
    toastNoLlm: "No LLM configured — configure one in Settings to enable AI rewrite.",
    toastImproveFailed: "AI completion failed.",
    toastExtract: "Archived {created} new prompt(s) from {candidates} candidate(s).",
    unavailable: "Prompt management is not available in this build.",
    exportLabel: "Export",
    importLabel: "Import",
    importBackup: "Import prompts backup",
    toastExported: "Exported {n} prompts.",
    toastImported: "Imported {n} prompts ({skipped} skipped).",
    importFailed: "Import failed — invalid backup file.",
    loadFailed: "Failed to load prompts.",
    draftFirst: "Write a draft to improve first.",
    extractFailed: "Extraction failed.",
    summaryLabel: "Summary: ",
    plazaTitle: "Prompt Plaza",
    plazaSubtitle: "Recommended high-quality prompts from trusted sources.",
    plazaDaily: "Daily picks",
    plazaDailyHint: "Refreshes every day.",
    plazaUse: "Use",
    plazaSourcePrefix: "Source: ",
    supermarketTitle: "Prompt Supermarket",
    supermarketSubtitle: "Browse more quality prompts by category and add them to your plaza.",
    myPlaza: "My plaza",
    myPlazaEmpty: "Add prompts from the supermarket below to build your plaza.",
    adopt: "Add",
    adopted: "Added",
    selectAria: "Select prompt",
    selectedCount: "{n} selected",
    deleteSelected: "Delete",
    clearSelection: "Cancel",
  },
  aiti: {
    modeAsk: "Ask",
    modeAiti: "AITI",
    modeRoundtable: "Roundtable",
    title: "Your AITI — your thinking strengths",
    subtitle: "Computed locally from your own conversations. A reflection of your strengths, not a verdict.",
    insufficient: "Not enough conversations analyzed yet — keep chatting and your portrait will take shape.",
    sample: "Drawn from {n} of your conversations",
    typeSeparator: " · ",
    strengthsTitle: "Your thinking strengths",
    empoweringIntro: "Across your AI conversations, these strengths shine through:",
    obsessionsTitle: "What you keep investing in",
    evidence: "seen in {n} conversations",
    axisDepthLabel: "Breadth ↔ Depth",
    axisDepthLeft: "Explorer",
    axisDepthRight: "Excavator",
    axisDepthLeftStrength: "You range widely and connect ideas across many fields.",
    axisDepthRightStrength: "You dive deep and master complex things thoroughly.",
    axisMakerLabel: "Theory ↔ Practice",
    axisMakerLeft: "Theorist",
    axisMakerRight: "Maker",
    axisMakerLeftStrength: "You think in principles and models, getting the fundamentals right.",
    axisMakerRightStrength: "You're action-oriented and turn ideas into real results fast.",
    axisFocusLabel: "Converge ↔ Wander",
    axisFocusLeft: "Converger",
    axisFocusRight: "Wanderer",
    axisFocusLeftStrength: "You stay focused and converge on the answer that matters.",
    axisFocusRightStrength: "You roam with curiosity and open up unexpected possibilities.",
    axisAffectLabel: "Cool ↔ Spirited",
    axisAffectLeft: "Cool-headed",
    axisAffectRight: "Spirited",
    axisAffectLeftStrength: "You stay calm and keep clear judgment under complexity.",
    axisAffectRightStrength: "You bring real passion and energy to what you explore.",
  },
  learn: {
    modeLearn: "Learn",
    title: "What you've been learning",
    subtitle: "Your conversations, organized as a personal curriculum. Computed locally.",
    insufficient: "Not enough conversations yet — keep chatting and your learning map will fill in.",
    sample: "From {n} analyzed conversations",
    domainsTitle: "Knowledge domains",
    uncategorized: "Uncategorized",
    domainConversations: "{n} conversations",
    glossaryTitle: "Things you've learned",
    openLoopsTitle: "Open loops",
    openLoopsEmpty: "No unresolved threads — nicely closed out.",
  },
  roundtable: {
    title: "AI Roundtable",
    subtitle: "Convene a panel of perspectives on your question, then a moderated synthesis.",
    questionPlaceholder: "Ask a judgment-call question to debate…",
    personasLabel: "Panelists (pick up to 3)",
    run: "Convene panel",
    running: "The panel is deliberating…",
    latencyHint: "Each seat answers in turn, so this takes a little while.",
    needQuestion: "Type a question first.",
    seatsTitle: "Panel",
    synthesisTitle: "Moderator's synthesis",
    consensus: "Consensus",
    disagreements: "Key disagreements",
    recommendation: "Recommendation",
    openQuestions: "Open questions",
    empty: "Ask a question and convene the panel to see perspectives + a synthesis.",
    personaSkeptic: "Skeptic",
    personaOptimist: "Optimist",
    personaPragmatist: "Pragmatist",
    personaDomainExpert: "Domain Expert",
    personaDevilsAdvocate: "Devil's Advocate",
  },
};

type DashboardProps = {
  storage: StorageApi;
  logoSrc: string;
  logoAlt?: string;
  rootClassName?: string;
  themeMode?: UiThemeMode;
  onToggleTheme?: () => Promise<void> | void;
  themeSyncStatus?: ThemeSyncStatus;
  themeSyncMessage?: string | null;
  labels?: DashboardLabels;
  plaza?: PlazaData;
  onPlazaAdoptToggle?: (id: string, adopt: boolean) => void;
  aiti?: AitiProfile;
  learn?: LearnProfile;
};

export function VestiDashboard({
  storage,
  logoSrc,
  logoAlt = "Vesti",
  rootClassName,
  themeMode = "light",
  onToggleTheme,
  themeSyncStatus = "idle",
  themeSyncMessage = null,
  labels: providedLabels,
  plaza,
  onPlazaAdoptToggle,
  aiti,
  learn,
}: DashboardProps) {
  const labels = providedLabels ?? DEFAULT_LABELS;
  const SETTINGS_KEY = "vesti_llm_settings";
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "library";
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (
      tab === "explore" ||
      tab === "network" ||
      tab === "library" ||
      tab === "prompts"
    )
      return tab;
    return "library";
  });
  const [exploreMode, setExploreMode] = useState<"ask" | "aiti" | "learn" | "roundtable">("ask");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerView, setDrawerView] = useState<DrawerView>("settings");
  const [modelscopeKey, setModelscopeKey] = useState("");
  const [notionSettings, setNotionSettingsState] = useState<NotionSettings>({
    authMode: "disconnected",
    accessToken: "",
    workspaceId: "",
    workspaceName: "",
    selectedDatabaseId: "",
    selectedDatabaseTitle: "",
    updatedAt: 0,
  });
  const [notionDatabaseQuery, setNotionDatabaseQuery] = useState("");
  const [notionDatabases, setNotionDatabases] = useState<NotionDatabaseOption[]>([]);
  const [notionDatabasesStatus, setNotionDatabasesStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [notionDatabasesMessage, setNotionDatabasesMessage] = useState("");
  const [notionMessage, setNotionMessage] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<"idle" | "saved" | "error">(
    "idle"
  );
  const [notionStatus, setNotionStatus] = useState<"idle" | "saved" | "error" | "loading">(
    "idle"
  );
  const [settingsAvailable, setSettingsAvailable] = useState(true);
  const [openConversationId, setOpenConversationId] = useState<number | null>(null);
  const [returnTab, setReturnTab] = useState<ReturnTab | null>(null);
  const [mountedTabs, setMountedTabs] = useState<Record<Tab, boolean>>(() => ({
    library: activeTab === "library",
    explore: activeTab === "explore",
    network: activeTab === "network",
    prompts: activeTab === "prompts",
  }));
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const notionAvailable =
    typeof chrome !== "undefined" &&
    Boolean(chrome.storage?.local) &&
    Boolean(chrome.identity?.launchWebAuthFlow);
  const notionConnected = isNotionConnected(notionSettings);
  const notionExportReady = isNotionExportConfigured(notionSettings);

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev[activeTab]) return prev;
      return {
        ...prev,
        [activeTab]: true,
      };
    });
  }, [activeTab]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;

    const applyNavRequest = (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const tab = (raw as DashboardNavRequest).tab;
      if (
        tab === "library" ||
        tab === "explore" ||
        tab === "network" ||
        tab === "prompts"
      ) {
        setActiveTab(tab);
      }
    };

    chrome.storage.local.get(DASHBOARD_NAV_REQUEST_KEY, (result) => {
      applyNavRequest(result?.[DASHBOARD_NAV_REQUEST_KEY]);
    });

    const onStorageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] =
      (changes, areaName) => {
        if (areaName !== "local") return;
        const navRequest = changes[DASHBOARD_NAV_REQUEST_KEY];
        if (!navRequest) return;
        applyNavRequest(navRequest.newValue);
      };

    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen || drawerView !== "settings") {
      setSettingsStatus("idle");
      return;
    }
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setSettingsAvailable(false);
      return;
    }
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      setSettingsAvailable(true);
      const settings = result?.[SETTINGS_KEY] as { apiKey?: string } | undefined;
      setModelscopeKey(settings?.apiKey ?? "");
    });
    void getNotionSettings()
      .then((settings) => {
        setNotionSettingsState(settings);
      })
      .catch((error) => {
        setNotionStatus("error");
        setNotionMessage(formatNotionErrorMessage(error));
      });
  }, [drawerOpen, drawerView]);

  useEffect(() => {
    if (!drawerOpen || drawerView !== "settings" || !notionConnected) {
      return;
    }

    void listNotionDatabases("")
      .then((results) => {
        setNotionDatabases(results);
        setNotionDatabasesStatus("ready");
        setNotionDatabasesMessage(
          results.length === 0
            ? "No shared databases found yet. Share the database with the integration, then refresh."
            : ""
        );
      })
      .catch((error) => {
        setNotionDatabasesStatus("error");
        setNotionDatabasesMessage(formatNotionErrorMessage(error));
      });
  }, [drawerOpen, drawerView, notionConnected]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (userMenuRef.current.contains(event.target as Node)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [settingsOpen]);

  const handleSaveModelscopeKey = () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setSettingsAvailable(false);
      setSettingsStatus("error");
      return;
    }
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        setSettingsStatus("error");
        return;
      }
      const existing = (result?.[SETTINGS_KEY] as Record<string, unknown>) ?? {};
      const next = {
        ...existing,
        apiKey: modelscopeKey.trim(),
      };
      chrome.storage.local.set({ [SETTINGS_KEY]: next }, () => {
        const saveErr = chrome.runtime?.lastError;
        if (saveErr) {
          setSettingsStatus("error");
          return;
        }
        setSettingsStatus("saved");
        setTimeout(() => setSettingsStatus("idle"), 1500);
      });
    });
  };

  const handleSelectTab = (tab: Tab) => {
    setActiveTab(tab);
    if (tab !== "library") {
      setReturnTab(null);
      setOpenConversationId(null);
      return;
    }
    setReturnTab(null);
  };

  const loadNotionDatabases = async (query = notionDatabaseQuery) => {
    if (!notionConnected) {
      setNotionDatabases([]);
      setNotionDatabasesStatus("idle");
      setNotionDatabasesMessage("");
      return;
    }

    setNotionDatabasesStatus("loading");
    setNotionDatabasesMessage("");
    try {
      const results = await listNotionDatabases(query);
      setNotionDatabases(results);
      setNotionDatabasesStatus("ready");
      setNotionDatabasesMessage(
        results.length === 0
          ? "No shared databases found yet. Share the database with the integration, then refresh."
          : ""
      );
    } catch (error) {
      setNotionDatabasesStatus("error");
      setNotionDatabasesMessage(formatNotionErrorMessage(error));
    }
  };

  const handleConnectNotion = async () => {
    setNotionStatus("loading");
    setNotionMessage("");
    try {
      const next = await connectToNotion();
      setNotionSettingsState(next);
      setNotionDatabaseQuery("");
      await loadNotionDatabases("");
      setNotionStatus("saved");
      setNotionMessage(labels.settings.notionConnected);
      setTimeout(() => setNotionStatus("idle"), 1500);
    } catch (error) {
      setNotionStatus("error");
      setNotionMessage(formatNotionErrorMessage(error));
    }
  };

  const handleDisconnectNotion = async () => {
    setNotionStatus("loading");
    setNotionMessage("");
    try {
      const next = await disconnectNotion();
      setNotionSettingsState(next);
      setNotionDatabases([]);
      setNotionDatabasesStatus("idle");
      setNotionDatabasesMessage("");
      setNotionDatabaseQuery("");
      setNotionStatus("saved");
      setNotionMessage(labels.settings.notionDisconnected);
      setTimeout(() => setNotionStatus("idle"), 1500);
    } catch (error) {
      setNotionStatus("error");
      setNotionMessage(formatNotionErrorMessage(error));
    }
  };

  const handleSelectNotionDatabase = async (database: NotionDatabaseOption) => {
    setNotionStatus("loading");
    setNotionMessage("");
    try {
      const next = await selectNotionDatabase(database);
      setNotionSettingsState(next);
      setNotionStatus("saved");
      setNotionMessage(`Selected ${database.title}.`);
      setTimeout(() => setNotionStatus("idle"), 1500);
    } catch (error) {
      setNotionStatus("error");
      setNotionMessage(formatNotionErrorMessage(error));
    }
  };

  const handleOpenConversation = (conversationId: number) => {
    const originTab = activeTab === "explore" || activeTab === "network" ? activeTab : null;
    setReturnTab(originTab);
    setActiveTab("library");
    setOpenConversationId(conversationId);
  };

  const handleReturnToSource = () => {
    if (!returnTab) return;
    setActiveTab(returnTab);
    setOpenConversationId(null);
    setReturnTab(null);
  };

  const openDrawer = (view: DrawerView) => {
    setDrawerView(view);
    setDrawerOpen(true);
    setSettingsOpen(false);
  };

  const isDarkMode = themeMode === "dark";
  const isThemeSwitchDisabled = !onToggleTheme || themeSyncStatus === "syncing";
  const themeDescription = isDarkMode
    ? `${labels.settings.themeShared} ${labels.settings.themeSharedDark}`
    : `${labels.settings.themeShared} ${labels.settings.themeSharedLight}`;
  const themeFeedback =
    themeSyncStatus === "syncing"
      ? labels.settings.syncingAppearance
      : themeSyncMessage || labels.settings.changesStayInSync;
  const returnToSourceLabel =
    activeTab === "library" && returnTab
      ? returnTab === "explore"
        ? labels.nav.backToExplore
        : labels.nav.backToNetwork
      : null;

  const brand = (
    <div className="flex items-center gap-2">
      <img src={logoSrc} alt={logoAlt} className="h-7 w-7" />
      <h1 className="text-base font-[family-name:var(--font-lora)] font-semibold text-text-primary">
        Vesti
      </h1>
    </div>
  );

  const tabNav = (
    <nav
      aria-label={labels.nav.dashboardSections}
      className="flex items-center justify-center gap-3 lg:gap-5"
    >
      <button
        type="button"
        onClick={() => handleSelectTab("library")}
        className={`inline-flex items-center px-3 py-1.5 text-[14px] leading-none font-mono font-medium uppercase tracking-[0.26em] transition-colors ${
          activeTab === "library"
            ? "text-text-primary"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        {labels.tabs.library}
      </button>
      <button
        type="button"
        onClick={() => handleSelectTab("explore")}
        className={`inline-flex items-center px-3 py-1.5 text-[14px] leading-none font-mono font-medium uppercase tracking-[0.26em] transition-colors ${
          activeTab === "explore"
            ? "text-text-primary"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        {labels.tabs.explore}
      </button>
      <button
        type="button"
        onClick={() => handleSelectTab("network")}
        className={`inline-flex items-center px-3 py-1.5 text-[14px] leading-none font-mono font-medium uppercase tracking-[0.26em] transition-colors ${
          activeTab === "network"
            ? "text-text-primary"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        {labels.tabs.network}
      </button>
      <button
        type="button"
        onClick={() => handleSelectTab("prompts")}
        className={`inline-flex items-center px-3 py-1.5 text-[14px] leading-none font-mono font-medium uppercase tracking-[0.26em] transition-colors ${
          activeTab === "prompts"
            ? "text-text-primary"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        {labels.tabs.prompts}
      </button>
    </nav>
  );

  const userMenu = (
    <div ref={userMenuRef} className="relative">
      <button
        type="button"
        onClick={() => setSettingsOpen((open) => !open)}
        className="inline-flex items-center gap-1 rounded-lg p-1.5 transition-colors hover:bg-bg-surface-card"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-primary text-sm font-sans text-white">
          U
        </div>
        <ChevronDown strokeWidth={1.75} className="h-4 w-4 text-text-secondary" />
      </button>
      {settingsOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-border-subtle bg-bg-primary py-1 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <button
            type="button"
            onClick={() => openDrawer("settings")}
            className="inline-flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-sans text-text-primary transition-colors hover:bg-bg-surface-card"
          >
            <Settings strokeWidth={1.6} className="h-4 w-4" />
            <span>{labels.settings.settings}</span>
          </button>
          <button
            type="button"
            onClick={() => openDrawer("data")}
            className="inline-flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-sans text-text-primary transition-colors hover:bg-bg-surface-card"
          >
            <Database strokeWidth={1.6} className="h-4 w-4" />
            <span>{labels.settings.dataOperations}</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <LibraryDataProvider storage={storage}>
      <div
        className={`${rootClassName ?? ""} relative flex h-screen flex-col bg-bg-primary text-text-primary`}
      >
        <header className="bg-bg-tertiary">
          <div className="hidden h-14 border-b border-border-subtle px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            <div className="justify-self-start">{brand}</div>
            <div className="justify-self-center self-center">{tabNav}</div>
            <div className="justify-self-end">{userMenu}</div>
          </div>
          <div className="lg:hidden">
            <div className="flex h-14 items-center justify-between border-b border-border-subtle px-4 sm:px-6">
              {brand}
              {userMenu}
            </div>
            <div className="border-b border-border-subtle px-4 sm:px-6">{tabNav}</div>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          {mountedTabs.library && (
            <div className={`h-full ${activeTab === "library" ? "block" : "hidden"}`}>
              <LibraryTab
                storage={storage}
                themeMode={themeMode}
                openConversationId={openConversationId}
                onConversationOpened={() => setOpenConversationId(null)}
                returnToSourceLabel={returnToSourceLabel}
                onReturnToSource={returnToSourceLabel ? handleReturnToSource : undefined}
                labels={labels.library}
              />
            </div>
          )}
          {mountedTabs.explore && (
            <div className={`h-full ${activeTab === "explore" ? "flex flex-col" : "hidden"}`}>
              {/* Explore = the reflective-AI hub: 问答 / AITI 画像 / 学习 / 圆桌 */}
              <div className="flex items-center gap-1 border-b border-border-subtle px-4 py-2">
                {(["ask", "aiti", "learn", "roundtable"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setExploreMode(mode)}
                    className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                      exploreMode === mode
                        ? "bg-accent-primary-light text-accent-primary"
                        : "text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    {mode === "ask"
                      ? labels.aiti.modeAsk
                      : mode === "aiti"
                        ? labels.aiti.modeAiti
                        : mode === "learn"
                          ? labels.learn.modeLearn
                          : labels.aiti.modeRoundtable}
                  </button>
                ))}
              </div>
              <div className={`min-h-0 flex-1 ${exploreMode === "ask" ? "block" : "hidden"}`}>
                <ExploreTab
                  storage={storage}
                  themeMode={themeMode}
                  onOpenConversation={handleOpenConversation}
                  labels={labels.explore}
                />
              </div>
              {exploreMode === "aiti" && (
                <div className="min-h-0 flex-1">
                  <AitiCard
                    profile={aiti}
                    labels={labels.aiti}
                    storage={storage}
                    sendToLabels={labels.library}
                  />
                </div>
              )}
              {exploreMode === "learn" && (
                <div className="min-h-0 flex-1">
                  <LearnCard
                    profile={learn}
                    labels={labels.learn}
                    onOpenConversation={handleOpenConversation}
                    storage={storage}
                    sendToLabels={labels.library}
                  />
                </div>
              )}
              {exploreMode === "roundtable" && (
                <div className="min-h-0 flex-1">
                  <RoundtablePanel
                    storage={storage}
                    themeMode={themeMode}
                    labels={labels.roundtable}
                    sendToLabels={labels.library}
                  />
                </div>
              )}
            </div>
          )}
          {mountedTabs.network && (
            <div className={`h-full ${activeTab === "network" ? "block" : "hidden"}`}>
              <NetworkTab
                storage={storage}
                themeMode={themeMode}
                isActive={activeTab === "network"}
                onSelectConversation={handleOpenConversation}
                labels={labels.network}
              />
            </div>
          )}
          {mountedTabs.prompts && (
            <div className={`h-full ${activeTab === "prompts" ? "block" : "hidden"}`}>
              <PromptsTab
                storage={storage}
                themeMode={themeMode}
                isActive={activeTab === "prompts"}
                onOpenConversation={handleOpenConversation}
                labels={labels.prompts}
                plaza={plaza}
                onPlazaAdoptToggle={onPlazaAdoptToggle}
              />
            </div>
          )}
        </div>

        {drawerOpen && (
          <>
            <button
              type="button"
              aria-label={labels.nav.closeDrawer}
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 z-40 bg-black/20"
            />
            <aside className="absolute right-0 top-0 z-50 flex h-full w-[420px] max-w-[90vw] flex-col border-l border-border-subtle bg-bg-primary shadow-[0_0_24px_rgba(0,0,0,0.12)]">
              <div className="flex h-14 items-center justify-between border-b border-border-subtle px-4">
                <div className="inline-flex items-center gap-2 text-sm font-sans text-text-primary">
                  {drawerView === "settings" ? (
                    <Settings strokeWidth={1.6} className="h-4 w-4" />
                  ) : (
                    <Database strokeWidth={1.6} className="h-4 w-4" />
                  )}
                  <span>{drawerView === "settings" ? labels.settings.settings : labels.settings.dataOperations}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-surface-card hover:text-text-primary"
                >
                  <X strokeWidth={1.8} className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {drawerView === "settings" ? (
                  <div className="flex flex-col gap-4">
                    <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-bg-secondary text-text-secondary">
                            {isDarkMode ? (
                              <Moon className="h-4 w-4" strokeWidth={1.5} />
                            ) : (
                              <Sun className="h-4 w-4" strokeWidth={1.5} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-text-primary">{labels.settings.appearance}</p>
                            <p className="mt-1 text-[11px] text-text-tertiary">{themeDescription}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isDarkMode}
                          onClick={() => {
                            if (!onToggleTheme) return;
                            void onToggleTheme();
                          }}
                          disabled={isThemeSwitchDisabled}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                            isDarkMode ? "bg-accent-primary" : "bg-bg-secondary"
                          } ${isThemeSwitchDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                        >
                          <span
                            className={`inline-block h-5 w-5 rounded-full border border-border-subtle bg-bg-primary shadow-sm transition-transform ${
                              isDarkMode ? "translate-x-5" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                      <p
                        className={`mt-3 text-[11px] ${
                          themeSyncStatus === "error" ? "text-danger" : "text-text-tertiary"
                        }`}
                      >
                        {themeFeedback}
                      </p>
                    </section>

                    <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
                      <div className="mb-3">
                        <p className="text-[13px] font-medium text-text-primary">{labels.settings.modelIntegration}</p>
                        <p className="mt-1 text-[11px] text-text-tertiary">
                          {labels.settings.manageIntegrationKeys}
                        </p>
                      </div>
                      <label className="mb-2 block text-[12px] font-sans text-text-secondary">
                        {labels.settings.modelscopeKeyLabel}
                      </label>
                      <input
                        type="password"
                        value={modelscopeKey}
                        onChange={(event) => setModelscopeKey(event.target.value)}
                        placeholder={labels.settings.modelscopeKeyPlaceholder}
                        disabled={!settingsAvailable}
                        className="w-full rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm font-sans text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 disabled:opacity-60"
                      />
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={handleSaveModelscopeKey}
                          className="rounded-md bg-accent-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-primary-hover"
                        >
                          {labels.settings.save}
                        </button>
                        <span className="text-right text-[11px] font-sans text-text-tertiary">
                          {settingsAvailable
                            ? settingsStatus === "saved"
                              ? labels.settings.savedLocally
                              : settingsStatus === "error"
                                ? labels.settings.saveFailed
                                : labels.settings.storedInChromeStorage
                          : labels.settings.availableInExtension}
                        </span>
                      </div>

                      <div className="mt-4 rounded-lg border border-border-subtle bg-bg-primary p-4">
                        <div className="mb-3">
                          <p className="text-[13px] font-medium text-text-primary">
                            {labels.settings.notionExportTitle}
                          </p>
                          <p className="mt-1 text-[11px] text-text-tertiary">
                            {labels.settings.notionExportDesc}
                          </p>
                        </div>

                        <div className="rounded-md border border-border-subtle bg-bg-primary px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[12px] font-sans font-medium text-text-primary">
                                {notionConnected
                                  ? notionSettings.workspaceName || labels.settings.notionWorkspaceConnected
                                  : notionAvailable
                                    ? labels.settings.connectToNotion
                                    : labels.settings.availableInExtension}
                              </div>
                              <p className="mt-1 text-[11px] font-sans leading-relaxed text-text-tertiary">
                                {notionConnected
                                  ? notionSettings.authMode === "legacy_manual"
                                    ? labels.settings.legacyToken
                                    : labels.settings.connectedChooseDatabase
                                  : notionAvailable
                                    ? labels.settings.oauthFlowDesc
                                    : labels.settings.oauthUnavailableOutsideExtension}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void handleConnectNotion()}
                                disabled={!notionAvailable || notionStatus === "loading"}
                                className="rounded-md bg-accent-primary px-3 py-1.5 text-xs font-sans font-medium text-white transition-colors hover:bg-accent-primary-hover disabled:opacity-60"
                              >
                                {notionStatus === "loading"
                                  ? labels.settings.connecting
                                  : notionConnected
                                    ? labels.settings.change
                                    : labels.settings.connect}
                              </button>
                              {notionConnected ? (
                                <button
                                  type="button"
                                  onClick={() => void handleDisconnectNotion()}
                                  disabled={notionStatus === "loading"}
                                  className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-sans text-text-secondary transition-colors hover:bg-bg-secondary disabled:opacity-60"
                                >
                                  {labels.settings.disconnect}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {notionConnected ? (
                          <>
                            <label className="mb-2 mt-3 block text-[12px] font-sans text-text-secondary">
                              {labels.settings.targetDatabase}
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={notionDatabaseQuery}
                                onChange={(event) => {
                                  setNotionDatabaseQuery(event.target.value);
                                  setNotionDatabasesStatus("idle");
                                  setNotionDatabasesMessage("");
                                }}
                                placeholder={labels.settings.databaseSearchPlaceholder}
                                className="w-full rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm font-sans text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20"
                              />
                              <button
                                type="button"
                                onClick={() => void loadNotionDatabases()}
                                disabled={notionDatabasesStatus === "loading"}
                                className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1.5 text-xs font-sans text-text-secondary transition-colors hover:bg-bg-secondary disabled:opacity-60"
                              >
                                {notionDatabasesStatus === "loading" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.6} />
                                )}
                                {labels.settings.refresh}
                              </button>
                            </div>
                            <p className="mt-2 text-[11px] font-sans leading-relaxed text-text-tertiary">
                              {labels.settings.shareDatabaseHint}
                            </p>

                            <div className="mt-3 rounded-md border border-border-subtle bg-bg-primary p-2">
                              {notionDatabases.length > 0 ? (
                                <div className="max-h-44 space-y-2 overflow-y-auto">
                                  {notionDatabases.map((database) => {
                                    const selected =
                                      database.id === notionSettings.selectedDatabaseId;
                                    return (
                                      <button
                                        key={database.id}
                                        type="button"
                                        onClick={() => void handleSelectNotionDatabase(database)}
                                        className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                                          selected
                                            ? "border-accent-primary/40 bg-accent-primary-light/40"
                                            : "border-transparent hover:border-border-subtle hover:bg-bg-secondary"
                                        }`}
                                      >
                                        <div className="text-[12px] font-sans font-medium text-text-primary">
                                          {database.title}
                                        </div>
                                        <div className="mt-1 text-[11px] font-sans text-text-tertiary">
                                          {database.id}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="px-1 py-2 text-[11px] font-sans text-text-tertiary">
                                  {notionDatabasesStatus === "loading"
                                    ? labels.settings.loadingSharedDatabases
                                    : labels.settings.noDatabasesLoaded}
                                </div>
                              )}
                            </div>

                            <div className="mt-3 flex items-center justify-between">
                              <span className="text-right text-[11px] font-sans text-text-tertiary">
                                {notionExportReady
                                  ? `${labels.settings.selectedColon}${
                                      notionSettings.selectedDatabaseTitle ||
                                      notionSettings.selectedDatabaseId
                                    }`
                                  : labels.settings.chooseDatabase}
                              </span>
                            </div>
                          </>
                        ) : null}

                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-right text-[11px] font-sans text-text-tertiary">
                            {settingsAvailable
                              ? notionStatus === "saved"
                                ? labels.settings.savedLocally
                                : notionStatus === "error"
                                  ? labels.settings.actionFailed
                                  : notionConnected
                                    ? labels.settings.readyForOneShotExport
                                    : labels.settings.storedInChromeStorage
                              : labels.settings.availableInExtension}
                          </span>
                        </div>
                        {notionMessage ? (
                          <p
                            className={`mt-2 text-[11px] font-sans ${
                              notionStatus === "error" ? "text-danger" : "text-text-secondary"
                            }`}
                          >
                            {notionMessage}
                          </p>
                        ) : null}
                        {notionDatabasesMessage ? (
                          <p
                            className={`mt-2 text-[11px] font-sans ${
                              notionDatabasesStatus === "error"
                                ? "text-danger"
                                : "text-text-tertiary"
                            }`}
                          >
                            {notionDatabasesMessage}
                          </p>
                        ) : null}
                      </div>
                    </section>
                  </div>
                ) : (
                  <DataManagementPanel storage={storage} />
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </LibraryDataProvider>
  );
}
