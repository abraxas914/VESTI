import "~style.css";
import "katex/dist/katex.min.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UiThemeMode } from "~lib/types";
import {
  buildPlazaPrompts,
  getCuratedCategories,
  resolveCuratedPrompts,
} from "~lib/promptPlaza/commonPrompts";
import {
  getAdoptedPlazaIds,
  setPlazaAdopted,
  setPlazaAdoptedMany,
  subscribeAdoptedPlazaIds,
} from "~lib/promptPlaza/plazaCollectionService";
import { computeAiti } from "~lib/aiti/computeAiti";
import { computeLearn } from "~lib/learn/computeLearn";
import { getAllSummaries } from "~lib/services/storageService";
import type { AitiProfile, LearnProfile } from "~vendor/vesti-ui";
import {
  connectObsidianVault,
  exportNoteToObsidian,
  getObsidianVaultStatus,
  writeMarkdownToVault,
} from "~lib/services/obsidianVaultService";
import {
  applyUiTheme,
  getUiSettings,
  initializeUiTheme,
  setUiThemeMode,
  subscribeUiSettings,
} from "~lib/services/uiSettingsService";
import { LOGO_BASE64 } from "~lib/ui/logo";
import { I18nProvider, useI18n } from "~lib/i18n";
import {
  getConversations,
  getTopics,
  runGardener,
  getRelatedConversations,
  getAllEdges,
  getMessages,
  getAnnotationsByConversation,
  saveAnnotation,
  deleteAnnotation,
  exportAnnotationToNote,
  exportAnnotationToNotion,
  updateConversation,
  updateConversationTitle,
  deleteConversation,
  renameFolderTag,
  moveFolderTag,
  removeFolderTag,
  askKnowledgeBase,
  runRoundtable,
  exportConversationToNotion,
  createExploreSession,
  listExploreSessions,
  getExploreSession,
  getExploreMessages,
  deleteExploreSession,
  renameExploreSession,
  updateExploreMessageContext,
  getSummary,
  generateSummary,
  getNotes,
  saveNote,
  updateNote,
  deleteNote,
  importObsidianDirectory,
  importObsidianZip,
  getNoteAsset,
  getStorageUsage,
  exportData,
  clearAllData,
  listPrompts,
  searchPrompts,
  createPrompt,
  updatePrompt,
  deletePrompt,
  togglePromptFavorite,
  incrementPromptUsage,
  extractPromptsFromLibrary,
  completePrompt,
} from "~lib/services/storageService";
import { VestiDashboard as VestiDashboardShell } from "~vendor/vesti-ui";
import { DashboardOnboardingGuide } from "./dashboard/DashboardOnboardingGuide";

type ThemeSyncStatus = "idle" | "syncing" | "error";

void initializeUiTheme().catch(() => {
  // Keep default light theme tokens if initialization fails.
});

function getThemeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export default function VestiDashboardPage() {
  return (
    <I18nProvider>
      <VestiDashboardInner />
    </I18nProvider>
  );
}

