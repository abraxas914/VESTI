import { useState } from "react";
import {
  Check,
  CheckSquare,
  Copy,
  Download,
  FolderPlus,
  Loader2,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useI18n } from "~lib/i18n";
import type {
  ConversationExportContentMode,
  ConversationExportFormat,
} from "../types/export";
import type { BatchSelectionMode } from "../hooks/useBatchSelection";

type BatchActionMode = Exclude<BatchSelectionMode, "inactive">;

interface BatchFeedback {
  message: string;
  tone: "default" | "warning" | "error";
  title?: string;
  detail?: string;
  hint?: string;
}

interface BatchActionBarProps {
  mode: BatchActionMode;
  exportMode: ConversationExportContentMode;
  selectedExportFormat: ConversationExportFormat;
  selectedCount: number;
  totalCount: number;
  actionKey: string | null;
  deleteConfirmValue: string;
  clipboardAvailable: boolean;
  copyJustSucceeded: boolean;
  feedback?: BatchFeedback | null;
  onDeleteConfirmValueChange: (value: string) => void;
  onExportModeChange: (mode: ConversationExportContentMode) => void;
  onExportFormatChange: (format: ConversationExportFormat) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleExportPanel: () => void;
  onToggleDeletePanel: () => void;
  onClosePanel: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onConfirmDelete: () => void;
  onBulkStar: () => void;
  onBulkAddTag: (tag: string) => void;
  onExit: () => void;
}

function getExportOptions(t: ReturnType<typeof useI18n>["t"]): Array<{
  format: ConversationExportFormat;
  name: string;
  description: string;
}> {
  return [
    {
      format: "md",
      name: t.timeline.batch.exportFormats.md.name,
      description: t.timeline.batch.exportFormats.md.desc,
    },
    {
      format: "txt",
      name: t.timeline.batch.exportFormats.txt.name,
      description: t.timeline.batch.exportFormats.txt.desc,
    },
    {
      format: "json",
      name: t.timeline.batch.exportFormats.json.name,
      description: t.timeline.batch.exportFormats.json.desc,
    },
  ];
}

function getExportModeOptions(t: ReturnType<typeof useI18n>["t"]): Array<{
  mode: ConversationExportContentMode;
  label: string;
  description: string;
}> {
  return [
    {
      mode: "full",
      label: t.timeline.batch.exportModes.full.label,
      description: t.timeline.batch.exportModes.full.desc,
    },
    {
      mode: "compact",
      label: t.timeline.batch.exportModes.compact.label,
      description: t.timeline.batch.exportModes.compact.desc,
    },
    {
      mode: "summary",
      label: t.timeline.batch.exportModes.summary.label,
      description: t.timeline.batch.exportModes.summary.desc,
    },
  ];
}

