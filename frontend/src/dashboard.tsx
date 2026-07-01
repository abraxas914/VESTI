import "~style.css";
import "katex/dist/katex.min.css";

import { useCallback, useEffect, useState } from "react";
import type { UiThemeMode } from "~lib/types";
import {
  connectObsidianVault,
  exportNoteToObsidian,
  getObsidianVaultStatus,
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
} from "~lib/services/storageService";
import { VestiDashboard as VestiDashboardShell } from "~vendor/vesti-ui";

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
  const { t } = useI18n();
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

  return (
    <VestiDashboardShell
      logoSrc={LOGO_BASE64}
      rootClassName="vesti-options"
      labels={t.dashboard}
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
      }}
    />
  );
}
