export const enTranslations = {
  common: {
    save: "Save",
    cancel: "Cancel",
    loading: "Loading...",
    copy: "Copy",
    copied: "Copied",
    retry: "Retry",
    close: "Close",
    open: "Open",
    refresh: "Refresh",
    connect: "Connect",
    disconnect: "Disconnect",
    soon: "Soon",
    unknown: "Unknown",
    notAvailable: "N/A",
    archive: "Archive",
    archiving: "Archiving...",
    selected: "Selected",
    of: "of",
    done: "Done",
    error: "Error",
    delete: "Delete",
    download: "Download",
    search: "Search",
    all: "All",
    none: "None",
    confirm: "Confirm",
    back: "Back",
    next: "Next",
    previous: "Previous",
    archived: "Archived",
    exporting: "Exporting...",
    imported: "Imported",
    expand: "Expand",
    collapse: "Collapse"
  },

  onboarding: {
    brandName: "VESTI",
    eyebrow: "Your private AI memory",
    subtitle: "Save conversations. Grow lasting knowledge.",
    intro:
      "VESTI quietly collects your AI conversations and turns them into a searchable, local-first knowledge trail.",
    quickStart: "Quick start",
    quickStartWorking: "Importing your most recent week of AI history...",
    quickStartDescription:
      "Import one week of history, with local demo cases as a safe fallback.",
    quickStartSuccess: "Your recent memories are ready. Opening VESTI...",
    quickStartNoTab:
      "VESTI is ready. Open a supported AI conversation to begin collecting.",
    quickStartUnavailable:
      "VESTI is ready, but the open conversation could not be captured yet.",
    skip: "Skip onboarding and start using →",
    privacy:
      "No account required. Your conversation library stays on this device.",
    supportedPlatforms:
      "Works with ChatGPT, Claude, Gemini, DeepSeek, Doubao, Qwen, Kimi, and Yuanbao.",
    actionFailed: "Something interrupted setup. Please try again.",
    setupTitle: "Make VESTI yours",
    setupSubtitle: "Three quick choices. You can change them later.",
    stepOf: "Step {current} of {total}",
    captureStepTitle: "How should VESTI collect conversations?",
    captureStepDescription:
      "Quick start always saves once when you explicitly ask it to.",
    captureMirror: "Automatic",
    captureMirrorDescription:
      "Save supported conversations quietly as they develop.",
    captureSmart: "Smart filter",
    captureSmartDescription:
      "Keep substantial conversations and hold short or blocked ones.",
    captureManual: "Manual",
    captureManualDescription:
      "Only save when you explicitly archive a conversation.",
    aiStepTitle: "Choose AI access",
    aiStepDescription:
      "Demo mode works immediately. A personal key is optional.",
    demoMode: "Demo — recommended",
    demoModeDescription: "Use VESTI's managed gateway with no setup or login.",
    byokMode: "Use my API key",
    byokModeDescription:
      "Store a personal DashScope-compatible key locally on this device.",
    apiKeyLabel: "API key",
    apiKeyPlaceholder: "sk-...",
    apiKeyInvalid: "Enter a valid key with at least 12 characters.",
    connectionTest: "Test connection",
    connectionTesting: "Testing...",
    connectionOptional: "Testing is optional and never blocks saving.",
    preferencesStepTitle: "Choose your workspace feel",
    preferencesStepDescription:
      "Set language, appearance, and the floating capture capsule.",
    languageLabel: "Language",
    themeLabel: "Appearance",
    themeLight: "Light",
    themeDark: "Dark",
    capsuleLabel: "Floating capsule",
    capsuleDescription:
      "Show lightweight capture status on supported AI sites.",
    back: "Back",
    next: "Continue",
    finish: "Finish setup",
    finishing: "Finishing...",
    resumeHint: "Your progress is saved automatically.",
    saveFailed: "Your choices could not be saved. Please retry.",
    capturedBanner: "Your latest conversation is ready.",
    noTabBanner:
      "VESTI is ready. Visit a supported AI conversation to capture your first memory.",
    unavailableBanner:
      "VESTI is ready. Reload the AI page if its current conversation does not appear.",
    dismiss: "Dismiss"
  },

  pages: {
    threads: "Threads",
    insights: "Insights",
    data: "Data",
    settings: "Settings"
  },

  dock: {
    threads: "Threads",
    explore: "Explore",
    aiti: "AITI",
    roundtable: "Roundtable",
    insights: "Insights",
    dataManagement: "Data Management",
    settings: "Settings",
    openLibrary: "Open Library Dashboard",
    navigation: "Vesti navigation",
    threadsDesc:
      "All your captured chats — search, tag, and pick up where you left off.",
    exploreDesc: "Ask questions across your local conversation library.",
    aitiDesc: "See the AI-usage persona inferred from your conversations.",
    roundtableDesc: "Discuss one topic with three contrasting AI roles.",
    insightsDesc:
      "An auto-summary of each chat, plus a weekly digest of your thinking.",
    dataDesc:
      "Back up and restore your library, and import past chats from each platform.",
    settingsDesc: "Models, capture, language, and theme.",
    openLibraryDesc:
      "Open the full web app — Library, Explore, Knowledge Graph, and Prompts."
  },

  coreFeatures: {
    dashboard: {
      mergeSummary: "Generate merged summary",
      summaryLabel: "Merged memory summary",
      continueFromSummary: "Start a new conversation from this summary",
      toast: "✨ Memories packed. Context continues seamlessly",
      summaryError: "The selected conversations could not be summarized.",
      continuationError: "The continuation conversation could not be created."
    },
    explore: {
      title: "Knowledge Explorer",
      description: "Ask across every conversation stored on this device.",
      contextTitle: "Continuation context",
      emptyTitle: "The knowledge kitten is ready",
      emptyDescription:
        "Ask a question and VESTI will search the full text of your local conversation library.",
      placeholder: "Ask your knowledge base...",
      ask: "Ask knowledge base",
      toast: "The kitten searched your knowledge base",
      error: "The knowledge base could not be searched."
    },
    aiti: {
      title: "Your AI usage persona",
      description:
        "A local analysis of the patterns across your saved conversations.",
      sample: "Based on {count} conversations",
      toast: "Your AI usage persona is ready",
      error: "Your persona could not be analyzed."
    },
    roundtable: {
      title: "AI Roundtable",
      description: "Three roles respond to the same topic in parallel.",
      placeholder: "What should the panel discuss?",
      start: "Start discussion",
      toast: "All three roles are seated. Let's talk!",
      error: "The roundtable could not be started.",
      roleFailed: "This role could not respond. Please try again.",
      roles: {
        domain_expert: "Domain expert",
        devils_advocate: "Devil's advocate",
        skeptic: "Skeptic"
      }
    }
  },

  settings: {
    title: "Settings",
    groups: {
      personalisation: "Personalisation",
      system: "System",
      support: "Support"
    },
    appearance: {
      title: "Appearance",
      description: "Theme and display preferences.",
      darkMode: "Dark Mode",
      darkModeDesc: "Minimalist dark palette.",
      compactCards: "Compact Cards",
      compactCardsDesc: "Reduce card padding.",
      themeLoading: "Applying theme...",
      darkEnabled: "Dark mode enabled.",
      lightEnabled: "Light mode enabled."
    },
    language: {
      title: "Language",
      description: "Interface language",
      auto: "Auto (follow browser)",
      en: "English",
      zh: "中文",
      ja: "日本語",
      ko: "한국어"
    },
    modelAccess: {
      title: "Model Access",
      description: "BYOK & proxy configuration",
      privacyTitle: "What leaves your device",
      privacyDisclosure:
        "Capture, local storage, and keyword search stay 100% on your device. AI features (summaries, Explore, embeddings, prompt tools, roundtable) send the relevant conversation text to the configured model — by default via Vesti's proxy to Alibaba Cloud Bailian. Add your own API key for direct routing.",
      useCustomApiKey: "Use Custom API Key",
      byokDesc: "BYOK - your key, direct routing",
      proxyActive: "Proxy Active",
      byokActive: "BYOK Active",
      primary: "Primary",
      backup: "Backup",
      endpoint: "Endpoint",
      credentials: "Credentials",
      apiKeyLabel: "API Key (Chat)",
      apiKeyPlaceholder: "sk-...",
      modelLabel: "Model",
      whitelistOnly: "whitelist only",
      proxy: "Proxy",
      proxyDesc: "Demo chat and embedding requests use the Vesti gateway. The gateway selects qwen-plus and manages its own qwen-turbo fallback; the legacy gateway is used only for retryable network or server failures.",
      proxyChat: "Proxy chat",
      proxyRoute: "Route",
      proxyBaseUrl: "Base URL",
      proxyHeader: "Header",
      serviceTokenAttached: "attached",
      serviceTokenOmitted: "omitted",
      serviceTokenLabel: "Service Token",
      serviceTokenOptional: "optional",
      serviceTokenPlaceholder: "Pre-filled by default",
<<<<<<< HEAD
      baseUrlPlaceholder: "https://api.ccvg1218.online",
=======
      baseUrlPlaceholder: "https://api.ccvg1218.online/api",
>>>>>>> origin/main
      save: "Save",
      test: "Test",
      testing: "Working...",
      saved: "Saved.",
      connectionVerified: "Connection verified.",
      testFailed: "Connection test failed.",
      apiKeyRequired: "API key is required in custom mode."
    },
    captureEngine: {
      title: "Capture Engine",
      description: "Mode and archive controls.",
      modeLabel: "Capture Mode",
      fullMirror: {
        label: "Full Mirror",
        desc: "Capture all parsed conversation updates."
      },
      smartDenoising: {
        label: "Smart Denoising",
        desc: "Capture only when min-turn and keyword rules pass."
      },
      manualArchive: {
        label: "Manual Archive",
        desc: "Hold captures until you archive the active thread manually."
      },
      minTurnsLabel: "Minimum turns (1-20)",
      blacklistLabel: "Blacklist keywords (comma separated)",
      blacklistPlaceholder: "translation, draft",
      manualModeHint: "Manual mode blocks automatic writes until you archive.",
      captureHint:
        "Capture writes only after a stable conversation URL ID is available.",
      activeThread: "Active thread",
      snapshot: "Snapshot",
      lastUpdate: "Last update",
      lastDecision: "Last decision",
      messages: "messages",
      turns: "turns",
      unavailable: "Unavailable",
      archive: "Archive",
      archiving: "Archiving...",
      archiveActiveThread: "Archive Active Thread",
      archiveHint: "Available in Smart/Manual mode with an active snapshot.",
      saveSettings: "Save Capture Settings",
      settingsSaved: "Capture settings saved.",
      archivedSummary: "Saved · {count} messages"
    },
    notionExport: {
      title: "Notion Export",
      description: "One-shot export for saved annotations",
      oauthConnected: "OAuth Connected",
      officialOAuth: "Official OAuth",
      connectDesc:
        "Connect with Notion, then choose the database used for one-shot annotation exports.",
      connectBtn: "Connect to Notion",
      connected: "Notion workspace connected",
      reconnect: "Change",
      disconnect: "Disconnect",
      legacyToken:
        "Legacy token detected. Reconnect to upgrade to official OAuth.",
      workspaceReady: "Your workspace is ready. Choose a database below.",
      oauthFlowDesc:
        "Opens the official Notion authorization flow in a secure browser window.",
      extensionOnly:
        "OAuth login is available only inside the extension build.",
      targetDatabase: "Target Database",
      databasePlaceholder: "Search shared databases",
      noDatabases:
        "No shared databases found yet. Share the database with the integration, then refresh.",
      shareHint:
        "If the database does not appear yet, share it with the integration in Notion, then refresh.",
      selected: "Selected",
      chooseDatabase: "Choose a database to enable annotation export.",
      connecting: "Connecting...",
      connectedMsg: "Notion connected.",
      disconnectedMsg: "Notion disconnected."
    },
    dataManagement: {
      title: "Data Management",
      description: "Storage, export, and cleanup.",
      dataToolsDesc: "Data tools are available in the Data tab.",
      dataToolsHint: "Use it for storage overview, exports, and cleanup.",
      openDataTab: "Open Data Management"
    },
    desktop: {
      title: "Connect VESTI Desktop",
      description:
        "Pair with the desktop app and sync your library to this computer.",
      statusLabel: "Status",
      statusOnline: "Desktop online",
      statusOffline: "Desktop offline",
      statusNotPaired: "Not paired",
      statusNeedsRepair: "Re-pairing required",
      pairedAt: "Paired",
      lastSync: "Last sync",
      neverSynced: "Never",
      syncing: "Syncing...",
      codeLabel: "Pairing code",
      codePlaceholder: "6-digit code from the desktop app",
      codeInvalid: "Invalid or expired pairing code.",
      desktopOffline:
        "Desktop app not detected. Start VESTI Desktop and try again.",
      desktopIncompatible:
        "The desktop app uses an incompatible bridge protocol. Please update it.",
      pairFailed: "Pairing failed. Try again.",
      connect: "Connect",
      connecting: "Connecting...",
      disconnect: "Disconnect",
      disconnected: "Disconnected from VESTI Desktop.",
      syncNow: "Sync now",
      syncResult: "Pushed {conversations} conversations · {messages} messages",
      syncSkipped: "Nothing new to sync.",
      repairHint:
        "The desktop app rejected the saved token. Pair again with a new code.",
      firstSyncHint: "The first sync runs automatically right after pairing.",
      statusWaitingConfirm: "Waiting for confirmation",
      waitingConfirmHint:
        'Desktop found — click "Allow" in the VESTI app window to finish connecting.',
      waitingRetryHint:
        "Not confirmed yet. Retry to bring the confirmation up in the VESTI app again, or wait for the next automatic attempt.",
      statusWindowClosed: "Pairing window closed",
      windowClosedHint:
        "Desktop found, but its pairing window is closed. Open the pairing window in the VESTI app's settings, then retry.",
      statusRejected: "Declined",
      rejectedCooldown:
        "The connection was declined in the VESTI app. You can retry in about {minutes} min.",
      retryConnect: "Retry",
      reconnect: "Reconnect",
      disconnectedHint:
        "Disconnected manually. The extension will not reconnect automatically — use the button below when you're ready.",
      offlineHint:
        "Desktop app not detected. Launch the VESTI desktop app (install it first if needed) — the extension then connects automatically.",
      usePairCode: "Connect with a pairing code (fallback)"
    },
    relay: {
      title: "Pending Handoff Packets",
      description:
        "Handoff packets sent from the desktop app, ready to fill the composer of an AI platform tab.",
      countLabel: "{count} packet(s) waiting to inject.",
      inject: "Inject into current tab",
      injecting: "Injecting...",
      dismiss: "Dismiss",
      injected:
        "Filled into the current tab's composer — review and send it there.",
      empty: "No pending packets.",
      unsupportedTab:
        "The current tab is not a supported AI platform. Open the target platform page first.",
      contentUnreachable:
        "The platform page is not ready. Refresh it and try again.",
      fillFailed:
        "Could not locate the composer on this page. Try again once it has finished loading.",
      failedHint: "Last attempt failed — you can retry."
    },
    support: {
      docsHelp: "Docs & Help",
      sendFeedback: "Send Feedback",
      contactHint: "Contact us directly or open an issue on GitHub.",
      copyEmail: "Copy",
      copied: "Copied",
      retry: "Retry",
      openIssue: "Open a GitHub Issue",
      whatsNew: "What's New"
    }
  },

  timeline: {
    searchPlaceholder: "Search conversations",
    searchAriaLabel: "Search conversations",
    filterAriaLabel: "Filter conversations",
    cancel: "Cancel",
    firstCapturedToday: "first captured today",
    lastCaptured: "Last captured",
    conversedAt: "Conversation",
    searchResults: "Top matches",
    noConversations: "No conversations yet",
    searchingMessages: "Searching messages...",
    noMatches: "No matches",
    startedToday: "Started Today",
    startedThisWeek: "Started This Week",
    startedEarlier: "Started Earlier",
    capturedToday: "Captured Today",
    capturedThisWeek: "Captured This Week",
    capturedEarlier: "Captured Earlier",
    sortByOrigin: "By conversation time",
    sortByCapture: "By capture time",
    timelineReset: "Reset",
    addToProject: "Add to project",
    noGroup: "No group",
    select: "Select",
    selectConversation: "Select conversation",
    deselectConversation: "Deselect conversation",
    goToOriginalUrl: "Go to Original URL",
    sourceUrlUnavailable: "Source URL unavailable",
    filters: {
      started: "Started",
      source: "Source"
    },
    datePresets: {
      allTime: "Started any time",
      today: "Started today",
      thisWeek: "Started this week",
      thisMonth: "Started this month"
    },
    allSources: "All sources",
    messages: "messages",
    turns: "turns",
    star: "Star",
    unstar: "Unstar",
    rename: "Rename",
    editTitle: "Edit conversation title",
    moreActions: "More actions",
    copyFullText: "Copy Full Text",
    copied: "Copied!",
    deleteConversation: "Delete conversation",
    relativeTime: {
      justNow: "just now",
      minutesAgo: "m ago",
      hoursAgo: "h ago",
      daysAgo: "d ago",
      monthsAgo: "mo ago"
    },
    batch: {
      clearSelection: "Clear selection",
      export: "Export",
      delete: "Delete",
      star: "Star",
      archive: "Archive",
      addToFolder: "Add to folder",
      folderNamePlaceholder: "Folder name (e.g. Work, Research)",
      add: "Add",
      close: "Close",
      exit: "Exit",
      exportPanelTitle: "Export",
      deletePanelTitle: "Delete",
      deleteConfirm: "Type DELETE to confirm",
      deleteWarning: "This action cannot be undone.",
      exportLabel: "Export",
      deleteLabel: "Delete",
      exportModeLabel: "Export mode",
      exportFormatLabel: "Export format",
      currentFormat: "Current format",
      threadSingular: "thread",
      threadPlural: "threads",
      confirmation: "Confirmation",
      confirmDelete: "Confirm delete",
      deselectAll: "Deselect All",
      selectAll: "Select all",
      selected: "selected",
      inCurrentResults: "in current results",
      toContinue: "to continue",
      deleteDescSingular:
        "This will remove the selected thread and its messages from local storage. Type",
      deleteDescPlural:
        "This will remove {count} selected threads and their messages from local storage. Type",
      exportFormats: {
        md: {
          name: "Markdown",
          desc: "Markdown export for notes, docs, and writing tools"
        },
        txt: {
          name: "Text",
          desc: "Plain text export for quick reading and copy/paste"
        },
        json: {
          name: "JSON",
          desc: "Structured export for backup, review, and reprocessing"
        }
      },
      exportModes: {
        full: {
          label: "Full",
          desc: "Keep the complete thread transcript locally."
        },
        compact: {
          label: "Compact",
          desc: "Distilled handoff for the next agent. Tries current LLM settings first, then local fallback."
        },
        summary: {
          label: "Summary",
          desc: "Human note format. Tries current LLM settings first, then local fallback."
        }
      },
      copyExport: "Copy export",
      downloadExport: "Download export",
      copiedToClipboard: "Copied export to clipboard.",
      copiedFormatToClipboard: "Copied {format} export to clipboard.",
      savedAs: "Saved as {filename}.",
      exported: "Exported {filename}",
      clipboardFailed: "Generated export could not be copied to the clipboard.",
      clipboardHint: "Check clipboard permissions or use Download instead.",
      clipboardUnavailable: "Copy unavailable",
      exportPanelDesc:
        "Keep Data-style format rows and choose the export density here."
    }
  },

  exportDialog: {
    title: "Export {count} thread",
    titlePlural: "Export {count} threads",
    tokens: "~{count} tokens",
    content: "Content",
    format: "Format",
    modeFull: "Full",
    modeFullDesc: "Complete history",
    modeCompact: "Compact",
    modeCompactDesc: "AI-compressed",
    modeSummary: "Summary",
    modeSummaryDesc: "Key points only",
    formatMd: "Markdown",
    formatTxt: "Text",
    formatJson: "JSON",
    download: "Download",
    copy: "Copy",
    copied: "Copied!",
    close: "Close"
  },

  data: {
    storage: "Storage",
    storageDesc: "Used space, quota, and browser details",
    export: "Export",
    exportDesc: "Download data in JSON, TXT, or MD",
    exportJsonDesc: "Reversible - includes summaries and weekly caches",
    exportTxtDesc: "Human-readable plain text export",
    exportMdDesc: "Markdown - compatible with Obsidian and notes tools",
    exportAction: "Export",
    importJson: "Import JSON",
    importJsonDesc:
      "Restore a reversible backup and replace captured data tables",
    exportFormatLabel: "Export format",
    exportedMessage: "Exported {filename}",
    importConfirm:
      "Import {filename}?\n\nThis will replace local conversations, messages, summaries, weekly reports, annotations, and search vectors with the JSON backup.\nLLM settings, notes, topics, and Explore sessions stay unchanged.",
    importCancelled: "Import cancelled.",
    importedMessage: "Imported {summary} from {filename}",
    importSummary: {
      threads: "{count} threads",
      messages: "{count} messages",
      summaries: "{count} summaries",
      weeklyReports: "{count} weekly reports",
      annotations: "{count} annotations"
    },
    clearCacheConfirm:
      "Clear cached summaries and weekly reports only?\nConversations and messages will be kept.",
    cacheClearedMessage:
      "Insights cache cleared. Conversations and messages were kept.",
    clearAllConfirm:
      "This will clear all local conversations, messages, summaries, and weekly reports.\nType DELETE to continue:",
    clearCancelled: "Clear cancelled.",
    dataCleared: "Local data cleared. LLM configuration is kept.",
    history: {
      title: "Import platform history",
      subtitle: "Bring in past conversations from this AI platform",
      description:
        "Vesti reads your existing threads through the platform's own API (using your current login) and saves them locally. Read-only — nothing is sent or submitted.",
      supportedNote:
        "Supported here: ChatGPT, Claude, Gemini, DeepSeek, Doubao, Qwen, Kimi and Yuanbao.",
      unsupportedTab:
        "Open a supported AI platform (ChatGPT, Claude, Gemini, DeepSeek, Doubao, Qwen, Kimi, Yuanbao) in the active tab, then come back to import its history.",
      notLoggedIn: "Sign in to {platform} in the active tab first, then retry.",
      ready: "Ready to import from {platform}.",
      start: "Import {platform} history",
      starting: "Starting…",
      cancel: "Cancel",
      listing: "Finding conversations…",
      running: "Importing… {processed}/{discovered}",
      doneSummary:
        "Done. {saved} imported · {newMessages} new messages · {skipped} skipped · {failed} failed.",
      cancelledSummary: "Cancelled. {saved} imported so far.",
      errorSummary: "Import failed: {error}",
      confirm:
        "Import your conversation history from {platform}? Vesti reads your threads via the platform's own API and saves them locally. Nothing is sent or submitted."
    },
    cleanup: "Cleanup",
    cleanupDesc: "Remove summary cache or wipe all local data",
    dashboard: "Dashboard",
    dashboardDesc: "Usage trends and compaction analytics",
    overview: "Overview",
    operations: "Operations",
    roadmap: "Roadmap",
    totalConversations: "Total conversations",
    compactedThreads: "Compacted threads",
    summaryRecords: "Summary records",
    weeklyReports: "Weekly reports",
    storageUsed: "Storage used",
    storageQuota: "Storage quota",
    softLimit: "Soft limit",
    hardLimit: "Hard limit",
    usedAppLimit: "Used / App limit (1GB)",
    browserQuota: "Browser quota",
    healthy: "Healthy",
    unknown: "Unknown",
    softLimitWarning: "Soft limit warning",
    writeBlocked: "Write blocked",
    storageWarning: "Storage crossed 900MB. Export or clear old data soon.",
    storageBlocked:
      "Storage reached 1GB. New writes are blocked until you export or clear data.",
    advancedStorageDetails: "Advanced storage details",
    threadsStored: "Threads stored",
    indexedDbStore: "IndexedDB store",
    lastCompaction: "Last compaction",
    insightsCache: "Insights cache",
    clearCache: "Clear cache",
    dangerZone: "Danger zone",
    clearLocalData: "Clear local data",
    importAction: "Import",
    compactionNote:
      "Compacted metrics currently use summary cache proxy and can be upgraded to strict Agent A compaction lineage later.",
    chromeStorageUsed: "chrome.storage.local used",
    estimatedIndexedDb: "Estimated IndexedDB + other",
    clearCacheDesc:
      "Clears cached thread summaries and weekly reports while keeping conversations and messages.",
    dangerDesc:
      "Clears all conversations, messages, cached summaries, and weekly reports. LLM configuration remains unchanged.",
    exportAllData: "Export all data",
    importData: "Import data",
    clearAllData: "Clear all data",
    clearInsightsCache: "Clear insights cache",
    noUndo: "This action cannot be undone."
  },

  insights: {
    title: "Insights",
    onDemand: "On-demand",
    scheduled: "Scheduled",
    discovery: "Discovery",
    threadSummary: "Thread Summary",
    threadSummaryDesc: "AI-generated digest of the active thread",
    weeklyDigest: "Weekly Digest",
    weeklyDigestDesc: "Highlights from the past seven days",
    exploreNetwork: "Explore & Network",
    exploreNetworkDesc: "Knowledge graph and thread connections",
    explore: "Explore",
    exploreDesc: "Browse and search your knowledge base",
    network: "Knowledge Graph",
    networkDesc: "Visualize connections between conversations",
    conversationSummary: "Conversation Summary",
    generate: "Generate",
    generating: "Generating...",
    noThreadSelected: "No thread selected",
    selectThread: "Select a thread from the timeline to generate a summary.",
    selectThreadHint: "Select a thread from Threads to generate a summary.",
    summaryReady: "Summary ready",
    summaryError: "Failed to generate summary",
    weeklyReady: "Weekly digest ready",
    weeklyError: "Failed to generate weekly digest",
    weeklySparse: "Not enough data this week",
    summaryDegraded: "Summary completed with degraded fallback.",
    summaryGenerated: "Summary generated.",
    readyToGenerate: "Ready to generate.",
    readyToCompile: "Ready to compile weekly digest.",
    generatingDigest: "Generating digest...",
    resume: "Resume",
    pause: "Pause",
    resumeProgress: "Resume progress view",
    pauseProgress: "Pause progress view",
    pausedResumeHint: "Paused. Resume to continue progress animation.",
    regenerate: "Regenerate",
    generateSummary: "Generate Summary",
    generateDigest: "Generate digest for this week",
    noSummaryYet: "No summary yet. Click Generate Summary to begin.",
    noThreadsThisWeek: "No threads started this week yet.",
    threadInRange: "thread in range",
    threadsInRange: "threads in range",
    threadsStartedInRange: "Threads started in range",
    last7Days: "Last 7 Days",
    lastFullWeek: "Last Full Week",
    coreQuestion: "Core Question",
    thinkingJourney: "Thinking Journey",
    keyInsights: "Key Insights",
    unresolvedThreads: "Unresolved Threads",
    nextSteps: "Next Steps",
    metaObservations: "Meta Observations",
    reasoningNodes: "Real-world anchors cover {count} reasoning nodes.",
    highlights: "Highlights",
    recurringQuestions: "Recurring Questions",
    crossDomainEcho: "Cross-Domain Echo",
    unresolved: "Unresolved",
    nextWeek: "Next Week",
    sharedLogic: "Shared logic",
    recapTitle: "Your Week in Review",
    statConversations: "Conversations",
    statActiveDays: "Active days",
    statStreak: "Week streak",
    statTopPlatform: "Top platform",
    recapHighlight: "Highlight of the week",
    recapEncouragement: "Encouragement",
    recapNextWeek: "For next week",
    recapStatConversations: "{count} conversations",
    recapStatActiveDays: "{count} active days",
    recapStatStreak: "{count}-week streak",
    recapStatPlatform: "mostly on {platform}",
    recapGenerating: "Putting your week together...",
    depthLabels: {
      deep: "Deep Dive",
      moderate: "Moderate Analysis",
      superficial: "Light Overview"
    },
    latestRegenerationFailed: "Latest regeneration failed.",
    failedToGenerateWeekly: "Failed to generate weekly digest.",
    weeklyGenerationTimeout: "Generation timed out. Please try again.",
    failedToGenerateSummary: "Failed to generate summary.",
    notEnoughData: "Not enough data to generate this week's digest.",
    sub3Hint:
      "This range has fewer than 3 substantial summaries. Weekly Digest will resume automatically when enough structured evidence is available.",
    semanticDegradedHint:
      "Enough summaries were found, but semantic quality gate downgraded this run to prevent low-signal fragments.",
    substantialSummaries: "Substantial summaries",
    uiPauseOnly: "UI pause only. Background generation continues.",
    modelLabel: "Model",
    generatedLabel: "Generated",
    storageLimitError:
      "Storage limit reached (1GB). Export or clear data in the Data tab.",
    unknownError: "Unknown error.",
    moreThreads: "{count} more",
    thread: "Thread",
    phases: {
      loadingSummaries: {
        label: "Loading thread summaries",
        desc: "Reading stored summaries for the selected week",
        hint: "~12s",
        status: "Loading this week's thread summaries..."
      },
      patternDetection: {
        label: "Pattern detection",
        desc: "Cross-thread frequency and recurrence analysis",
        hint: "~14s",
        status: "Scanning for recurring patterns..."
      },
      crossDomainMapping: {
        label: "Cross-domain mapping",
        desc: "Structural isomorphism detection",
        hint: "~15s",
        status: "Mapping cross-domain echoes..."
      },
      composing: {
        label: "Composing and persisting",
        desc: "Digest composition and persistence",
        hint: "~10s",
        status: "Composing and writing digest..."
      }
    },
    threadPhases: {
      preparing: {
        label: "Initialising pipeline",
        desc: "Checking cache and waking context window",
        status: "Preparing conversation context..."
      },
      distilling: {
        label: "Distilling logic",
        desc: "Tracing what changed across turns",
        status: "Distilling core logic..."
      },
      curating: {
        label: "Curating summary",
        desc: "Building journey steps and insight glossary",
        status: "Curating structured summary..."
      },
      finalising: {
        label: "Finalising artefacts",
        desc: "Writing storage record and refreshing card",
        status: "Finalising and persisting..."
      }
    }
  },

  reader: {
    loading: "Loading...",
    buildingIndex: "Building search index...",
    noMessages: "No messages",
    copy: "Copy",
    copied: "Copied",
    copyTeX: "Copy TeX",
    copyCode: "Copy code",
    plain: "plain",
    searchResults: "Search results",
    resultOf: "of",
    prevResult: "Previous result",
    nextResult: "Next result",
    closeSearch: "Close search",
    timestamp: {
      started: "Started",
      lastUpdated: "Last updated",
      captured: "Captured",
      sourceTime: "Source Time",
      summaryStarted: "Started",
      summaryUpdated: "last updated"
    }
  },

  message: {
    you: "You",
    aiPrefix: "AI",
    copyMessage: "Copy message",
    source: "Source",
    sources: "Sources",
    attachment: "Attachment",
    attachments: "Attachments",
    artifact: "Artifact",
    artifacts: "Artifacts"
  },

  capture: {
    status: {
      ready: "Ready",
      mirrorMode: "Mirror mode does not need manual archive.",
      unsupported_tab:
        "Open a ChatGPT, Claude, Gemini, DeepSeek, Doubao, Qwen, Kimi, or Yuanbao thread in the active tab.",
      no_transient: "No active thread snapshot detected yet.",
      content_unreachable:
        "Cannot reach page content script. Refresh the page and try again."
    },
    errors: {
      archiveModeDisabled:
        "Manual archive is available only in Smart or Manual mode.",
      activeTabUnsupported:
        "Active tab is unsupported. Open ChatGPT, Claude, Gemini, DeepSeek, Doubao, Qwen, Kimi, or Yuanbao.",
      activeTabUnavailable: "No active tab found.",
      transientNotFound:
        "No active thread snapshot found. Send one message and try again.",
      missingConversationId:
        "Current URL has no stable conversation ID yet. Continue the thread and retry.",
      emptyPayload: "No parsed messages available to archive.",
      storageLimit:
        "Storage hard limit reached. Export or clear data before archiving.",
      persistFailed: "Archive write failed. Please retry.",
      forceArchiveFailed: "Manual archive failed. Please retry."
    }
  },

  dashboard: {
    tabs: {
      library: "LIBRARY",
      explore: "EXPLORE",
      network: "KNOWLEDGE GRAPH",
      prompts: "PROMPTS"
    },
    nav: {
      backToExplore: "Back to Explore",
      backToNetwork: "Back to Knowledge Graph",
      dashboardSections: "Dashboard sections",
      closeDrawer: "Close drawer backdrop"
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
      changesStayInSync:
        "Changes here stay in sync with the dock settings panel.",
      savedLocally: "Saved locally",
      saveFailed: "Save failed",
      storedInChromeStorage: "Stored in chrome.storage.local",
      availableInExtension: "Available in extension only",
      notionWorkspaceConnected: "Notion workspace connected",
      connectToNotion: "Connect to Notion",
      legacyToken:
        "Legacy token detected. Reconnect to upgrade to official OAuth.",
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
      save: "Save",
      notionExportTitle: "Notion Export",
      notionExportDesc:
        "Connect with Notion and choose the database used for annotation export.",
      connectedChooseDatabase:
        "Connected. Choose the database used for one-shot exports.",
      oauthUnavailableOutsideExtension:
        "OAuth login is unavailable outside the extension build.",
      disconnect: "Disconnect",
      targetDatabase: "Target Database",
      databaseSearchPlaceholder: "Search shared databases",
      refresh: "Refresh",
      shareDatabaseHint:
        "Share the database with your Notion integration, then refresh if it does not appear yet.",
      selectedColon: "Selected: ",
      readyForOneShotExport: "Ready for one-shot export",
      noSharedDatabasesFound:
        "No shared databases found yet. Share the database with the integration, then refresh.",
      selectedDatabaseMessage: "Selected {title}.",
      modelscopeKeyLabel: "API Key",
      modelscopeKeyPlaceholder: "Paste your API key here",
      themeUpdateFailed: "Theme update failed."
    },
    library: {
      allConversations: "All Conversations",
      starred: "Starred",
      recent: "Recent",
      smartClassification: "SMART CATEGORIES",
      noSmartClassification: "Smart categories will appear after conversations are analyzed.",
      organizeUnclassified: "Organize",
      organizeUnclassifiedConfirm: "Analyze the next {count} unclassified conversations?",
      organizingConversations: "Organizing {done}/{total}",
      classificationComplete: "Organized {done} conversations.",
      classificationPartial: "Organized {done}; {failed} failed.",
      tags: "TAGS",
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
      loadRelatedFailed: "Failed to load related conversations",
      loadMessagesFailed: "Failed to load messages",
      initiatingPipeline: "Initiating pipeline...",
      extractingCore: "Extracting core question...",
      generatingInsights: "Generating insights...",
      savingSummary: "Saving summary...",
      analyzed: "Auto-classified",
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
      messagesAvailableButEmpty:
        "Messages are available, but preview text is empty.",
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
      startExtractingHint:
        "Start extracting from the reader or create a conversation note to keep your reading and writing side by side.",
      startWritingPlaceholder: "Start writing...",
      createConversationNote: "Create Conversation Note",
      extractedExcerptsPlaceholder:
        "Extracted excerpts and your notes will appear here...",
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
      myNotesExportUnavailable:
        "My Notes export is not available in this build.",
      savedToMyNotes: "Saved to My Notes.",
      couldNotExportToMyNotes: "Couldn't export this comment to My Notes.",
      notionExportUnavailable: "Notion export is not available in this build.",
      sentToNotion: "Sent to Notion.",
      notionSettingsMissing:
        "Connect to Notion and choose a database in Settings before exporting.",
      notionReconnectRequired:
        "Your Notion session expired. Reconnect in Settings and try again.",
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
      localNotesAndObsidianShareEditor:
        "Local notes and imported Obsidian files now share the same Markdown editor surface.",
      loadingNotes: "Loading notes...",
      createLocalNoteHint:
        "Create a local note, then export it to an Obsidian folder whenever you are ready.",
      createNote: "Create a note",
      localNotes: "Local Notes",
      noLocalNotesYet: "No local notes yet.",
      weeklyKnowledge: "Weekly Knowledge",
      weeklyKnowledgeNote: "Weekly knowledge",
      generatedFromWeeklyReport: "Generated from a weekly report",
      noWeeklyKnowledgeYet:
        "Save a growth report to build your weekly knowledge archive.",
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
      sourceFileChangedAfterEdits:
        "Source file changed after local edits. Re-import skipped to avoid overwriting this note.",
      dateUnknown: "Unknown date",
      frontmatter: "Frontmatter",
      directoryExportNotSupported:
        "This browser surface does not support local directory export.",
      directorySelectionCancelled: "Directory selection was cancelled.",
      saveBeforeExport: "Save the current note before exporting it.",
      exportFailed: "Could not export this note to Obsidian.",
      chooseConversationsTitle: "Choose Conversations",
      chooseConversationsDesc:
        "Search, preview, and pick the conversations the agent is allowed to use.",
      applySelected: "Apply Selected",
      useAll: "Use All",
      noSearchResults: "No conversations match this search.",
      noPreviewAvailable: "No preview available",
      closeSidebar: "Close sidebar",
      openSidebar: "Open sidebar",
      emptyDetailTitle: "No conversation selected",
      emptyDetailHint: "Pick a conversation from the left to read it here.",
      summaryCard: {
        coreQuestion: "Core Question",
        thinkingJourney: "Thinking Journey",
        step: "Step",
        example: "Example: ",
        keyInsights: "Key Insights",
        unresolvedThreads: "Unresolved Threads",
        metaObservations: "Meta Observations",
        thinkingStyle: "Thinking style:",
        emotionalTone: "Emotional tone:",
        depth: "Depth:",
        nextSteps: "Next Steps",
        fallback: "Fallback plain text"
      }
    },
    explore: {
      modeAgent: "Agent",
      modeClassic: "Classic",
      scopeAll: "All",
      scopeSelected: "Selected",
      executionDetails: "Execution Details",
      drawerPlan: "Plan",
      drawerToolCalls: "Tool Calls",
      drawerSources: "Sources",
      drawerContextDraft: "Context Draft",
      plannerIntent: "Intent",
      plannerRoute: "Route",
      plannerSourceLimit: "Source limit",
      plannerSummaryTarget: "Summary target",
      sourceControls: "Source Controls",
      regenerateAnswer: "Regenerate Answer",
      saveSelection: "Save Selection",
      savingSelection: "Saving...",
      saveDraft: "Save",
      chooseConversationsTitle: "Choose Conversations",
      chooseConversationsDesc:
        "Search, preview, and pick the conversations the agent is allowed to use.",
      applySelected: "Apply Selected",
      useAll: "Use All",
      noSearchResults: "No conversations match this search.",
      noPreviewAvailable: "No preview available",
      closeSidebar: "Close sidebar",
      openSidebar: "Open sidebar",
      emptyDetailTitle: "No conversation selected",
      emptyDetailHint: "Pick a conversation from the left to read it here.",
      summaryCard: {
        coreQuestion: "Core Question",
        thinkingJourney: "Thinking Journey",
        step: "Step",
        example: "Example: ",
        keyInsights: "Key Insights",
        unresolvedThreads: "Unresolved Threads",
        metaObservations: "Meta Observations",
        thinkingStyle: "Thinking style:",
        emotionalTone: "Emotional tone:",
        depth: "Depth:",
        nextSteps: "Next Steps",
        fallback: "Fallback plain text"
      },
      sendToButton: "Send to…",
      sendToNotionConversation: "Notion — conversation",
      sendToNotionSummary: "Notion — summary",
      sendToObsidianConversation: "Obsidian — conversation",
      sendToObsidianSummary: "Obsidian — summary",
      sendToNotion: "Notion",
      sendToObsidian: "Obsidian",
      sendToExporting: "Exporting…",
      sendToDone: "Sent ✓",
      sendToFailed: "Export failed",
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
      choosePromptHint:
        "Choose one to populate the composer, then edit it before sending.",
      loadingStarterIdeas: "Loading starter ideas",
      starterDeckReady: "Starter deck ready",
      cardsUpdateHint: "Cards update on every new chat.",
      askPlaceholder:
        "Ask your knowledge base, summarize a week, or trace a decision trail...",
      askAgentPlaceholder: "Ask your knowledge base (Agent mode)...",
      askClassicPlaceholder: "Ask your knowledge base (Classic mode)...",
      agentModeDesc:
        "Agent mode shows the planner route, tool calls, source controls, and editable context drafts.",
      classicModeDesc:
        "Classic mode searches your history and returns concise source-grounded answers.",
      newChatPrefill: "New Chat (Prefill)",
      searchByTitlePlaceholder: "Search by title or snippet...",
      fillComposer: "FILL COMPOSER",
      starterDeck1Eyebrow: "Start with a task",
      starterDeck1Title: "Explore your library with a lighter touch.",
      starterDeck1Description:
        "Ask a focused question, then let Explore search, summarize, and stitch together the minimal context needed.",
      starterDeck2Eyebrow: "Private by default",
      starterDeck2Title:
        "Ask for the shape of the work, not the whole transcript.",
      starterDeck2Description:
        "Explore is most useful when it compresses a library into a narrow, trustworthy answer you can inspect.",
      starterDeck3Eyebrow: "Work in layers",
      starterDeck3Title: "Start broad, then narrow to the sources that matter.",
      starterDeck3Description:
        "Use a starter prompt to get a compact answer, then inspect the source conversations if you need verification.",
      modeStages: {
        agent: [
          "Planning the route...",
          "Scanning lightweight library cues...",
          "Collecting source evidence...",
          "Compiling context draft...",
          "Synthesizing a longer answer..."
        ],
        classic: [
          "Understanding your question...",
          "Searching indexed context...",
          "Synthesizing a longer answer..."
        ]
      },
      starterDecks: [
        {
          eyebrow: "Start with a task",
          title: "Explore your library with a lighter touch.",
          description:
            "Ask a focused question, then let Explore search, summarize, and stitch together the minimal context needed.",
          privacyTip:
            "Keep prompts narrow. Ask for themes, decisions, or one time window instead of raw transcripts.",
          capabilityHint:
            "Summaries, weekly digests, and source-grounded answers are all available here.",
          prompts: [
            {
              title: "Summarize this week",
              prompt:
                "Summarize what I worked on this week and highlight the main decisions.",
              detail:
                "Great for rolling up a recent batch of conversations into a concise review."
            },
            {
              title: "Find the decision trail",
              prompt:
                "Show the conversations that explain how we reached the final decision.",
              detail:
                "Use this when you want the context behind a conclusion, not just the conclusion."
            },
            {
              title: "Group related threads",
              prompt:
                "Group the most related conversations about this topic and explain why they belong together.",
              detail:
                "Useful for clustering a topic without exposing the full raw conversation history."
            },
            {
              title: "Build a quick brief",
              prompt:
                "Create a short brief from the most relevant conversations and keep it source-grounded.",
              detail:
                "A compact starting point when you want a clean handoff or a summary note."
            }
          ]
        },
        {
          eyebrow: "Private by default",
          title: "Ask for the shape of the work, not the whole transcript.",
          description:
            "Explore is most useful when it compresses a library into a narrow, trustworthy answer you can inspect.",
          privacyTip:
            "Favor descriptors like themes, blockers, or outcomes. Avoid asking for everything at once.",
          capabilityHint:
            "You can search across all conversations or a selected subset, then refine sources afterward.",
          prompts: [
            {
              title: "What changed?",
              prompt:
                "What changed across my conversations over the last week?",
              detail:
                "A safe way to surface progress without pulling in more than you need."
            },
            {
              title: "Cluster the blockers",
              prompt:
                "Cluster the repeated blockers or open questions across my conversations.",
              detail:
                "Helps reveal recurring pain points and where the discussion kept circling back."
            },
            {
              title: "Trace one topic",
              prompt:
                "Trace the main discussion around privacy or search and summarize the arc.",
              detail:
                "Good for following a single thread through multiple conversations."
            },
            {
              title: "Surface next steps",
              prompt:
                "Surface the next actions implied by the most relevant conversations.",
              detail:
                "Turns scattered discussion into a practical follow-up list."
            }
          ]
        },
        {
          eyebrow: "Work in layers",
          title: "Start broad, then narrow to the sources that matter.",
          description:
            "Use a starter prompt to get a compact answer, then inspect the source conversations if you need verification.",
          privacyTip:
            "Short prompts usually reveal less than a fully detailed request, which helps keep exploration focused.",
          capabilityHint:
            "Ask for weekly summaries, cross-conversation themes, or a source list you can inspect manually.",
          prompts: [
            {
              title: "Weekly recap",
              prompt:
                "Give me a compact weekly recap with the main themes and follow-ups.",
              detail:
                "Designed for a weekly digest that stays concise but still useful."
            },
            {
              title: "Theme map",
              prompt:
                "Map the main themes across my conversations about architecture and tooling.",
              detail:
                "Useful when the goal is to understand the library at a higher level first."
            },
            {
              title: "Evidence first",
              prompt:
                "List the most relevant conversations for this topic and summarize each one briefly.",
              detail:
                "A good bridge between search and review when you want a source-backed answer."
            },
            {
              title: "Decision summary",
              prompt: "Summarize the decision and the evidence that led to it.",
              detail:
                "Short, inspectable, and suitable for quick handoff notes."
            }
          ]
        }
      ],
      libraryStarter: {
        titleTemplate: 'Continue "{cue}"',
        promptTemplate:
          'Continue "{cue}" and search the related context before summarizing the key points.',
        detail:
          "Built from recent library cues using only lightweight title and snippet context."
      },
      toolLabels: {
        intent_planner: "Intent Planner",
        time_scope_resolver: "Time Scope Resolver",
        weekly_summary_tool: "Weekly Summary Tool",
        query_planner: "Query Planner (Legacy)",
        search_rag: "Semantic Search",
        summary_tool: "Summary Tool",
        context_compiler: "Context Compiler",
        answer_synthesizer: "Answer Synthesizer"
      },
      toolExplanations: {
        intent_planner:
          "Uses the model to decide what the user is asking for, which route to run, and whether a time window is required.",
        time_scope_resolver:
          "Turns phrases like 'this week' into a concrete date range so the answer is auditable.",
        weekly_summary_tool:
          "Finds the conversations in that period, then reuses or generates a week-level digest.",
        query_planner:
          "Legacy fixed planning step from the earlier Explore pipeline.",
        search_rag:
          "Searches the knowledge base by semantic similarity to retrieve the most relevant conversations.",
        summary_tool:
          "Fills in missing conversation summaries so multi-source answers are easier to synthesize and inspect.",
        context_compiler:
          "Builds the editable context draft and source set shown in the drawer.",
        answer_synthesizer:
          "Produces the final answer from the collected evidence and tells the user where to inspect the result."
      },
      intentLabels: {
        fact_lookup: "Fact Lookup",
        cross_conversation_summary: "Cross-Conversation Summary",
        weekly_review: "Weekly Review",
        timeline: "Timeline",
        clarification_needed: "Clarification Needed"
      },
      pathLabels: {
        rag: "Semantic Search",
        weekly_summary: "Weekly Summary",
        clarify: "Clarify First"
      },
      toolStatus: {
        running: "running",
        completed: "completed",
        failed: "failed"
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
      openContextDraft: "Open Context Draft",
      sources: "Sources",
      noRelevantConversations: "No relevant conversations found",
      refreshingSuggestions: "Refreshing suggestions...",
      open: "Open",
      failedToLoadConversations: "Failed to load conversations.",
      exploreUnavailable: "Explore is unavailable in the current environment.",
      chooseAtLeastOne:
        "Choose at least one conversation before using Selected scope.",
      failedToRetrieveAnswer: "Failed to retrieve answer.",
      deleteConversationConfirm: "Delete this conversation?",
      contextDraftSaved: "Context draft saved.",
      savedLocally:
        "Saved locally for this view (storage adapter unavailable).",
      failedToSaveContext: "Failed to save context draft.",
      copiedToClipboard: "Copied to clipboard.",
      clipboardUnavailable: "Clipboard is unavailable in this environment.",
      downloaded: "Downloaded {filename}.",
      selectAtLeastOneSource: "Select at least one source before regenerating.",
      couldNotDetermineQuery: "Could not determine the query for this answer.",
      regeneratedNotice:
        "Regenerated as a new turn using {count} selected source(s).",
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
      contextDraft: "Context Draft",
      plannerDecision: "Planner Decision",
      sourceLimitPrefix: "Source limit:",
      summaryTargetPrefix: "Summary target:",
      timeScopePrefix: "Time scope:",
      whyThisRoute: "Why This Route",
      goalPrefix: "Goal:",
      clarificationPrefix: "Clarification:",
      plannedTools: "Planned Tools",
      plannerFootnote:
        "The planner chooses the high-level route with the model. Tool execution stays bounded and inspectable in the app.",
      noPlannerMetadata: "No planner metadata was recorded for this answer.",
      noToolCallsRecorded: "No tool calls were recorded for this answer.",
      activeQuery: "Active Query",
      selectedSourcesPrefix: "Selected sources:",
      candidateSources: "Candidate Sources",
      noContextCandidates: "No context candidates for this answer.",
      saving: "Saving...",
      openDraft: "Open Draft",
      regenerationFootnote:
        "Regeneration appends a new turn using only the selected conversations.",
      draftEditable: "Draft (Editable)",
      save: "Save",
      copy: "Copy",
      downloadTxt: "Download TXT"
    },
    data: {
      title: "Data Management",
      unavailableTitle: "Data operations unavailable",
      unavailableDesc:
        "This environment does not provide export/clear/storage APIs.",
      usedAppLimit: "Used / App limit (1GB)",
      unknown: "Unknown",
      browserQuota: "Browser quota",
      healthy: "Healthy",
      softLimitWarning: "Soft limit warning",
      writeBlocked: "Write blocked",
      storageWarning: "Storage crossed 900MB. Export or clear old data soon.",
      storageBlocked:
        "Storage reached 1GB. New writes are blocked until you export or clear data.",
      advancedStorageDetails: "Advanced storage details (Chrome)",
      chromeStorageUsed: "chrome.storage.local used",
      estimatedIndexedDb: "Estimated IndexedDB + other",
      softLimit: "Soft limit",
      unlimitedStorage: "unlimitedStorage",
      enabled: "enabled",
      disabled: "disabled",
      exportLocalData: "Export local data",
      exportFormat: "Export {format}",
      exportHint:
        "JSON is reversible and includes summaries + weekly caches. TXT/MD are human-readable exports.",
      dangerZone: "Danger zone",
      dangerDesc:
        "Clears all conversations, messages, cached summaries, and weekly reports. LLM configuration remains unchanged.",
      clearLocalData: "Clear local data",
      clearPrompt:
        "This will clear all local conversations and cached insights.\\nType DELETE to continue:",
      clearCancelled: "Clear cancelled.",
      localDataCleared: "Local data cleared. LLM configuration is kept.",
      exportedFile: "Exported {filename}",
      runningDataAction: "Running data action...",
      refreshingStorage: "Refreshing storage..."
    },
    network: {
      emptyTitle: "Your knowledge graph will appear here.",
      emptyDesc:
        "Conversations you capture on AI chat sites appear here automatically. Capture a few, then watch the graph grow — nodes group by platform/topic and semantic links appear as similarity indexing completes.",
      noConversationsYet: "No conversations captured yet.",
      replayInfo:
        "This replay runs the full timeline in 8 seconds, even when everything was captured today.",
      newConversationOn: "+ New conversation on {platform}",
      conversationOn: "+ {label} · {platform}",
      buildingGraph: "Building graph...",
      trendLabel: "Trend · daily new conversations",
      noSemanticLinks:
        "No semantic links yet. Playback still shows how conversations accumulated over time.",
      dragHint: "Drag the trend line to pause on a moment.",
      replay: "Replay",
      edgeLoadingUnavailable:
        "Semantic edge loading is unavailable in this environment.",
      edgePlaybackUnavailable:
        "Semantic edge playback is temporarily unavailable.",
      close: "Close",
      started: "Started",
      messages: "messages",
      semanticLinks: "semantic links",
      noPreviewSnippet:
        "No preview snippet available for this conversation yet.",
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
        "Summaries power this view — generate them in the Library first, and the thinking map will trace your key topics over time.",
      loadingThinkingMap: "Building your thinking map...",
      gapInsightTitle: "Threads you haven't connected",
      gapInsightTemplate: "You explored {a} and {b} but never linked them",
      conceptMentionedIn: "Across {count} conversations",
      relatedConversations: "Related conversations",
      groupByLabel: "Group by",
      groupByPlatform: "Platform",
      groupByTopic: "Topic",
      groupByProject: "Project",
      groupOther: "Ungrouped",
      clusterConversationCount: "{count} conversations"
    },
    prompts: {
      title: "Frequent Prompts",
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
      emptyHint:
        "Extract reusable prompts from your captured conversations, or add one manually.",
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
      bodyPlaceholder:
        "Write your reusable prompt. Use {{variables}} for placeholders.",
      improveTooltip:
        "Rewrite this draft into a stronger prompt (uses your configured LLM)",
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
      toastNoLlm:
        "No LLM configured — configure one in Settings to enable AI rewrite.",
      toastImproveFailed: "AI completion failed.",
      toastExtract:
        "Archived {created} new prompt(s) from {candidates} candidate(s).",
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
      supermarketSubtitle:
        "Browse more quality prompts by category and add them to your plaza.",
      myPlaza: "My plaza",
      myPlazaEmpty:
        "Add prompts from the supermarket below to build your plaza.",
      adopt: "Add",
      adopted: "Added",
      selectAria: "Select prompt",
      selectedCount: "{n} selected",
      deleteSelected: "Delete",
      clearSelection: "Cancel"
    },
    aiti: {
      modeAsk: "Ask",
      modeAiti: "AITI",
      modeRoundtable: "Roundtable",
      title: "Your AITI — your thinking strengths",
      subtitle:
        "Computed locally from your own conversations. A reflection of your strengths, not a verdict.",
      insufficient:
        "Not enough conversations analyzed yet — keep chatting and your portrait will take shape.",
      insufficientHint:
        "Once you have 2 or more conversations, AITI will show a preliminary portrait.",
      sample: "Drawn from {n} of your conversations",
      confidenceLabel: "Confidence",
      confidenceLow: "Preliminary",
      confidenceMedium: "Growing",
      confidenceHigh: "Solid",
      typeSeparator: " · ",
      strengthsTitle: "Your thinking strengths",
      empoweringIntro:
        "Across your AI conversations, these strengths shine through:",
      obsessionsTitle: "What you keep investing in",
      evidence: "seen in {n} conversations",
      axisNeedsSignal: "Needs more signal",
      axisDepthLabel: "Breadth ↔ Depth",
      axisDepthLeft: "Explorer",
      axisDepthRight: "Excavator",
      axisDepthLeftStrength:
        "You range widely and connect ideas across many fields.",
      axisDepthRightStrength:
        "You dive deep and master complex things thoroughly.",
      axisMakerLabel: "Theory ↔ Practice",
      axisMakerLeft: "Theorist",
      axisMakerRight: "Maker",
      axisMakerLeftStrength:
        "You think in principles and models, getting the fundamentals right.",
      axisMakerRightStrength:
        "You're action-oriented and turn ideas into real results fast.",
      axisFocusLabel: "Converge ↔ Wander",
      axisFocusLeft: "Converger",
      axisFocusRight: "Wanderer",
      axisFocusLeftStrength:
        "You stay focused and converge on the answer that matters.",
      axisFocusRightStrength:
        "You roam with curiosity and open up unexpected possibilities.",
      axisAffectLabel: "Cool ↔ Spirited",
      axisAffectLeft: "Cool-headed",
      axisAffectRight: "Spirited",
      axisAffectLeftStrength:
        "You stay calm and keep clear judgment under complexity.",
      axisAffectRightStrength:
        "You bring strong emotional engagement to what you explore.",
      axisCuriosityLabel: "Settled ↔ Curious",
      axisCuriosityLeft: "Settled",
      axisCuriosityRight: "Curious",
      axisCuriosityLeftStrength:
        "You move efficiently to answers and prefer concise resolution.",
      axisCuriosityRightStrength:
        "You ask freely and follow threads wherever they lead.",
      axisInterdisciplinaryLabel: "Focused ↔ Interdisciplinary",
      axisInterdisciplinaryLeft: "Focused",
      axisInterdisciplinaryRight: "Interdisciplinary",
      axisInterdisciplinaryLeftStrength:
        "You go deep in focused domains and build specialized expertise.",
      axisInterdisciplinaryRightStrength:
        "You connect ideas across domains and weave distant fields together.",
      trendsTitle: "Recent direction",
      trendRising: "Rising",
      trendFalling: "Falling",
      trendStable: "Stable"
    },
    learn: {
      modeLearn: "Learn",
      title: "What you've been learning",
      subtitle:
        "Your conversations, organized as a personal curriculum. Computed locally.",
      insufficient:
        "Not enough conversations yet — keep chatting and your learning map will fill in.",
      insufficientHint:
        "Start 1–2 conversations and Learn will surface domains, terms, and open questions.",
      sample: "From {n} analyzed conversations",
      confidenceLabel: "Confidence",
      confidenceLow: "Preliminary",
      confidenceMedium: "Growing",
      confidenceHigh: "Solid",
      domainsTitle: "Knowledge domains",
      uncategorized: "Uncategorized",
      domainConversations: "{n} conversations",
      glossaryTitle: "Things you've learned",
      openLoopsTitle: "Open loops",
      openLoopsEmpty: "No unresolved threads — nicely closed out.",
      learningPathTitle: "Suggested learning path",
      learningPathStage: "Stage {n}",
      learningPathEstimatedMinutes: "~{n} min",
      reviewQueueTitle: "Due for review",
      reviewQueueEmpty: "Nothing due for review right now.",
      reviewDueNow: "Due now",
      reviewDueSoon: "Due soon",
      goalsTitle: "Learning goals",
      goalsEmpty:
        "No goals inferred yet — keep chatting and goals will appear.",
      learningPathFoundationTitle: "Establish {domain}",
      learningPathExpandTitle: "Connect {domains}",
      learningPathApplyTitle: "Tackle open questions",
      learningPathSynthesizeTitle: "Synthesize your map",
      learningPathFoundationDesc:
        "Lock in the key concepts that appear most often in your conversations.",
      learningPathExpandDesc:
        "Bridge your core topic with neighboring domains to build a richer map.",
      learningPathApplyDesc:
        "Use what you've learned to address the unresolved threads in your conversations.",
      learningPathSynthesizeDesc:
        "Step back and connect the dots across domains and terms.",
      learningGoalDeepen: "Deepen {domain}"
    },
    roundtable: {
      title: "AI Roundtable",
      subtitle:
        "Convene a panel of perspectives on your question, then a moderated synthesis.",
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
      empty:
        "Ask a question and convene the panel to see perspectives + a synthesis.",
      personaSkeptic: "Skeptic",
      personaOptimist: "Optimist",
      personaPragmatist: "Pragmatist",
      personaDomainExpert: "Domain Expert",
      personaDevilsAdvocate: "Devil's Advocate"
    }
  },

  platforms: {
    ChatGPT: "ChatGPT",
    Claude: "Claude",
    Gemini: "Gemini",
    DeepSeek: "DeepSeek",
    Qwen: "Qwen",
    Doubao: "Doubao",
    Kimi: "Kimi",
    Yuanbao: "Yuanbao"
  },

  realTimeAssist: {
    panelTitle: "Prompt quality",
    issuesTitle: "Suggestions",
    score: {
      label: "Quality",
      poor: "Poor",
      fair: "Fair",
      good: "Good",
      excellent: "Excellent"
    },
    breakdown: {
      length: "Useful length",
      instruction: "Clear action verb",
      role: "Role / persona",
      constraints: "Constraints",
      structure: "Steps or bullets",
      variables: "Reusable variables",
      codeFence: "Code block",
      questionPenalty: "Bare short question"
    },
    clarity: {
      tooShort: "Too short to evaluate",
      pureQuestion: "Just a question, no instruction",
      noInstructionVerb: "No clear action verb",
      noRole: "No role or expertise set",
      noFormat: "Output format unspecified",
      noConstraints: "No constraints given",
      noExample: "No example provided",
      noContext: "Missing context",
      vagueScope: "Scope is broad / vague",
      noStructure: "Long but unstructured",
      undefinedVariables: "Variables not defined"
    },
    suggestion: {
      tooShort:
        "Add detail: describe the task, the context, and what a good answer looks like.",
      pureQuestion:
        "Turn this into an instruction: state the task, who should answer, and the constraints.",
      noInstructionVerb:
        "Start with a clear action verb (write, analyze, refactor, summarize…).",
      noRole:
        "Specify a role or expertise, e.g. “You are a senior TypeScript engineer…”.",
      noFormat:
        "Describe the desired output format (bullet list, table, JSON, word count).",
      noConstraints:
        "Add constraints: what to include, what to avoid, length, tone, or audience.",
      noExample:
        "Provide a short example of the input and/or output you expect.",
      noContext:
        "Add the background the model needs: audience, goal, prior context.",
      vagueScope:
        "Narrow the scope: give concrete specifics, inputs, and the exact deliverable.",
      noStructure: "Break this into numbered steps or bullet points.",
      undefinedVariables:
        "Define each {{variable}}: say what it represents and give an example value."
    },
    actions: {
      optimize: "Optimize with AI",
      optimizing: "Optimizing…",
      replaceDraft: "Replace draft",
      useSuggestion: "Use suggestion",
      cancel: "Cancel",
      offlineHint: "Configure an LLM in Settings to enable AI rewrite.",
      completionFailed: "Optimization failed. Try again.",
      saveAsPrompt: "Save as prompt"
    },
    toggle: {
      label: "Real-time prompt assistant",
      description: "Score prompts and suggest improvements as you type.",
      enabled: "Real-time assist is on",
      disabled: "Real-time assist is off",
      turnOffHere: "Turn off on this site",
      openSettings: "Open settings"
    },
    status: {
      analyzing: "Analyzing…",
      ready: "Ready to optimize"
    },
    empty: {
      noScore: "Start typing to get suggestions.",
      allClear: "Looks clear — no issues found."
    }
  }
} as const

// Widen string *literals* to `string` while preserving the nested key shape, so
// locale files (e.g. zh.ts) must mirror en.ts's structure but may use their own
// strings. Without this, `typeof enTranslations` (from `as const`) forces every
// translated value to equal the English literal, producing a type error on
// every non-English string.
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>
}

export type TranslationsType = DeepStringify<typeof enTranslations>
