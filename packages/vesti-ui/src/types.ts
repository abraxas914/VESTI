export type Platform =
  | "ChatGPT"
  | "Claude"
  | "Gemini"
  | "DeepSeek"
  | "Qwen"
  | "Doubao"
  | "Kimi"
  | "Yuanbao";

export type UiThemeMode = "light" | "dark";

export interface Topic {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  count?: number;
  children?: Topic[];
}

export interface GardenerStep {
  step: string;
  status: "pending" | "running" | "completed";
  details?: string;
}

export interface GardenerResult {
  tags: string[];
  matchedTopic?: Topic;
  createdTopic?: Topic;
  steps: GardenerStep[];
}

export interface Conversation {
  id: number;
  title: string;
  platform: Platform;
  snippet: string;
  url?: string;
  tags: string[];
  topic_id: number | null;
  created_at: number;
  updated_at: number;
  source_created_at?: number | null;
  first_captured_at?: number;
  last_captured_at?: number;
  message_count?: number;
  is_starred: boolean;
  is_archived?: boolean;
  is_trash?: boolean;
  has_note?: boolean;
}

export interface RelatedConversation {
  id: number;
  title: string;
  platform: Platform;
  similarity: number;
}

export type ExploreMode = "agent" | "classic";

export type ExploreSearchScopeMode = "all" | "selected";

export interface ExploreSearchScope {
  mode: ExploreSearchScopeMode;
  conversationIds?: number[];
}

export interface ExploreAskOptions {
  searchScope?: ExploreSearchScope;
}

export type ExploreIntentType =
  | "fact_lookup"
  | "cross_conversation_summary"
  | "weekly_review"
  | "timeline"
  | "clarification_needed";

export type ExploreRequestedTimeScopePreset =
  | "none"
  | "current_week_to_date"
  | "last_7_days"
  | "last_full_week"
  | "custom";

