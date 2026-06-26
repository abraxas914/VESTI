"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, Copy, Download, ExternalLink, Plus, Search, Sparkles, Square, Trash2, Upload } from "lucide-react";
import type {
  DashboardLabels,
  PlazaData,
  PlazaPrompt,
  Prompt,
  StorageApi,
  UiThemeMode,
} from "../types";

interface PromptsTabProps {
  storage: StorageApi;
  themeMode?: UiThemeMode;
  isActive?: boolean;
  onOpenConversation?: (conversationId: number) => void;
  labels: DashboardLabels["prompts"];
  /** Plaza data (daily picks + supermarket catalog + adopted ids), host-built. */
  plaza?: PlazaData;
  /** Toggle adoption of a catalog prompt into the user's personal plaza. */
  onPlazaAdoptToggle?: (id: string, adopt: boolean) => void;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface EditorState {
  open: boolean;
  isNew: boolean;
  id: number | null;
  title: string;
  body: string;
  sourceConversationId: number | null;
}

const EMPTY_EDITOR: EditorState = {
  open: false,
  isNew: false,
  id: null,
  title: "",
  body: "",
  sourceConversationId: null,
};

// Lightweight prompt repository: each entry is a concise trigger (唤醒词) + the
// original prompt body. Find / new / edit / delete only — auto-built from the
// user's high-frequency prompts. No categories / tags / quality / LLM enrichment.
export function PromptsTab({
  storage,
  isActive = false,
  onOpenConversation,
  labels,
  plaza,
  onPlazaAdoptToggle,
}: PromptsTabProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [extractStatus, setExtractStatus] = useState<"idle" | "running">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const supportsPrompts = Boolean(storage.listPrompts);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Multi-select for the adopted plaza shelf (我的广场) → bulk remove (un-adopt).
  const [selectedPlazaIds, setSelectedPlazaIds] = useState<Set<string>>(new Set());
  const togglePlazaSelect = useCallback((id: string) => {
    setSelectedPlazaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleBulkRemovePlaza = useCallback(() => {
    if (!onPlazaAdoptToggle) return;
    for (const id of selectedPlazaIds) onPlazaAdoptToggle(id, false);
    setSelectedPlazaIds(new Set());
  }, [onPlazaAdoptToggle, selectedPlazaIds]);

  const load = useCallback(async () => {
    if (!storage.listPrompts) {
      setStatus("error");
      setError(labels.unavailable);
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await storage.listPrompts({ includeArchived: false });
      setPrompts(result);
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError((loadError as Error)?.message ?? labels.loadFailed);
    }
  }, [storage, labels]);

  useEffect(() => {
    if (isActive && status === "idle") {
      void load();
    }
  }, [isActive, status, load]);

  // Auto-build the library ONLY when it's empty (one-time populate). Re-running
  // is an explicit user action (the Extract button), which refreshes the set —
  // this avoids the auto-accumulation that bloated the library across opens.
  const autoExtractDoneRef = useRef(false);
  useEffect(() => {
    if (!isActive || status !== "ready" || autoExtractDoneRef.current) return;
    if (!storage.extractPromptsFromLibrary) return;
    if (prompts.length > 0) return;
    autoExtractDoneRef.current = true;
    void (async () => {
      setExtractStatus("running");
      try {
        await storage.extractPromptsFromLibrary?.({ scope: "recent" });
        await load();
      } catch {
        /* silent — the manual extract button remains available */
      } finally {
        setExtractStatus("idle");
      }
    })();
  }, [isActive, status, prompts.length, storage, load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visiblePrompts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle
      ? prompts.filter(
          (p) =>
            p.title.toLowerCase().includes(needle) ||
            p.body.toLowerCase().includes(needle),
        )
      : prompts;
    return [...list].sort((a, b) => b.updated_at - a.updated_at);
  }, [prompts, search]);

  const openNew = useCallback(() => {
    setEditor({ ...EMPTY_EDITOR, open: true, isNew: true });
  }, []);

  // Plaza → prefill the editor as a NEW prompt so the user reviews/edits before
  // saving (dedup by body hash avoids accidental duplicates on save).
  const usePlazaPrompt = useCallback((p: PlazaPrompt) => {
    setEditor({
      open: true,
      isNew: true,
      id: null,
      title: p.title,
      body: p.body,
      sourceConversationId: null,
    });
  }, []);

  const plazaDaily = plaza?.daily ?? [];
  const supermarket = plaza?.supermarket ?? [];
  const adoptedSet = useMemo(() => new Set(plaza?.adoptedIds ?? []), [plaza?.adoptedIds]);
  const adoptedItems = useMemo(() => {
    if (adoptedSet.size === 0) return [] as PlazaPrompt[];
    const out: PlazaPrompt[] = [];
    for (const cat of supermarket) {
      for (const p of cat.prompts) {
        if (adoptedSet.has(p.id)) out.push(p);
      }
    }
    return out;
  }, [supermarket, adoptedSet]);
  const showPlaza =
    status === "ready" &&
    extractStatus !== "running" &&
    search.trim() === "" &&
    (plazaDaily.length > 0 || supermarket.length > 0);

  const openEdit = useCallback((prompt: Prompt) => {
    setEditor({
      open: true,
      isNew: false,
      id: prompt.id,
      title: prompt.title,
      body: prompt.body,
      sourceConversationId: prompt.source_conversation_id,
    });
  }, []);

  const closeEditor = useCallback(() => setEditor(EMPTY_EDITOR), []);

  const handleSave = useCallback(async () => {
    const body = editor.body.trim();
    if (!body) {
      setToast(labels.toastBodyEmpty);
      return;
    }
    try {
      if (editor.isNew || editor.id === null) {
        if (!storage.createPrompt) return;
        const { created } = await storage.createPrompt({
          title: editor.title.trim() || undefined,
          body,
          source: "manual",
        });
        setToast(created ? labels.toastSaved : labels.toastDuplicate);
      } else {
        if (!storage.updatePrompt) return;
        await storage.updatePrompt(editor.id, {
          title: editor.title.trim() || undefined,
          body,
          // Promote to "manual" so an edited prompt survives a library refresh.
          source: "manual",
        });
        setToast(labels.toastUpdated);
      }
      closeEditor();
      await load();
    } catch (saveError) {
      setToast((saveError as Error)?.message ?? labels.toastSaveFailed);
    }
  }, [editor, storage, labels, closeEditor, load]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!storage.deletePrompt) return;
      try {
        await storage.deletePrompt(id);
        if (editor.id === id) closeEditor();
        setToast(labels.toastDeleted);
        await load();
      } catch (deleteError) {
        setToast((deleteError as Error)?.message ?? labels.toastDeleteFailed);
      }
    },
    [storage, labels, editor.id, closeEditor, load],
  );

  const handleBulkDelete = useCallback(async () => {
    if (!storage.deletePrompt || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      for (const id of ids) {
        await storage.deletePrompt(id);
        if (editor.id === id) closeEditor();
      }
      setToast(labels.toastDeleted);
      clearSelection();
      await load();
    } catch (deleteError) {
      setToast((deleteError as Error)?.message ?? labels.toastDeleteFailed);
    }
  }, [storage, selectedIds, editor.id, closeEditor, labels, clearSelection, load]);

  const handleCopy = useCallback(
    async (prompt: Prompt) => {
      try {
        await navigator.clipboard.writeText(prompt.body);
        setToast(labels.toastCopied);
        if (storage.incrementPromptUsage) {
          await storage.incrementPromptUsage(prompt.id);
        }
      } catch {
        setToast(labels.toastClipboard);
      }
    },
    [storage, labels],
  );

  // #2 Backup: export/import the prompt library as a JSON file (self-contained;
  // survives reinstall). Uses the existing storage CRUD — no backend changes.
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = useCallback(async () => {
    if (!storage.listPrompts) return;
    try {
      const all = await storage.listPrompts({ includeArchived: true });
      const payload = JSON.stringify(
        { schema: "vesti_prompts.v1", prompts: all },
        null,
        2,
      );
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vesti-prompts-backup.json";
      link.click();
      URL.revokeObjectURL(url);
      setToast(labels.toastExported.replace("{n}", String(all.length)));
    } catch {
      setToast(labels.toastSaveFailed);
    }
  }, [storage, labels]);

  const handleImportFile = useCallback(
    async (file: File) => {
      if (!storage.createPrompt) return;
      let prompts: Array<{ title?: string; body?: string }> = [];
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.prompts)
            ? parsed.prompts
            : null;
        if (!list) throw new Error("bad format");
        prompts = list;
      } catch {
        setToast(labels.importFailed);
        return;
      }
      let imported = 0;
      let skipped = 0;
      for (const item of prompts) {
        const body = typeof item?.body === "string" ? item.body : "";
        if (!body.trim()) {
          skipped += 1;
          continue;
        }
        try {
          const { created } = await storage.createPrompt({
            title: typeof item?.title === "string" ? item.title : undefined,
            body,
            source: "manual",
          });
          if (created) imported += 1;
          else skipped += 1;
        } catch {
          skipped += 1;
        }
      }
      setToast(
        labels.toastImported
          .replace("{n}", String(imported))
          .replace("{skipped}", String(skipped)),
      );
      await load();
    },
    [storage, labels, load],
  );

  const handleExtract = useCallback(async () => {
    if (!storage.extractPromptsFromLibrary) return;
    setExtractStatus("running");
    try {
      const result = await storage.extractPromptsFromLibrary({ scope: "recent" });
      try {
        window.localStorage.setItem("vesti_prompts_last_extract", String(Date.now()));
      } catch {
        /* ignore */
      }
      setToast(
        labels.toastExtract
          .replace("{created}", String(result.created))
          .replace("{candidates}", String(result.candidates)),
      );
      await load();
    } catch (extractError) {
      setToast((extractError as Error)?.message ?? labels.extractFailed);
    } finally {
      setExtractStatus("idle");
    }
  }, [storage, labels, load]);

  if (!supportsPrompts) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-text-secondary">
        <p>{labels.unavailable}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-6 py-4">
        <div>
          <h2 className="font-mono text-[13px] font-medium uppercase tracking-[0.26em] text-text-primary">
            {labels.title}
          </h2>
          <p className="mt-1 text-[12px] text-text-tertiary">
            {labels.summary.replace("{count}", String(prompts.length))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExtract}
            disabled={extractStatus === "running"}
            title={labels.extractTooltip}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-text-primary transition-colors hover:bg-bg-surface-card disabled:opacity-60"
          >
            <Sparkles strokeWidth={1.7} className="h-4 w-4" />
            {extractStatus === "running" ? labels.extracting : labels.extractFromChats}
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            title={labels.exportLabel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-text-primary transition-colors hover:bg-bg-surface-card"
          >
            <Download strokeWidth={1.7} className="h-4 w-4" />
            {labels.exportLabel}
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            title={labels.importBackup}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-text-primary transition-colors hover:bg-bg-surface-card"
          >
            <Upload strokeWidth={1.7} className="h-4 w-4" />
            {labels.importLabel}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleImportFile(file);
            }}
          />
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus strokeWidth={2} className="h-4 w-4" />
            {labels.newPrompt}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border-subtle px-6 py-3">
        <div className="relative">
          <Search
            strokeWidth={1.7}
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.searchPlaceholder}
            className="w-full rounded-lg border border-border-subtle bg-bg-primary py-1.5 pl-8 pr-3 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-primary"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {(status === "loading" || extractStatus === "running") && prompts.length === 0 && (
          <p className="py-12 text-center text-[13px] text-text-tertiary">
            {extractStatus === "running" ? labels.extracting : labels.loading}
          </p>
        )}
        {status === "error" && (
          <div className="py-12 text-center text-[13px] text-red-600">
            {error}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-text-primary hover:bg-bg-surface-card"
              >
                {labels.retry}
              </button>
            </div>
          </div>
        )}
        {status === "ready" && extractStatus !== "running" && visiblePrompts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[14px] text-text-secondary">
              {prompts.length === 0 ? labels.emptyNone : labels.emptyFiltered}
            </p>
            {prompts.length === 0 && (
              <p className="mt-1 max-w-sm text-[12px] text-text-tertiary">{labels.emptyHint}</p>
            )}
          </div>
        )}
        {selectedIds.size > 0 && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-accent-primary/40 bg-accent-primary-light px-3 py-2">
            <span className="text-[12px] font-medium text-accent-primary">
              {(labels.selectedCount ?? "{n} selected").replace("{n}", String(selectedIds.size))}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleBulkDelete()}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <Trash2 strokeWidth={1.7} className="h-3.5 w-3.5" />
                {labels.deleteSelected ?? "Delete"}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md px-2.5 py-1 text-[12px] text-text-secondary hover:bg-bg-tertiary"
              >
                {labels.clearSelection ?? "Cancel"}
              </button>
            </div>
          </div>
        )}
        {visiblePrompts.length > 0 && (
          <ul className="flex flex-col gap-2">
            {visiblePrompts.map((prompt) => {
              const selected = prompt.id != null && selectedIds.has(prompt.id);
              return (
              <li
                key={prompt.id}
                className={`group flex cursor-pointer items-start gap-3 rounded-xl border bg-bg-surface-card p-3.5 transition-shadow hover:shadow-[0_4px_14px_rgba(0,0,0,0.05)] ${
                  selected ? "border-accent-primary" : "border-border-subtle"
                }`}
                onClick={() => openEdit(prompt)}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (prompt.id != null) toggleSelect(prompt.id);
                  }}
                  className={`mt-0.5 shrink-0 rounded p-0.5 transition-opacity ${
                    selected ? "text-accent-primary opacity-100" : "text-text-tertiary opacity-0 group-hover:opacity-100"
                  }`}
                  aria-label={labels.selectAria ?? "Select"}
                >
                  {selected ? (
                    <CheckSquare strokeWidth={1.7} className="h-4 w-4" />
                  ) : (
                    <Square strokeWidth={1.7} className="h-4 w-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-text-primary">
                    {prompt.title}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-text-secondary">
                    {prompt.body}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy(prompt);
                    }}
                    className="rounded p-1.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                    aria-label={labels.copy}
                  >
                    <Copy strokeWidth={1.7} className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(prompt.id);
                    }}
                    className="rounded p-1.5 text-text-tertiary hover:bg-red-50 hover:text-red-600"
                    aria-label={labels.deleteAria}
                  >
                    <Trash2 strokeWidth={1.7} className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        )}

        {/* 提示词广场 (Plaza): daily picks + my adopted shelf + the supermarket */}
        {showPlaza && (
          <section className="mt-8 border-t border-border-subtle pt-6">
            <h3 className="text-[13px] font-medium text-text-primary">{labels.plazaTitle}</h3>
            <p className="mt-1 text-[12px] text-text-tertiary">{labels.plazaSubtitle}</p>

            {plazaDaily.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-accent-primary">
                    {labels.plazaDaily}
                  </span>
                  <span className="text-[11px] text-text-tertiary">{labels.plazaDailyHint}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {plazaDaily.map((p) => (
                    <PlazaCard
                      key={p.id}
                      prompt={p}
                      labels={labels}
                      adopted={adoptedSet.has(p.id)}
                      onUse={() => usePlazaPrompt(p)}
                      onAdopt={
                        onPlazaAdoptToggle
                          ? () => onPlazaAdoptToggle(p.id, !adoptedSet.has(p.id))
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 我的广场: prompts the user adopted from the supermarket */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium text-text-secondary">{labels.myPlaza}</span>
                {selectedPlazaIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-accent-primary">
                      {(labels.selectedCount ?? "{n} selected").replace("{n}", String(selectedPlazaIds.size))}
                    </span>
                    <button
                      type="button"
                      onClick={handleBulkRemovePlaza}
                      className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:opacity-90"
                    >
                      <Trash2 strokeWidth={1.7} className="h-3 w-3" />
                      {labels.deleteSelected ?? "Delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlazaIds(new Set())}
                      className="rounded-md px-2 py-0.5 text-[11px] text-text-secondary hover:bg-bg-tertiary"
                    >
                      {labels.clearSelection ?? "Cancel"}
                    </button>
                  </div>
                )}
              </div>
              {adoptedItems.length === 0 ? (
                <p className="text-[11.5px] text-text-tertiary">{labels.myPlazaEmpty}</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {adoptedItems.map((p) => {
                    const sel = selectedPlazaIds.has(p.id);
                    return (
                      <div key={p.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => togglePlazaSelect(p.id)}
                          aria-label={labels.selectAria ?? "Select"}
                          className={`absolute left-1.5 top-1.5 z-10 rounded p-0.5 transition-opacity ${
                            sel ? "text-accent-primary opacity-100" : "text-text-tertiary opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          {sel ? (
                            <CheckSquare strokeWidth={1.7} className="h-4 w-4" />
                          ) : (
                            <Square strokeWidth={1.7} className="h-4 w-4" />
                          )}
                        </button>
                        <div className={sel ? "rounded-xl ring-1 ring-accent-primary" : ""}>
                          <PlazaCard
                            prompt={p}
                            labels={labels}
                            adopted
                            onUse={() => usePlazaPrompt(p)}
                            onAdopt={
                              onPlazaAdoptToggle ? () => onPlazaAdoptToggle(p.id, false) : undefined
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 提示词超市: full catalog grouped by big-category */}
            {supermarket.length > 0 && (
              <div className="mt-6 border-t border-border-subtle pt-5">
                <h4 className="text-[13px] font-medium text-text-primary">
                  {labels.supermarketTitle}
                </h4>
                <p className="mt-1 text-[12px] text-text-tertiary">{labels.supermarketSubtitle}</p>
                {supermarket.map((group) => (
                  <div key={group.category} className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                      {group.category}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {group.prompts.map((p) => (
                        <PlazaCard
                          key={p.id}
                          prompt={p}
                          labels={labels}
                          adopted={adoptedSet.has(p.id)}
                          onUse={() => usePlazaPrompt(p)}
                          onAdopt={
                            onPlazaAdoptToggle
                              ? () => onPlazaAdoptToggle(p.id, !adoptedSet.has(p.id))
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Editor drawer */}
      {editor.open && (
        <div className="absolute inset-0 z-40 flex">
          <button
            type="button"
            aria-label={labels.closeEditor}
            className="flex-1 bg-black/20"
            onClick={closeEditor}
          />
          <div className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border-subtle bg-bg-primary shadow-xl">
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
              <h3 className="text-[14px] font-medium text-text-primary">
                {editor.isNew ? labels.editorNew : labels.editorEdit}
              </h3>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded p-1 text-text-tertiary hover:bg-bg-surface-card hover:text-text-primary"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3 px-5 py-4">
              <label className="text-[12px] font-medium text-text-secondary">
                {labels.fieldTitle}
                <input
                  value={editor.title}
                  onChange={(event) =>
                    setEditor((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder={labels.titlePlaceholder}
                  className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-[13px] font-normal text-text-primary outline-none focus:border-accent-primary"
                />
              </label>
              <label className="flex flex-1 flex-col text-[12px] font-medium text-text-secondary">
                {labels.fieldBody}
                <textarea
                  value={editor.body}
                  onChange={(event) =>
                    setEditor((prev) => ({ ...prev, body: event.target.value }))
                  }
                  rows={12}
                  placeholder={labels.bodyPlaceholder}
                  className="mt-1 w-full flex-1 resize-y rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 font-mono text-[13px] font-normal leading-relaxed text-text-primary outline-none focus:border-accent-primary"
                />
              </label>
              {!editor.isNew && editor.sourceConversationId !== null && onOpenConversation && (
                <button
                  type="button"
                  onClick={() => onOpenConversation(editor.sourceConversationId as number)}
                  className="inline-flex items-center gap-1.5 self-start text-[12px] text-accent-primary hover:underline"
                >
                  <ExternalLink strokeWidth={1.7} className="h-3.5 w-3.5" />
                  {labels.openSource}
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-5 py-3">
              {!editor.isNew && editor.id !== null ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(editor.id as number)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50"
                >
                  <Trash2 strokeWidth={1.7} className="h-4 w-4" />
                  {labels.deleteBtn}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-surface-card"
                >
                  {labels.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-accent-primary px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                >
                  {labels.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text-primary px-4 py-2 text-[13px] text-bg-primary shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function PlazaCard({
  prompt,
  labels,
  onUse,
  adopted = false,
  onAdopt,
}: {
  prompt: PlazaPrompt;
  labels: DashboardLabels["prompts"];
  onUse: () => void;
  adopted?: boolean;
  onAdopt?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onUse}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onUse();
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border border-border-subtle bg-bg-surface-card p-3.5 transition-shadow hover:shadow-[0_4px_14px_rgba(0,0,0,0.05)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="truncate text-[13px] font-medium text-text-primary">{prompt.title}</div>
        <span className="shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] text-text-tertiary">
          {prompt.category}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-text-secondary">
        {prompt.body}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {prompt.sourceUrl ? (
          <a
            href={prompt.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10.5px] text-text-tertiary hover:text-text-primary hover:underline"
          >
            <ExternalLink strokeWidth={1.7} className="h-3 w-3" />
            {labels.plazaSourcePrefix}
            {prompt.source}
          </a>
        ) : (
          <span className="text-[10.5px] text-text-tertiary">
            {labels.plazaSourcePrefix}
            {prompt.source}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          {onAdopt && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAdopt();
              }}
              aria-pressed={adopted}
              className={`rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors ${
                adopted
                  ? "border-accent-primary bg-accent-primary-light text-accent-primary"
                  : "border-border-subtle text-text-secondary hover:bg-bg-tertiary"
              }`}
            >
              {adopted ? labels.adopted : labels.adopt}
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onUse();
            }}
            className="rounded-lg border border-border-subtle px-2.5 py-1 text-[11.5px] text-text-primary opacity-0 transition-opacity hover:bg-bg-tertiary group-hover:opacity-100"
          >
            {labels.plazaUse}
          </button>
        </div>
      </div>
    </div>
  );
}
