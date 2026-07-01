"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useState,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  BookOpen,
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Expand,
  List,
  Shrink,
  Star,
  Check,
  ArrowRight,
  Clock,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  Annotation,
  Conversation,
  Topic,
  StorageApi,
  RelatedConversation,
  Message,
  ChatSummaryData,
  Note,
  NoteAssetRecord,
  ObsidianImportFileEntry,
  ObsidianImportSummary,
  UiThemeMode,
} from "../types";
import { useLibraryData } from "../contexts/library-data";
import { getPlatformBadgeStyle, getPlatformLabel } from "../constants/platform";
import { MarkdownNoteEditor } from "../components/MarkdownNoteEditor";
import { ResizablePanelDivider } from "../components/ResizablePanelDivider";
import { StructuredSummaryCard } from "../components/StructuredSummaryCard";
import { SummaryPipelineProgress } from "../components/SummaryPipelineProgress";
import type { PipelineStageState } from "../components/SummaryPipelineProgress";
import {
  getNotionSettings,
  isNotionExportConfigured,
} from "../notion-integration";
import { RichMessageContent } from "../components/RichMessageContent";
import { ReaderTimestampFooter } from "../components/ReaderTimestampFooter";
import { useResizableWidth } from "../hooks/use-resizable-width";
import { useNoteDraft, type NoteSaveStatus } from "../hooks/use-note-draft";
import { buildMessagePreviewText } from "../lib/messagePackage";
import { buildReaderTimestampFooterModel } from "../lib/reader-timestamps";
import { serializeSelectionFragmentToMarkdown } from "../lib/selection-markdown";

type ViewMode = "conversations" | "notes";
type FolderItem = { name: string; isCustom: boolean; isTag: boolean };
type FolderMeta = { customFolders: string[] };
type WorkspaceMode = "single" | "split";
type PendingExcerpt = {
  id: string;
  conversationId: number;
  messageId: number;
  messageIndex: number;
  sourceLabel: string;
  content: string;
};
type ReaderSelectionAction = PendingExcerpt & {
  top: number;
  left: number;
};

type LibraryTabProps = {
  storage: StorageApi;
  themeMode?: UiThemeMode;
  openConversationId?: number | null;
  onConversationOpened?: () => void;
  returnToSourceLabel?: string | null;
  onReturnToSource?: () => void;
  labels?: Record<string, any>;
};

type LibrarySplitContextValue = {
  isSplitActive: boolean;
  isSplitNavigationOpen: boolean;
  noteSaveStatus: NoteSaveStatus;
  pendingExcerpts: PendingExcerpt[];
  openSplitNavigation: () => void;
  closeSplitNavigation: () => void;
  toggleSplitNavigation: () => void;
  consumePendingExcerpt: (excerptId: string) => void;
  exitSplit: () => void | Promise<void>;
};

const LibrarySplitContext = createContext<LibrarySplitContextValue | null>(
  null,
);

const STANDARD_NOTE_EDITOR_MIN_HEIGHT = 280;
const SPLIT_NOTE_EDITOR_MIN_HEIGHT = 520;

type ImportedVaultFolderNode = {
  name: string;
  path: string;
  folders: ImportedVaultFolderNode[];
  notes: Note[];
  noteCount: number;
};

type ImportedVaultNode = {
  id: string;
  name: string;
  folders: ImportedVaultFolderNode[];
  rootNotes: Note[];
  noteCount: number;
};

function compareAlphaNumeric(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function basename(path: string | null | undefined): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

function buildImportedVaults(notes: Note[]): ImportedVaultNode[] {
  type MutableFolderNode = {
    name: string;
    path: string;
    children: Map<string, MutableFolderNode>;
    notes: Note[];
  };

  type MutableVaultNode = {
    id: string;
    name: string;
    root: MutableFolderNode;
  };

  const vaults = new Map<string, MutableVaultNode>();

  for (const note of notes) {
    if (note.source_type !== "obsidian") continue;

    const vaultId = note.import_meta?.vault_id ?? "unknown-vault";
    const vaultName = note.import_meta?.vault_name ?? "Imported Vault";
    let vault = vaults.get(vaultId);
    if (!vault) {
      vault = {
        id: vaultId,
        name: vaultName,
        root: {
          name: "",
          path: "",
          children: new Map(),
          notes: [],
        },
      };
      vaults.set(vaultId, vault);
    }

    const folderSegments = (note.import_meta?.folder_path ?? "")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    let currentFolder = vault.root;
    let currentPath = "";

    for (const segment of folderSegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existingFolder = currentFolder.children.get(segment);
      if (existingFolder) {
        currentFolder = existingFolder;
        continue;
      }

      const nextFolder: MutableFolderNode = {
        name: segment,
        path: currentPath,
        children: new Map(),
        notes: [],
      };
      currentFolder.children.set(segment, nextFolder);
      currentFolder = nextFolder;
    }

    currentFolder.notes.push(note);
  }

  const finalizeFolder = (
    folder: MutableFolderNode,
  ): ImportedVaultFolderNode => {
    const folders = [...folder.children.values()]
      .sort((a, b) => compareAlphaNumeric(a.name, b.name))
      .map(finalizeFolder);
    const noteCount =
      folder.notes.length +
      folders.reduce((sum, child) => sum + child.noteCount, 0);

    return {
      name: folder.name,
      path: folder.path,
      folders,
      notes: [...folder.notes].sort((a, b) =>
        compareAlphaNumeric(a.title, b.title),
      ),
      noteCount,
    };
  };

  return [...vaults.values()]
    .map((vault) => {
      const folders = [...vault.root.children.values()]
        .sort((a, b) => compareAlphaNumeric(a.name, b.name))
        .map(finalizeFolder);
      const rootNotes = [...vault.root.notes].sort((a, b) =>
        compareAlphaNumeric(a.title, b.title),
      );

      return {
        id: vault.id,
        name: vault.name,
        folders,
        rootNotes,
        noteCount:
          rootNotes.length +
          folders.reduce((sum, folder) => sum + folder.noteCount, 0),
      };
    })
    .sort((a, b) => compareAlphaNumeric(a.name, b.name));
}

function useLibrarySplitContext(): LibrarySplitContextValue {
  const context = useContext(LibrarySplitContext);
  if (!context) {
    throw new Error(
      "LibrarySplitContext is only available inside LibraryTab split workspace.",
    );
  }
  return context;
}

function SplitNavigationToggle({
  labels,
}: {
  labels: Record<string, any>;
}) {
  const { isSplitActive, toggleSplitNavigation } = useLibrarySplitContext();

  if (!isSplitActive) return null;

  return (
    <button
      type="button"
      onClick={toggleSplitNavigation}
      className="absolute left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-bg-primary/92 text-text-tertiary shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur transition-colors hover:text-text-primary"
      aria-label={labels.libraryNavigation ?? "Toggle library navigation"}
      title={labels.libraryNavigation ?? "Library navigation"}
    >
      <List strokeWidth={1.7} className="h-4 w-4" />
    </button>
  );
}

function DetailSectionEyebrow({ children }: { children: string }) {
  return (
    <div className="mb-3 text-[11px] font-sans font-medium uppercase tracking-[0.16em] text-text-tertiary">
      {children}
    </div>
  );
}

function DetailSectionCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[24px] border border-border-subtle bg-bg-surface-card shadow-[0_12px_36px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

function MetaChip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-bg-secondary px-3 py-1 text-[12px] font-sans text-text-secondary">
      {children}
    </span>
  );
}

type SplitNoteEditorPanelProps = {
  selectedConversation: Conversation;
  selectedNote: Note | null;
  noteTitle: string;
  noteContent: string;
  linkedConversations: Conversation[];
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSaveRequest: () => void | Promise<void>;
  onAppendExcerpt: (excerpt: PendingExcerpt) => void;
  onCreateConversationNote: () => void | Promise<void>;
  onDeleteCurrentNote: () => void | Promise<void>;
  onOpenConversation: (conversationId: number) => void | Promise<void>;
  formatTimeAgo: (timestamp: number) => string;
  labels: Record<string, any>;
};