export interface ExploreRequestedTimeScope {
  preset: ExploreRequestedTimeScopePreset;
  label?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExploreResolvedTimeScope {
  preset: Exclude<ExploreRequestedTimeScopePreset, "none">;
  label: string;
  rangeStart: number;
  rangeEnd: number;
  startDate: string;
  endDate: string;
}

export type ExplorePlannerPath = "rag" | "weekly_summary" | "clarify";

export type ExploreToolName =
  | "intent_planner"
  | "time_scope_resolver"
  | "weekly_summary_tool"
  | "query_planner"
  | "search_rag"
  | "summary_tool"
  | "context_compiler"
  | "answer_synthesizer";

export type ExploreToolStatus = "completed" | "failed" | "skipped";

export interface ExploreToolCall {
  id: string;
  name: ExploreToolName;
  status: ExploreToolStatus;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  description?: string;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}

export interface ExploreContextCandidate {
  conversationId: number;
  title: string;
  platform: Platform;
  similarity: number;
  matchType?: "semantic" | "time_scope";
  selectionReason?: string;
  summarySnippet?: string;
  excerpt?: string;
}

export interface ExploreAgentPlan {
  intent: ExploreIntentType;
  reason: string;
  preferredPath: ExplorePlannerPath;
  sourceLimit: number;
  summaryTargetCount: number;
  answerGoal?: string;
  needsClarification?: boolean;
  clarifyingQuestion?: string;
  requestedTimeScope?: ExploreRequestedTimeScope;
  resolvedTimeScope?: ExploreResolvedTimeScope;
  toolPlan?: ExploreToolName[];
}

export interface ExploreAgentMeta {
  mode: ExploreMode;
  query?: string;
  searchScope?: ExploreSearchScope;
  plan?: ExploreAgentPlan;
  toolCalls: ExploreToolCall[];
  contextDraft?: string;
  contextCandidates?: ExploreContextCandidate[];
  selectedContextConversationIds?: number[];
  totalDurationMs?: number;
}

export interface RagResponse {
  answer: string;
  sources: RelatedConversation[];
  agent?: ExploreAgentMeta;
}

export type AstVersion = "ast_v1" | "ast_v2";

export interface AstRoot {
  type: "root";
  children: AstNode[];
}

export type AstNode =
  | AstTextNode
  | AstFragmentNode
  | AstParagraphNode
  | AstHeadingNode
  | AstBreakNode
  | AstListNode
  | AstListItemNode
  | AstCodeBlockNode
  | AstInlineCodeNode
  | AstStrongNode
  | AstEmphasisNode
  | AstTableNode
  | AstMathNode
  | AstAttachmentNode
  | AstBlockquoteNode;

export interface AstTextNode {
  type: "text";
  text: string;
}

export interface AstFragmentNode {
  type: "fragment";
  children: AstNode[];
}

export interface AstParagraphNode {
  type: "p";
  children: AstNode[];
}

export interface AstHeadingNode {
  type: "h1" | "h2" | "h3";
  children: AstNode[];
}

export interface AstBreakNode {
  type: "br";
}

export interface AstListNode {
  type: "ul" | "ol";
  children: AstNode[];
}

export interface AstListItemNode {
  type: "li";
  children: AstNode[];
}

export interface AstCodeBlockNode {
  type: "code_block";
  code: string;
  language?: string | null;
}

export interface AstInlineCodeNode {
  type: "code_inline";
  text: string;
}

export interface AstStrongNode {
  type: "strong";
  children: AstNode[];
}

export interface AstEmphasisNode {
  type: "em";
  children: AstNode[];
}

export type AstTableAlign = "left" | "center" | "right" | null;

export type AstTableNode = AstTableNodeLegacy | AstTableNodeV2;

export interface AstTableNodeLegacy {
  type: "table";
  kind?: "legacy";
  headers: string[];
  rows: string[][];
}

export interface AstTableColumnV2 {
  align?: AstTableAlign;
  header: AstNode[];
}

export interface AstTableCellV2 {
  align?: AstTableAlign;
  children: AstNode[];
}

export interface AstTableRowV2 {
  cells: AstTableCellV2[];
}

export interface AstTableNodeV2 {
  type: "table";
  kind: "v2";
  columns: AstTableColumnV2[];
  rows: AstTableRowV2[];
}

export interface AstMathNode {
  type: "math";
  tex: string;
  display?: boolean;
}

export interface AstAttachmentNode {
  type: "attachment";
  name: string;
  mime?: string | null;
}

export interface AstBlockquoteNode {
  type: "blockquote";
  children: AstNode[];
}

export type MessageCitationSourceType =
  | "inline_pill"
  | "search_card"
  | "reference_list"
  | "unknown";

export interface MessageCitation {
  label: string;
  href: string;
  host: string;
  sourceType: MessageCitationSourceType;
}

export type MessageArtifactKind =
  | "canvas"
  | "preview"
  | "code_artifact"
  | "download_card"
  | "standalone_artifact"
  | "unknown";

export type MessageArtifactCaptureMode =
  | "presence_only"
  | "embedded_dom_snapshot"
  | "standalone_artifact";

export interface MessageArtifact {
  kind: MessageArtifactKind;
  label?: string;
  captureMode?: MessageArtifactCaptureMode;
  renderDimensions?: { width: number; height: number };
  plainText?: string;
  markdownSnapshot?: string;
  normalizedHtmlSnapshot?: string;
}

export type MessageAttachmentOccurrenceRole = "user_upload";

export interface MessageAttachment {
  indexAlt: string;
  label?: string;
  mime?: string | null;
  occurrenceRole: MessageAttachmentOccurrenceRole;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "ai";
  content_text: string;
  content_ast?: AstRoot | null;
  content_ast_version?: AstVersion | null;
  degraded_nodes_count?: number;
  citations?: MessageCitation[];
  attachments?: MessageAttachment[];
  artifacts?: MessageArtifact[];
  normalized_html_snapshot?: string | null;
  created_at: number;
}

export interface Annotation {
  id: number;
  conversation_id: number;
  message_id: number;
  content_text: string;
  created_at: number;
  days_after: number;
}

export type AsyncStatus = "idle" | "loading" | "ready" | "error";
export type ExportFormat = "json" | "txt" | "md";
export type StorageUsageStatus = "ok" | "warning" | "blocked";

export interface StorageUsageSnapshot {
  originUsed: number;
  originQuota: number | null;
  localUsed: number;
  unlimitedStorageEnabled: boolean;
  softLimit: number;
  hardLimit: number;
  status: StorageUsageStatus;
}

export type ConversationFilters = {
  platform?: Platform;
  search?: string;
  dateRange?: { start: number; end: number };
};

export interface ExploreSession {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExploreMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  sources?: RelatedConversation[];
  agentMeta?: ExploreAgentMeta;
  timestamp: number;
}

export type StorageApi = {
  getTopics: () => Promise<Topic[]>;
  getConversations: (filters?: ConversationFilters) => Promise<Conversation[]>;
  runGardener?: (
    conversationId: number
  ) => Promise<{ updated: boolean; conversation: Conversation; result: GardenerResult }>;
  getRelatedConversations?: (
    conversationId: number,
    limit?: number
  ) => Promise<RelatedConversation[]>;
  getAllEdges?: (options?: {
    threshold?: number;
    conversationIds?: number[];
  }) => Promise<Array<{ source: number; target: number; weight: number }>>;
  getMessages?: (conversationId: number) => Promise<Message[]>;
  getAnnotationsByConversation?: (conversationId: number) => Promise<Annotation[]>;
  saveAnnotation?: (payload: {
    conversationId: number;
    messageId: number;
    contentText: string;
  }) => Promise<Annotation>;
  deleteAnnotation?: (annotationId: number) => Promise<void>;
  exportAnnotationToNote?: (annotationId: number) => Promise<Note>;
  exportAnnotationToNotion?: (
    annotationId: number
  ) => Promise<{ pageId: string; url?: string }>;
  updateConversation?: (
    id: number,
    changes: { topic_id?: number | null; is_starred?: boolean; tags?: string[] }
  ) => Promise<{ updated: boolean; conversation: Conversation }>;
  updateConversationTitle?: (id: number, title: string) => Promise<Conversation>;
  deleteConversation?: (id: number) => Promise<void>;
  renameFolderTag?: (
    from: string,
    to: string
  ) => Promise<{ updated: number }>;
  moveFolderTag?: (
    from: string,
    to: string
  ) => Promise<{ updated: number }>;
  removeFolderTag?: (tag: string) => Promise<{ updated: number }>;
  askKnowledgeBase?: (
    query: string,
    sessionId?: string,
    limit?: number,
    mode?: ExploreMode,
    options?: ExploreAskOptions
  ) => Promise<RagResponse & { sessionId: string }>;
  // Explore Session APIs
  createExploreSession?: (title: string) => Promise<string>;
  listExploreSessions?: (limit?: number) => Promise<ExploreSession[]>;
  getExploreSession?: (sessionId: string) => Promise<ExploreSession | null>;
  getExploreMessages?: (sessionId: string) => Promise<ExploreMessage[]>;
  deleteExploreSession?: (sessionId: string) => Promise<void>;
  renameExploreSession?: (sessionId: string, title: string) => Promise<void>;
  updateExploreMessageContext?: (
    messageId: string,
    contextDraft: string,
    selectedContextConversationIds: number[]
  ) => Promise<void>;
  runRoundtable?: (
    question: string,
    personaIds: RoundtablePersonaId[],
    opts?: { lang?: "zh" | "en" }
  ) => Promise<RoundtableResult>;
  getSummary?: (conversationId: number) => Promise<ChatSummaryData | null>;
  generateSummary?: (conversationId: number) => Promise<ChatSummaryData>;
  getNotes?: () => Promise<Note[]>;
  saveNote?: (note: CreateNoteInput) => Promise<Note>;
  updateNote?: (id: number, changes: UpdateNoteChanges) => Promise<Note>;
  deleteNote?: (id: number) => Promise<void>;
  getObsidianVaultStatus?: () => Promise<ObsidianVaultStatus>;
  connectObsidianVault?: () => Promise<ObsidianVaultStatus>;
  exportNoteToObsidian?: (note: Note) => Promise<ObsidianNoteExportResult>;
  // Send a whole conversation / its summary out as ready Markdown.
  exportConversationToNotion?: (input: {
    title: string;
    markdown: string;
  }) => Promise<{ pageId: string; url?: string }>;
  exportConversationToObsidian?: (input: {
    title: string;
    markdown: string;
  }) => Promise<{ relative_path: string; vault_name: string; exported_at: number }>;
  importObsidianDirectory?: (
    vaultName: string,
    entries: ObsidianImportFileEntry[]
  ) => Promise<ObsidianImportSummary>;
  importObsidianZip?: (
    fileName: string,
    data: ArrayBuffer
  ) => Promise<ObsidianImportSummary>;
  getNoteAsset?: (assetId: string) => Promise<NoteAssetRecord | null>;
  getStorageUsage?: () => Promise<StorageUsageSnapshot>;
  exportData?: (
    format: ExportFormat
  ) => Promise<{ blob: Blob; filename: string; mime: string }>;
  clearAllData?: () => Promise<void>;
  // Prompt Management
  listPrompts?: (filter?: PromptListFilter) => Promise<Prompt[]>;
  searchPrompts?: (query: string, limit?: number) => Promise<Prompt[]>;
  createPrompt?: (
    input: CreatePromptInput
  ) => Promise<{ prompt: Prompt; created: boolean }>;
  updatePrompt?: (id: number, changes: UpdatePromptChanges) => Promise<Prompt>;
  deletePrompt?: (id: number) => Promise<void>;
  togglePromptFavorite?: (id: number, isFavorite: boolean) => Promise<Prompt>;
  incrementPromptUsage?: (id: number) => Promise<Prompt>;
  extractPromptsFromLibrary?: (options?: {
    scope?: "all" | "recent";
    limit?: number;
  }) => Promise<PromptExtractionResult>;
  completePrompt?: (payload: {
    draft: string;
    platform?: Platform;
    useLibrary?: boolean;
  }) => Promise<PromptCompletionResult>;
};

// ---- Prompt Management types (mirror of frontend/src/lib/types) -------------

export type PromptSource = "manual" | "extracted";

export interface Prompt {
  id: number;
  title: string;
  body: string;
  category: string | null;
  tags: string[];
  source: PromptSource;
  source_platform: Platform | null;
  source_conversation_id: number | null;
  source_message_id: number | null;
  is_favorite: boolean;
  is_archived: boolean;
  quality_score: number;
  summary: string | null;
  variables: string[];
  use_count: number;
  last_used_at: number | null;
  body_hash: string;
  created_at: number;
  updated_at: number;
}

export interface CreatePromptInput {
  title?: string;
  body: string;
  category?: string | null;
  tags?: string[];
  source?: PromptSource;
  source_platform?: Platform | null;
  source_conversation_id?: number | null;
  source_message_id?: number | null;
  is_favorite?: boolean;
  summary?: string | null;
  quality_score?: number;
}

export interface UpdatePromptChanges {
  title?: string;
  body?: string;
  category?: string | null;
  tags?: string[];
  is_favorite?: boolean;
  is_archived?: boolean;
  summary?: string | null;
  quality_score?: number;
  source?: PromptSource;
}

export interface PromptListFilter {
  category?: string | null;
  favoritesOnly?: boolean;
  includeArchived?: boolean;
  source?: PromptSource;
  search?: string;
  sort?: "recent" | "score" | "usage";
}

export interface PromptExtractionResult {
  created: number;
  skipped: number;
  candidates: number;
  usedLlm: boolean;
}

export interface PromptCompletionResult {
  completion: string;
  usedLlm: boolean;
}

export interface ArtifactMetaData {
  title: string;
  generated_at: string;
  tags: string[];
  fallback: boolean;
  range_label?: string;
}

export interface ChatSummaryData {
  meta: ArtifactMetaData;
  core_question: string;
  thinking_journey: Array<{
    step: number;
    speaker: "User" | "AI";
    assertion: string;
    real_world_anchor: string | null;
  }>;
  key_insights: Array<{
    term: string;
    definition: string;
  }>;
  unresolved_threads: string[];
  meta_observations: {
    thinking_style: string;
    emotional_tone: string;
    depth_level: "superficial" | "moderate" | "deep";
  };
  actionable_next_steps: string[];
  plain_text?: string;
}

export type NoteSourceType = "native" | "obsidian";
export type ObsidianImportSourceKind = "directory" | "zip";
export type NoteImportAssetKind = "link" | "embed";

export interface NoteImportAssetRef {
  path: string;
  asset_id: string | null;
  kind: NoteImportAssetKind;
}

export interface NoteImportConflict {
  detected_at: number;
  incoming_source_file_hash: string;
  incoming_content: string;
  incoming_frontmatter: Record<string, unknown> | null;
}

export interface NoteImportMeta {
  vault_id: string | null;
  vault_name: string | null;
  relative_path: string | null;
  folder_path: string | null;
  frontmatter: Record<string, unknown> | null;
  wikilinks: string[];
  embeds: string[];
  tags: string[];
  assets: NoteImportAssetRef[];
  source_mtime: number | null;
  source_file_hash: string | null;
  last_imported_note_hash: string | null;
  imported_at: number | null;
  last_imported_at: number | null;
  conflict: NoteImportConflict | null;
}

export interface NoteObsidianExportMeta {
  vault_id: string;
  relative_path: string;
  last_exported_at: number;
}

export type ObsidianVaultConnectionState =
  | "not_connected"
  | "connected"
  | "needs_reconnect";

export interface ObsidianVaultStatus {
  state: ObsidianVaultConnectionState;
  vault_id: string | null;
  vault_name: string | null;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  excerpt: string;
  hash: string;
  created_at: number;
  updated_at: number;
  linked_conversation_ids: number[];
  source_type: NoteSourceType;
  source_path: string | null;
  import_meta: NoteImportMeta | null;
  obsidian_export: NoteObsidianExportMeta | null;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  linked_conversation_ids: number[];
  source_type?: NoteSourceType;
  source_path?: string | null;
  import_meta?: NoteImportMeta | null;
  obsidian_export?: NoteObsidianExportMeta | null;
}

export interface UpdateNoteChanges {
  title?: string;
  content?: string;
  linked_conversation_ids?: number[];
  source_type?: NoteSourceType;
  source_path?: string | null;
  import_meta?: NoteImportMeta | null;
  obsidian_export?: NoteObsidianExportMeta | null;
}

export interface NoteSourceRecord {
  id: string;
  name: string;
  kind: ObsidianImportSourceKind;
  created_at: number;
  updated_at: number;
}

export interface NoteAssetRecord {
  id: string;
  vault_id: string;
  relative_path: string;
  mime_type: string;
  hash: string;
  byte_size: number;
  blob: Blob;
  created_at: number;
  updated_at: number;
}

export interface ObsidianImportFileEntry {
  path: string;
  mime_type: string;
  last_modified: number;
  data: ArrayBuffer;
}

export interface ObsidianImportSummary {
  vaultId: string;
  importedNotes: number;
  updatedNotes: number;
  skippedNotes: number;
  conflictedNotes: number;
  importedAssets: number;
  unsupportedFiles: string[];
}

export interface ObsidianNoteExportResult {
  note: Note;
  vault_id: string;
  vault_name: string;
  relative_path: string;
  exported_at: number;
}

export interface ExploreStarterPromptLabel {
  title: string;
  prompt: string;
  detail: string;
}

export interface ExploreStarterDeckLabel {
  eyebrow: string;
  title: string;
  description: string;
  privacyTip: string;
  capabilityHint: string;
  prompts: readonly ExploreStarterPromptLabel[];
}

export interface ExploreLabels {
  // Choose Conversations dialog
  chooseConversationsTitle: string;
  chooseConversationsDesc: string;
  applySelected: string;
  useAll: string;
  noSearchResults: string;
  noPreviewAvailable: string;
  closeSidebar: string;
  openSidebar: string;
  noConversationsSelected: string;
  oneConversationSelected: string;
  multipleConversationsSelected: string;
  // Sessions / scope / mode toggles
  newChat: string;
  noConversationsYet: string;
  today: string;
  yesterday: string;
  earlier: string;
  agent: string;
  classic: string;
  all: string;
  selected: string;
  allConversations: string;
  send: string;
  starterPrompts: string;
  choosePromptHint: string;
  loadingStarterIdeas: string;
  starterDeckReady: string;
  cardsUpdateHint: string;
  askPlaceholder: string;
  askAgentPlaceholder: string;
  askClassicPlaceholder: string;
  agentModeDesc: string;
  classicModeDesc: string;
  newChatPrefill: string;
  searchByTitlePlaceholder: string;
  fillComposer: string;
  // Existing flat starter-deck header keys (kept for backward compatibility)
  starterDeck1Eyebrow: string;
  starterDeck1Title: string;
  starterDeck1Description: string;
  starterDeck2Eyebrow: string;
  starterDeck2Title: string;
  starterDeck2Description: string;
  starterDeck3Eyebrow: string;
  starterDeck3Title: string;
  starterDeck3Description: string;
  // Structured starter content (drives STARTER_DECKS)
  modeStages: {
    agent: readonly string[];
    classic: readonly string[];
  };
  starterDecks: readonly ExploreStarterDeckLabel[];
  libraryStarter: {
    titleTemplate: string;
    promptTemplate: string;
    detail: string;
  };
  // Enum/key maps
  toolLabels: Record<ExploreToolName, string>;
  toolExplanations: Record<ExploreToolName, string>;
  intentLabels: Record<ExploreIntentType, string>;
  pathLabels: Record<ExplorePlannerPath, string>;
  toolStatus: {
    running: string;
    completed: string;
    failed: string;
  };
  // Helper returns / summaries
  inRange: string;
  unknown: string;
  unavailable: string;
  noToolCalls: string;
  toolCallsSummary: string;
  toolCallsSummaryFailed: string;
  stepsLabel: string;
  failedLabel: string;
  untitled: string;
  // Message authorship / meta bar
  you: string;
  assistantName: string;
  plan: string;
  toolCalls: string;
  intentPrefix: string;
  routePrefix: string;
  scopePrefix: string;
  timePrefix: string;
  currentScopePrefix: string;
  sourceControls: string;
  openContextDraft: string;
  sources: string;
  noRelevantConversations: string;
  // Refresh / starter
  refreshingSuggestions: string;
  open: string;
  // Error / notice strings
  failedToLoadConversations: string;
  exploreUnavailable: string;
  chooseAtLeastOne: string;
  failedToRetrieveAnswer: string;
  deleteConversationConfirm: string;
  contextDraftSaved: string;
  savedLocally: string;
  failedToSaveContext: string;
  copiedToClipboard: string;
  clipboardUnavailable: string;
  downloaded: string;
  selectAtLeastOneSource: string;
  couldNotDetermineQuery: string;
  regeneratedNotice: string;
  failedToRegenerate: string;
  dismiss: string;
  // Session list fallbacks / row actions
  untitledSession: string;
  noMessages: string;
  rename: string;
  delete: string;
  // Tool-call rows
  inputLabel: string;
  outputLabel: string;
  errorLabel: string;
  // aria labels
  resizeSidebarAria: string;
  resizeDrawerAria: string;
  // Drawer headings / plan fields
  executionDetails: string;
  contextDraft: string;
  plannerDecision: string;
  sourceLimitPrefix: string;
  summaryTargetPrefix: string;
  timeScopePrefix: string;
  whyThisRoute: string;
  goalPrefix: string;
  clarificationPrefix: string;
  plannedTools: string;
  plannerFootnote: string;
  noPlannerMetadata: string;
  noToolCallsRecorded: string;
  // Sources drawer
  activeQuery: string;
  selectedSourcesPrefix: string;
  candidateSources: string;
  noContextCandidates: string;
  saving: string;
  saveSelection: string;
  regenerateAnswer: string;
  openDraft: string;
  regenerationFootnote: string;
  // Context-draft drawer
  draftEditable: string;
  save: string;
  copy: string;
  downloadTxt: string;
}

export interface DataLabels {
  title: string;
  unavailableTitle: string;
  unavailableDesc: string;
  usedAppLimit: string;
  unknown: string;
  browserQuota: string;
  healthy: string;
  softLimitWarning: string;
  writeBlocked: string;
  storageWarning: string;
  storageBlocked: string;
  advancedStorageDetails: string;
  chromeStorageUsed: string;
  estimatedIndexedDb: string;
  softLimit: string;
  unlimitedStorage: string;
  enabled: string;
  disabled: string;
  exportLocalData: string;
  exportFormat: string;
  exportHint: string;
  dangerZone: string;
  dangerDesc: string;
  clearLocalData: string;
  clearPrompt: string;
  clearCancelled: string;
  localDataCleared: string;
  exportedFile: string;
  runningDataAction: string;
  refreshingStorage: string;
}

export interface DashboardLabels {
  tabs: {
    library: string;
    explore: string;
    network: string;
    prompts: string;
  };
  nav: {
    backToExplore: string;
    backToNetwork: string;
    dashboardSections: string;
    closeDrawer: string;
  };
  settings: {
    settings: string;
    dataOperations: string;
    appearance: string;
    modelIntegration: string;
    themeShared: string;
    themeSharedDark: string;
    themeSharedLight: string;
    syncingAppearance: string;
    changesStayInSync: string;
    modelscopeKeyPlaceholder: string;
    savedLocally: string;
    saveFailed: string;
    storedInChromeStorage: string;
    availableInExtension: string;
    notionWorkspaceConnected: string;
    connectToNotion: string;
    legacyToken: string;
    oauthFlowDesc: string;
    connecting: string;
    change: string;
    connect: string;
    searchSharedDatabases: string;
    loadingSharedDatabases: string;
    noDatabasesLoaded: string;
    chooseDatabase: string;
    actionFailed: string;
    notionConnected: string;
    notionDisconnected: string;
    settingsSaved: string;
    manageIntegrationKeys: string;
    modelscopeKeyLabel: string;
    save: string;
    notionExportTitle: string;
    notionExportDesc: string;
    connectedChooseDatabase: string;
    oauthUnavailableOutsideExtension: string;
    disconnect: string;
    targetDatabase: string;
    databaseSearchPlaceholder: string;
    refresh: string;
    shareDatabaseHint: string;
    selectedColon: string;
    readyForOneShotExport: string;
    noSharedDatabasesFound: string;
    selectedDatabaseMessage: string;
    themeUpdateFailed: string;
  };
  library: {
    allConversations: string;
    starred: string;
    recent: string;
    folders: string;
    myNotes: string;
    exporting: string;
    notion: string;
    general: string;
    libraryNavigation: string;
    conversationCount: string;
    noMessages: string;
    loadingMessages: string;
    you: string;
    untitled: string;
    newNote: string;
    saving: string;
    unsavedChanges: string;
    noNoteYet: string;
    deleteNote: string;
    exitSplitView: string;
    deleteNotAvailable: string;
    renameNotAvailable: string;
    deleteFolderNotAvailable: string;
    renameFolderFailed: string;
    deleteFolderFailed: string;
    updateStarFailed: string;
    renameConversationFailed: string;
    newFolderPrompt: string;
    renameFolderPrompt: string;
    renameConversationPrompt: string;
    deleteConversationLabel: string;
    initiatingPipeline: string;
    extractingCore: string;
    generatingInsights: string;
    savingSummary: string;
    loadRelatedFailed: string;
    loadMessagesFailed: string;
    directoryExportNotSupported: string;
    directorySelectionCancelled: string;
    saveBeforeExport: string;
    exportFailed: string;
    // Reader / conversation detail
    analyzed: string;
    notAnalyzedYet: string;
    summary: string;
    noSummaryYet: string;
    generateSummary: string;
    regenerate: string;
    importToNotes: string;
    viewNote: string;
    originalConversation: string;
    preview: string;
    messageCountLabel: string;
    showOriginalMessages: string;
    hideOriginalMessages: string;
    loadingOriginalConversation: string;
    messagesAvailableButEmpty: string;
    openOriginal: string;
    splitView: string;
    openSplitView: string;
    exitSplit: string;
    conversationNote: string;
    updatedAt: string;
    updatedAtTime: string;
    notesForPrefix: string;
    linkedConversations: string;
    noLinkedConversations: string;
    open: string;
    focusNote: string;
    noNoteLinkedYet: string;
    startExtractingHint: string;
    startWritingPlaceholder: string;
    createConversationNote: string;
    extractedExcerptsPlaceholder: string;
    // Related
    relatedConversations: string;
    findingRelated: string;
    noRelatedConversations: string;
    unableToLoadRelated: string;
    relatedNotes: string;
    // Annotation
    addAnnotation: string;
    openAnnotation: string;
    annotation: string;
    annotationCount: string;
    annotationsCount: string;
    deleteThisComment: string;
    deleting: string;
    cancel: string;
    commentPlaceholder: string;
    commentsUnavailable: string;
    couldNotSaveComment: string;
    couldNotDeleteComment: string;
    myNotesExportUnavailable: string;
    savedToMyNotes: string;
    couldNotExportToMyNotes: string;
    notionExportUnavailable: string;
    sentToNotion: string;
    notionSettingsMissing: string;
    notionReconnectRequired: string;
    couldNotExportToNotion: string;
    addedOn: string;
    dayAfter: string;
    daysAfter: string;
    afterTheConversation: string;
    unknownTime: string;
    // Note editor
    localNote: string;
    obsidianNote: string;
    noExcerptYet: string;
    conflict: string;
    vaultPath: string;
    sourceHash: string;
    unknown: string;
    unavailable: string;
    attachments: string;
    attachmentPreview: string;
    previewAvailableForImages: string;
    useOpenForOtherAttachments: string;
    importMetadata: string;
    exportToObsidian: string;
    choosingFolder: string;
    notesWorkspace: string;
    selectNoteToEdit: string;
    localNotesAndObsidianShareEditor: string;
    loadingNotes: string;
    createLocalNoteHint: string;
    createNote: string;
    localNotes: string;
    noLocalNotesYet: string;
    importedVaults: string;
    // Rename / delete dialogs
    renameNote: string;
    updateNoteTitle: string;
    noteTitlePlaceholder: string;
    deleteNoteConfirm: string;
    deleteConversationConfirm: string;
    deleteFolderConfirm: string;
    // Actions
    star: string;
    unstar: string;
    rename: string;
    changeFolder: string;
    removeFromFolder: string;
    delete: string;
    folderActions: string;
    createNewFolder: string;
    newFolder: string;
    conversationActions: string;
    // Selection / Extract
    extract: string;
    // Status
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysAgo: string;
    monthsAgo: string;
    yearsAgo: string;
    // Source file conflict
    sourceFileChangedAfterEdits: string;
    // Formatting
    dateUnknown: string;
    frontmatter: string;
    // Choose Conversations dialog
    chooseConversationsTitle: string;
    chooseConversationsDesc: string;
    applySelected: string;
    useAll: string;
    noSearchResults: string;
    noPreviewAvailable: string;
    closeSidebar: string;
    openSidebar: string;
    emptyDetailTitle: string;
    emptyDetailHint: string;
    summaryCard: {
      coreQuestion: string;
      thinkingJourney: string;
      step: string;
      example: string;
      keyInsights: string;
      unresolvedThreads: string;
      metaObservations: string;
      thinkingStyle: string;
      emotionalTone: string;
      depth: string;
      nextSteps: string;
      fallback: string;
    };
    sendToButton?: string;
    sendToNotionConversation?: string;
    sendToNotionSummary?: string;
    sendToObsidianConversation?: string;
    sendToObsidianSummary?: string;
    sendToExporting?: string;
    sendToDone?: string;
    sendToFailed?: string;
  };
  explore: ExploreLabels;
  data: DataLabels;
  network: {
    emptyTitle: string;
    emptyDesc: string;
    noConversationsYet: string;
    replayInfo: string;
    newConversationOn: string;
    conversationOn: string;
    buildingGraph: string;
    trendLabel: string;
    noSemanticLinks: string;
    dragHint: string;
    replay: string;
    edgeLoadingUnavailable: string;
    edgePlaybackUnavailable: string;
    close: string;
    started: string;
    messages: string;
    semanticLinks: string;
    noPreviewSnippet: string;
    tags: string;
    connectedConversations: string;
    noSemanticLinksForNode: string;
    viewInLibrary: string;
    edgeSemanticSimilarity: string;
    trendScrubberAriaLabel: string;
    conversationsVisible: string;
    appearsLaterInReplay: string;
    starred: string;
    unknownPlatform: string;
    conversationN: string;
    thinkingMapView: string;
    conversationMapView: string;
    thinkingMapEmpty: string;
    loadingThinkingMap: string;
    gapInsightTitle: string;
    gapInsightTemplate: string;
    conceptMentionedIn: string;
    relatedConversations: string;
  };
  prompts: {
    title: string;
    summary: string;
    extractFromChats: string;
    extracting: string;
    extractTooltip: string;
    newPrompt: string;
    searchPlaceholder: string;
    favorites: string;
    allCategories: string;
    sortRecent: string;
    sortQuality: string;
    sortUsage: string;
    loading: string;
    emptyNone: string;
    emptyFiltered: string;
    emptyHint: string;
    retry: string;
    favorite: string;
    unfavorite: string;
    copy: string;
    deleteAria: string;
    closeEditor: string;
    editorNew: string;
    editorEdit: string;
    fieldTitle: string;
    titlePlaceholder: string;
    fieldBody: string;
    bodyPlaceholder: string;
    improveTooltip: string;
    improving: string;
    improveWithAI: string;
    fieldCategory: string;
    categoryPlaceholder: string;
    fieldTags: string;
    tagsPlaceholder: string;
    markFavorite: string;
    openSource: string;
    save: string;
    cancel: string;
    deleteBtn: string;
    usedTimes: string;
    scorePoor: string;
    scoreGood: string;
    scoreHigh: string;
    toastBodyEmpty: string;
    toastSaved: string;
    toastDuplicate: string;
    toastUpdated: string;
    toastSaveFailed: string;
    toastDeleted: string;
    toastDeleteFailed: string;
    toastFavoriteFailed: string;
    toastCopied: string;
    toastClipboard: string;
    toastImproved: string;
    toastNoLlm: string;
    toastImproveFailed: string;
    toastExtract: string;
    unavailable: string;
    exportLabel: string;
    importLabel: string;
    importBackup: string;
    toastExported: string;
    toastImported: string;
    importFailed: string;
    loadFailed: string;
    draftFirst: string;
    extractFailed: string;
    summaryLabel: string;
    plazaTitle: string;
    plazaSubtitle: string;
    plazaDaily: string;
    plazaDailyHint: string;
    plazaUse: string;
    plazaSourcePrefix: string;
    supermarketTitle: string;
    supermarketSubtitle: string;
    myPlaza: string;
    myPlazaEmpty: string;
    adopt: string;
    adopted: string;
    selectAria: string;
    selectedCount: string;
    deleteSelected: string;
    clearSelection: string;
  };
  aiti: {
    modeAsk: string;
    modeAiti: string;
    modeRoundtable: string;
    title: string;
    subtitle: string;
    insufficient: string;
    insufficientHint: string;
    sample: string;
    confidenceLabel: string;
    confidenceLow: string;
    confidenceMedium: string;
    confidenceHigh: string;
    typeSeparator: string;
    strengthsTitle: string;
    empoweringIntro: string;
    obsessionsTitle: string;
    evidence: string;
    axisNeedsSignal: string;
    axisDepthLabel: string;
    axisDepthLeft: string;
    axisDepthRight: string;
    axisDepthLeftStrength: string;
    axisDepthRightStrength: string;
    axisMakerLabel: string;
    axisMakerLeft: string;
    axisMakerRight: string;
    axisMakerLeftStrength: string;
    axisMakerRightStrength: string;
    axisFocusLabel: string;
    axisFocusLeft: string;
    axisFocusRight: string;
    axisFocusLeftStrength: string;
    axisFocusRightStrength: string;
    axisAffectLabel: string;
    axisAffectLeft: string;
    axisAffectRight: string;
    axisAffectLeftStrength: string;
    axisAffectRightStrength: string;
  };
  learn: {
    modeLearn: string;
    title: string;
    subtitle: string;
    insufficient: string;
    insufficientHint: string;
    sample: string;
    confidenceLabel: string;
    confidenceLow: string;
    confidenceMedium: string;
    confidenceHigh: string;
    domainsTitle: string;
    uncategorized: string;
    domainConversations: string;
    glossaryTitle: string;
    openLoopsTitle: string;
    openLoopsEmpty: string;
  };
  roundtable: {
    title: string;
    subtitle: string;
    questionPlaceholder: string;
    personasLabel: string;
    run: string;
    running: string;
    latencyHint: string;
    needQuestion: string;
    seatsTitle: string;
    synthesisTitle: string;
    consensus: string;
    disagreements: string;
    recommendation: string;
    openQuestions: string;
    empty: string;
    personaSkeptic: string;
    personaOptimist: string;
    personaPragmatist: string;
    personaDomainExpert: string;
    personaDevilsAdvocate: string;
  };
}

/** A curated/recommended prompt for the 提示词广场 (Prompt Plaza). */
export interface PlazaPrompt {
  id: string;
  title: string;
  body: string;
  category: string;
  source: string;
  sourceUrl?: string;
  featured?: boolean;
}

/** A big-category group of curated prompts for the 提示词超市. */
export interface PlazaCategory {
  category: string;
  prompts: PlazaPrompt[];
}

/** Reflective-module confidence level. Mirrors sample size + signal quality. */
export type ReflectiveConfidence = "low" | "medium" | "high";

/** AITI (个人内向探索) — a locally-computed "thinking fingerprint". */
export interface AitiAxisScore {
  /** stable axis key: "depth" | "maker" | "focus" | "affect" */
  key: string;
  /** 0..100, toward the axis's RIGHT pole */
  score: number;
  /** up to a few source conversations that contributed most (evidence) */
  evidenceConversationIds: number[];
  /** false when the axis has no supporting evidence (score is a neutral default,
   * not an observation) — the UI renders it muted instead of confidently labeled */
  hasSignal?: boolean;
}

export interface AitiObsession {
  term: string;
  count: number;
}

export interface AitiTrend {
  /** same key as the axis */
  key: string;
  /** direction of change across the time window */
  direction: "rising" | "falling" | "stable";
  /** absolute score change (0..100 scale) */
  delta: number;
  /** human-readable window label, e.g. "Last 30 days" */
  windowLabel: string;
}

export interface AitiProfile {
  /** false → not enough signal to be meaningful (show the gated state) */
  available: boolean;
  sampleSize: number;
  /** confidence driven by sample size and evidence coverage */
  confidence: ReflectiveConfidence;
  axes: AitiAxisScore[];
  obsessions: AitiObsession[];
  /** per-axis trend over a recent time window (optional) */
  trends?: AitiTrend[];
  /** LLM-generated narrative portrait (optional, user-triggered) */
  narrative?: string;
  /** generation timestamp */
  generatedAt?: number;
}

/** "学习 Learn" — the captured KB reframed as a personal curriculum. */
export interface LearnDomain {
  topicId: number | null;
  name: string;
  count: number;
  deep: number;
  moderate: number;
  superficial: number;
}
export interface LearnGlossaryEntry {
  term: string;
  definition: string;
  conversationId?: number;
}
export interface LearnOpenLoop {
  text: string;
  conversationId: number;
}

export interface LearnPathStage {
  /** 1-based stage index */
  stage: number;
  title: string;
  description: string;
  /** concept terms covered in this stage */
  concepts: string[];
  /** rough study time estimate in minutes */
  estimatedMinutes?: number;
}

export interface LearnReviewItem {
  term: string;
  conversationId?: number;
  /** next review due timestamp */
  dueAt: number;
  /** current spaced-repetition interval in days */
  intervalDays: number;
}

export interface LearnGoal {
  id: string;
  text: string;
  /** 0..100 completion estimate */
  progress: number;
  /** glossary terms / domains that support this goal */
  matchedTerms: string[];
}

export interface LearnProfile {
  available: boolean;
  sampleSize: number;
  confidence: ReflectiveConfidence;
  domains: LearnDomain[];
  glossary: LearnGlossaryEntry[];
  openLoops: LearnOpenLoop[];
  /** suggested learning sequence (optional) */
  learningPath?: LearnPathStage[];
  /** spaced-repetition queue (optional) */
  reviewQueue?: LearnReviewItem[];
  /** inferred or user-set learning goals (optional) */
  goals?: LearnGoal[];
  generatedAt?: number;
}

// ---- AI 圆桌 (Roundtable) ----
export type RoundtablePersonaId =
  | "skeptic"
  | "optimist"
  | "pragmatist"
  | "domain_expert"
  | "devils_advocate"
  | "moderator";

export interface RoundtablePersona {
  id: RoundtablePersonaId;
  nameZh: string;
  nameEn: string;
  blurbZh: string;
  blurbEn: string;
  systemPromptZh: string;
  systemPromptEn: string;
}

export interface RoundtableSeatTurn {
  personaId: RoundtablePersonaId;
  content: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface RoundtableSynthesis {
  consensus: string[];
  disagreements: string[];
  recommendation: string;
  openQuestions: string[];
}

export interface RoundtableResult {
  question: string;
  lang: "zh" | "en";
  grounded: boolean;
  seatTurns: RoundtableSeatTurn[];
  synthesis: RoundtableSynthesis | null;
  synthesisRaw: string;
  sources: RelatedConversation[];
  totalDurationMs: number;
}

/** Everything the Prompts tab needs to render the plaza + supermarket. */
export interface PlazaData {
  /** Today's date-seeded recommendations. */
  daily: PlazaPrompt[];
  /** Full catalog grouped by big-category (the 提示词超市). */
  supermarket: PlazaCategory[];
  /** Catalog ids the user has adopted into their personal 提示词广场. */
  adoptedIds: string[];
}