function VestiDashboardInner() {
  const { t, locale } = useI18n();
  const [themeMode, setThemeMode] = useState<UiThemeMode>(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const [themeSyncStatus, setThemeSyncStatus] = useState<ThemeSyncStatus>("idle");
  const [themeSyncMessage, setThemeSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getUiSettings()
      .then((settings) => {
        if (cancelled) return;
        setThemeMode(settings.themeMode);
        applyUiTheme(settings.themeMode);
        setThemeSyncStatus("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setThemeSyncStatus("error");
        setThemeSyncMessage(
          getThemeErrorMessage(error, t.dashboard.settings.themeUpdateFailed)
        );
      });

    const unsubscribe = subscribeUiSettings((settings) => {
      if (cancelled) return;
      setThemeMode(settings.themeMode);
      applyUiTheme(settings.themeMode);
      setThemeSyncStatus("idle");
      setThemeSyncMessage(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [t]);

  const handleToggleTheme = useCallback(async () => {
    const previous = themeMode;
    const next: UiThemeMode = previous === "dark" ? "light" : "dark";

    setThemeMode(next);
    applyUiTheme(next);
    setThemeSyncStatus("syncing");
    setThemeSyncMessage(null);

    try {
      const saved = await setUiThemeMode(next);
      setThemeMode(saved.themeMode);
      applyUiTheme(saved.themeMode);
      setThemeSyncStatus("idle");
      setThemeSyncMessage(null);
    } catch (error) {
      setThemeMode(previous);
      applyUiTheme(previous);
      setThemeSyncStatus("error");
      setThemeSyncMessage(
        getThemeErrorMessage(error, t.dashboard.settings.themeUpdateFailed)
      );
    }
  }, [themeMode, t]);

  const lang = locale === "zh" ? "zh" : "en";

  // 提示词广场 + 提示词超市: bundled curated catalog, localized. Daily picks are
  // date-seeded; the supermarket is the full catalog grouped by big-category;
  // adopted ids are the user's personal shelf (chrome.storage.local).
  const [adoptedIds, setAdoptedIds] = useState<string[]>([]);
  useEffect(() => {
    void getAdoptedPlazaIds().then(setAdoptedIds);
    return subscribeAdoptedPlazaIds(setAdoptedIds);
  }, []);

  const plaza = useMemo(() => {
    const daily = buildPlazaPrompts(lang, Date.now()).filter((p) => p.featured);
    const resolved = resolveCuratedPrompts(lang);
    const supermarket = getCuratedCategories(lang).map((category) => ({
      category,
      prompts: resolved.filter((p) => p.category === category),
    }));
    return { daily, supermarket, adoptedIds };
  }, [lang, adoptedIds]);

  const handlePlazaAdoptToggle = useCallback((id: string, adopt: boolean) => {
    void setPlazaAdopted(id, adopt).then(setAdoptedIds);
  }, []);

  const handlePlazaAdoptToggleMany = useCallback((ids: string[], adopt: boolean) => {
    void setPlazaAdoptedMany(ids, adopt).then(setAdoptedIds);
  }, []);

  // AITI (个人内向探索): computed locally from stored summaries, with a
  // messages fallback so even sparse data produces a confidence-graded profile.
  // Recomputed when the dataset signals a change (VESTI_DATA_UPDATED).
  const [aiti, setAiti] = useState<AitiProfile | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const recompute = () => {
      void Promise.all([getAllSummaries(), getConversations()])
        .then(async ([summaries, conversations]) => {
          const messages = (
            await Promise.all(conversations.map((c) => getMessages(c.id)))
          ).flat();
          if (!cancelled) setAiti(computeAiti(summaries, { conversations, messages }));
        })
        .catch(() => {
          if (!cancelled) setAiti({ available: false, sampleSize: 0, confidence: "low", axes: [], obsessions: [] });
        });
    };
    recompute();
    const onMsg = (msg: unknown) => {
      if (msg && typeof msg === "object" && (msg as { type?: string }).type === "VESTI_DATA_UPDATED") {
        recompute();
      }
    };
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onMsg);
    }
    return () => {
      cancelled = true;
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onMsg);
      }
    };
  }, []);

  // Learn (学习): local curriculum view from summaries + topics + conversations,
  // with a messages fallback for sparse data.
  const [learn, setLearn] = useState<LearnProfile | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const recompute = () => {
      void Promise.all([getAllSummaries(), getTopics(), getConversations()])
        .then(async ([summaries, topics, conversations]) => {
          const messages = (
            await Promise.all(conversations.map((c) => getMessages(c.id)))
          ).flat();
          if (!cancelled) setLearn(computeLearn(summaries, topics, conversations, { messages, labels: t.dashboard.learn }));
        })
        .catch(() => {
          if (!cancelled) {
            setLearn({ available: false, sampleSize: 0, confidence: "low", domains: [], glossary: [], openLoops: [] });
          }
        });
    };
    recompute();
    const onMsg = (msg: unknown) => {
      if (msg && typeof msg === "object" && (msg as { type?: string }).type === "VESTI_DATA_UPDATED") {
        recompute();
      }
    };
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onMsg);
    }
    return () => {
      cancelled = true;
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onMsg);
      }
    };
  }, []);

  return (
    <>
      <VestiDashboardShell
      logoSrc={LOGO_BASE64}
      rootClassName="vesti-options"
      labels={t.dashboard}
      plaza={plaza}
      onPlazaAdoptToggle={handlePlazaAdoptToggle}
      onPlazaAdoptToggleMany={handlePlazaAdoptToggleMany}
      aiti={aiti}
      learn={learn}
      themeMode={themeMode}
      onToggleTheme={handleToggleTheme}
      themeSyncStatus={themeSyncStatus}
      themeSyncMessage={themeSyncMessage}
      storage={{
        getConversations,
        getTopics,
        runGardener,
        getRelatedConversations,
        getAllEdges,
        getMessages,
        getAnnotationsByConversation,
        saveAnnotation,
        deleteAnnotation,
        exportAnnotationToNote,
        exportAnnotationToNotion,
        updateConversation,
        updateConversationTitle,
        deleteConversation,
        renameFolderTag,
        moveFolderTag,
        removeFolderTag,
        askKnowledgeBase,
        runRoundtable,
        exportConversationToNotion,
        // Obsidian export runs in-page (File System Access). Connect the vault in
        // Settings first; writeMarkdownToVault throws a clear error if it isn't —
        // we deliberately don't pre-await a status check here (that would consume
        // the user gesture that a first-time directory picker needs).
        exportConversationToObsidian: async (input: { title: string; markdown: string }) =>
          writeMarkdownToVault({
            title: input.title,
            frontmatter: { source: "VESTI" },
            body: input.markdown,
          }),
        createExploreSession,
        listExploreSessions,
        getExploreSession,
        getExploreMessages,
        deleteExploreSession,
        renameExploreSession,
        updateExploreMessageContext,
        getSummary,
        generateSummary,
        getNotes,
        saveNote,
        updateNote,
        deleteNote,
        getObsidianVaultStatus,
        connectObsidianVault,
        exportNoteToObsidian,
        importObsidianDirectory,
        importObsidianZip,
        getNoteAsset,
        getStorageUsage,
        exportData,
        clearAllData,
        listPrompts,
        searchPrompts,
        createPrompt,
        updatePrompt,
        deletePrompt,
        togglePromptFavorite,
        incrementPromptUsage,
        extractPromptsFromLibrary,
        completePrompt,
      }}
      />
      <DashboardOnboardingGuide locale={locale} />
    </>
  );
}