function SplitNoteEditorPanel({
  selectedConversation,
  selectedNote,
  noteTitle,
  noteContent,
  linkedConversations,
  onTitleChange,
  onContentChange,
  onSaveRequest,
  onAppendExcerpt,
  onCreateConversationNote,
  onDeleteCurrentNote,
  onOpenConversation,
  formatTimeAgo,
  labels,
}: SplitNoteEditorPanelProps) {
  const {
    pendingExcerpts,
    consumePendingExcerpt,
    noteSaveStatus,
    exitSplit,
  } = useLibrarySplitContext();
  const splitScrollViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedNote || pendingExcerpts.length === 0) return;

    pendingExcerpts
      .filter((excerpt) => excerpt.conversationId === selectedConversation.id)
      .forEach((excerpt) => {
        onAppendExcerpt(excerpt);
        consumePendingExcerpt(excerpt.id);
      });
  }, [
    consumePendingExcerpt,
    onAppendExcerpt,
    pendingExcerpts,
    selectedConversation.id,
    selectedNote,
  ]);

  const saveStatusLabel = selectedNote
    ? noteSaveStatus === "saving"
      ? (labels.saving ?? "Saving...")
      : noteSaveStatus === "unsaved"
        ? (labels.unsavedChanges ?? "Unsaved changes")
        : (labels.updatedAtTime ?? "Updated {time}").replace("{time}", formatTimeAgo(selectedNote.updated_at))
    : (labels.noNoteYet ?? "No note yet");

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <div ref={splitScrollViewportRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-bg-primary/95 px-6 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-sans uppercase tracking-[0.18em] text-text-tertiary">
                {labels.conversationNote ?? "Conversation Note"}
              </div>
              <div className="mt-1 text-[13px] font-sans text-text-secondary">
                {saveStatusLabel}
              </div>
            </div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => void exitSplit()}
                aria-label={labels.exitSplitView ?? "Exit split view"}
                title={labels.exitSplitView ?? "Exit split view"}
                className="group inline-flex h-9 items-center bg-transparent px-1 text-[12px] font-sans text-text-tertiary transition-colors duration-200 hover:text-text-primary"
              >
                <Shrink strokeWidth={1.7} className="h-4 w-4 shrink-0" />
                <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] uppercase tracking-[0.18em] opacity-0 transition-[max-width,opacity,margin] duration-200 group-hover:ml-2 group-hover:max-w-[108px] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[108px] group-focus-visible:opacity-100">
                  {labels.exitSplit ?? "Exit Split"}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-6 pb-28">
          {selectedNote ? (
            <>
              <input
                type="text"
                value={noteTitle}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder={selectedConversation.title}
                className="w-full border-0 bg-transparent px-0 text-2xl font-serif font-normal text-text-primary outline-none placeholder:text-text-tertiary"
              />

              <div className="mt-6">
                <MarkdownNoteEditor
                  value={noteContent}
                  onChange={onContentChange}
                  onSaveRequest={onSaveRequest}
                  placeholderText={labels.extractedExcerptsPlaceholder ?? "Extracted excerpts and your notes will appear here..."}
                  minHeight={SPLIT_NOTE_EDITOR_MIN_HEIGHT}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void onDeleteCurrentNote()}
                    aria-label={labels.deleteNote ?? "Delete note"}
                    title={labels.deleteNote ?? "Delete note"}
                    className="inline-flex h-8 w-8 items-center justify-center text-[#B42318] transition-colors hover:bg-[#FEF2F2]"
                  >
                    <Trash2 strokeWidth={1.6} className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-8">
                <h3 className="mb-3 text-[11px] font-sans font-medium uppercase tracking-wider text-text-tertiary">
                  {labels.linkedConversations ?? "Linked Conversations"}
                </h3>
                {linkedConversations.length > 0 ? (
                  <div className="space-y-2">
                    {linkedConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => void onOpenConversation(conversation.id)}
                        className="flex w-full items-center justify-between rounded-lg bg-bg-surface-card p-3 transition-colors hover:bg-bg-surface-card-hover"
                      >
                        <span className="truncate text-[13px] font-sans text-text-primary">
                          {conversation.title}
                        </span>
                        <span className="text-xs font-sans font-medium text-accent-primary">
                          {labels.open ?? "Open"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg bg-bg-surface-card p-3 text-[13px] font-sans text-text-tertiary">
                    {labels.noLinkedConversations ?? "No linked conversations"}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[28px] border border-dashed border-border-subtle bg-bg-surface-card px-10 text-center">
              <div className="text-[11px] font-sans uppercase tracking-[0.18em] text-text-tertiary">
                {labels.focusNote ?? "Focus Note"}
              </div>
              <h2 className="mt-3 text-2xl font-serif font-normal text-text-primary">
                {labels.noNoteLinkedYet ?? "No note linked yet"}
              </h2>
              <p className="mt-3 max-w-md text-[13px] font-sans leading-relaxed text-text-secondary">
                {labels.startExtractingHint ?? "Start extracting from the reader or create a conversation note"}
                for
                {` ${selectedConversation.title}`} to keep your reading and
                writing side by side.
              </p>
              <button
                type="button"
                onClick={() => void onCreateConversationNote()}
                className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-bg-primary px-4 py-2 text-[13px] font-sans text-text-primary transition-colors hover:bg-bg-secondary"
              >
                <BookOpen strokeWidth={1.6} className="h-4 w-4" />
                {labels.createConversationNote ?? "Create Conversation Note"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LibraryTab({
  storage,
  themeMode = "light",
  openConversationId,
  onConversationOpened,
  returnToSourceLabel = null,
  onReturnToSource,
  labels: providedLabels,
}: LibraryTabProps) {
  const labels = providedLabels ?? ({} as Record<string, any>);
  const { topics, conversations, refresh } = useLibraryData();
  const getRelatedConversations = storage.getRelatedConversations;
  const getMessages = storage.getMessages;
  const getAnnotationsByConversation = storage.getAnnotationsByConversation;
  const saveAnnotation = storage.saveAnnotation;
  const deleteAnnotation = storage.deleteAnnotation;
  const exportAnnotationToNote = storage.exportAnnotationToNote;
  const exportAnnotationToNotion = storage.exportAnnotationToNotion;
  const updateConversation = storage.updateConversation;
  const updateConversationTitle = storage.updateConversationTitle;
  const deleteConversation = storage.deleteConversation;
  const renameFolderTag = storage.renameFolderTag;
  const removeFolderTag = storage.removeFolderTag;
  const [viewMode, setViewMode] = useState<ViewMode>("conversations");
  const [selectedConversationId, setSelectedConversationId] = useState<
    number | null
  >(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [listFilter, setListFilter] = useState<"all" | "starred" | "recent">(
    "all",
  );
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [relatedConversations, setRelatedConversations] = useState<
    RelatedConversation[]
  >([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadedMessagesConversationId, setLoadedMessagesConversationId] =
    useState<number | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationDrafts, setAnnotationDrafts] = useState<
    Record<number, string>
  >({});
  const [annotationSaving, setAnnotationSaving] = useState<
    Record<number, boolean>
  >({});
  const [annotationActionBusy, setAnnotationActionBusy] = useState<
    Record<string, boolean>
  >({});
  const [activeAnnotationMessageId, setActiveAnnotationMessageId] = useState<
    number | null
  >(null);
  const [annotationPendingDeleteId, setAnnotationPendingDeleteId] = useState<
    number | null
  >(null);
  const [annotationNotice, setAnnotationNotice] = useState<{
    tone: "error" | "success";
    message: string;
    annotationId?: number;
  } | null>(null);
  const [isAnnotationDrawerOverlay, setIsAnnotationDrawerOverlay] =
    useState(false);
  const [
    isAnnotationTriggerAlwaysVisible,
    setIsAnnotationTriggerAlwaysVisible,
  ] = useState(false);
  const [annotationPopoverStyle, setAnnotationPopoverStyle] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [isConversationExpanded, setIsConversationExpanded] = useState(false);
  const [, setAnalysisData] = useState<{
    summary?: string;
    keyInsights?: string[];
  } | null>(null);
  const [summaryData, setSummaryData] = useState<ChatSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<PipelineStageState[]>(
    [],
  );
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<
    number | null
  >(null);
  const [openFolderMenuName, setOpenFolderMenuName] = useState<string | null>(
    null,
  );

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [hasLinkedNote, setHasLinkedNote] = useState(false);
  const [renameNoteTarget, setRenameNoteTarget] = useState<Note | null>(null);
  const [renameNoteTitle, setRenameNoteTitle] = useState("");
  const [obsidianActionBusy, setObsidianActionBusy] = useState<number | null>(
    null,
  );
  const [obsidianNotice, setObsidianNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [noteImportBusy, setNoteImportBusy] = useState<"directory" | "zip" | null>(
    null,
  );
  const [noteImportNotice, setNoteImportNotice] = useState<{
    tone: "success" | "error";
    message: string;
    summary?: ObsidianImportSummary;
  } | null>(null);
  const [expandedVaultIds, setExpandedVaultIds] = useState<
    Record<string, boolean>
  >({});
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<
    Record<string, boolean>
  >({});
  const [previewedAssetPath, setPreviewedAssetPath] = useState<string | null>(
    null,
  );
  const [previewedAssetUrl, setPreviewedAssetUrl] = useState<string | null>(
    null,
  );
  const [previewedAssetMimeType, setPreviewedAssetMimeType] = useState<
    string | null
  >(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("single");
  const [isSplitNavigationOpen, setIsSplitNavigationOpen] = useState(false);
  const [isDesktopSplitAvailable, setIsDesktopSplitAvailable] = useState(false);
  const [pendingExcerpts, setPendingExcerpts] = useState<PendingExcerpt[]>([]);
  const [readerSelectionAction, setReaderSelectionAction] =
    useState<ReaderSelectionAction | null>(null);

  // Note editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const directoryImportInputRef = useRef<HTMLInputElement>(null);
  const zipImportInputRef = useRef<HTMLInputElement>(null);
  const renameNoteInputRef = useRef<HTMLInputElement>(null);
  const annotationTextareaRef = useRef<HTMLTextAreaElement>(null);
  const annotationSurfaceRef = useRef<HTMLDivElement>(null);
  const annotationDismissInFlightRef = useRef(false);
  const libraryWorkspaceRef = useRef<HTMLDivElement>(null);
  const annotationTriggerRefs = useRef<Map<number, HTMLButtonElement>>(
    new Map(),
  );
  const messageContentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const conversationPreviewScrollRef = useRef<HTMLDivElement>(null);
  const FOLDER_META_KEY = "vesti_folder_meta";
  const NOTION_SETTINGS_KEY = "vesti_notion_settings";
  const [hasNotionExportConfig, setHasNotionExportConfig] = useState(false);
  const [libraryWorkspaceWidth, setLibraryWorkspaceWidth] = useState(0);
  const previewedAssetUrlRef = useRef<string | null>(null);
  const flushPendingNoteSaveRef = useRef<() => Promise<Note | null> | void>(
    () => undefined,
  );
  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const persistNoteDraft = async (
    noteId: number,
    changes: { title?: string; content?: string },
  ): Promise<Note> => {
    if (!storage.updateNote) {
      throw new Error("Note update is not available.");
    }

    const updated = await storage.updateNote(noteId, changes);
    setNotes((prev) =>
      prev.map((note) => (note.id === updated.id ? updated : note)),
    );
    return updated;
  };

  const {
    title: noteTitle,
    content: noteContent,
    saveStatus: noteSaveStatus,
    setTitle: setNoteTitle,
    setContent: setNoteContent,
    flush: flushPendingNoteSave,
  } = useNoteDraft({
    note: selectedNote,
    persistNote: storage.updateNote ? persistNoteDraft : undefined,
    debounceMs: 750,
  });
  const localNotes = useMemo(
    () => notes.filter((note) => note.source_type !== "obsidian"),
    [notes],
  );
  const importedVaults = useMemo(() => buildImportedVaults(notes), [notes]);
  const canUseObsidianVault = Boolean(
    storage.connectObsidianVault && storage.exportNoteToObsidian,
  );
  const sidebarPane = useResizableWidth({
    storageKey: "vesti.library.sidebar-width",
    defaultWidth: 200,
    minWidth: 168,
    maxWidth: 280,
  });
  const listPane = useResizableWidth({
    storageKey: "vesti.library.list-width",
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 420,
  });
  const splitNotePane = useResizableWidth({
    storageKey: "vesti.library.split-note-width",
    defaultWidth: 540,
    minWidth: 360,
    direction: -1,
    getMaxWidth: () => {
      if (libraryWorkspaceWidth <= 0) {
        if (typeof window === "undefined") {
          return 720;
        }

        return 720;
      }

      const splitReaderMinWidth = Math.max(
        280,
        Math.min(420, Math.round(libraryWorkspaceWidth * 0.4)),
      );

      return Math.max(
        420,
        libraryWorkspaceWidth - splitReaderMinWidth,
      );
    },
  });
  const navigationGroupWidth = sidebarPane.width + listPane.width;

  useEffect(() => {
    flushPendingNoteSaveRef.current = flushPendingNoteSave;
  }, [flushPendingNoteSave]);

  useEffect(() => {
    const node = libraryWorkspaceRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateWidth = () => {
      setLibraryWorkspaceWidth(node.getBoundingClientRect().width);
    };

    updateWidth();
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!obsidianNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setObsidianNotice((current) =>
        current?.message === obsidianNotice.message ? null : current,
      );
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [obsidianNotice]);

  const revokePreviewedAssetUrl = () => {
    if (previewedAssetUrlRef.current) {
      URL.revokeObjectURL(previewedAssetUrlRef.current);
      previewedAssetUrlRef.current = null;
    }
  };

  const setPreviewAsset = (
    url: string | null,
    mimeType: string | null,
    assetPath: string | null,
  ) => {
    revokePreviewedAssetUrl();
    previewedAssetUrlRef.current = url;
    setPreviewedAssetUrl(url);
    setPreviewedAssetMimeType(mimeType);
    setPreviewedAssetPath(assetPath);
  };

  const updateNoteInState = useCallback((updated: Note) => {
    setNotes((prev) =>
      prev.map((note) => (note.id === updated.id ? updated : note)),
    );
  }, []);

  const handleCreateLocalNote = useCallback(async () => {
    if (!storage.saveNote) return;

    try {
      await flushPendingNoteSave();
      const newNote = await storage.saveNote({
        title: "New Note",
        content: "",
        linked_conversation_ids: selectedConversationId
          ? [selectedConversationId]
          : [],
        source_type: "native",
      });
      setNotes((prev) => [newNote, ...prev]);
      await openNotesView(newNote.id);
    } catch (error) {
      console.error("[library] New Note failed", error);
    }
  }, [
    flushPendingNoteSave,
    openNotesView,
    selectedConversationId,
    storage.saveNote,
  ]);

  const handleExportNoteToObsidian = useCallback(
    async (note: Note) => {
      if (!storage.connectObsidianVault || !storage.exportNoteToObsidian) return;

      setObsidianActionBusy(note.id);
      setObsidianNotice(null);

      try {
        let nextNote = note;

        if (selectedNoteId === note.id) {
          const flushed = await flushPendingNoteSave();
          if (flushed) {
            nextNote = flushed;
            updateNoteInState(flushed);
          } else if (noteSaveStatus === "unsaved") {
            throw new Error("NOTE_SAVE_REQUIRED_BEFORE_EXPORT");
          }
        }

        await storage.connectObsidianVault();
        const result = await storage.exportNoteToObsidian(nextNote);
        updateNoteInState(result.note);
        setObsidianNotice({
          tone: "success",
          message: result.vault_name
            ? `Exported to ${result.vault_name}/${result.relative_path}.`
            : `Exported to ${result.relative_path}.`,
        });
      } catch (error) {
        console.error("[library] Failed to export note to Obsidian", error);
        setObsidianNotice({
          tone: "error",
          message:
            error instanceof Error &&
            error.message === "OBSIDIAN_VAULT_UNSUPPORTED"
              ? "This browser surface does not support local directory export."
              : error instanceof Error &&
                  error.message === "OBSIDIAN_VAULT_PERMISSION_DENIED"
                ? "Directory selection was cancelled."
                : error instanceof Error &&
                    error.message === "NOTE_SAVE_REQUIRED_BEFORE_EXPORT"
                  ? (labels.saveBeforeExport ?? "Save the current note before exporting it.")
                  : (labels.exportFailed ?? "Could not export this note to Obsidian."),
        });
      } finally {
        setObsidianActionBusy(null);
      }
    },
    [
      flushPendingNoteSave,
      noteSaveStatus,
      selectedNoteId,
      storage.connectObsidianVault,
      storage.exportNoteToObsidian,
      updateNoteInState,
    ],
  );

  function getInitialStages(): PipelineStageState[] {
    return [
      {
        stage: "initiating_pipeline",
        label: labels.initiatingPipeline ?? "Initiating pipeline...",
        status: "pending",
      },
      {
        stage: "distilling_core_logic",
        label: labels.extractingCore ?? "Extracting core question...",
        status: "pending",
      },
      {
        stage: "curating_summary",
        label: labels.generatingInsights ?? "Generating insights...",
        status: "pending",
      },
      {
        stage: "persisting_result",
        label: labels.savingSummary ?? "Saving summary...",
        status: "pending",
      },
    ];
  }

  function isPipelineStageStatus(
    status: string,
  ): status is PipelineStageState["status"] {
    return (
      status === "pending" ||
      status === "in_progress" ||
      status === "completed" ||
      status === "degraded_fallback"
    );
  }

  useEffect(() => {
    if (!storage.getNotes) return;
    setNotesLoading(true);
    storage
      .getNotes()
      .then((data) => setNotes(data))
      .catch(() => setNotes([]))
      .finally(() => setNotesLoading(false));
  }, [storage]);

  useEffect(() => {
    const input = directoryImportInputRef.current;
    if (!input) return;

    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    setExpandedVaultIds((current) => {
      const next = { ...current };
      for (const vault of importedVaults) {
        if (next[vault.id] === undefined) {
          next[vault.id] = true;
        }
      }
      return next;
    });
  }, [importedVaults]);

  useEffect(() => {
    setPreviewAsset(null, null, null);
  }, [selectedNoteId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const syncSplitAvailability = () =>
      setIsDesktopSplitAvailable(mediaQuery.matches);

    syncSplitAvailability();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncSplitAvailability);
      return () =>
        mediaQuery.removeEventListener("change", syncSplitAvailability);
    }

    mediaQuery.addListener(syncSplitAvailability);
    return () => mediaQuery.removeListener(syncSplitAvailability);
  }, []);

  useEffect(() => {
    if (workspaceMode !== "split") {
      setIsSplitNavigationOpen(false);
    }
  }, [workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "split" || isDesktopSplitAvailable) return;
    setWorkspaceMode("single");
    setIsSplitNavigationOpen(false);
    setReaderSelectionAction(null);
  }, [isDesktopSplitAvailable, workspaceMode]);

  const persistFolderMeta = (nextCustom: string[]) => {
    setCustomFolders(nextCustom);
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.set(
      { [FOLDER_META_KEY]: { customFolders: nextCustom } },
      () => {
        void chrome.runtime?.lastError;
      },
    );
  };

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(FOLDER_META_KEY, (result) => {
      const meta = result?.[FOLDER_META_KEY] as FolderMeta | undefined;
      if (!meta) return;
      if (Array.isArray(meta.customFolders)) {
        setCustomFolders(meta.customFolders);
      }
    });
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setHasNotionExportConfig(false);
      return;
    }

    const syncNotionConfig = () => {
      void getNotionSettings()
        .then((settings) => {
          setHasNotionExportConfig(isNotionExportConfigured(settings));
        })
        .catch(() => {
          setHasNotionExportConfig(false);
        });
    };

    syncNotionConfig();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[NOTION_SETTINGS_KEY]) return;
      syncNotionConfig();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    if (!openConversationMenuId && !openFolderMenuName) return;
    const handleClick = () => {
      setOpenConversationMenuId(null);
      setOpenFolderMenuName(null);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openConversationMenuId, openFolderMenuName]);

  useEffect(() => {
    if (conversations.length > 0 && selectedConversationId === null) {
      return;
    }
    if (conversations.length > 0 && selectedConversationId !== null) {
      const exists = conversations.some((c) => c.id === selectedConversationId);
      if (!exists) {
        setSelectedConversationId(null);
      }
    }
  }, [conversations, selectedConversationId]);

  // TODO: replace with actual db read when teammate's analysis schema is confirmed
  // e.g. db.analyses.where('conversation_id').equals(selectedConversationId).first()
  useEffect(() => {
    setAnalysisData(null);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId || !storage.getSummary) {
      setSummaryData(null);
      return;
    }
    setSummaryLoading(true);
    storage
      .getSummary(selectedConversationId)
      .then((data) => setSummaryData(data))
      .catch(() => setSummaryData(null))
      .finally(() => setSummaryLoading(false));
  }, [selectedConversationId, storage]);

  useEffect(() => {
    if (!selectedConversationId) {
      setHasLinkedNote(false);
      return;
    }
    setHasLinkedNote(
      notes.some(
        (note) =>
          note.source_type === "native" &&
          note.linked_conversation_ids.includes(selectedConversationId),
      ),
    );
  }, [selectedConversationId, notes]);

  useEffect(() => {
    let cancelled = false;

    const loadRelated = async () => {
      if (!selectedConversationId || !getRelatedConversations) {
        setRelatedConversations([]);
        setRelatedError(null);
        return;
      }

      setRelatedLoading(true);
      setRelatedError(null);
      try {
        const data = await getRelatedConversations(selectedConversationId, 3);
        if (!cancelled) {
          setRelatedConversations(data);
        }
      } catch (error) {
        if (!cancelled) {
          setRelatedConversations([]);
          setRelatedError(
            (error as Error)?.message ?? "Failed to load related conversations",
          );
        }
      } finally {
        if (!cancelled) {
          setRelatedLoading(false);
        }
      }
    };

    void loadRelated();

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId, getRelatedConversations]);

  useEffect(() => {
    let cancelled = false;

    const loadMessages = async () => {
      if (!selectedConversationId || !getMessages) {
        setMessages([]);
        setMessagesError(null);
        return;
      }

      setMessagesLoading(true);
      setMessagesError(null);
      setMessages([]);
      try {
        const data = await getMessages(selectedConversationId);
        if (!cancelled) {
          setMessages(data);
        }
      } catch (error) {
        if (!cancelled) {
          setMessages([]);
          setMessagesError(
            (error as Error)?.message ?? "Failed to load messages",
          );
        }
      } finally {
        if (!cancelled) {
          setMessagesLoading(false);
        }
      }
    };

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId, getMessages]);

  useEffect(() => {
    let cancelled = false;

    const loadAnnotations = async () => {
      if (!selectedConversationId || !getAnnotationsByConversation) {
        setAnnotations([]);
        setAnnotationDrafts({});
        setActiveAnnotationMessageId(null);
        setAnnotationPendingDeleteId(null);
        setAnnotationNotice(null);
        return;
      }

      try {
        const data = await getAnnotationsByConversation(selectedConversationId);
        if (!cancelled) {
          setAnnotations(data);
          setAnnotationDrafts({});
          setAnnotationActionBusy({});
          setAnnotationPendingDeleteId(null);
          setAnnotationNotice(null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[library] Failed to load annotations", error);
          setAnnotations([]);
          setAnnotationDrafts({});
          setAnnotationActionBusy({});
          setActiveAnnotationMessageId(null);
          setAnnotationPendingDeleteId(null);
          setAnnotationNotice(null);
        }
      }
    };

    void loadAnnotations();

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId, getAnnotationsByConversation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 1279px)");
    const syncOverlayMode = () =>
      setIsAnnotationDrawerOverlay(mediaQuery.matches);

    syncOverlayMode();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncOverlayMode);
      return () => mediaQuery.removeEventListener("change", syncOverlayMode);
    }

    mediaQuery.addListener(syncOverlayMode);
    return () => mediaQuery.removeListener(syncOverlayMode);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const syncTriggerVisibility = () =>
      setIsAnnotationTriggerAlwaysVisible(mediaQuery.matches);

    syncTriggerVisibility();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncTriggerVisibility);
      return () =>
        mediaQuery.removeEventListener("change", syncTriggerVisibility);
    }

    mediaQuery.addListener(syncTriggerVisibility);
    return () => mediaQuery.removeListener(syncTriggerVisibility);
  }, []);

  useEffect(() => {
    if (
      activeAnnotationMessageId !== null &&
      !messages.some((message) => message.id === activeAnnotationMessageId)
    ) {
      setActiveAnnotationMessageId(null);
      setAnnotationPendingDeleteId(null);
      setAnnotationNotice(null);
    }
  }, [messages, activeAnnotationMessageId]);

  useEffect(() => {
    if (!activeAnnotationMessageId || !annotationTextareaRef.current) return;
    annotationTextareaRef.current.focus();
    annotationTextareaRef.current.setSelectionRange(
      annotationTextareaRef.current.value.length,
      annotationTextareaRef.current.value.length,
    );
  }, [activeAnnotationMessageId]);

  useEffect(() => {
    const element = annotationTextareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [annotationDrafts, activeAnnotationMessageId, isAnnotationDrawerOverlay]);

  useEffect(() => {
    if (activeAnnotationMessageId === null || isAnnotationDrawerOverlay) {
      setAnnotationPopoverStyle(null);
      return;
    }

    const trigger = annotationTriggerRefs.current.get(
      activeAnnotationMessageId,
    );
    const container = conversationPreviewScrollRef.current;
    if (!trigger || !container) return;

    const triggerRect = trigger.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const width = Math.min(360, Math.max(240, container.clientWidth - 24));
    const top =
      triggerRect.bottom - containerRect.top + container.scrollTop + 8;
    const left = Math.min(
      Math.max(triggerRect.right - containerRect.left - width, 12),
      Math.max(12, container.clientWidth - width - 12),
    );

    setAnnotationPopoverStyle({
      top,
      left,
      width,
      maxHeight: Math.min(360, Math.max(180, container.clientHeight - 24)),
    });
  }, [
    activeAnnotationMessageId,
    isAnnotationDrawerOverlay,
    isConversationExpanded,
  ]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (renameNoteTarget && renameNoteInputRef.current) {
      renameNoteInputRef.current.focus();
      renameNoteInputRef.current.select();
    }
  }, [renameNoteTarget]);

  const selectedConversation = conversations.find(
    (c) => c.id === selectedConversationId,
  );
  const activeAnnotationMessage =
    activeAnnotationMessageId !== null
      ? messages.find((message) => message.id === activeAnnotationMessageId) ??
        null
      : null;
  const activeAnnotationDraft =
    activeAnnotationMessageId !== null
      ? annotationDrafts[activeAnnotationMessageId] ?? ""
      : "";
  const annotationsByMessage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    annotations
      .slice()
      .sort((a, b) => a.created_at - b.created_at)
      .forEach((annotation) => {
        const bucket = map.get(annotation.message_id) ?? [];
        bucket.push(annotation);
        map.set(annotation.message_id, bucket);
      });
    return map;
  }, [annotations]);
  const activeMessageAnnotations =
    activeAnnotationMessage !== null
      ? annotationsByMessage.get(activeAnnotationMessage.id) ?? []
      : [];
  const isAnnotationPanelOpen = activeAnnotationMessage !== null;
  const areAnnotationRowActionsAlwaysVisible =
    isAnnotationDrawerOverlay || isAnnotationTriggerAlwaysVisible;
  const renameNoteTrimmed = renameNoteTitle.trim();
  const canSaveRenamedNote = Boolean(
    renameNoteTarget &&
      storage.updateNote &&
      renameNoteTrimmed &&
      renameNoteTrimmed !== renameNoteTarget.title,
  );
  const messageCount = messages.length;
  const timestampFooter = useMemo(
    () =>
      selectedConversation
        ? buildReaderTimestampFooterModel(selectedConversation)
        : null,
    [selectedConversation],
  );
  const isConversationContentSettled =
    selectedConversation !== undefined &&
    selectedConversation !== null &&
    !messagesLoading &&
    loadedMessagesConversationId === selectedConversation.id;
  const messageDate =
    messages.length > 0
      ? messages[0].created_at
      : selectedConversation?.updated_at;
  const normalizeTags = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
    );
  };

  const activeTags = normalizeTags(selectedConversation?.tags);
  const activeTopicName = selectedConversation?.topic_id
    ? findTopicById(topics, selectedConversation.topic_id)?.name
    : undefined;
  const hasAnalysis = Boolean(activeTags.length > 0 || activeTopicName);
  const overviewSectionLabel = activeTopicName ?? activeTags[0] ?? labels.general ?? "General";
  const relatedNotesForConversation = useMemo(
    () =>
      selectedConversation
        ? getConversationLinkedNotes(selectedConversation.id)
        : [],
    [notes, selectedConversation],
  );
  const originalConversationPreview = useMemo(() => {
    if (messagesLoading) {
      return labels.loadingMessages ?? "Loading messages...";
    }
    if (messages.length === 0) {
      return labels.noMessages ?? "No messages captured yet.";
    }
    const preview = buildMessagePreviewText(messages[0], {
      maxChars: 160,
    }).trim();
    return preview || "Messages are available, but preview text is empty.";
  }, [messages, messagesLoading]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const conversation of conversations) {
      for (const tag of normalizeTags(conversation.tags)) {
        const normalized = tag.trim();
        if (!normalized) continue;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [conversations]);

  const starredCount = useMemo(
    () =>
      conversations.filter((conversation) => conversation.is_starred).length,
    [conversations],
  );
  const recentConversations = useMemo(() => {
    const sorted = [...conversations].sort(
      (a, b) => b.updated_at - a.updated_at,
    );
    return sorted.slice(0, 20);
  }, [conversations]);
  const folderItems = useMemo<FolderItem[]>(() => {
    const normalize = (value: string) => value.trim().toLowerCase();
    const used = new Set<string>();
    const items: FolderItem[] = [];

    const customSet = new Set(customFolders.map((name) => normalize(name)));

    for (const { tag } of tagCounts) {
      const key = normalize(tag);
      if (used.has(key)) continue;
      used.add(key);
      items.push({
        name: tag,
        isCustom: customSet.has(key),
        isTag: true,
      });
    }

    for (const name of customFolders) {
      const key = normalize(name);
      if (used.has(key)) continue;
      used.add(key);
      items.push({
        name,
        isCustom: true,
        isTag: false,
      });
    }

    return items;
  }, [tagCounts, customFolders]);

  const baseConversations =
    listFilter === "starred"
      ? conversations.filter((conversation) => conversation.is_starred)
      : listFilter === "recent"
        ? recentConversations
        : conversations;
  const tagFilteredConversations = selectedTag
    ? baseConversations.filter((conversation) =>
        normalizeTags(conversation.tags).includes(selectedTag),
      )
    : baseConversations;

  const filteredConversations = tagFilteredConversations;
  const isSplitActive =
    workspaceMode === "split" &&
    isDesktopSplitAvailable &&
    Boolean(selectedConversation);
  const isReaderConversationExpanded = isSplitActive || isConversationExpanded;

  const canToggleConversationExpanded = !isSplitActive && messageCount > 0;

  useEffect(() => {
    setIsConversationExpanded(isSplitActive);
    setSummaryExpanded(false);
  }, [selectedConversationId, isSplitActive]);

  useEffect(() => {
    if (typeof openConversationId !== "number") return;
    if (openConversationId !== selectedConversationId) {
      void selectConversation(openConversationId, {
        resetSelectedNote: !isSplitActive,
      });
    }
    onConversationOpened?.();
  }, [
    isSplitActive,
    openConversationId,
    onConversationOpened,
    selectedConversationId,
  ]);

  function getConversationLinkedNotes(conversationId: number): Note[] {
    return notes
      .filter(
        (note) =>
          note.source_type === "native" &&
          note.linked_conversation_ids.includes(conversationId),
      )
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  function resolveConversationSplitNote(conversationId: number): Note | null {
    if (
      selectedNote &&
      selectedNote.linked_conversation_ids.includes(conversationId)
    ) {
      return selectedNote;
    }
    return getConversationLinkedNotes(conversationId)[0] ?? null;
  }

  async function ensureConversationNote(
    conversationId: number,
    options?: { createIfMissing?: boolean },
  ): Promise<Note | null> {
    const existingNote = resolveConversationSplitNote(conversationId);
    if (existingNote) {
      setSelectedNoteId(existingNote.id);
      return existingNote;
    }

    if (!options?.createIfMissing || !storage.saveNote) {
      setSelectedNoteId(null);
      return null;
    }

    const conversation = conversations.find(
      (item) => item.id === conversationId,
    );
    const createdNote = await storage.saveNote({
      title: conversation?.title ?? (labels.untitled ?? "Untitled"),
      content: "",
      linked_conversation_ids: [conversationId],
      source_type: "native",
    });
    setNotes((prev) => [
      createdNote,
      ...prev.filter((note) => note.id !== createdNote.id),
    ]);
    setSelectedNoteId(createdNote.id);
    return createdNote;
  }

  function closeReaderSelectionAction() {
    setReaderSelectionAction(null);
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
  }

  function queuePendingExcerpt(excerpt: PendingExcerpt) {
    setPendingExcerpts((prev) => [...prev, excerpt]);
  }

  function consumePendingExcerpt(excerptId: string) {
    setPendingExcerpts((prev) =>
      prev.filter((excerpt) => excerpt.id !== excerptId),
    );
  }

  function appendExcerptToDraft(excerpt: PendingExcerpt) {
    setNoteContent((current) => {
      const trimmedCurrent = current.trimEnd();
      const prefix = trimmedCurrent.length > 0 ? "\n\n" : "";
      return `${trimmedCurrent}${prefix}${excerpt.content}`;
    });
  }

  async function enterSplitView(options?: { openNavigation?: boolean }) {
    if (!selectedConversationId) return;
    await flushPendingNoteSave();
    setViewMode("conversations");
    if (isDesktopSplitAvailable) {
      setWorkspaceMode("split");
      setIsSplitNavigationOpen(Boolean(options?.openNavigation));
      const linkedNote = resolveConversationSplitNote(selectedConversationId);
      setSelectedNoteId(linkedNote?.id ?? null);
    }
  }

  async function exitSplitView() {
    await flushPendingNoteSave();
    setWorkspaceMode("single");
    setIsSplitNavigationOpen(false);
    setReaderSelectionAction(null);
    setViewMode("conversations");
  }

  async function openNotesView(noteId?: number | null) {
    await flushPendingNoteSave();
    setWorkspaceMode("single");
    setIsSplitNavigationOpen(false);
    setViewMode("notes");
    if (typeof noteId === "number") {
      setSelectedNoteId(noteId);
    } else if (notes.length > 0 && !selectedNoteId) {
      setSelectedNoteId(notes[0].id);
    }
  }

  async function selectConversation(
    conversationId: number | null,
    options?: {
      resetFilters?: boolean;
      closeNavigation?: boolean;
      resetSelectedNote?: boolean;
    },
  ) {
    await flushPendingNoteSave();
    setViewMode("conversations");
    if (options?.resetFilters) {
      setListFilter("all");
      setSelectedTag(null);
    }
    setSelectedConversationId(conversationId);
    if (options?.resetSelectedNote) {
      setSelectedNoteId(null);
    }
    if (options?.closeNavigation) {
      setIsSplitNavigationOpen(false);
    }
    setReaderSelectionAction(null);
  }

  async function selectNote(noteId: number | null) {
    await flushPendingNoteSave();
    setSelectedNoteId(noteId);
  }

  async function handleSplitViewForCurrentConversation() {
    if (!selectedConversationId) return;
    await enterSplitView();
  }

  async function handleImportConversationToNotes() {
    if (!selectedConversationId) return;
    let note = resolveConversationSplitNote(selectedConversationId);
    if (!note) {
      if (!storage.saveNote) return;
      const title = selectedConversation?.title ?? (labels.untitled ?? "Untitled");
      const content = summaryData
        ? [
            `## ${summaryData.core_question}`,
            "",
            "### Thinking Journey",
            ...summaryData.thinking_journey.map(
              (item) =>
                `**Step ${item.step} · ${item.speaker}**: ${item.assertion}${
                  item.real_world_anchor
                    ? `\n  _Example: ${item.real_world_anchor}_`
                    : ""
                }`,
            ),
            "",
            "### Key Insights",
            ...summaryData.key_insights.map(
              (item) => `**${item.term}**: ${item.definition}`,
            ),
            "",
            "### Unresolved Threads",
            ...summaryData.unresolved_threads.map((item) => `- ${item}`),
            "",
            "### Next Steps",
            ...summaryData.actionable_next_steps.map((item) => `- ${item}`),
          ].join("\n")
        : (labels.notesForPrefix ?? "Notes for: {title}").replace("{title}", title);
      note = await storage.saveNote({
        title,
        content,
        linked_conversation_ids: [selectedConversationId],
        source_type: "native",
      });
      setNotes((prev) => [
        note as Note,
        ...prev.filter((item) => item.id !== note?.id),
      ]);
      setSelectedNoteId(note.id);
    }
    if (!note) return;
    if (isDesktopSplitAvailable) {
      setViewMode("conversations");
      setWorkspaceMode("split");
      setIsSplitNavigationOpen(false);
      return;
    }
    await openNotesView(note.id);
  }

  async function handleCreateConversationNote() {
    if (!selectedConversationId) return;
    const note = await ensureConversationNote(selectedConversationId, {
      createIfMissing: true,
    });
    if (!note) return;
    if (isDesktopSplitAvailable) {
      setWorkspaceMode("split");
      setViewMode("conversations");
      return;
    }
    await openNotesView(note.id);
  }

  async function handleDeleteCurrentSplitNote() {
    if (!selectedNote) return;
    if (!storage.deleteNote) {
      window.alert(labels.deleteNotAvailable ?? "Delete is not available yet.");
      return;
    }
    const confirmed = window.confirm(`Delete note "${selectedNote.title}"?`);
    if (!confirmed) return;
    try {
      await storage.deleteNote(selectedNote.id);
      setNotes((prev) => prev.filter((note) => note.id !== selectedNote.id));
      setSelectedNoteId(null);
    } catch (error) {
      console.error("[library] deleteNote failed", error);
    }
  }

  function updateReaderSelectionAction(
    message: Message,
    messageIndex: number,
    element: HTMLDivElement | null,
  ) {
    if (!element || !selectedConversation || !isDesktopSplitAvailable) {
      setReaderSelectionAction(null);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setReaderSelectionAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;

    if (
      !anchorNode ||
      !focusNode ||
      !element.contains(anchorNode) ||
      !element.contains(focusNode)
    ) {
      setReaderSelectionAction(null);
      return;
    }

    const markdownContent = serializeSelectionFragmentToMarkdown(
      range.cloneContents(),
    );
    const content = (
      markdownContent ||
      selection.toString().replace(/\s+\n/g, "\n")
    ).trim();
    if (!content) {
      setReaderSelectionAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setReaderSelectionAction(null);
      return;
    }

    const maxLeft =
      typeof window !== "undefined" ? window.innerWidth - 148 : rect.left;
    setReaderSelectionAction({
      id: `${message.id}-${Date.now()}`,
      conversationId: selectedConversation.id,
      messageId: message.id,
      messageIndex,
      sourceLabel:
        message.role === "user" ? (labels.you ?? "You") : selectedConversation.platform,
      content,
      top: Math.max(12, rect.bottom + 10),
      left: Math.max(12, Math.min(rect.left + rect.width / 2 - 60, maxLeft)),
    });
  }

  async function handleExtractSelection() {
    if (!readerSelectionAction || !selectedConversationId) return;
    const note = await ensureConversationNote(selectedConversationId, {
      createIfMissing: true,
    });
    if (!note) return;

    setViewMode("conversations");
    if (isDesktopSplitAvailable) {
      setWorkspaceMode("split");
      setIsSplitNavigationOpen(false);
    }
    queuePendingExcerpt(readerSelectionAction);
    closeReaderSelectionAction();
  }

  useEffect(() => {
    if (!isSplitActive || !selectedConversationId) return;

    const nextNote = resolveConversationSplitNote(selectedConversationId);
    if ((nextNote?.id ?? null) !== selectedNoteId) {
      setSelectedNoteId(nextNote?.id ?? null);
    }
  }, [isSplitActive, notes, selectedConversationId, selectedNoteId]);

  useEffect(() => {
    if (typeof window === "undefined" || !readerSelectionAction) return;

    const handleClearSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setReaderSelectionAction(null);
      }
    };

    const handleViewportChange = () => {
      setReaderSelectionAction(null);
    };

    document.addEventListener("selectionchange", handleClearSelection);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("selectionchange", handleClearSelection);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [readerSelectionAction]);

  useEffect(() => {
    return () => {
      revokePreviewedAssetUrl();
      void flushPendingNoteSaveRef.current();
    };
  }, []);

  const handleCreateFolder = () => {
    const name = window.prompt(labels.newFolderPrompt ?? "New folder name");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    const exists = folderItems.some(
      (item) => item.name.trim().toLowerCase() === normalized,
    );
    if (exists) {
      window.alert("A folder with that name already exists.");
      return;
    }
    const nextCustom = [...customFolders, trimmed];
    persistFolderMeta(nextCustom);
    setViewMode("conversations");
    setListFilter("all");
    setSelectedTag(trimmed);
    setSelectedConversationId(null);
  };

  const handleRenameFolder = async (item: FolderItem) => {
    const name = window.prompt(labels.renameFolderPrompt ?? "Rename folder", item.name);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) return;
    const normalized = trimmed.toLowerCase();
    const exists = folderItems.some(
      (folder) =>
        folder.name.trim().toLowerCase() === normalized &&
        folder.name.trim().toLowerCase() !== item.name.trim().toLowerCase(),
    );
    if (exists) {
      window.alert("A folder with that name already exists.");
      return;
    }

    const currentKey = item.name.trim().toLowerCase();
    const nextCustom = customFolders.map((folder) =>
      folder.trim().toLowerCase() === currentKey ? trimmed : folder,
    );

    if (item.isTag) {
      if (!renameFolderTag) {
        window.alert("Renaming folders is not available yet.");
        return;
      }
      try {
        await renameFolderTag(item.name, trimmed);
        await refresh();
      } catch (error) {
        window.alert((error as Error)?.message ?? (labels.renameFolderFailed ?? "Failed to rename folder."));
        return;
      }
    }

    persistFolderMeta(nextCustom);
    if (selectedTag?.trim().toLowerCase() === currentKey) {
      setSelectedTag(trimmed);
    }
  };

  const handleDeleteFolder = async (item: FolderItem) => {
    const confirmed = window.confirm(`Delete folder "${item.name}"?`);
    if (!confirmed) return;

    const currentKey = item.name.trim().toLowerCase();
    let nextCustom = customFolders.filter(
      (folder) => folder.trim().toLowerCase() !== currentKey,
    );

    if (item.isTag) {
      if (!removeFolderTag) {
        window.alert(labels.deleteFolderNotAvailable ?? "Deleting folders is not available yet.");
        return;
      }
      try {
        await removeFolderTag(item.name);
        await refresh();
      } catch (error) {
        window.alert((error as Error)?.message ?? (labels.deleteFolderFailed ?? "Failed to delete folder."));
        return;
      }
    }

    persistFolderMeta(nextCustom);
    if (selectedTag?.trim().toLowerCase() === currentKey) {
      setSelectedTag(null);
      setListFilter("all");
      setSelectedConversationId(null);
    }
  };

  const dedupeTagList = (tags: string[]) => {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const tag of tags) {
      const normalized = tag.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }
    return output;
  };

  const handleConversationStar = async (conversation: Conversation) => {
    if (!updateConversation) {
      window.alert("Starring is not available yet.");
      return;
    }
    try {
      await updateConversation(conversation.id, {
        is_starred: !conversation.is_starred,
      });
      await refresh();
    } catch (error) {
      window.alert((error as Error)?.message ?? (labels.updateStarFailed ?? "Failed to update star."));
    }
  };

  const handleConversationRename = async (conversation: Conversation) => {
    if (!updateConversationTitle) {
      window.alert(labels.renameNotAvailable ?? "Renaming is not available yet.");
      return;
    }
    const name = window.prompt(labels.renameConversationPrompt ?? "Rename conversation", conversation.title);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === conversation.title) return;
    try {
      await updateConversationTitle(conversation.id, trimmed);
      await refresh();
    } catch (error) {
      window.alert(
        (error as Error)?.message ?? (labels.renameConversationFailed ?? "Failed to rename conversation."),
      );
    }
  };

  const handleConversationChangeFolder = async (conversation: Conversation) => {
    if (!updateConversation) {
      window.alert("Changing folders is not available yet.");
      return;
    }
    const name = window.prompt(labels.changeFolder ?? "Change folder", selectedTag ?? "");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const selectedKey = selectedTag?.trim().toLowerCase() ?? null;
    let nextTags = dedupeTagList(normalizeTags(conversation.tags));
    if (selectedKey) {
      nextTags = nextTags.filter(
        (tag) => tag.trim().toLowerCase() !== selectedKey,
      );
    }
    nextTags = dedupeTagList([...nextTags, trimmed]).slice(0, 6);

    try {
      await updateConversation(conversation.id, { tags: nextTags });
      if (
        !customFolders.some(
          (folder) => folder.trim().toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        persistFolderMeta([...customFolders, trimmed]);
      }
      await refresh();
    } catch (error) {
      window.alert((error as Error)?.message ?? "Failed to change folder.");
    }
  };

  const handleConversationRemoveFromFolder = async (
    conversation: Conversation,
  ) => {
    if (!updateConversation) {
      window.alert("Removing from folder is not available yet.");
      return;
    }
    if (!selectedTag) {
      window.alert("Select a folder first.");
      return;
    }
    const selectedKey = selectedTag.trim().toLowerCase();
    let nextTags = dedupeTagList(normalizeTags(conversation.tags));
    nextTags = nextTags.filter(
      (tag) => tag.trim().toLowerCase() !== selectedKey,
    );
    try {
      await updateConversation(conversation.id, { tags: nextTags });
      await refresh();
    } catch (error) {
      window.alert(
        (error as Error)?.message ?? "Failed to remove from folder.",
      );
    }
  };

  const handleConversationDelete = async (conversation: Conversation) => {
    if (!deleteConversation) {
      window.alert(labels.deleteNotAvailable ?? "Delete is not available yet.");
      return;
    }
    const confirmed = window.confirm(labels.deleteConversationConfirm ?? "Delete this conversation?");
    if (!confirmed) return;
    try {
      await deleteConversation(conversation.id);
      await refresh();
    } catch (error) {
      window.alert(
        (error as Error)?.message ?? "Failed to delete conversation.",
      );
    }
  };

  const handleNoteDelete = async (note: Note) => {
    if (!storage.deleteNote) {
      window.alert(labels.deleteNotAvailable ?? "Delete is not available yet.");
      return;
    }
    const confirmed = window.confirm(`Delete note "${note.title}"?`);
    if (!confirmed) return;
    try {
      await flushPendingNoteSave();
      await storage.deleteNote(note.id);
      const nextNotes = notes.filter((item) => item.id !== note.id);
      setNotes(nextNotes);
      if (selectedNoteId === note.id) {
        setSelectedNoteId(isSplitActive ? null : nextNotes[0]?.id ?? null);
      }
      if (renameNoteTarget?.id === note.id) {
        setRenameNoteTarget(null);
      }
    } catch (error) {
      console.error("[library] deleteNote failed", error);
    }
  };

  const openNoteRenameDialog = (note: Note) => {
    setRenameNoteTarget(note);
    setRenameNoteTitle(note.title);
  };

  const submitNoteRename = async () => {
    if (!renameNoteTarget || !storage.updateNote) return;
    const trimmedTitle = renameNoteTitle.trim();
    if (!trimmedTitle || trimmedTitle === renameNoteTarget.title) {
      setRenameNoteTarget(null);
      return;
    }
    try {
      const updated = await storage.updateNote(renameNoteTarget.id, {
        title: trimmedTitle,
      });
      setNotes((prev) =>
        prev.map((note) => (note.id === updated.id ? updated : note)),
      );
      if (selectedNoteId === updated.id) {
        setNoteTitle(updated.title);
      }
      setRenameNoteTarget(null);
    } catch (error) {
      window.alert((error as Error)?.message ?? "Failed to rename note.");
    }
  };

  const refreshNotes = async (): Promise<Note[]> => {
    if (!storage.getNotes) {
      return notes;
    }

    const nextNotes = await storage.getNotes();
    setNotes(nextNotes);
    return nextNotes;
  };

  const formatImportNotice = (summary: ObsidianImportSummary): string => {
    const parts = [
      `Imported ${summary.importedNotes} note${summary.importedNotes === 1 ? "" : "s"}`,
      summary.updatedNotes > 0
        ? `updated ${summary.updatedNotes}`
        : null,
      summary.skippedNotes > 0
        ? `skipped ${summary.skippedNotes}`
        : null,
      summary.conflictedNotes > 0
        ? `conflicts ${summary.conflictedNotes}`
        : null,
      summary.importedAssets > 0
        ? `assets ${summary.importedAssets}`
        : null,
    ].filter(Boolean);

    return parts.join(" · ");
  };

  const clearImportInputs = () => {
    if (directoryImportInputRef.current) {
      directoryImportInputRef.current.value = "";
    }
    if (zipImportInputRef.current) {
      zipImportInputRef.current.value = "";
    }
  };

  const handleDirectoryImportSelection = async (fileList: FileList | null) => {
    if (!fileList?.length || !storage.importObsidianDirectory) return;

    setNoteImportBusy("directory");
    setNoteImportNotice(null);

    try {
      const files = Array.from(fileList);
      const entries = await Promise.all(
        files.map(async (file) => {
          const relativePath = file.webkitRelativePath || file.name;
          return {
            path: relativePath,
            mime_type: file.type || "application/octet-stream",
            last_modified: file.lastModified,
            data: await file.arrayBuffer(),
          } satisfies ObsidianImportFileEntry;
        }),
      );
      const inferredVaultName =
        files[0]?.webkitRelativePath?.split("/").filter(Boolean)[0] ??
        "Obsidian Vault";
      const summary = await storage.importObsidianDirectory(
        inferredVaultName,
        entries,
      );
      const nextNotes = await refreshNotes();
      const firstImportedNote = nextNotes.find(
        (note) => note.import_meta?.vault_id === summary.vaultId,
      );

      setExpandedVaultIds((current) => ({
        ...current,
        [summary.vaultId]: true,
      }));
      setNoteImportNotice({
        tone: "success",
        message: formatImportNotice(summary),
        summary,
      });
      setViewMode("notes");
      if (firstImportedNote) {
        await openNotesView(firstImportedNote.id);
      }
    } catch (error) {
      setNoteImportNotice({
        tone: "error",
        message:
          (error as Error)?.message ?? "Couldn't import this Obsidian vault.",
      });
    } finally {
      setNoteImportBusy(null);
      clearImportInputs();
    }
  };

  const handleZipImportSelection = async (file: File | null) => {
    if (!file || !storage.importObsidianZip) return;

    setNoteImportBusy("zip");
    setNoteImportNotice(null);

    try {
      const summary = await storage.importObsidianZip(
        file.name,
        await file.arrayBuffer(),
      );
      const nextNotes = await refreshNotes();
      const firstImportedNote = nextNotes.find(
        (note) => note.import_meta?.vault_id === summary.vaultId,
      );

      setExpandedVaultIds((current) => ({
        ...current,
        [summary.vaultId]: true,
      }));
      setNoteImportNotice({
        tone: "success",
        message: formatImportNotice(summary),
        summary,
      });
      setViewMode("notes");
      if (firstImportedNote) {
        await openNotesView(firstImportedNote.id);
      }
    } catch (error) {
      setNoteImportNotice({
        tone: "error",
        message:
          (error as Error)?.message ?? "Couldn't import this Obsidian zip.",
      });
    } finally {
      setNoteImportBusy(null);
      clearImportInputs();
    }
  };

  const toggleVaultExpansion = (vaultId: string) => {
    setExpandedVaultIds((current) => ({
      ...current,
      [vaultId]: !(current[vaultId] ?? true),
    }));
  };

  const toggleFolderExpansion = (folderKey: string) => {
    setExpandedFolderPaths((current) => ({
      ...current,
      [folderKey]: !(current[folderKey] ?? true),
    }));
  };

  const loadNoteAssetUrl = async (
    assetId: string,
  ): Promise<{ asset: NoteAssetRecord; url: string } | null> => {
    if (!storage.getNoteAsset) {
      window.alert("Asset preview is not available yet.");
      return null;
    }

    const asset = await storage.getNoteAsset(assetId);
    if (!asset) {
      window.alert("This attachment is no longer available.");
      return null;
    }

    return {
      asset,
      url: URL.createObjectURL(asset.blob),
    };
  };

  const handlePreviewImportedAsset = async (
    assetPath: string,
    assetId: string | null,
  ) => {
    if (!assetId) {
      window.alert("This attachment hasn't been imported yet.");
      return;
    }

    const resolved = await loadNoteAssetUrl(assetId);
    if (!resolved) return;

    setPreviewAsset(resolved.url, resolved.asset.mime_type, assetPath);
  };

  const handleOpenImportedAsset = async (
    assetPath: string,
    assetId: string | null,
  ) => {
    if (!assetId) {
      window.alert("This attachment hasn't been imported yet.");
      return;
    }

    const resolved = await loadNoteAssetUrl(assetId);
    if (!resolved) return;

    const opened = window.open(resolved.url, "_blank", "noopener,noreferrer");
    if (!opened) {
      setPreviewAsset(resolved.url, resolved.asset.mime_type, assetPath);
      return;
    }

    window.setTimeout(() => {
      URL.revokeObjectURL(resolved.url);
    }, 60_000);
  };

  const renderNoteListRow = (note: Note, depth = 0) => {
    const isSelected = note.id === selectedNoteId;
    const hasLinkedConversations = note.linked_conversation_ids.length > 0;
    const isExporting = obsidianActionBusy === note.id;
    const noteSourceLabel =
      note.source_type === "obsidian"
        ? note.import_meta?.relative_path ?? note.source_path ?? "Imported"
        : note.obsidian_export?.relative_path
          ? note.obsidian_export.relative_path
          : "Local note";

    return (
      <div
        key={note.id}
        className={`w-full text-left rounded-lg p-3 transition-all duration-200 relative group ${
          isSelected
            ? "bg-bg-surface-card-active shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            : "bg-bg-surface-card hover:bg-bg-surface-card-hover hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
        }`}
        style={{ marginLeft: depth > 0 ? `${depth * 14}px` : undefined }}
      >
        <span className="absolute right-3 top-3 text-[11px] font-sans text-text-tertiary">
          {formatTimeAgo(note.updated_at)}
        </span>
        <button
          type="button"
          onClick={() => void selectNote(note.id)}
          className="w-full text-left"
        >
          <h3 className="mb-1.5 pr-16 text-sm font-sans font-medium leading-snug text-text-primary">
            {note.title}
          </h3>
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-150 ease-in-out ${
              isSelected
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0 group-hover:opacity-100 group-hover:grid-rows-[1fr]"
            }`}
          >
            <div className="overflow-hidden pb-7">
              <p className="mb-2 line-clamp-2 text-[13px] font-sans leading-relaxed text-text-secondary">
                {note.excerpt || "No excerpt yet."}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[11px] font-sans text-text-secondary">
                  {note.source_type === "obsidian" ? "Obsidian" : "Local"}
                </span>
                {hasLinkedConversations ? (
                  <span
                    title={`Linked to ${note.linked_conversation_ids.length} conversation${
                      note.linked_conversation_ids.length > 1 ? "s" : ""
                    }`}
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "#3266AD",
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                {note.import_meta?.conflict ? (
                  <span className="rounded-full bg-[#FEF3F2] px-2 py-0.5 text-[11px] font-sans text-[#B42318]">
                    {labels.conflict ?? "Conflict"}
                  </span>
                ) : null}
                {note.obsidian_export ? (
                  <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[11px] font-sans text-text-secondary">
                    Obsidian
                  </span>
                ) : null}
                <span className="truncate text-[11px] font-sans text-text-tertiary">
                  {noteSourceLabel}
                </span>
              </div>
            </div>
          </div>
        </button>
        <div
          className={`absolute right-2 bottom-2 flex items-center gap-1 transition-opacity ${
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              void selectNote(note.id);
              openNoteRenameDialog(note);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-surface-card hover:text-text-primary"
            aria-label={`Rename note ${note.title}`}
          >
            <Pencil strokeWidth={1.5} className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              void handleNoteDelete(note);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-surface-card hover:text-[#B42318]"
            aria-label={`Delete note ${note.title}`}
          >
            <Trash2 strokeWidth={1.5} className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderImportedFolderNode = (
    vaultId: string,
    folder: ImportedVaultFolderNode,
    depth = 1,
  ): ReactNode => {
    const folderKey = `${vaultId}:${folder.path}`;
    const isExpanded = expandedFolderPaths[folderKey] ?? true;

    return (
      <div key={folderKey} className="space-y-1.5">
        <button
          type="button"
          onClick={() => toggleFolderExpansion(folderKey)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-bg-surface-card"
          style={{ paddingLeft: `${depth * 14 + 12}px` }}
        >
          <ChevronDown
            strokeWidth={1.5}
            className={`h-4 w-4 text-text-tertiary transition-transform ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
          <span className="flex-1 truncate text-[13px] font-sans text-text-primary">
            {folder.name}
          </span>
          <span className="text-[11px] font-sans text-text-tertiary">
            {folder.noteCount}
          </span>
        </button>
        {isExpanded ? (
          <div className="space-y-1.5">
            {folder.folders.map((childFolder) =>
              renderImportedFolderNode(vaultId, childFolder, depth + 1),
            )}
            {folder.notes.map((note) => renderNoteListRow(note, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  // Derive a BCP-47 date locale from the localized labels already threaded
  // into this tab (no separate locale prop/global is plumbed through here).
  const dateLocale = /[一-鿿]/.test(String(labels.justNow ?? ""))
    ? "zh-CN"
    : "en-US";

  function formatDate(timestamp?: number): string {
    if (!timestamp) return labels.dateUnknown ?? "Unknown date";
    return new Intl.DateTimeFormat(dateLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(timestamp));
  }

  function formatAnnotationTimestamp(annotation: Annotation): string {
    const createdAt = annotation.created_at;
    if (!createdAt) return labels.unknownTime ?? "Added at an unknown time";
    const dateLabel = new Intl.DateTimeFormat(dateLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(createdAt));
    const dayLabel =
      annotation.days_after === 1
        ? (labels.dayAfter ?? "day")
        : (labels.daysAfter ?? "days");
    return `${labels.addedOn ?? "Added on"} ${dateLabel} · ${annotation.days_after} ${dayLabel} ${labels.afterTheConversation ?? "after the conversation"}`;
  }

  function getAnnotationsForMessage(messageId: number): Annotation[] {
    return annotationsByMessage.get(messageId) ?? [];
  }

  function getLatestAnnotationForMessage(
    messageId: number,
  ): Annotation | undefined {
    const items = getAnnotationsForMessage(messageId);
    return items[items.length - 1];
  }

  function setAnnotationTriggerRef(
    messageId: number,
    node: HTMLButtonElement | null,
  ) {
    if (node) {
      annotationTriggerRefs.current.set(messageId, node);
      return;
    }
    annotationTriggerRefs.current.delete(messageId);
  }

  function setMessageContentRef(
    messageId: number,
    node: HTMLDivElement | null,
  ) {
    if (node) {
      messageContentRefs.current.set(messageId, node);
      return;
    }
    messageContentRefs.current.delete(messageId);
  }

  function isAnnotationTriggerTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      Boolean(target.closest("[data-annotation-trigger='true']"))
    );
  }

  function openAnnotationPanel(message: Message) {
    setAnnotationDrafts((prev) => {
      if (prev[message.id] !== undefined) return prev;
      return {
        ...prev,
        [message.id]: "",
      };
    });
    setActiveAnnotationMessageId(message.id);
    setAnnotationPendingDeleteId(null);
    setAnnotationNotice(null);
  }

  function closeAnnotationPanel() {
    setActiveAnnotationMessageId(null);
    setAnnotationPendingDeleteId(null);
    setAnnotationNotice(null);
  }

  function updateAnnotationDraft(messageId: number, value: string) {
    setAnnotationDrafts((prev) => ({
      ...prev,
      [messageId]: value,
    }));
    setAnnotationNotice(null);
    setAnnotationPendingDeleteId(null);
  }

  function getAnnotationTriggerLabel(annotation?: Annotation): string {
    return annotation ? "Open annotation" : "Add annotation";
  }

  function getAnnotationCountLabel(count: number): string {
    return count === 1 ? "1 annotation" : `${count} annotations`;
  }

  function getAnnotationPreview(message: Message): string {
    return buildMessagePreviewText(message, { maxChars: 180 });
  }

  const persistAnnotationDraft = async (
    message: Message,
    options?: {
      closeOnComplete?: boolean;
      silentIfEmpty?: boolean;
    },
  ): Promise<"saved" | "empty" | "error"> => {
    if (!selectedConversationId || !saveAnnotation) {
      setAnnotationNotice({
        tone: "error",
        message: "Comments are unavailable in this build.",
      });
      return "error";
    }

    const draft = (annotationDrafts[message.id] || "").trim();
    if (!draft) {
      if (!options?.silentIfEmpty) {
        setAnnotationNotice(null);
      }
      return "empty";
    }

    setAnnotationSaving((prev) => ({ ...prev, [message.id]: true }));
    setAnnotationNotice(null);
    try {
      const annotation = await saveAnnotation({
        conversationId: selectedConversationId,
        messageId: message.id,
        contentText: draft,
      });
      setAnnotations((prev) => {
        return [...prev, annotation].sort(
          (a, b) => a.created_at - b.created_at,
        );
      });
      setAnnotationDrafts((prev) => ({
        ...prev,
        [message.id]: "",
      }));
      setAnnotationPendingDeleteId(null);
      setAnnotationNotice(null);
      if (options?.closeOnComplete) {
        closeAnnotationPanel();
      }
      return "saved";
    } catch (error) {
      setAnnotationNotice({
        tone: "error",
        message: "Couldn't save this comment.",
      });
      return "error";
    } finally {
      setAnnotationSaving((prev) => ({ ...prev, [message.id]: false }));
    }
  };

  const dismissAnnotationSurface = async () => {
    if (annotationDismissInFlightRef.current) return;
    if (!activeAnnotationMessage) {
      closeAnnotationPanel();
      return;
    }

    annotationDismissInFlightRef.current = true;
    try {
      const result = await persistAnnotationDraft(activeAnnotationMessage, {
        closeOnComplete: false,
        silentIfEmpty: true,
      });
      if (result !== "error") {
        closeAnnotationPanel();
      }
    } finally {
      annotationDismissInFlightRef.current = false;
    }
  };

  const handleAnnotationTriggerClick = async (message: Message) => {
    if (activeAnnotationMessageId === message.id) {
      await dismissAnnotationSurface();
      return;
    }

    if (activeAnnotationMessage) {
      const result = await persistAnnotationDraft(activeAnnotationMessage, {
        closeOnComplete: false,
        silentIfEmpty: true,
      });
      if (result === "error") return;
    }

    openAnnotationPanel(message);
  };

  const handleSaveAnnotation = async (message: Message) => {
    await persistAnnotationDraft(message, {
      closeOnComplete: false,
      silentIfEmpty: true,
    });
  };

  const handleDeleteAnnotation = async (annotation: Annotation) => {
    if (!deleteAnnotation) {
      setAnnotationNotice({
        tone: "error",
        message: "Comments are unavailable in this build.",
      });
      return;
    }
    const busyKey = `delete:${annotation.id}`;
    setAnnotationActionBusy((prev) => ({ ...prev, [busyKey]: true }));
    setAnnotationNotice(null);
    try {
      await deleteAnnotation(annotation.id);
      setAnnotations((prev) =>
        prev.filter((item) => item.id !== annotation.id),
      );
      setAnnotationPendingDeleteId(null);
      setAnnotationNotice(null);
    } catch (error) {
      setAnnotationNotice({
        tone: "error",
        message: "Couldn't delete this comment.",
      });
    } finally {
      setAnnotationActionBusy((prev) => ({ ...prev, [busyKey]: false }));
    }
  };

  const handleExportAnnotationToNote = async (annotation: Annotation) => {
    if (!exportAnnotationToNote) {
      setAnnotationNotice({
        tone: "error",
        message: "My Notes export is not available in this build.",
      });
      return;
    }

    const busyKey = `note:${annotation.id}`;
    setAnnotationActionBusy((prev) => ({ ...prev, [busyKey]: true }));
    setAnnotationNotice(null);
    try {
      const note = await exportAnnotationToNote(annotation.id);
      setNotes((prev) => [note, ...prev.filter((item) => item.id !== note.id)]);
      setHasLinkedNote(true);
      setAnnotationNotice({
        tone: "success",
        message: "Saved to My Notes.",
        annotationId: annotation.id,
      });
    } catch (error) {
      setAnnotationNotice({
        tone: "error",
        message: "Couldn't export this comment to My Notes.",
      });
    } finally {
      setAnnotationActionBusy((prev) => ({ ...prev, [busyKey]: false }));
    }
  };

  const handleExportAnnotationToNotion = async (annotation: Annotation) => {
    if (!exportAnnotationToNotion) {
      setAnnotationNotice({
        tone: "error",
        message: "Notion export is not available in this build.",
      });
      return;
    }

    const busyKey = `notion:${annotation.id}`;
    setAnnotationActionBusy((prev) => ({ ...prev, [busyKey]: true }));
    setAnnotationNotice(null);
    try {
      await exportAnnotationToNotion(annotation.id);
      setAnnotationNotice({
        tone: "success",
        message: "Sent to Notion.",
        annotationId: annotation.id,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message === "NOTION_SETTINGS_MISSING"
          ? "Connect to Notion and choose a database in Settings before exporting."
          : error instanceof Error &&
              error.message === "NOTION_RECONNECT_REQUIRED"
            ? "Your Notion session expired. Reconnect in Settings and try again."
            : "Couldn't export this comment to Notion.";
      setAnnotationNotice({
        tone: "error",
        message,
      });
    } finally {
      setAnnotationActionBusy((prev) => ({ ...prev, [busyKey]: false }));
    }
  };

  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return labels.justNow ?? "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return (labels.minutesAgo ?? "{count}m ago").replace("{count}", String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return (labels.hoursAgo ?? "{count}h ago").replace("{count}", String(hours));
    const days = Math.floor(hours / 24);
    if (days < 30) return (labels.daysAgo ?? "{count}d ago").replace("{count}", String(days));
    const months = Math.floor(days / 30);
    if (months < 12) return (labels.monthsAgo ?? "{count}mo ago").replace("{count}", String(months));
    return (labels.yearsAgo ?? "{count}y ago").replace("{count}", String(Math.floor(months / 12)));
  }

  function handleAnnotationComposerBlur(
    event: FocusEvent<HTMLTextAreaElement>,
  ) {
    const nextTarget = event.relatedTarget;
    if (
      (nextTarget && annotationSurfaceRef.current?.contains(nextTarget)) ||
      isAnnotationTriggerTarget(nextTarget)
    ) {
      return;
    }

    void dismissAnnotationSurface();
  }

  function handleAnnotationComposerKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    if (!activeAnnotationMessage) return;
    void handleSaveAnnotation(activeAnnotationMessage);
  }

  useEffect(() => {
    if (!isAnnotationPanelOpen || isAnnotationDrawerOverlay) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        (target instanceof Node &&
          annotationSurfaceRef.current?.contains(target)) ||
        isAnnotationTriggerTarget(target)
      ) {
        return;
      }
      void dismissAnnotationSurface();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void dismissAnnotationSurface();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isAnnotationPanelOpen,
    isAnnotationDrawerOverlay,
    activeAnnotationMessage,
  ]);

  useEffect(() => {
    if (annotationNotice?.tone !== "success") return;
    const timer = window.setTimeout(() => {
      setAnnotationNotice((current) =>
        current?.tone === "success" ? null : current,
      );
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [annotationNotice]);

  const renderAnnotationPanelContent = () => {
    if (!activeAnnotationMessage || !selectedConversation) return null;

    return (
      <>
        <div className="border-b border-border-subtle px-4 py-4">
          <div className="text-[11px] font-sans uppercase tracking-[0.16em] text-text-tertiary">
            {activeAnnotationMessage.role === "user"
              ? (labels.you ?? "You")
              : selectedConversation.platform}
          </div>
          <p className="mt-1 text-[13px] font-sans leading-relaxed text-text-secondary">
            {getAnnotationPreview(activeAnnotationMessage)}
          </p>
        </div>

        {annotationNotice?.tone === "error" && (
          <div className="border-b border-border-subtle px-4 py-3">
            <div className="rounded-xl bg-[#FEF2F2] px-3 py-2 text-[12px] font-sans text-[#B42318]">
              {annotationNotice.message}
            </div>
          </div>
        )}

        {activeMessageAnnotations.length > 0 ? (
          <div className="divide-y divide-border-subtle px-4">
            {activeMessageAnnotations.map((annotation) => {
              const isDeleteBusy =
                annotationActionBusy[`delete:${annotation.id}`];
              const isNoteBusy = annotationActionBusy[`note:${annotation.id}`];
              const isNotionBusy =
                annotationActionBusy[`notion:${annotation.id}`];
              const inlineSuccessNotice =
                annotationNotice?.tone === "success" &&
                annotationNotice.annotationId === annotation.id
                  ? annotationNotice.message
                  : null;
              const showActions =
                areAnnotationRowActionsAlwaysVisible ||
                annotationPendingDeleteId === annotation.id ||
                Boolean(isDeleteBusy) ||
                Boolean(isNoteBusy) ||
                Boolean(isNotionBusy) ||
                Boolean(inlineSuccessNotice);

              return (
                <article
                  key={annotation.id}
                  className="group/annotation py-3 first:pt-4 last:pb-4"
                >
                  <div className="text-[11px] font-sans text-text-tertiary">
                    {formatAnnotationTimestamp(annotation)}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] font-sans leading-relaxed text-text-primary">
                    {annotation.content_text}
                  </p>

                  {annotationPendingDeleteId === annotation.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-sans text-[#B42318]">
                      <span>Delete this comment?</span>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAnnotation(annotation)}
                        disabled={Boolean(isDeleteBusy)}
                        className="rounded-md px-2 py-1 font-medium text-[#922018] hover:bg-[#FEF2F2] disabled:opacity-50"
                      >
                        {isDeleteBusy ? (labels.deleting ?? "Deleting...") : (labels.delete ?? "Delete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnnotationPendingDeleteId(null)}
                        className="rounded-md px-2 py-1 text-text-secondary hover:bg-bg-surface-card hover:text-text-primary"
                      >
                        {labels.cancel ?? "Cancel"}
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`mt-3 flex flex-wrap items-center gap-3 text-[12px] font-sans transition-opacity ${
                        showActions
                          ? "opacity-100"
                          : "opacity-0 group-hover/annotation:opacity-100 group-focus-within/annotation:opacity-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          void handleExportAnnotationToNote(annotation)
                        }
                        disabled={Boolean(isNoteBusy)}
                        className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary disabled:opacity-50"
                      >
                        <BookOpen strokeWidth={1.6} className="h-3.5 w-3.5" />
                        {isNoteBusy ? (labels.exporting ?? "Exporting...") : (labels.myNotes ?? "My Notes")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleExportAnnotationToNotion(annotation)
                        }
                        disabled={
                          Boolean(isNotionBusy) || !hasNotionExportConfig
                        }
                        className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary disabled:opacity-50"
                        title={
                          hasNotionExportConfig
                            ? (labels.notion ?? "Notion")
                            : (labels.notionSettingsMissing ?? "Connect to Notion and choose a database in Settings to enable export")
                        }
                      >
                        <ArrowRight strokeWidth={1.6} className="h-3.5 w-3.5" />
                        {isNotionBusy ? (labels.exporting ?? "Exporting...") : (labels.notion ?? "Notion")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setAnnotationPendingDeleteId(annotation.id)
                        }
                        className="inline-flex items-center gap-1 text-[#B42318] hover:text-[#922018]"
                      >
                        <Trash2 strokeWidth={1.6} className="h-3.5 w-3.5" />
                        {labels.delete ?? "Delete"}
                      </button>
                      {inlineSuccessNotice ? (
                        <span className="text-text-tertiary">
                          {inlineSuccessNotice}
                        </span>
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}

        <div className="border-t border-border-subtle px-4 py-3">
          <textarea
            ref={annotationTextareaRef}
            value={activeAnnotationDraft}
            onChange={(event) =>
              updateAnnotationDraft(
                activeAnnotationMessage.id,
                event.target.value,
              )
            }
            onBlur={handleAnnotationComposerBlur}
            onKeyDown={handleAnnotationComposerKeyDown}
            rows={1}
            placeholder={labels.commentPlaceholder ?? "Comment..."}
            className="min-h-[38px] w-full resize-none border-0 bg-transparent px-0 py-0 text-[13px] font-sans leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-0"
          />
        </div>
      </>
    );
  };

  function findTopicById(nodes: Topic[], id: number): Topic | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children && node.children.length > 0) {
        const match = findTopicById(node.children, id);
        if (match) return match;
      }
    }
    return null;
  }

  const switchToConversation = (conversationId: number) => {
    void selectConversation(conversationId, {
      resetFilters: true,
      closeNavigation: isSplitActive,
    });
  };

  const isAllActive =
    viewMode === "conversations" && !selectedTag && listFilter === "all";
  const isStarredActive =
    viewMode === "conversations" && listFilter === "starred";
  const isRecentActive =
    viewMode === "conversations" && listFilter === "recent";
  const splitContextValue: LibrarySplitContextValue = {
    isSplitActive,
    isSplitNavigationOpen,
    noteSaveStatus,
    pendingExcerpts,
    openSplitNavigation: () => setIsSplitNavigationOpen(true),
    closeSplitNavigation: () => setIsSplitNavigationOpen(false),
    toggleSplitNavigation: () =>
      setIsSplitNavigationOpen((current) => !current),
    consumePendingExcerpt,
    exitSplit: exitSplitView,
  };

  return (
    <div className="flex h-full flex-col">
      {returnToSourceLabel && onReturnToSource ? (
        <div className="border-b border-border-subtle bg-bg-primary px-4 py-2.5">
          <button
            type="button"
            onClick={onReturnToSource}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-primary px-3 py-1.5 text-xs font-sans text-text-secondary transition-colors hover:bg-bg-surface-card hover:text-text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.7} />
            {returnToSourceLabel}
          </button>
        </div>
      ) : null}
      <LibrarySplitContext.Provider value={splitContextValue}>
        <div
          ref={libraryWorkspaceRef}
          className="relative flex min-h-0 flex-1 overflow-hidden"
        >
          <SplitNavigationToggle labels={labels} />
          {isSplitActive && isSplitNavigationOpen ? (
            <button
              type="button"
              className="absolute inset-0 z-20 bg-black/10 backdrop-blur-[1px]"
              onClick={() => setIsSplitNavigationOpen(false)}
              aria-label="Close library navigation"
            />
          ) : null}
          <div
            className={`${
              isSplitActive
                ? "absolute inset-y-0 left-0 z-30 flex overflow-hidden transition-[transform,opacity] duration-300 ease-out"
                : "flex shrink-0"
            } ${
              isSplitActive
                ? isSplitNavigationOpen
                  ? "translate-x-0 opacity-100"
                  : "-translate-x-[calc(100%+16px)] opacity-0 pointer-events-none"
                : ""
            }`}
            style={{
              width: `${navigationGroupWidth}px`,
              maxWidth: isSplitActive ? "calc(100% - 32px)" : undefined,
            }}
          >
            {/* Left Column - Sidebar (200px) */}
            <aside
              className="flex shrink-0 flex-col bg-bg-secondary"
              style={{ width: `${sidebarPane.width}px` }}
            >
              <div className="px-2 pt-3 pb-2">
                <button
                  onClick={() => {
                    void flushPendingNoteSave();
                    setViewMode("conversations");
                    setListFilter("all");
                    setSelectedTag(null);
                    setSelectedConversationId(null);
                    setIsSplitNavigationOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
                    isAllActive
                      ? "bg-accent-primary-light"
                      : "hover:bg-bg-surface-card"
                  }`}
                >
                  <List
                    strokeWidth={1.5}
                    className={`w-4 h-4 ${isAllActive ? "text-accent-primary" : "text-text-secondary"}`}
                  />
                  <span
                    className={`flex-1 text-sm font-sans ${
                      isAllActive ? "text-accent-primary" : "text-text-primary"
                    }`}
                  >
                    {labels.allConversations ?? "All Conversations"}
                  </span>
                  <span className="text-xs font-sans text-text-tertiary">
                    {conversations.length}
                  </span>
                </button>
                <button
                  onClick={() => {
                    void flushPendingNoteSave();
                    setViewMode("conversations");
                    setListFilter("starred");
                    setSelectedTag(null);
                    setSelectedConversationId(null);
                    setIsSplitNavigationOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
                    isStarredActive
                      ? "bg-accent-primary-light"
                      : "hover:bg-bg-surface-card"
                  }`}
                >
                  <Star
                    strokeWidth={1.5}
                    className={`w-4 h-4 ${isStarredActive ? "text-accent-primary" : "text-text-secondary"}`}
                  />
                  <span
                    className={`flex-1 text-sm font-sans ${
                      isStarredActive
                        ? "text-accent-primary"
                        : "text-text-primary"
                    }`}
                  >
                    {labels.starred ?? "Starred"}
                  </span>
                  <span className="text-xs font-sans text-text-tertiary">
                    {starredCount}
                  </span>
                </button>
                <button
                  onClick={() => {
                    void flushPendingNoteSave();
                    setViewMode("conversations");
                    setListFilter("recent");
                    setSelectedTag(null);
                    setSelectedConversationId(null);
                    setIsSplitNavigationOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
                    isRecentActive
                      ? "bg-accent-primary-light"
                      : "hover:bg-bg-surface-card"
                  }`}
                >
                  <Clock
                    strokeWidth={1.5}
                    className={`w-4 h-4 ${isRecentActive ? "text-accent-primary" : "text-text-secondary"}`}
                  />
                  <span
                    className={`flex-1 text-sm font-sans ${
                      isRecentActive
                        ? "text-accent-primary"
                        : "text-text-primary"
                    }`}
                  >
                    {labels.recent ?? "Recent"}
                  </span>
                  <span className="text-xs font-sans text-text-tertiary">
                    {recentConversations.length}
                  </span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-2">
                <div className="flex items-center justify-between px-2 py-2">
                  <span className="text-[10px] font-sans font-semibold text-text-tertiary uppercase tracking-wider">
                    {labels.folders ?? "FOLDERS"}
                  </span>
                  <button
                    onClick={handleCreateFolder}
                    className="w-5 h-5 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-card transition-colors"
                    aria-label={labels.createNewFolder ?? "Create new folder"}
                    title={labels.newFolder ?? "New folder"}
                  >
                    +
                  </button>
                </div>
                {folderItems.length > 0 && (
                  <div className="flex flex-col">
                    {folderItems.map((folder) => {
                      const isSelected = selectedTag === folder.name;
                      return (
                        <div
                          key={folder.name}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            void flushPendingNoteSave();
                            setViewMode("conversations");
                            setListFilter("all");
                            setSelectedTag(folder.name);
                            setSelectedConversationId(null);
                            setIsSplitNavigationOpen(false);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void flushPendingNoteSave();
                              setViewMode("conversations");
                              setListFilter("all");
                              setSelectedTag(folder.name);
                              setSelectedConversationId(null);
                              setIsSplitNavigationOpen(false);
                            }
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-200 my-1 rounded-lg group cursor-pointer relative ${
                            isSelected && viewMode === "conversations"
                              ? "bg-bg-surface-card-active"
                              : "hover:bg-bg-surface-card"
                          }`}
                        >
                          <span className="flex-1 text-sm font-sans text-text-primary truncate">
                            {folder.name}
                          </span>
                          <div className="ml-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenFolderMenuName((prev) =>
                                  prev === folder.name ? null : folder.name,
                                );
                              }}
                              className="w-5 h-5 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-card"
                              title={labels.folderActions ?? "Folder actions"}
                              aria-label={`Folder actions for ${folder.name}`}
                            >
                              <MoreHorizontal
                                strokeWidth={1.5}
                                className="w-3.5 h-3.5"
                              />
                            </button>
                          </div>
                          {openFolderMenuName === folder.name && (
                            <div
                              className="absolute right-2 top-9 z-30 w-44 rounded-md border border-border-subtle bg-bg-primary shadow-[0_8px_24px_rgba(0,0,0,0.08)] py-1"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  void handleRenameFolder(folder);
                                  setOpenFolderMenuName(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                              >
                                <Pencil strokeWidth={1.5} className="w-4 h-4" />
                                <span>{labels.rename ?? "Rename"}</span>
                              </button>
                              <div className="my-1 h-px bg-border-subtle" />
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDeleteFolder(folder);
                                  setOpenFolderMenuName(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-[#B42318] hover:bg-bg-surface-card transition-colors"
                              >
                                <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                                <span>{labels.delete ?? "Delete"}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-border-subtle px-2 py-2">
                <button
                  onClick={() => void openNotesView()}
                  className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
                    viewMode === "notes"
                      ? "bg-bg-surface-card-active"
                      : "hover:bg-bg-surface-card"
                  }`}
                >
                  <BookOpen
                    strokeWidth={1.5}
                    className="w-4 h-4 text-text-secondary"
                  />
                  <span className="flex-1 text-sm font-sans text-text-primary">
                    {labels.myNotes ?? "My Notes"}
                  </span>
                  <span className="text-xs font-sans text-text-tertiary">
                    {notes.length}
                  </span>
                </button>
              </div>
            </aside>

            <ResizablePanelDivider
              ariaLabel="Resize library sidebar"
              onPointerDown={sidebarPane.handlePointerDown}
              onNudge={sidebarPane.nudgeWidth}
              isDragging={sidebarPane.isDragging}
            />

            {/* Middle Column - Conversation/Note List (320px) */}
            <div
              className="flex shrink-0 flex-col bg-bg-tertiary"
              style={{ width: `${listPane.width}px` }}
            >
              {viewMode === "conversations" ? (
                <>
                  <div className="px-4 py-3">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-serif font-normal text-text-primary">
                          {selectedTag
                            ? selectedTag
                            : listFilter === "starred"
                              ? (labels.starred ?? "Starred")
                              : listFilter === "recent"
                                ? (labels.recent ?? "Recent")
                                : (labels.allConversations ?? "All Conversations")}
                        </h2>
                        <span className="text-xs font-sans text-text-tertiary">
                          · {filteredConversations.length} {labels.conversationCount ?? "conversations"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 mt-2">
                    {filteredConversations.map((conv) => {
                      const isSelected = conv.id === selectedConversationId;
                      return (
                        <div
                          key={conv.id}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            void selectConversation(conv.id, {
                              closeNavigation: isSplitActive,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void selectConversation(conv.id, {
                                closeNavigation: isSplitActive,
                              });
                            }
                          }}
                          className={`w-full text-left p-3 rounded-lg transition-all duration-200 relative group cursor-pointer ${
                            isSelected
                              ? "bg-bg-surface-card-active shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                              : "bg-bg-surface-card hover:bg-bg-surface-card-hover hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void selectConversation(conv.id, {
                                closeNavigation: isSplitActive,
                              });
                              setOpenConversationMenuId((prev) =>
                                prev === conv.id ? null : conv.id,
                              );
                            }}
                            className="absolute right-2 top-2 w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-card transition-colors opacity-0 group-hover:opacity-100"
                            aria-label={labels.conversationActions ?? "Conversation actions"}
                          >
                            <MoreHorizontal
                              strokeWidth={1.5}
                              className="w-4 h-4"
                            />
                          </button>
                          {openConversationMenuId === conv.id && (
                            <div
                              className="absolute right-2 top-10 z-30 w-52 rounded-md border border-border-subtle bg-bg-primary shadow-[0_8px_24px_rgba(0,0,0,0.08)] py-1"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  void handleConversationStar(conv);
                                  setOpenConversationMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                              >
                                <Star strokeWidth={1.5} className="w-4 h-4" />
                                <span>
                                  {conv.is_starred ? (labels.unstar ?? "Unstar") : (labels.star ?? "Star")}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleConversationRename(conv);
                                  setOpenConversationMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                              >
                                <Pencil strokeWidth={1.5} className="w-4 h-4" />
                                <span>{labels.rename ?? "Rename"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleConversationChangeFolder(conv);
                                  setOpenConversationMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                              >
                                <ArrowRight
                                  strokeWidth={1.5}
                                  className="w-4 h-4"
                                />
                                <span>{labels.changeFolder ?? "Change folder"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleConversationRemoveFromFolder(conv);
                                  setOpenConversationMenuId(null);
                                }}
                                disabled={!selectedTag}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans transition-colors ${
                                  selectedTag
                                    ? "text-text-primary hover:bg-bg-surface-card"
                                    : "text-text-tertiary cursor-not-allowed"
                                }`}
                              >
                                <X strokeWidth={1.5} className="w-4 h-4" />
                                <span>{labels.removeFromFolder ?? "Remove from folder"}</span>
                              </button>
                              <div className="my-1 h-px bg-border-subtle" />
                              <button
                                type="button"
                                onClick={() => {
                                  void handleConversationDelete(conv);
                                  setOpenConversationMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-[#B42318] hover:bg-bg-surface-card transition-colors"
                              >
                                <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                                <span>{labels.delete ?? "Delete"}</span>
                              </button>
                            </div>
                          )}
                          <h3 className="text-sm font-sans font-medium text-text-primary mb-1.5 leading-snug line-clamp-1">
                            {conv.title}
                          </h3>
                          <div
                            className={`grid transition-[grid-template-rows,opacity] duration-150 ease-in-out ${
                              isSelected
                                ? "grid-rows-[1fr] opacity-100"
                                : "grid-rows-[0fr] opacity-0 group-hover:opacity-100 group-hover:grid-rows-[1fr]"
                            }`}
                          >
                            <div className="overflow-hidden">
                              <p className="text-[13px] font-sans text-text-secondary leading-relaxed mb-2 line-clamp-2">
                                {conv.snippet}
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
                                  style={getPlatformBadgeStyle(
                                    conv.platform,
                                    themeMode,
                                  )}
                                >
                                  {getPlatformLabel(conv.platform)}
                                </span>
                                {normalizeTags(conv.tags)
                                  .slice(0, 2)
                                  .map((tag) => (
                                    <span
                                      key={tag}
                                      className="px-2 py-0.5 rounded-full text-[11px] font-sans text-text-secondary bg-bg-secondary"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                <span className="ml-auto text-[11px] font-sans text-text-tertiary">
                                  {formatTimeAgo(conv.updated_at)}
                                </span>
                                {conv.has_note && (
                                  <span
                                    title="Has notes"
                                    style={{
                                      display: "inline-block",
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      backgroundColor: "#3266AD",
                                      flexShrink: 0,
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-border-subtle">
                    <input
                      ref={directoryImportInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(event) => {
                        void handleDirectoryImportSelection(
                          event.target.files,
                        );
                      }}
                    />
                    <input
                      ref={zipImportInputRef}
                      type="file"
                      className="hidden"
                      accept=".zip,application/zip"
                      onChange={(event) => {
                        void handleZipImportSelection(
                          event.target.files?.[0] ?? null,
                        );
                      }}
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-serif font-normal text-text-primary">
                          {labels.myNotes ?? "My Notes"}
                        </h2>
                        <span className="text-xs font-sans text-text-tertiary">
                          · {notes.length} {labels.notesCount ?? "notes"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                    {notesLoading && notes.length === 0 ? (
                      <div className="text-[13px] font-sans text-text-tertiary">
                        {labels.loadingNotes ?? "Loading notes..."}
                      </div>
                    ) : notes.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border-subtle bg-bg-surface-card px-4 py-6 text-[13px] font-sans text-text-tertiary">
                        <div>
                          {labels.createLocalNoteHint ?? "Create a local note, then export it to an Obsidian folder whenever you are ready."}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
                          {storage.saveNote ? (
                            <button
                              type="button"
                              onClick={() => {
                                void handleCreateLocalNote();
                              }}
                              className="font-medium text-text-primary transition-colors hover:text-accent-primary"
                            >
                              {labels.createNote ?? "Create a note"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="px-1 pt-1">
                          <div className="mb-2 flex items-center justify-between px-2">
                            <span className="text-[11px] font-sans uppercase tracking-[0.16em] text-text-tertiary">
                              {labels.localNotes ?? "Local Notes"}
                            </span>
                            <div className="flex items-center gap-3">
                              {storage.saveNote ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleCreateLocalNote();
                                  }}
                                  className="text-[11px] font-sans uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text-primary"
                                >
                                  {labels.newNote ?? "New Note"}
                                </button>
                              ) : null}
                              <span className="text-[11px] font-sans text-text-tertiary">
                                {localNotes.length}
                              </span>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {localNotes.length > 0 ? (
                              localNotes.map((note) => renderNoteListRow(note))
                            ) : (
                              <div className="rounded-lg bg-bg-surface-card px-3 py-3 text-[13px] font-sans text-text-tertiary">
                                <div>No local notes yet.</div>
                                {storage.saveNote ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleCreateLocalNote();
                                    }}
                                    className="mt-2 text-[12px] font-medium text-text-primary transition-colors hover:text-accent-primary"
                                  >
                                    {labels.createNote ?? "Create a note"}
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>

                        {importedVaults.length > 0 ? (
                          <div className="px-1 pt-4">
                            <div className="mb-2 px-2 text-[11px] font-sans uppercase tracking-[0.16em] text-text-tertiary">
                              {labels.importedVaults ?? "Imported Vaults"}
                            </div>
                            <div className="space-y-2">
                              {importedVaults.map((vault) => {
                                const isExpanded =
                                  expandedVaultIds[vault.id] ?? true;
                                return (
                                  <div
                                    key={vault.id}
                                    className="rounded-xl border border-border-subtle bg-bg-surface-card"
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleVaultExpansion(vault.id)
                                      }
                                      className="flex w-full items-center gap-2 px-3 py-3 text-left"
                                    >
                                      <ChevronDown
                                        strokeWidth={1.5}
                                        className={`h-4 w-4 text-text-tertiary transition-transform ${
                                          isExpanded ? "" : "-rotate-90"
                                        }`}
                                      />
                                      <span className="flex-1 truncate text-[13px] font-sans font-medium text-text-primary">
                                        {vault.name}
                                      </span>
                                      <span className="text-[11px] font-sans text-text-tertiary">
                                        {vault.noteCount}
                                      </span>
                                    </button>
                                    {isExpanded ? (
                                      <div className="space-y-1.5 border-t border-border-subtle px-2 py-2">
                                        {vault.rootNotes.map((note) =>
                                          renderNoteListRow(note, 1),
                                        )}
                                        {vault.folders.map((folder) =>
                                          renderImportedFolderNode(
                                            vault.id,
                                            folder,
                                          ),
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <ResizablePanelDivider
              ariaLabel="Resize library list column"
              onPointerDown={listPane.handlePointerDown}
              onNudge={listPane.nudgeWidth}
              isDragging={listPane.isDragging}
            />
          </div>

          <div className="min-w-0 flex flex-1">
            {/* Right Column - Reader/Editor (flex-1) */}
            {viewMode === "conversations" && selectedConversation && (
              <div
                className={`min-w-0 bg-bg-primary overflow-y-auto ${
                  isSplitActive ? "flex-1" : "flex-1"
                }`}
              >
                <div className="max-w-3xl mx-auto px-8 py-6">
                  {/* Block A - Header */}
                  <div className="mb-6 border-b border-border-subtle pb-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h1 className="mb-3 text-2xl font-serif font-normal leading-tight text-text-primary">
                          {selectedConversation.title}
                        </h1>
                        <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] font-sans text-text-secondary">
                          <span
                            className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
                            style={getPlatformBadgeStyle(
                              selectedConversation.platform,
                              themeMode,
                            )}
                          >
                            {getPlatformLabel(selectedConversation.platform)}
                          </span>
                          <span>·</span>
                          <span>{formatDate(messageDate)}</span>
                          <span>·</span>
                          <span>{messageCount} messages</span>
                          {selectedConversation.url && (
                            <>
                              <span>·</span>
                              <button
                                type="button"
                                onClick={() =>
                                  window.open(
                                    selectedConversation.url,
                                    "_blank",
                                    "noopener,noreferrer",
                                  )
                                }
                                className="inline-flex items-center gap-1 text-accent-primary transition-colors hover:text-accent-primary/80"
                                title={labels.openOriginal ?? "Open original conversation"}
                              >
                                <ExternalLink
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.5}
                                />
                                <span>{labels.open ?? "Open"}</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {isDesktopSplitAvailable && !isSplitActive ? (
                        <button
                          type="button"
                          onClick={() =>
                            void handleSplitViewForCurrentConversation()
                          }
                          aria-label={labels.openSplitView ?? "Open split view"}
                          title={labels.splitView ?? "Split view"}
                          className="group inline-flex h-9 shrink-0 items-center bg-transparent px-1 text-[12px] font-sans text-text-tertiary transition-colors duration-200 hover:text-text-primary"
                        >
                          <Expand
                            strokeWidth={1.7}
                            className="h-4 w-4 shrink-0"
                          />
                          <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] uppercase tracking-[0.18em] opacity-0 transition-[max-width,opacity,margin] duration-200 group-hover:ml-2 group-hover:max-w-[108px] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[108px] group-focus-visible:opacity-100">
                            Split View
                          </span>
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeTags.map((tag) => (
                        <MetaChip key={tag}>{tag}</MetaChip>
                      ))}
                    </div>
                  </div>

                  <DetailSectionEyebrow>
                    {overviewSectionLabel}
                  </DetailSectionEyebrow>
                  <DetailSectionCard className="mb-8">
                    <div className="w-full p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-sans">
                        {hasAnalysis ? (
                          <>
                            <Check
                              strokeWidth={1.5}
                              className="w-4 h-4 text-accent-primary"
                            />
                            <span className="text-text-primary">{labels.analyzed ?? "Analyzed"}</span>
                            {activeTopicName && (
                              <>
                                <span className="text-text-tertiary">·</span>
                                <span className="text-text-tertiary">
                                  {activeTopicName}
                                </span>
                              </>
                            )}
                            {activeTags.length > 0 && (
                              <>
                                <span className="text-text-tertiary">·</span>
                                <span className="text-text-tertiary">
                                  {activeTags.join(", ")}
                                </span>
                              </>
                            )}
                          </>
                        ) : (
                          <span className="text-text-tertiary">
                            {labels.notAnalyzedYet ?? "Not analyzed yet"}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-border-subtle" />

                    {/* Summary 区域 */}
                    <div className="p-4">
                      {summaryLoading ? (
                        <p className="text-[13px] font-sans text-text-tertiary">
                          {labels.loadingSummary ?? "Loading summary..."}
                        </p>
                      ) : summaryData ? (
                        <div>
                          <button
                            type="button"
                            onClick={() => setSummaryExpanded((prev) => !prev)}
                            className="w-full flex items-center justify-between py-1 text-[13px]
                   font-sans text-text-secondary hover:text-text-primary
                   transition-colors duration-150"
                          >
                            <span className="font-medium">
                              {summaryData.meta?.title || (labels.summary ?? "Summary")}
                            </span>
                            <ChevronDown
                              className={`w-4 h-4 transition-transform duration-200 ${
                                summaryExpanded ? "rotate-180" : ""
                              }`}
                              strokeWidth={1.75}
                            />
                          </button>
                          <div
                            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
                              summaryExpanded
                                ? "grid-rows-[1fr] opacity-100 mt-3"
                                : "grid-rows-[0fr] opacity-0"
                            }`}
                          >
                            <div className="overflow-hidden">
                              <StructuredSummaryCard
                                data={summaryData}
                                compact
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          <p className="text-[13px] font-sans text-text-tertiary leading-relaxed">
                            {labels.noSummaryYet ?? "No summary yet. Generate one to see structured insights."}
                          </p>
                          {storage.generateSummary && (
                            <>
                              {summaryGenerating &&
                                pipelineStages.length > 0 && (
                                  <SummaryPipelineProgress
                                    stages={pipelineStages}
                                  />
                                )}
                              <button
                                type="button"
                                disabled={summaryGenerating}
                                onClick={async () => {
                                  if (
                                    !selectedConversationId ||
                                    !storage.generateSummary
                                  )
                                    return;
                                  setSummaryGenerating(true);
                                  setPipelineStages(getInitialStages());
                                  setPipelineStages((prev) =>
                                    prev.map((stage, index) =>
                                      index === 0
                                        ? { ...stage, status: "in_progress" }
                                        : stage,
                                    ),
                                  );

                                  let progressListener:
                                    | ((
                                        message: unknown,
                                        _sender: chrome.runtime.MessageSender,
                                        _sendResponse: (
                                          response?: unknown,
                                        ) => void,
                                      ) => void)
                                    | null = null;

                                  try {
                                    if (
                                      typeof chrome !== "undefined" &&
                                      chrome.runtime?.onMessage
                                    ) {
                                      progressListener = (message) => {
                                        if (
                                          !message ||
                                          typeof message !== "object"
                                        )
                                          return;
                                        const maybeMessage = message as {
                                          type?: unknown;
                                          payload?: {
                                            stage?: unknown;
                                            status?: unknown;
                                          };
                                        };
                                        if (
                                          maybeMessage.type !==
                                          "INSIGHT_PIPELINE_PROGRESS"
                                        )
                                          return;

                                        const stage =
                                          maybeMessage.payload?.stage;
                                        const status =
                                          maybeMessage.payload?.status;
                                        if (
                                          typeof stage !== "string" ||
                                          typeof status !== "string"
                                        ) {
                                          return;
                                        }
                                        if (!isPipelineStageStatus(status)) {
                                          return;
                                        }

                                        setPipelineStages((prev) => {
                                          const currentIdx = prev.findIndex(
                                            (item) => item.stage === stage,
                                          );
                                          if (currentIdx === -1) return prev;

                                          return prev.map((item, idx) => {
                                            if (item.stage === stage) {
                                              return { ...item, status };
                                            }
                                            if (
                                              status === "completed" &&
                                              idx === currentIdx + 1
                                            ) {
                                              return {
                                                ...item,
                                                status: "in_progress",
                                              };
                                            }
                                            return item;
                                          });
                                        });
                                      };
                                      chrome.runtime.onMessage.addListener(
                                        progressListener,
                                      );
                                    } else {
                                      const simulateProgress = async () => {
                                        const stages = getInitialStages().map(
                                          (item) => item.stage,
                                        );
                                        for (
                                          let i = 0;
                                          i < stages.length;
                                          i += 1
                                        ) {
                                          await new Promise((resolve) => {
                                            setTimeout(resolve, 600);
                                          });
                                          setPipelineStages((prev) =>
                                            prev.map((stage, idx) => ({
                                              ...stage,
                                              status:
                                                idx < i
                                                  ? "completed"
                                                  : idx === i
                                                    ? "in_progress"
                                                    : "pending",
                                            })),
                                          );
                                        }
                                      };
                                      void simulateProgress();
                                    }

                                    const data = await storage.generateSummary(
                                      selectedConversationId,
                                    );
                                    setPipelineStages((prev) =>
                                      prev.map((stage) => ({
                                        ...stage,
                                        status: "completed",
                                      })),
                                    );
                                    setSummaryData(data);
                                    setSummaryExpanded(true);
                                  } catch (error) {
                                    console.error(
                                      "[library] generateSummary failed",
                                      error,
                                    );
                                    setPipelineStages((prev) =>
                                      prev.map((stage) =>
                                        stage.status === "in_progress"
                                          ? {
                                              ...stage,
                                              status: "degraded_fallback",
                                            }
                                          : stage,
                                      ),
                                    );
                                  } finally {
                                    if (
                                      progressListener &&
                                      typeof chrome !== "undefined" &&
                                      chrome.runtime?.onMessage
                                    ) {
                                      chrome.runtime.onMessage.removeListener(
                                        progressListener,
                                      );
                                    }
                                    setSummaryGenerating(false);
                                  }
                                }}
                                className="self-start inline-flex items-center gap-1.5 px-3 py-1.5
                             rounded-md text-[13px] font-sans text-text-secondary
                             hover:text-accent-primary hover:bg-accent-primary-light
                             transition-colors duration-150 disabled:opacity-50
                             disabled:cursor-not-allowed"
                              >
                                {labels.generateSummary ?? "Generate Summary"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 操作栏 */}
                    <div className="px-4 pb-3 flex items-center gap-2 border-t border-border-subtle pt-3">
                      {storage.generateSummary && summaryData && (
                        <button
                          type="button"
                          disabled={summaryGenerating}
                          onClick={async () => {
                            if (
                              !selectedConversationId ||
                              !storage.generateSummary
                            )
                              return;
                            setSummaryData(null);
                            setSummaryExpanded(false);
                            setSummaryGenerating(true);
                            setPipelineStages(getInitialStages());
                            setPipelineStages((prev) =>
                              prev.map((stage, index) =>
                                index === 0
                                  ? { ...stage, status: "in_progress" }
                                  : stage,
                              ),
                            );
                            try {
                              const data = await storage.generateSummary(
                                selectedConversationId,
                              );
                              setPipelineStages((prev) =>
                                prev.map((stage) => ({
                                  ...stage,
                                  status: "completed",
                                })),
                              );
                              setSummaryData(data);
                              setSummaryExpanded(true);
                            } catch (error) {
                              console.error(
                                "[library] regenerateSummary failed",
                                error,
                              );
                              setPipelineStages((prev) =>
                                prev.map((stage) =>
                                  stage.status === "in_progress"
                                    ? { ...stage, status: "degraded_fallback" }
                                    : stage,
                                ),
                              );
                            } finally {
                              setSummaryGenerating(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                 text-[13px] font-sans text-text-secondary
                 hover:text-accent-primary hover:bg-accent-primary-light
                 transition-colors duration-150 disabled:opacity-50
                 disabled:cursor-not-allowed"
                        >
                          <RefreshCw
                            className="w-3.5 h-3.5"
                            strokeWidth={1.75}
                          />
                          {labels.regenerate ?? "Regenerate"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleImportConversationToNotes()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-sans
                      text-text-secondary hover:text-accent-primary hover:bg-accent-primary-light
                      transition-colors duration-150"
                      >
                        <BookOpen strokeWidth={1.5} className="w-3.5 h-3.5" />
                        {labels.importToNotes ?? "Import to Notes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const linkedNote = notes.find((n) =>
                            n.linked_conversation_ids.includes(
                              selectedConversationId ?? -1,
                            ),
                          );
                          if (linkedNote) {
                            void openNotesView(linkedNote.id);
                          }
                        }}
                        disabled={!hasLinkedNote}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-sans
                      transition-colors duration-150
                      ${
                        hasLinkedNote
                          ? "text-text-secondary hover:text-accent-primary hover:bg-accent-primary-light"
                          : "text-text-tertiary cursor-not-allowed opacity-50"
                      }`}
                      >
                        <ArrowRight strokeWidth={1.5} className="w-3.5 h-3.5" />
                        {labels.viewNote ?? "View Note"}
                      </button>
                    </div>
                  </DetailSectionCard>

                  <DetailSectionEyebrow>
                    {labels.originalConversation ?? "Original Conversation"}
                  </DetailSectionEyebrow>
                  <DetailSectionCard className="mb-8">
                    {/* 默认预览条 - 折叠时显示 */}
                    {!isReaderConversationExpanded && (
                      <div className="space-y-4 p-5">
                        <div className="rounded-[20px] border border-border-subtle bg-bg-secondary/40 px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-sans uppercase tracking-[0.14em] text-text-tertiary">
                            <span>{labels.preview ?? "Preview"}</span>
                            <span
                              className="h-1 w-1 rounded-full bg-border-default/80"
                              aria-hidden="true"
                            />
                            <span>{messageCount} {labels.messageCountLabel ?? "messages"}</span>
                          </div>
                          <p
                            className={`mt-3 max-w-[60ch] break-words font-sans text-[14px] leading-[1.75] ${
                              messagesLoading
                                ? "text-text-tertiary"
                                : "line-clamp-3 text-text-primary"
                            }`}
                          >
                            {messagesLoading
                              ? "Loading original conversation..."
                              : originalConversationPreview}
                          </p>
                          {canToggleConversationExpanded && (
                            <div className="mt-4 flex justify-end border-t border-border-subtle pt-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setIsConversationExpanded((prev) => !prev)
                                }
                                className="inline-flex items-center rounded-full bg-bg-primary px-3.5 py-1.5 text-[12px] font-sans text-text-secondary transition-colors hover:bg-white hover:text-text-primary"
                              >
                                {labels.showOriginalMessages ?? "Show original messages"} ({messageCount})
                              </button>
                            </div>
                          )}
                        </div>
                        {isConversationContentSettled && timestampFooter && (
                          <ReaderTimestampFooter
                            key={selectedConversation.id}
                            model={timestampFooter}
                          />
                        )}
                      </div>
                    )}

                    {/* 展开后的完整消息流 */}
                    <div
                      className={`transition-all duration-300 ease-in-out ${
                        isSplitActive
                          ? "border-t border-border-subtle opacity-100"
                          : isConversationExpanded
                            ? "overflow-hidden border-t border-border-subtle opacity-100"
                            : "max-h-0 overflow-hidden opacity-0 pointer-events-none"
                      }`}
                    >
                      <div
                        ref={conversationPreviewScrollRef}
                        className={`relative ${
                          isSplitActive
                            ? ""
                            : "max-h-[440px] overflow-y-auto p-4"
                        }`}
                        style={
                          isSplitActive
                            ? undefined
                            : { scrollbarGutter: "stable" }
                        }
                      >
                        {canToggleConversationExpanded && (
                          <div className="mb-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => setIsConversationExpanded(false)}
                              className="inline-flex items-center rounded-full border border-border-subtle bg-bg-primary px-3.5 py-1.5 text-[12px] font-sans text-text-secondary transition-colors whitespace-nowrap hover:bg-bg-secondary hover:text-text-primary"
                            >
                              {labels.hideOriginalMessages ?? "Hide original messages"}
                            </button>
                          </div>
                        )}
                        <div>
                          <div className="prose prose-slate dark:prose-invert max-w-none min-w-0 prose-headings:text-text-primary prose-p:text-text-primary prose-li:text-text-primary prose-strong:text-text-primary prose-em:text-text-primary prose-code:text-text-primary prose-a:text-accent-primary prose-blockquote:text-text-secondary">
                            {messagesLoading && (
                              <div className="text-[13px] font-sans text-text-tertiary">
                                {labels.loadingMessages ?? "Loading messages..."}
                              </div>
                            )}
                            {!messagesLoading && messagesError && (
                              <div className="text-[13px] font-sans text-text-tertiary">
                                {labels.loadMessagesFailed ?? "Unable to load messages."}
                              </div>
                            )}
                            {messages.map((message, messageIndex) => {
                              const isUser = message.role === "user";
                              const messageAnnotations =
                                getAnnotationsForMessage(message.id);
                              const latestAnnotation =
                                getLatestAnnotationForMessage(message.id);
                              const annotationCount = messageAnnotations.length;
                              const isAnnotationActive =
                                activeAnnotationMessageId === message.id;

                              return (
                                <div key={message.id} className="group mb-5">
                                  <div
                                    className={`rounded-[22px] border px-4 py-4 transition-all duration-150 md:px-5 ${
                                      isAnnotationActive
                                        ? "border-accent-primary/40 bg-accent-primary-light/40 shadow-[0_8px_28px_rgba(15,23,42,0.06)]"
                                        : "border-transparent hover:border-border-subtle hover:bg-bg-secondary/40"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      {isUser ? (
                                        <div className="text-[11px] font-sans text-text-tertiary uppercase tracking-wide">
                                          {labels.you ?? "You"}
                                        </div>
                                      ) : (
                                        <span
                                          className="inline-block px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none uppercase tracking-wide"
                                          style={getPlatformBadgeStyle(
                                            selectedConversation.platform,
                                            themeMode,
                                          )}
                                        >
                                          {getPlatformLabel(
                                            selectedConversation.platform,
                                          )}
                                        </span>
                                      )}

                                      <button
                                        type="button"
                                        ref={(node) =>
                                          setAnnotationTriggerRef(
                                            message.id,
                                            node,
                                          )
                                        }
                                        data-annotation-trigger="true"
                                        onClick={() =>
                                          void handleAnnotationTriggerClick(
                                            message,
                                          )
                                        }
                                        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-2xl transition-all ${
                                          annotationCount > 0
                                            ? isAnnotationActive
                                              ? "bg-accent-primary-light/70 text-accent-primary opacity-100"
                                              : "bg-transparent text-text-secondary opacity-100"
                                            : isAnnotationActive
                                              ? "border border-border-subtle bg-bg-primary text-text-secondary"
                                              : isAnnotationTriggerAlwaysVisible
                                                ? "border border-border-subtle/80 bg-bg-primary/90 text-text-tertiary opacity-100"
                                                : "border border-border-subtle/80 bg-bg-primary/90 text-text-tertiary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                        }`}
                                        aria-label={`${getAnnotationTriggerLabel(latestAnnotation)}: ${
                                          isUser
                                            ? "user message"
                                            : `${selectedConversation.platform} reply`
                                        }`}
                                        title={
                                          annotationCount > 0
                                            ? "Open annotations"
                                            : getAnnotationTriggerLabel(
                                                latestAnnotation,
                                              )
                                        }
                                      >
                                        {annotationCount === 0 ? (
                                          <MessageSquarePlus
                                            strokeWidth={1.8}
                                            className="h-4 w-4"
                                          />
                                        ) : (
                                          <MessageSquare
                                            strokeWidth={1.8}
                                            className={`h-4 w-4 transition-opacity ${
                                              isAnnotationActive ||
                                              isAnnotationTriggerAlwaysVisible
                                                ? "opacity-100"
                                                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                            }`}
                                          />
                                        )}
                                        {annotationCount > 0 ? (
                                          <span
                                            className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent-primary transition-transform ${
                                              isAnnotationActive
                                                ? "scale-125"
                                                : ""
                                            }`}
                                            aria-hidden="true"
                                          ></span>
                                        ) : null}
                                      </button>
                                    </div>

                                    <div
                                      className={`mt-3 text-base leading-relaxed ${
                                        isUser
                                          ? "text-text-primary font-semibold"
                                          : "text-text-secondary"
                                      }`}
                                    >
                                      <div
                                        className={
                                          isUser
                                            ? ""
                                            : "rounded-2xl bg-bg-surface-ai-message p-3"
                                        }
                                        ref={(node) =>
                                          setMessageContentRef(message.id, node)
                                        }
                                        onMouseUp={() => {
                                          const element =
                                            messageContentRefs.current.get(
                                              message.id,
                                            ) ?? null;
                                          window.setTimeout(() => {
                                            updateReaderSelectionAction(
                                              message,
                                              messageIndex + 1,
                                              element,
                                            );
                                          }, 0);
                                        }}
                                      >
                                        <RichMessageContent message={message} />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {isAnnotationPanelOpen &&
                            !isAnnotationDrawerOverlay &&
                            activeAnnotationMessage &&
                            annotationPopoverStyle && (
                              <div
                                ref={annotationSurfaceRef}
                                style={{
                                  top: annotationPopoverStyle.top,
                                  left: annotationPopoverStyle.left,
                                  width: annotationPopoverStyle.width,
                                  maxHeight: annotationPopoverStyle.maxHeight,
                                }}
                                className="absolute z-20 overflow-y-auto rounded-[22px] border border-border-subtle bg-bg-primary shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
                              >
                                {renderAnnotationPanelContent()}
                              </div>
                            )}
                          {readerSelectionAction ? (
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => void handleExtractSelection()}
                              className="fixed z-30 inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-primary px-3 py-1.5 text-[12px] font-sans text-text-primary shadow-[0_10px_28px_rgba(15,23,42,0.18)] transition-colors hover:bg-bg-secondary"
                              style={{
                                top: readerSelectionAction.top,
                                left: readerSelectionAction.left,
                              }}
                            >
                              <BookOpen
                                strokeWidth={1.6}
                                className="h-3.5 w-3.5"
                              />
                              Extract
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isConversationContentSettled && timestampFooter && (
                        <ReaderTimestampFooter
                          key={selectedConversation.id}
                          model={timestampFooter}
                          className="mt-4 border-t border-border-subtle pt-4"
                        />
                      )}
                    </div>
                  </DetailSectionCard>

                  {isAnnotationPanelOpen &&
                    isAnnotationDrawerOverlay &&
                    activeAnnotationMessage && (
                      <>
                        <button
                          type="button"
                          aria-label="Close annotation panel backdrop"
                          onClick={() => void dismissAnnotationSurface()}
                          className="fixed inset-0 z-40 bg-black/20 xl:hidden"
                        />
                        <aside
                          ref={annotationSurfaceRef}
                          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col rounded-t-[28px] border border-border-subtle bg-bg-primary shadow-[0_-12px_48px_rgba(15,23,42,0.18)] xl:hidden"
                        >
                          <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-border-subtle" />
                          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
                            <div>
                              <div className="text-[11px] font-sans uppercase tracking-[0.16em] text-text-tertiary">
                                {labels.annotation ?? "Comment"}
                              </div>
                              <div className="mt-1 text-sm font-sans font-medium text-text-primary">
                                {activeAnnotationMessage.role === "user"
                                  ? (labels.you ?? "You")
                                  : selectedConversation.platform}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void dismissAnnotationSurface()}
                              className="rounded-md p-1 text-text-secondary hover:bg-bg-surface-card hover:text-text-primary transition-colors"
                              aria-label="Close annotation panel"
                            >
                              <X strokeWidth={1.8} className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto">
                            {renderAnnotationPanelContent()}
                          </div>
                        </aside>
                      </>
                    )}

                  {/* Related Notes */}
                  {selectedConversation &&
                    relatedNotesForConversation.length > 0 && (
                      <>
                        <DetailSectionEyebrow>
                          {labels.relatedNotes ?? "Related Notes"}
                        </DetailSectionEyebrow>
                        <DetailSectionCard className="mb-8">
                          <div className="space-y-2 p-2">
                            {relatedNotesForConversation.map((note) => (
                              <button
                                key={note.id}
                                onClick={() => void openNotesView(note.id)}
                                className="w-full flex items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-bg-secondary/60 group"
                              >
                                <span className="min-w-0 flex-1 truncate text-[13px] font-sans text-text-primary">
                                  {note.title}
                                </span>
                                <span className="shrink-0 text-[12px] font-sans font-medium text-accent-primary">
                                  {labels.open ?? "Open"}
                                </span>
                              </button>
                            ))}
                          </div>
                        </DetailSectionCard>
                      </>
                    )}

                  <DetailSectionEyebrow>
                    {labels.relatedConversations ?? "Related Conversations"}
                  </DetailSectionEyebrow>
                  <DetailSectionCard>
                    <div className="space-y-2 p-2">
                      {relatedLoading && (
                        <div className="px-3 py-2 text-[13px] font-sans text-text-tertiary">
                          {labels.findingRelated ?? "Finding related conversations..."}
                        </div>
                      )}
                      {!relatedLoading && relatedConversations.length === 0 && (
                        <div className="px-3 py-2 text-[13px] font-sans text-text-tertiary">
                          {relatedError
                            ? (labels.unableToLoadRelated ?? "Unable to load related conversations.")
                            : (labels.noRelatedConversations ?? "No related conversations yet.")}
                        </div>
                      )}
                      {!relatedLoading &&
                        relatedConversations.map((related) => (
                          <button
                            key={related.id}
                            onClick={() => switchToConversation(related.id)}
                            className="w-full flex items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-bg-secondary/60"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <span className="text-[13px] font-sans text-text-primary truncate">
                                {related.title}
                              </span>
                            </div>
                            <span className="shrink-0 text-xs font-sans text-accent-primary font-medium">
                              {related.similarity}%
                            </span>
                          </button>
                        ))}
                    </div>
                  </DetailSectionCard>
                </div>
              </div>
            )}

            {isSplitActive && selectedConversation ? (
              <ResizablePanelDivider
                ariaLabel="Resize split note pane"
                onPointerDown={splitNotePane.handlePointerDown}
                onNudge={(delta) => splitNotePane.nudgeWidth(-delta)}
                isDragging={splitNotePane.isDragging}
              />
            ) : null}

            {isSplitActive && selectedConversation ? (
              <div
                className="min-h-0 shrink-0 bg-bg-primary"
                style={{ width: `${splitNotePane.width}px` }}
              >
                <SplitNoteEditorPanel
                  selectedConversation={selectedConversation}
                  selectedNote={selectedNote}
                  noteTitle={noteTitle}
                  noteContent={noteContent}
                  linkedConversations={
                    selectedNote
                      ? selectedNote.linked_conversation_ids
                          .map((convId) =>
                            conversations.find(
                              (conversation) => conversation.id === convId,
                            ),
                          )
                          .filter(
                            (conversation): conversation is Conversation =>
                              Boolean(conversation),
                          )
                      : []
                  }
                  onTitleChange={setNoteTitle}
                  onContentChange={setNoteContent}
                  onSaveRequest={flushPendingNoteSave}
                  onAppendExcerpt={appendExcerptToDraft}
                  onCreateConversationNote={handleCreateConversationNote}
                  onDeleteCurrentNote={handleDeleteCurrentSplitNote}
                  onOpenConversation={switchToConversation}
                  formatTimeAgo={formatTimeAgo}
                  labels={labels}
                />
              </div>
            ) : null}

            {!isSplitActive && viewMode === "notes" && selectedNote ? (
              <div className="flex-1 overflow-y-auto bg-bg-primary">
                <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-8 py-6">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {editingTitle ? (
                        <input
                          ref={titleInputRef}
                          type="text"
                          value={noteTitle}
                          onChange={(event) => setNoteTitle(event.target.value)}
                          onBlur={() => setEditingTitle(false)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") setEditingTitle(false);
                            if (event.key === "Escape") {
                              setNoteTitle(selectedNote.title);
                              setEditingTitle(false);
                            }
                          }}
                          className="w-full border-b border-accent-primary bg-transparent text-2xl font-serif font-normal text-text-primary outline-none"
                        />
                      ) : (
                        <h1
                          onClick={() => setEditingTitle(true)}
                          className="cursor-text text-2xl font-serif font-normal text-text-primary transition-opacity hover:opacity-70"
                        >
                          {noteTitle || selectedNote.title}
                        </h1>
                      )}
                    </div>
                  </div>

                  <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-border-subtle pb-6 text-[13px] font-sans text-text-secondary">
                    <span className="rounded-full bg-bg-secondary px-3 py-1 text-[12px] text-text-secondary">
                      {selectedNote.source_type === "obsidian"
                        ? "Obsidian"
                        : "Local"}
                    </span>
                    {selectedNote.import_meta?.vault_name ? (
                      <span className="rounded-full bg-bg-secondary px-3 py-1 text-[12px] text-text-secondary">
                        {selectedNote.import_meta.vault_name}
                      </span>
                    ) : null}
                    {selectedNote.source_path ? (
                      <span className="truncate text-[12px] text-text-tertiary">
                        {selectedNote.source_path}
                      </span>
                    ) : null}
                    {selectedNote.obsidian_export?.relative_path ? (
                      <span className="truncate rounded-full bg-bg-secondary px-3 py-1 text-[12px] text-text-secondary">
                        {selectedNote.obsidian_export.relative_path}
                      </span>
                    ) : null}
                    <span className="ml-auto">
                      {noteSaveStatus === "saving"
                        ? (labels.saving ?? "Saving...")
                        : noteSaveStatus === "unsaved"
                          ? (labels.unsavedChanges ?? "Unsaved changes")
                        : (labels.updatedAtTime ?? "Updated {time}").replace("{time}", formatTimeAgo(selectedNote.updated_at))}
                    </span>
                  </div>

                  {selectedNote.import_meta?.conflict ? (
                    <div className="mb-5 rounded-xl border border-[#FECDCA] bg-[#FEF3F2] px-4 py-3 text-[13px] font-sans text-[#B42318]">
                      Source file changed after local edits. Re-import skipped to
                      avoid overwriting this note.
                    </div>
                  ) : null}

                  <div className="mb-10">
                    <MarkdownNoteEditor
                      value={noteContent}
                      onChange={setNoteContent}
                      onSaveRequest={flushPendingNoteSave}
                      placeholderText={labels.startWritingPlaceholder ?? "Start writing..."}
                      minHeight={STANDARD_NOTE_EDITOR_MIN_HEIGHT}
                      className="w-full overflow-hidden rounded-2xl border border-border-subtle bg-bg-primary"
                    />
                  </div>

                  {selectedNote.source_type === "obsidian" &&
                  selectedNote.import_meta ? (
                    <div className="mb-8 space-y-4">
                      <h3 className="text-[11px] font-sans font-medium uppercase tracking-wider text-text-tertiary">
                        {labels.importMetadata ?? "Import Metadata"}
                      </h3>
                      <div className="rounded-2xl border border-border-subtle bg-bg-surface-card p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                              {labels.vaultPath ?? "Vault Path"}
                            </div>
                            <div className="mt-1 break-all text-[13px] font-sans text-text-primary">
                              {selectedNote.import_meta.relative_path ??
                                selectedNote.source_path ??
                                "Unknown"}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                              {labels.sourceHash ?? "Source Hash"}
                            </div>
                            <div className="mt-1 break-all text-[13px] font-sans text-text-primary">
                              {selectedNote.import_meta.source_file_hash ??
                                "Unavailable"}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {selectedNote.import_meta.tags.map((tag) => (
                            <MetaChip key={tag}>#{tag}</MetaChip>
                          ))}
                          {selectedNote.import_meta.wikilinks.map((link) => (
                            <MetaChip key={`wikilink:${link}`}>
                              {`[[${link}]]`}
                            </MetaChip>
                          ))}
                          {selectedNote.import_meta.embeds.map((embed) => (
                            <MetaChip key={`embed:${embed}`}>
                              {`![[${embed}]]`}
                            </MetaChip>
                          ))}
                          {selectedNote.import_meta.frontmatter ? (
                            <MetaChip>{labels.frontmatter ?? "Frontmatter"}</MetaChip>
                          ) : null}
                        </div>
                      </div>

                      {selectedNote.import_meta.assets.length > 0 ? (
                        <div>
                          <h3 className="mb-3 text-[11px] font-sans font-medium uppercase tracking-wider text-text-tertiary">
                            Attachments
                          </h3>
                          <div className="space-y-2">
                            {selectedNote.import_meta.assets.map((asset) => (
                              <div
                                key={`${asset.kind}:${asset.path}`}
                                className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-bg-surface-card px-3 py-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[13px] font-sans text-text-primary">
                                    {basename(asset.path) || asset.path}
                                  </div>
                                  <div className="truncate text-[11px] font-sans text-text-tertiary">
                                    {asset.path}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handlePreviewImportedAsset(
                                      asset.path,
                                      asset.asset_id,
                                    )
                                  }
                                  className="rounded-md bg-bg-primary px-3 py-1.5 text-[12px] font-sans text-text-primary transition-colors hover:bg-bg-secondary"
                                >
                                  {labels.preview ?? "Preview"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleOpenImportedAsset(
                                      asset.path,
                                      asset.asset_id,
                                    )
                                  }
                                  className="rounded-md bg-bg-primary px-3 py-1.5 text-[12px] font-sans text-text-primary transition-colors hover:bg-bg-secondary"
                                >
                                  {labels.open ?? "Open"}
                                </button>
                              </div>
                            ))}
                          </div>
                          {previewedAssetUrl && previewedAssetPath ? (
                            <div className="mt-4 rounded-2xl border border-border-subtle bg-bg-surface-card p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                                    {labels.attachmentPreview ?? "Attachment Preview"}
                                  </div>
                                  <div className="mt-1 text-[13px] font-sans text-text-primary">
                                    {previewedAssetPath}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setPreviewAsset(null, null, null)}
                                  className="rounded-md px-2 py-1 text-[12px] font-sans text-text-secondary transition-colors hover:bg-bg-primary hover:text-text-primary"
                                >
                                  Close
                                </button>
                              </div>
                              {previewedAssetMimeType?.startsWith("image/") ? (
                                <img
                                  src={previewedAssetUrl}
                                  alt={basename(previewedAssetPath)}
                                  className="max-h-[360px] w-auto rounded-xl border border-border-subtle object-contain"
                                />
                              ) : (
                                <div className="text-[13px] font-sans text-text-secondary">
                                  {labels.previewAvailableForImages ?? "Preview is available for imported images."}{" "}
                                  {labels.useOpenForOtherAttachments ?? "Use Open for other attachment types."}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {canUseObsidianVault ? (
                    <div className="mb-8 flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void handleExportNoteToObsidian(selectedNote);
                        }}
                        disabled={obsidianActionBusy === selectedNote.id}
                        className={`rounded-md px-3 py-1.5 text-[13px] font-sans font-medium transition-colors ${
                          obsidianActionBusy === selectedNote.id
                            ? "cursor-not-allowed bg-bg-surface-card text-text-tertiary"
                            : "bg-accent-primary text-bg-primary hover:bg-accent-primary/90"
                        }`}
                      >
                        {obsidianActionBusy === selectedNote.id
                          ? (labels.choosingFolder ?? "Choosing Folder...")
                          : (labels.exportToObsidian ?? "Export to Obsidian")}
                      </button>
                      {obsidianNotice ? (
                        <div
                          className={`text-[12px] font-sans transition-opacity duration-300 ${
                            obsidianNotice.tone === "success"
                              ? "text-text-secondary"
                              : "text-[#B42318]"
                          }`}
                        >
                          {obsidianNotice.message}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-2">
                    <h3 className="mb-3 text-[11px] font-sans font-medium uppercase tracking-wider text-text-tertiary">
                      {labels.linkedConversations ?? "Linked Conversations"}
                    </h3>
                    {selectedNote.linked_conversation_ids.length > 0 ? (
                      <div className="space-y-2">
                        {selectedNote.linked_conversation_ids.map((convId) => {
                          const conversation = conversations.find(
                            (item) => item.id === convId,
                          );
                          if (!conversation) return null;

                          return (
                            <button
                              key={convId}
                              onClick={() => switchToConversation(conversation.id)}
                              className="flex w-full items-center justify-between rounded-lg bg-bg-surface-card p-3 transition-colors hover:bg-bg-surface-card-hover"
                            >
                              <div className="min-w-0 flex-1 text-left">
                                <span className="truncate text-[13px] font-sans text-text-primary">
                                  {conversation.title}
                                </span>
                              </div>
                              <span className="text-xs font-sans font-medium text-accent-primary">
                                {labels.preview ?? "Preview"} →
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg bg-bg-surface-card p-3 text-[13px] font-sans text-text-tertiary">
                        {labels.noLinkedConversations ?? "No linked conversations"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {!isSplitActive && viewMode === "notes" && !selectedNote ? (
              <div className="flex flex-1 items-center justify-center bg-bg-primary px-8">
                <div className="max-w-md text-center">
                  <div className="text-[11px] font-sans uppercase tracking-[0.18em] text-text-tertiary">
                    {labels.notesWorkspace ?? "Notes Workspace"}
                  </div>
                  <h2 className="mt-3 text-2xl font-serif font-normal text-text-primary">
                    {labels.selectNoteToEdit ?? "Select a note to start editing"}
                  </h2>
                  <p className="mt-3 text-[13px] font-sans leading-relaxed text-text-secondary">
                    {labels.localNotesAndObsidianShareEditor ?? "Local notes and imported Obsidian files now share the same Markdown editor surface."}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          {renameNoteTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button
                type="button"
                onClick={() => setRenameNoteTarget(null)}
                className="absolute inset-0 bg-black/25"
                aria-label="Close rename note dialog"
              />
              <div className="relative w-full max-w-md rounded-xl border border-border-subtle bg-bg-primary shadow-[0_16px_48px_rgba(0,0,0,0.18)] p-4">
                <h3 className="text-[16px] font-sans font-medium text-text-primary">
                  {labels.renameNote ?? "Rename Note"}
                </h3>
                <p className="mt-1 text-[13px] font-sans text-text-tertiary">
                  {labels.updateNoteTitle ?? "Update the title for this note."}
                </p>
                <input
                  ref={renameNoteInputRef}
                  type="text"
                  value={renameNoteTitle}
                  onChange={(event) => setRenameNoteTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitNoteRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setRenameNoteTarget(null);
                    }
                  }}
                  placeholder={labels.noteTitlePlaceholder ?? "Note title"}
                  className="mt-3 w-full rounded-md border border-border-subtle bg-bg-surface-card px-3 py-2 text-[13px] font-sans text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRenameNoteTarget(null)}
                    className="px-3 py-1.5 rounded-md text-[13px] font-sans text-text-secondary hover:text-text-primary hover:bg-bg-surface-card transition-colors"
                  >
                    {labels.cancel ?? "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void submitNoteRename();
                    }}
                    disabled={!canSaveRenamedNote}
                    className="px-3 py-1.5 rounded-md text-[13px] font-sans bg-accent-primary text-text-inverse hover:bg-accent-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </LibrarySplitContext.Provider>
    </div>
  );
}