export function BatchActionBar({
  mode,
  exportMode,
  selectedExportFormat,
  selectedCount,
  totalCount,
  actionKey,
  deleteConfirmValue,
  clipboardAvailable,
  copyJustSucceeded,
  feedback = null,
  onDeleteConfirmValueChange,
  onExportModeChange,
  onExportFormatChange,
  onSelectAll,
  onClearSelection,
  onToggleExportPanel,
  onToggleDeletePanel,
  onClosePanel,
  onDownload,
  onCopy,
  onConfirmDelete,
  onBulkStar,
  onBulkAddTag,
  onExit,
}: BatchActionBarProps) {
  const { t } = useI18n();
  const [folderInput, setFolderInput] = useState("");
  const [showFolder, setShowFolder] = useState(false);
  const submitFolder = () => {
    const value = folderInput.trim();
    if (!value) return;
    onBulkAddTag(value);
    setFolderInput("");
    setShowFolder(false);
  };
  const exportOptions = getExportOptions(t);
  const exportModeOptions = getExportModeOptions(t);
  const isAllSelected = selectedCount === totalCount && totalCount > 0;
  const hasSelection = selectedCount > 0;
  const deleteBusy = actionKey === "delete";
  const showingExportPanel = mode === "export_panel";
  const showingDeletePanel = mode === "delete_panel";
  const selectedMode =
    exportModeOptions.find((option) => option.mode === exportMode) ||
    exportModeOptions[0];
  const selectedFormat =
    exportOptions.find((option) => option.format === selectedExportFormat) ||
    exportOptions[0];
  const feedbackClassName =
    feedback?.tone === "error"
      ? "is-error"
      : feedback?.tone === "warning"
        ? "is-warning"
        : "";
  const toolbarActionBaseClassName =
    "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-45";
  const toolbarNeutralActionClassName = `${toolbarActionBaseClassName} text-text-secondary hover:bg-bg-secondary hover:text-text-primary`;
  const toolbarDeleteActionClassName = `${toolbarActionBaseClassName} text-danger hover:bg-bg-secondary`;
  const toolbarSelectActionClassName = `${toolbarNeutralActionClassName} px-1.5`;
  const hasStructuredFeedback = Boolean(
    feedback?.title || feedback?.detail || feedback?.hint
  );
  const downloadBusy = actionKey === `download-${selectedExportFormat}`;
  const copyBusy = actionKey === `copy-${selectedExportFormat}`;
  const exportActionsDisabled = Boolean(actionKey) || !hasSelection;
  const copyDisabled = exportActionsDisabled || !clipboardAvailable;
  const copyButtonClassName = [
    "data-export-action-btn",
    exportMode !== "full" ? "is-ai-ready" : "",
    copyJustSucceeded ? "is-success" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const copyButtonLabel = copyBusy
    ? t.common.loading
    : copyJustSucceeded
      ? t.common.copied
      : clipboardAvailable
        ? t.common.copy
        : t.timeline.batch.clipboardUnavailable;
  const copyButtonIcon = copyBusy ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
  ) : copyJustSucceeded ? (
    <Check className="h-3.5 w-3.5" strokeWidth={1.8} />
  ) : (
    <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
  );

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-3">
      {showFolder ? (
        <div className="rounded-xl border border-border-subtle bg-bg-primary/95 p-3 shadow-paper backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[12px] font-semibold text-text-primary">
              {t.timeline.batch.addToFolder} · {selectedCount}{" "}
              {selectedCount === 1 ? t.timeline.batch.threadSingular : t.timeline.batch.threadPlural}
            </p>
            <button
              type="button"
              onClick={() => setShowFolder(false)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              autoFocus
              value={folderInput}
              onChange={(event) => setFolderInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitFolder();
                if (event.key === "Escape") setShowFolder(false);
              }}
              placeholder={t.timeline.batch.folderNamePlaceholder}
              className="h-9 flex-1 rounded-lg border border-border-subtle bg-bg-primary px-3 text-[13px] text-text-primary outline-none focus:border-accent-primary"
            />
            <button
              type="button"
              onClick={submitFolder}
              disabled={!folderInput.trim() || Boolean(actionKey)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t.timeline.batch.add}
            </button>
          </div>
        </div>
      ) : showingExportPanel ? (
        <div className="rounded-xl border border-border-subtle bg-bg-primary/95 p-3 shadow-paper backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-text-primary">
                {t.timeline.batch.exportLabel} {selectedCount} {selectedCount === 1 ? t.timeline.batch.threadSingular : t.timeline.batch.threadPlural}
              </p>
              <p className="mt-0.5 text-[11px] text-text-secondary">
                {t.timeline.batch.exportPanelDesc}
              </p>
            </div>
            <button
              type="button"
              onClick={onClosePanel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          <p className="mt-3 data-subgroup-label">{t.timeline.batch.exportModeLabel}</p>
          <div className="rounded-lg bg-bg-secondary p-1">
            <div className="grid grid-cols-3 gap-1">
              {exportModeOptions.map((option) => {
                const active = exportMode === option.mode;
                return (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => onExportModeChange(option.mode)}
                    className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                      active
                        ? "bg-bg-primary text-text-primary shadow-sm"
                        : "text-text-secondary hover:bg-bg-primary/70 hover:text-text-primary"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-[1.45] text-text-secondary">
            {selectedMode.description}
          </p>

          <p className="mt-3 data-subgroup-label">{t.timeline.batch.exportFormatLabel}</p>
          <div className="data-format-selector">
            {exportOptions.map((option) => {
              const active = selectedExportFormat === option.format;
              return (
                <button
                  key={option.format}
                  type="button"
                  onClick={() => onExportFormatChange(option.format)}
                  disabled={Boolean(actionKey)}
                  className={`data-format-option ${active ? "is-selected" : ""}`}
                >
                  <span className="data-format-option-name">{option.name}</span>
                  <span className="data-format-option-desc">{option.description}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-[1.45] text-text-secondary">
            {t.timeline.batch.currentFormat}: {selectedFormat.name}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="data-export-action-btn"
              disabled={exportActionsDisabled}
              onClick={onDownload}
            >
              {downloadBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              {downloadBusy ? t.common.loading : t.common.download}
            </button>
            <button
              type="button"
              className={copyButtonClassName}
              disabled={copyDisabled}
              onClick={onCopy}
            >
              {copyButtonIcon}
              {copyButtonLabel}
            </button>
          </div>

          {feedback &&
            (hasStructuredFeedback ? (
              <div className={`mt-3 data-feedback-callout ${feedbackClassName}`}>
                <div className="data-feedback-callout-head">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                  <p className="data-feedback-title">{feedback.title || feedback.message}</p>
                </div>
                {feedback.detail && <p className="data-feedback-detail">{feedback.detail}</p>}
                {feedback.hint && <p className="data-feedback-hint">{feedback.hint}</p>}
              </div>
            ) : (
              <p className={`mt-3 data-feedback-row ${feedbackClassName}`}>{feedback.message}</p>
            ))}
        </div>
      ) : showingDeletePanel ? (
        <div className="rounded-xl border border-border-subtle bg-bg-primary/95 p-3 shadow-paper backdrop-blur-sm">
          <div className="data-danger-zone">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="data-danger-head">
                  <TriangleAlert className="h-4 w-4" strokeWidth={1.8} />
                  <span>{t.timeline.batch.deleteLabel} {selectedCount} {selectedCount === 1 ? t.timeline.batch.threadSingular : t.timeline.batch.threadPlural}</span>
                </div>
                <p className="data-danger-desc mb-0">
                  {selectedCount === 1
                    ? t.timeline.batch.deleteDescSingular
                    : t.timeline.batch.deleteDescPlural.replace("{count}", String(selectedCount))}
                  {" "}
                  <span className="font-semibold text-danger">DELETE</span>
                  {" "}
                  {t.timeline.batch.toContinue}.
                </p>
              </div>
              <button
                type="button"
                onClick={onClosePanel}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
              {t.timeline.batch.confirmation}
            </label>
            <input
              type="text"
              value={deleteConfirmValue}
              placeholder={t.timeline.batch.deleteConfirm}
              onChange={(event) => onDeleteConfirmValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClosePanel();
                }
                if (event.key === "Enter" && deleteConfirmValue === "DELETE") {
                  event.preventDefault();
                  onConfirmDelete();
                }
              }}
              className="mt-1.5 h-9 w-full rounded-md border border-border-default bg-bg-primary px-3 text-vesti-sm text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-border-focus"
            />

            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClosePanel}
                className="data-export-btn"
                disabled={deleteBusy}
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                className="data-danger-btn"
                disabled={deleteConfirmValue !== "DELETE" || deleteBusy || !hasSelection}
                onClick={onConfirmDelete}
              >
                {deleteBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                {t.timeline.batch.confirmDelete}
              </button>
            </div>
          </div>

          {feedback &&
            (hasStructuredFeedback ? (
              <div className={`mt-3 data-feedback-callout ${feedbackClassName}`}>
                <div className="data-feedback-callout-head">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                  <p className="data-feedback-title">{feedback.title || feedback.message}</p>
                </div>
                {feedback.detail && <p className="data-feedback-detail">{feedback.detail}</p>}
                {feedback.hint && <p className="data-feedback-hint">{feedback.hint}</p>}
              </div>
            ) : (
              <p className={`mt-3 data-feedback-row ${feedbackClassName}`}>{feedback.message}</p>
            ))}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border-subtle bg-bg-primary/95 px-2 py-2 shadow-paper backdrop-blur-sm">
            <div className="flex items-center gap-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={isAllSelected ? onClearSelection : onSelectAll}
                  className={`${toolbarSelectActionClassName} min-w-0`}
                >
                  {isAllSelected ? (
                    <CheckSquare className="h-4 w-4 text-accent-primary" strokeWidth={1.5} />
                  ) : (
                    <Square className="h-4 w-4" strokeWidth={1.5} />
                  )}
                  {isAllSelected ? t.timeline.batch.deselectAll : t.timeline.batch.selectAll}
                </button>
                <p className="min-w-0 truncate text-[11px] leading-4 text-text-tertiary">
                  <span className="font-semibold text-text-secondary">{selectedCount}</span>{" "}
                  {t.timeline.batch.selected} &middot; {totalCount} {t.timeline.batch.inCurrentResults}
                </p>
              </div>

              <div className="flex-1" />

              <div className="ml-2 flex shrink-0 items-center gap-2 pl-2">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-px rounded-full bg-border-subtle"
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={onBulkStar}
                    disabled={!hasSelection || Boolean(actionKey)}
                    className={toolbarNeutralActionClassName}
                  >
                    <Star className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t.timeline.batch.star}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFolder(true)}
                    disabled={!hasSelection || Boolean(actionKey)}
                    className={toolbarNeutralActionClassName}
                  >
                    <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t.timeline.batch.addToFolder}
                  </button>
                  <button
                    type="button"
                    onClick={onToggleExportPanel}
                    disabled={!hasSelection || Boolean(actionKey)}
                    className={toolbarNeutralActionClassName}
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t.timeline.batch.export}
                  </button>
                  <button
                    type="button"
                    onClick={onToggleDeletePanel}
                    disabled={!hasSelection || Boolean(actionKey)}
                    className={toolbarDeleteActionClassName}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t.timeline.batch.delete}
                  </button>
                  <button
                    type="button"
                    onClick={onExit}
                    disabled={Boolean(actionKey)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {feedback &&
            (hasStructuredFeedback ? (
              <div className={`mt-2 data-feedback-callout ${feedbackClassName}`}>
                <div className="data-feedback-callout-head">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                  <p className="data-feedback-title">{feedback.title || feedback.message}</p>
                </div>
                {feedback.detail && <p className="data-feedback-detail">{feedback.detail}</p>}
                {feedback.hint && <p className="data-feedback-hint">{feedback.hint}</p>}
              </div>
            ) : (
              <p className={`mt-2 data-feedback-row ${feedbackClassName}`}>{feedback.message}</p>
            ))}
        </>
      )}
    </div>
  );
}
