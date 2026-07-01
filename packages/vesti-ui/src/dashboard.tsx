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
import { LibraryTab } from "./tabs/library-tab";
import { NetworkTab } from "./tabs/network-tab";
import type { DashboardLabels, StorageApi, UiThemeMode } from "./types";
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

type Tab = "library" | "explore" | "network";
type DrawerView = "settings" | "data";
type ReturnTab = Exclude<Tab, "library">;
type DashboardNavRequest = {
  tab?: unknown;
  requestedAt?: unknown;
};
type ThemeSyncStatus = "idle" | "syncing" | "error";

const DASHBOARD_NAV_REQUEST_KEY = "vesti_dashboard_open_tab";

const DEFAULT_LABELS: DashboardLabels = {
  tabs: { library: "LIBRARY", explore: "EXPLORE", network: "NETWORK" },
  nav: {
    backToExplore: "Back to Explore",
    backToNetwork: "Back to Network",
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
    manageIntegrationKeys: "Manage dashboard-only integration keys.",
    modelscopeKeyLabel: "ModelScope Key",
    save: "Save",
    notionExportTitle: "Notion Export",
    notionExportDesc: "Connect with Notion and choose the database used for annotation export.",
    connectedChooseDatabase: "Connected. Choose the database used for one-shot exports.",
    oauthUnavailableOutsideExtension: "OAuth login is unavailable outside the extension build.",
    disconnect: "Disconnect",
    targetDatabase: "Target Database",
    databaseSearchPlaceholder: "Search shared databases",
    refresh: "Refresh",
    shareDatabaseHint: "Share the database with your Notion integration, then refresh if it does not appear yet.",
    selectedColon: "Selected: ",
    readyForOneShotExport: "Ready for one-shot export",
    noSharedDatabasesFound: "No shared databases found yet. Share the database with the integration, then refresh.",
    selectedDatabaseMessage: "Selected {title}.",
    themeUpdateFailed: "Theme update failed.",
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
    analyzed: "Analyzed",
    notAnalyzedYet: "Not analyzed yet",
    summary: "Summary",
    noSummaryYet: "No summary yet. Generate one to see structured insights.",
    generateSummary: "Generate Summary",
    regenerate: "Regenerate",
    importToNotes: "Import to Notes",
    viewNote: "View Note",
    originalConversation: "Original Conversation",
    preview: "Preview",
    messageCountLabel: "messages",
    showOriginalMessages: "Show original messages",
    hideOriginalMessages: "Hide original messages",
    loadingOriginalConversation: "Loading original conversation...",
    messagesAvailableButEmpty: "Messages are available, but preview text is empty.",
    openOriginal: "Open",
    splitView: "Split View",
    openSplitView: "Open split view",
    exitSplit: "Exit Split",
    conversationNote: "Conversation Note",
    updatedAt: "Updated",
    updatedAtTime: "Updated {time}",
    notesForPrefix: "Notes for: {title}",
    linkedConversations: "Linked Conversations",
    noLinkedConversations: "No linked conversations",
    open: "Open",
    focusNote: "Focus Note",
    noNoteLinkedYet: "No note linked yet",
    startExtractingHint: "Start extracting from the reader or create a conversation note to keep your reading and writing side by side.",
    startWritingPlaceholder: "Start writing...",
    createConversationNote: "Create Conversation Note",
    extractedExcerptsPlaceholder: "Extracted excerpts and your notes will appear here...",
    relatedConversations: "Related Conversations",
    findingRelated: "Finding related conversations...",
    noRelatedConversations: "No related conversations yet.",
    unableToLoadRelated: "Unable to load related conversations.",
    relatedNotes: "Related Notes",
    addAnnotation: "Add annotation",
    openAnnotation: "Open annotation",
    annotation: "Comment",
    annotationCount: "1 annotation",
    annotationsCount: "{count} annotations",
    deleteThisComment: "Delete this comment?",
    deleting: "Deleting...",
    cancel: "Cancel",
    commentPlaceholder: "Comment...",
    commentsUnavailable: "Comments are unavailable in this build.",
    couldNotSaveComment: "Couldn't save this comment.",
    couldNotDeleteComment: "Couldn't delete this comment.",
    myNotesExportUnavailable: "My Notes export is not available in this build.",
    savedToMyNotes: "Saved to My Notes.",
    couldNotExportToMyNotes: "Couldn't export this comment to My Notes.",
    notionExportUnavailable: "Notion export is not available in this build.",
    sentToNotion: "Sent to Notion.",
    notionSettingsMissing: "Connect to Notion and choose a database in Settings before exporting.",
    notionReconnectRequired: "Your Notion session expired. Reconnect in Settings and try again.",
    couldNotExportToNotion: "Couldn't export this comment to Notion.",
    addedOn: "Added on",
    dayAfter: "day",
    daysAfter: "days",
    afterTheConversation: "after the conversation",
    unknownTime: "Added at an unknown time",
    localNote: "Local",
    obsidianNote: "Obsidian",
    noExcerptYet: "No excerpt yet.",
    conflict: "Conflict",
    vaultPath: "Vault Path",
    sourceHash: "Source Hash",
    unknown: "Unknown",
    unavailable: "Unavailable",
    attachments: "Attachments",
    attachmentPreview: "Attachment Preview",
    previewAvailableForImages: "Preview is available for imported images.",
    useOpenForOtherAttachments: "Use Open for other attachment types.",
    importMetadata: "Import Metadata",
    exportToObsidian: "Export to Obsidian",
    choosingFolder: "Choosing Folder...",
    notesWorkspace: "Notes Workspace",
    selectNoteToEdit: "Select a note to start editing",
    localNotesAndObsidianShareEditor: "Local notes and imported Obsidian files now share the same Markdown editor surface.",
    loadingNotes: "Loading notes...",
    createLocalNoteHint: "Create a local note, then export it to an Obsidian folder whenever you are ready.",
    createNote: "Create a note",
    localNotes: "Local Notes",
    noLocalNotesYet: "No local notes yet.",
    importedVaults: "Imported Vaults",
    renameNote: "Rename Note",
    updateNoteTitle: "Update the title for this note.",
    noteTitlePlaceholder: "Note title",
    deleteNoteConfirm: "Delete note",
    deleteConversationConfirm: "Delete this conversation?",
    deleteFolderConfirm: "Delete folder",
    star: "Star",
    unstar: "Unstar",
    rename: "Rename",
    changeFolder: "Change folder",
    removeFromFolder: "Remove from folder",
    delete: "Delete",
    folderActions: "Folder actions",
    createNewFolder: "Create new folder",
    newFolder: "New folder",
    conversationActions: "Conversation actions",
    extract: "Extract",
    justNow: "just now",
    minutesAgo: "m ago",
    hoursAgo: "h ago",
    daysAgo: "d ago",
    monthsAgo: "mo ago",
    yearsAgo: "y ago",
    sourceFileChangedAfterEdits: "Source file changed after local edits. Re-import skipped to avoid overwriting this note.",
    dateUnknown: "Unknown date",
    frontmatter: "Frontmatter",
    chooseConversationsTitle: "Choose Conversations",
    chooseConversationsDesc: "Search, preview, and pick the conversations the agent is allowed to use.",
    applySelected: "Apply Selected",
    useAll: "Use All",
    noSearchResults: "No conversations match this search.",
    noPreviewAvailable: "No preview available",
    closeSidebar: "Close sidebar",
    openSidebar: "Open sidebar",
  },
  explore: {
    chooseConversationsTitle: "Choose Conversations",
    chooseConversationsDesc: "Search, preview, and pick the conversations the agent is allowed to use.",
    applySelected: "Apply Selected",
    useAll: "Use All",
    noSearchResults: "No conversations match this search.",
    noPreviewAvailable: "No preview available",
    closeSidebar: "Close sidebar",
    openSidebar: "Open sidebar",
    noConversationsSelected: "0 conversations selected",
    oneConversationSelected: "1 conversation selected",
    multipleConversationsSelected: "{count} conversations selected",
    newChat: "New Chat",
    noConversationsYet: "No conversations yet",
    today: "Today",
    yesterday: "Yesterday",
    earlier: "Earlier",
    agent: "Agent",
    classic: "Classic",
    all: "All",
    selected: "Selected",
    allConversations: "All conversations",
    send: "Send",
    starterPrompts: "Starter prompts",
    choosePromptHint: "Choose one to populate the composer, then edit it before sending.",
    loadingStarterIdeas: "Loading starter ideas",
    starterDeckReady: "Starter deck ready",
    cardsUpdateHint: "Cards update on every new chat.",
    askPlaceholder: "Ask your knowledge base, summarize a week, or trace a decision trail...",
    askAgentPlaceholder: "Ask your knowledge base (Agent mode)...",
    askClassicPlaceholder: "Ask your knowledge base (Classic mode)...",
    agentModeDesc: "Agent mode shows the planner route, tool calls, source controls, and editable context drafts.",
    classicModeDesc: "Classic mode searches your history and returns concise source-grounded answers.",
    newChatPrefill: "New Chat (Prefill)",
    searchByTitlePlaceholder: "Search by title or snippet...",
    fillComposer: "FILL COMPOSER",
    starterDeck1Eyebrow: "Start with a task",
    starterDeck1Title: "Explore your library with a lighter touch.",
    starterDeck1Description: "Ask a focused question, then let Explore search, summarize, and stitch together the minimal context needed.",
    starterDeck2Eyebrow: "Private by default",
    starterDeck2Title: "Ask for the shape of the work, not the whole transcript.",
    starterDeck2Description: "Explore is most useful when it compresses a library into a narrow, trustworthy answer you can inspect.",
    starterDeck3Eyebrow: "Work in layers",
    starterDeck3Title: "Start broad, then narrow to the sources that matter.",
    starterDeck3Description: "Use a starter prompt to get a compact answer, then inspect the source conversations if you need verification.",
    modeStages: {
      agent: [
        "Planning the route...",
        "Scanning lightweight library cues...",
        "Collecting source evidence...",
        "Compiling context draft...",
        "Synthesizing a longer answer...",
      ],
      classic: [
        "Understanding your question...",
        "Searching indexed context...",
        "Synthesizing a longer answer...",
      ],
    },
    starterDecks: [
      {
        eyebrow: "Start with a task",
        title: "Explore your library with a lighter touch.",
        description: "Ask a focused question, then let Explore search, summarize, and stitch together the minimal context needed.",
        privacyTip: "Keep prompts narrow. Ask for themes, decisions, or one time window instead of raw transcripts.",
        capabilityHint: "Summaries, weekly digests, and source-grounded answers are all available here.",
        prompts: [
          {
            title: "Summarize this week",
            prompt: "Summarize what I worked on this week and highlight the main decisions.",
            detail: "Great for rolling up a recent batch of conversations into a concise review.",
          },
          {
            title: "Find the decision trail",
            prompt: "Show the conversations that explain how we reached the final decision.",
            detail: "Use this when you want the context behind a conclusion, not just the conclusion.",
          },
          {
            title: "Group related threads",
            prompt: "Group the most related conversations about this topic and explain why they belong together.",
            detail: "Useful for clustering a topic without exposing the full raw conversation history.",
          },
          {
            title: "Build a quick brief",
            prompt: "Create a short brief from the most relevant conversations and keep it source-grounded.",
            detail: "A compact starting point when you want a clean handoff or a summary note.",
          },
        ],
      },
      {
        eyebrow: "Private by default",
        title: "Ask for the shape of the work, not the whole transcript.",
        description: "Explore is most useful when it compresses a library into a narrow, trustworthy answer you can inspect.",
        privacyTip: "Favor descriptors like themes, blockers, or outcomes. Avoid asking for everything at once.",
        capabilityHint: "You can search across all conversations or a selected subset, then refine sources afterward.",
        prompts: [
          {
            title: "What changed?",
            prompt: "What changed across my conversations over the last week?",
            detail: "A safe way to surface progress without pulling in more than you need.",
          },
          {
            title: "Cluster the blockers",
            prompt: "Cluster the repeated blockers or open questions across my conversations.",
            detail: "Helps reveal recurring pain points and where the discussion kept circling back.",
          },
          {
            title: "Trace one topic",
            prompt: "Trace the main discussion around privacy or search and summarize the arc.",
            detail: "Good for following a single thread through multiple conversations.",
          },
          {
            title: "Surface next steps",
            prompt: "Surface the next actions implied by the most relevant conversations.",
            detail: "Turns scattered discussion into a practical follow-up list.",
          },
        ],
      },
      {
        eyebrow: "Work in layers",
        title: "Start broad, then narrow to the sources that matter.",
        description: "Use a starter prompt to get a compact answer, then inspect the source conversations if you need verification.",
        privacyTip: "Short prompts usually reveal less than a fully detailed request, which helps keep exploration focused.",
        capabilityHint: "Ask for weekly summaries, cross-conversation themes, or a source list you can inspect manually.",
        prompts: [
          {
            title: "Weekly recap",
            prompt: "Give me a compact weekly recap with the main themes and follow-ups.",
            detail: "Designed for a weekly digest that stays concise but still useful.",
          },
          {
            title: "Theme map",
            prompt: "Map the main themes across my conversations about architecture and tooling.",
            detail: "Useful when the goal is to understand the library at a higher level first.",
          },
          {
            title: "Evidence first",
            prompt: "List the most relevant conversations for this topic and summarize each one briefly.",
            detail: "A good bridge between search and review when you want a source-backed answer.",
          },
          {
            title: "Decision summary",
            prompt: "Summarize the decision and the evidence that led to it.",
            detail: "Short, inspectable, and suitable for quick handoff notes.",
          },
        ],
      },
    ],
    libraryStarter: {
      titleTemplate: 'Continue "{cue}"',
      promptTemplate: 'Continue "{cue}" and search the related context before summarizing the key points.',
      detail: "Built from recent library cues using only lightweight title and snippet context.",
    },
    toolLabels: {
      intent_planner: "Intent Planner",
      time_scope_resolver: "Time Scope Resolver",
      weekly_summary_tool: "Weekly Summary Tool",
      query_planner: "Query Planner (Legacy)",
      search_rag: "Semantic Search",
      summary_tool: "Summary Tool",
      context_compiler: "Context Compiler",
      answer_synthesizer: "Answer Synthesizer",
    },
    toolExplanations: {
      intent_planner: "Uses the model to decide what the user is asking for, which route to run, and whether a time window is required.",
      time_scope_resolver: "Turns phrases like 'this week' into a concrete date range so the answer is auditable.",
      weekly_summary_tool: "Finds the conversations in that period, then reuses or generates a week-level digest.",
      query_planner: "Legacy fixed planning step from the earlier Explore pipeline.",
      search_rag: "Searches the knowledge base by semantic similarity to retrieve the most relevant conversations.",
      summary_tool: "Fills in missing conversation summaries so multi-source answers are easier to synthesize and inspect.",
      context_compiler: "Builds the editable context draft and source set shown in the drawer.",
      answer_synthesizer: "Produces the final answer from the collected evidence and tells the user where to inspect the result.",
    },
    intentLabels: {
      fact_lookup: "Fact Lookup",
      cross_conversation_summary: "Cross-Conversation Summary",
      weekly_review: "Weekly Review",
      timeline: "Timeline",
      clarification_needed: "Clarification Needed",
    },
    pathLabels: {
      rag: "Semantic Search",
      weekly_summary: "Weekly Summary",
      clarify: "Clarify First",
    },
    toolStatus: {
      running: "running",
      completed: "completed",
      failed: "failed",
    },
    inRange: "In range",
    unknown: "Unknown",
    unavailable: "Unavailable",
    noToolCalls: "No tool calls",
    toolCallsSummary: "{count} steps · {seconds}s",
    toolCallsSummaryFailed: "{count} steps · {failed} failed · {seconds}s",
    stepsLabel: "steps",
    failedLabel: "failed",
    untitled: "untitled",
    you: "You",
    assistantName: "Vesti",
    plan: "Plan",
    toolCalls: "Tool Calls",
    intentPrefix: "Intent:",
    routePrefix: "Route:",
    scopePrefix: "Scope:",
    timePrefix: "Time:",
    currentScopePrefix: "Current scope:",
    sourceControls: "Source Controls",
    openContextDraft: "Open Context Draft",
    sources: "Sources",
    noRelevantConversations: "No relevant conversations found",
    refreshingSuggestions: "Refreshing suggestions...",
    open: "Open",
    failedToLoadConversations: "Failed to load conversations.",
    exploreUnavailable: "Explore is unavailable in the current environment.",
    chooseAtLeastOne: "Choose at least one conversation before using Selected scope.",
    failedToRetrieveAnswer: "Failed to retrieve answer.",
    deleteConversationConfirm: "Delete this conversation?",
    contextDraftSaved: "Context draft saved.",
    savedLocally: "Saved locally for this view (storage adapter unavailable).",
    failedToSaveContext: "Failed to save context draft.",
    copiedToClipboard: "Copied to clipboard.",
    clipboardUnavailable: "Clipboard is unavailable in this environment.",
    downloaded: "Downloaded {filename}.",
    selectAtLeastOneSource: "Select at least one source before regenerating.",
    couldNotDetermineQuery: "Could not determine the query for this answer.",
    regeneratedNotice: "Regenerated as a new turn using {count} selected source(s).",
    failedToRegenerate: "Failed to regenerate answer.",
    dismiss: "Dismiss",
    untitledSession: "Untitled",
    noMessages: "No messages",
    rename: "Rename",
    delete: "Delete",
    inputLabel: "Input:",
    outputLabel: "Output:",
    errorLabel: "Error:",
    resizeSidebarAria: "Resize Explore sidebar",
    resizeDrawerAria: "Resize Explore details drawer",
    executionDetails: "Execution Details",
    contextDraft: "Context Draft",
    plannerDecision: "Planner Decision",
    sourceLimitPrefix: "Source limit:",
    summaryTargetPrefix: "Summary target:",
    timeScopePrefix: "Time scope:",
    whyThisRoute: "Why This Route",
    goalPrefix: "Goal:",
    clarificationPrefix: "Clarification:",
    plannedTools: "Planned Tools",
    plannerFootnote: "The planner chooses the high-level route with the model. Tool execution stays bounded and inspectable in the app.",
    noPlannerMetadata: "No planner metadata was recorded for this answer.",
    noToolCallsRecorded: "No tool calls were recorded for this answer.",
    activeQuery: "Active Query",
    selectedSourcesPrefix: "Selected sources:",
    candidateSources: "Candidate Sources",
    noContextCandidates: "No context candidates for this answer.",
    saving: "Saving...",
    saveSelection: "Save Selection",
    regenerateAnswer: "Regenerate Answer",
    openDraft: "Open Draft",
    regenerationFootnote: "Regeneration appends a new turn using only the selected conversations.",
    draftEditable: "Draft (Editable)",
    save: "Save",
    copy: "Copy",
    downloadTxt: "Download TXT",
  },
  data: {
    title: "Data Management",
    unavailableTitle: "Data operations unavailable",
    unavailableDesc: "This environment does not provide export/clear/storage APIs.",
    usedAppLimit: "Used / App limit (1GB)",
    unknown: "Unknown",
    browserQuota: "Browser quota",
    healthy: "Healthy",
    softLimitWarning: "Soft limit warning",
    writeBlocked: "Write blocked",
    storageWarning: "Storage crossed 900MB. Export or clear old data soon.",
    storageBlocked: "Storage reached 1GB. New writes are blocked until you export or clear data.",
    advancedStorageDetails: "Advanced storage details (Chrome)",
    chromeStorageUsed: "chrome.storage.local used",
    estimatedIndexedDb: "Estimated IndexedDB + other",
    softLimit: "Soft limit",
    unlimitedStorage: "unlimitedStorage",
    enabled: "enabled",
    disabled: "disabled",
    exportLocalData: "Export local data",
    exportFormat: "Export {format}",
    exportHint: "JSON is reversible and includes summaries + weekly caches. TXT/MD are human-readable exports.",
    dangerZone: "Danger zone",
    dangerDesc: "Clears all conversations, messages, cached summaries, and weekly reports. LLM configuration remains unchanged.",
    clearLocalData: "Clear local data",
    clearPrompt: "This will clear all local conversations and cached insights.\\nType DELETE to continue:",
    clearCancelled: "Clear cancelled.",
    localDataCleared: "Local data cleared. LLM configuration is kept.",
    exportedFile: "Exported {filename}",
    runningDataAction: "Running data action...",
    refreshingStorage: "Refreshing storage...",
  },
  network: {
    emptyTitle: "Your temporal network will appear here.",
    emptyDesc: "Capture a few conversations first, then reopen Network to watch the graph evolve over time.",
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
    thinkingMapView: "Thinking map",
    conversationMapView: "Conversations",
    thinkingMapEmpty:
      "Generate conversation summaries in the Library first — the thinking map is built from the key insights inside them.",
    loadingThinkingMap: "Building your thinking map...",
    gapInsightTitle: "Threads you haven't connected",
    gapInsightTemplate: "You explored {a} and {b} but never linked them",
    conceptMentionedIn: "Across {count} conversations",
    relatedConversations: "Related conversations",
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
}: DashboardProps) {
  const labels = providedLabels ?? DEFAULT_LABELS;
  const SETTINGS_KEY = "vesti_llm_settings";
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "library";
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "explore" || tab === "network" || tab === "library") return tab;
    return "library";
  });
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
      if (tab === "library" || tab === "explore" || tab === "network") {
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
            ? labels.settings.noSharedDatabasesFound
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
          ? labels.settings.noSharedDatabasesFound
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
      setNotionMessage(
        labels.settings.selectedDatabaseMessage.replace("{title}", database.title)
      );
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
    </nav>
  );

  const userMenu = (
    <div ref={userMenuRef} className="relative">
      <button
        type="button"
        onClick={() => setSettingsOpen((open) => !open)}
        className="inline-flex items-center gap-1 rounded-lg p-1.5 transition-colors hover:bg-bg-surface-card"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-primary text-sm font-sans text-text-inverse">
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
            <div className={`h-full ${activeTab === "explore" ? "block" : "hidden"}`}>
              <ExploreTab
                storage={storage}
                themeMode={themeMode}
                onOpenConversation={handleOpenConversation}
                labels={labels.explore}
              />
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
                          className="rounded-md bg-accent-primary px-3 py-1.5 text-xs font-medium text-text-inverse transition-colors hover:bg-accent-primary-hover"
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
                                className="rounded-md bg-accent-primary px-3 py-1.5 text-xs font-sans font-medium text-text-inverse transition-colors hover:bg-accent-primary-hover disabled:opacity-60"
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
                  <DataManagementPanel storage={storage} labels={labels.data} />
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </LibraryDataProvider>
  );
}
