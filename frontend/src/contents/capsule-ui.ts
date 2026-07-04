import type { PlasmoCSConfig } from "plasmo";
import { sendRequest } from "../lib/messaging/runtime";
import { getUiSettings } from "../lib/services/uiSettingsService";
import {
  DEFAULT_CAPSULE_SETTINGS,
  getCapsuleSettingsForHost,
  updateCapsuleSettingsForHost,
  type CapsuleAnchor,
  type CapsuleSettings,
  type CapsuleViewMode,
} from "../lib/services/capsuleSettingsService";
import {
  getPromptAssistSettingsForHost,
  subscribePromptAssistSettings,
} from "../lib/services/promptAssistSettingsService";
import {
  getComposerText,
  resolveComposer,
  resolveComposerFromEvent,
  setComposerText,
  type ComposerEl,
} from "../lib/contents/composerIo";
import { searchCuratedPrompts } from "../lib/promptPlaza/commonPrompts";

// A dock search result: either a saved prompt (has promptId) or a curated plaza
// prompt (fromPlaza). Both fill the composer; only saved ones track usage.
type PmResult = {
  title: string;
  body: string;
  promptId?: number;
  fromPlaza?: boolean;
};
import type { ActiveCaptureStatus, Platform, Prompt, UiThemeMode } from "../lib/types";
import { LOGO_BASE64 } from "../lib/ui/logo";
import { logger } from "../lib/utils/logger";
import { detectAndSetLanguage } from "../lib/services/languageSettingsService";
import { resolveLocale, type SupportedLocale } from "../lib/i18n/locales";

export const config: PlasmoCSConfig = {
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://chat.deepseek.com/*",
    "https://www.doubao.com/*",
    "https://chat.qwen.ai/*",
    "https://www.kimi.com/*",
    "https://kimi.com/*",
    "https://kimi.moonshot.cn/*",
    "https://yuanbao.tencent.com/*",
  ],
  run_at: "document_idle",
  all_frames: false,
};

type CapsuleRuntimeState =
  | "idle"
  | "mirroring"
  | "holding"
  | "ready_to_archive"
  | "archiving"
  | "saved"
  | "error";

type DragSource = "collapsed" | "expanded";

interface DragSession {
  active: boolean;
  pointerId: number | null;
  source: DragSource | null;
  canDrag: boolean;
  startedWithModifier: boolean;
  dragging: boolean;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

type CapsulePosition = Pick<CapsuleSettings, "anchor" | "offsetX" | "offsetY">;

const CAPSULE_ROOT_ID = "vesti-capsule-root";
const CAPSULE_Z_INDEX = 2147483646;
const POLL_INTERVAL_MS = 3000;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];
const DRAG_THRESHOLD_PX = 5;
const VIEWPORT_MARGIN = 8;
const COLLAPSED_SIZE = 43.2;
const LOGO_SIZE = 21.6;
const UI_SETTINGS_STORAGE_KEY = "vesti_ui_settings";
const CAPSULE_SETTINGS_STORAGE_KEY = "vesti_capsule_settings";
const POSITION_SYNC_GRACE_MS = 2000;
const CAPSULE_FONT_FACE_STYLE_ID = "vesti-capsule-font-face-style";
const FONT_UI_400_URL = new URL(
  "../../public/fonts/Lexend-UI-400.woff2",
  import.meta.url
).toString();
const FONT_UI_500_URL = new URL(
  "../../public/fonts/Lexend-UI-500.woff2",
  import.meta.url
).toString();
const FONT_UI_600_URL = new URL(
  "../../public/fonts/Lexend-UI-600.woff2",
  import.meta.url
).toString();
const FONT_UI_CJK_400_URL = new URL(
  "../../public/fonts/SourceHanSansSC-UI-400.woff2",
  import.meta.url
).toString();
const FONT_UI_CJK_500_URL = new URL(
  "../../public/fonts/SourceHanSansSC-UI-500.woff2",
  import.meta.url
).toString();
const FONT_UI_CJK_600_URL = new URL(
  "../../public/fonts/SourceHanSansSC-UI-500.woff2",
  import.meta.url
).toString();
const FONT_TITLE_400_URL = new URL(
  "../../public/fonts/Exposure-Title-400.woff2",
  import.meta.url
).toString();
const PRIMARY_ROLLOUT_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "chat.deepseek.com",
  "chat.qwen.ai",
  "www.doubao.com",
  "www.kimi.com",
  "kimi.com",
  "kimi.moonshot.cn",
  "yuanbao.tencent.com",
]);

interface PlatformTone {
  bg: string;
  text: string;
  border: string;
}

const PLATFORM_BY_HOST: Record<string, Platform> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "claude.ai": "Claude",
  "gemini.google.com": "Gemini",
  "chat.deepseek.com": "DeepSeek",
  "chat.qwen.ai": "Qwen",
  "www.doubao.com": "Doubao",
  "www.kimi.com": "Kimi",
  "kimi.com": "Kimi",
  "kimi.moonshot.cn": "Kimi",
  "yuanbao.tencent.com": "Yuanbao",
};

const PLATFORM_TONE: Record<UiThemeMode, Record<Platform, PlatformTone>> = {
  light: {
    ChatGPT: {
      bg: "hsl(146 46% 93%)",
      text: "hsl(146 52% 28%)",
      border: "hsl(146 32% 76%)",
    },
    Claude: {
      bg: "hsl(22 86% 93%)",
      text: "hsl(20 54% 42%)",
      border: "hsl(21 55% 79%)",
    },
    Gemini: {
      bg: "hsl(254 86% 95%)",
      text: "hsl(252 45% 47%)",
      border: "hsl(252 52% 82%)",
    },
    DeepSeek: {
      bg: "hsl(222 90% 95%)",
      text: "hsl(222 62% 44%)",
      border: "hsl(222 63% 81%)",
    },
    Qwen: {
      bg: "hsl(242 88% 95%)",
      text: "hsl(242 56% 46%)",
      border: "hsl(242 58% 82%)",
    },
    Doubao: {
      bg: "hsl(210 100% 95%)",
      text: "hsl(212 66% 44%)",
      border: "hsl(211 69% 81%)",
    },
    Kimi: {
      bg: "hsl(222 20% 93%)",
      text: "hsl(222 15% 28%)",
      border: "hsl(222 12% 74%)",
    },
    Yuanbao: {
      bg: "hsl(173 62% 93%)",
      text: "hsl(173 58% 26%)",
      border: "hsl(173 35% 75%)",
    },
  },
  dark: {
    ChatGPT: {
      bg: "hsl(158 33% 18%)",
      text: "hsl(150 50% 66%)",
      border: "hsl(154 30% 33%)",
    },
    Claude: {
      bg: "hsl(18 44% 20%)",
      text: "hsl(18 58% 66%)",
      border: "hsl(18 33% 34%)",
    },
    Gemini: {
      bg: "hsl(252 35% 20%)",
      text: "hsl(252 80% 76%)",
      border: "hsl(252 34% 35%)",
    },
    DeepSeek: {
      bg: "hsl(224 44% 20%)",
      text: "hsl(222 88% 75%)",
      border: "hsl(223 35% 35%)",
    },
    Qwen: {
      bg: "hsl(242 42% 20%)",
      text: "hsl(242 88% 76%)",
      border: "hsl(242 33% 35%)",
    },
    Doubao: {
      bg: "hsl(211 46% 20%)",
      text: "hsl(211 90% 76%)",
      border: "hsl(211 37% 35%)",
    },
    Kimi: {
      bg: "hsl(222 20% 16%)",
      text: "hsl(222 18% 68%)",
      border: "hsl(222 14% 32%)",
    },
    Yuanbao: {
      bg: "hsl(173 30% 16%)",
      text: "hsl(173 52% 62%)",
      border: "hsl(173 28% 31%)",
    },
  },
};

const FALLBACK_PLATFORM_TONE: Record<UiThemeMode, PlatformTone> = {
  light: {
    bg: "hsl(220 20% 93%)",
    text: "hsl(220 16% 36%)",
    border: "hsl(220 20% 83%)",
  },
  dark: {
    bg: "hsl(220 17% 22%)",
    text: "hsl(220 19% 73%)",
    border: "hsl(220 16% 36%)",
  },
};

type CapsuleLocale = SupportedLocale;

const capsuleEn = {
  unavailable: "Unavailable",
  mirroring: "Mirroring",
  held: "Held",
  ready: "Ready",
  archiving: "Archiving...",
  saved: "Saved",
  actionFailed: "Action failed",
  archiveNow: "Archive now",
  mirrorModeHint: "Mirror mode saves content automatically.",
  archiveCompleted: "Archive completed.",
  vestiCapsule: "Vesti capsule",
  openVestiCapsule: "Open Vesti capsule",
  openVestiDock: "Open Vesti Dock",
  openDock: "Open Dock",
  collapseAria: "Collapse capsule",
  collapseTitle: "Collapse",
  waitingForStatus: "Waiting for status...",
  pm: {
    heading: "Prompt Assistant",
    optimize: "Optimize",
    optimizing: "Optimizing...",
    continue: "Continue",
    continuing: "Continuing...",
    searchPlaceholder: "Search your prompts + plaza picks by trigger/keyword...",
    empty: "No prompts yet.",
    noResults: "No match.",
    noDraft: "Type something in the chat box first.",
    fill: "Fill",
    cancel: "Cancel",
    failed: "Could not generate. Try again.",
    offlineHint: "Connect a model in Settings to optimize prompts.",
    hint: "Type to match · Enter to fill",
    plazaBadge: "Plaza",
  },
  errorMessages: {
    ARCHIVE_MODE_DISABLED: "Archive is disabled in mirror mode.",
    ACTIVE_TAB_UNSUPPORTED: "Current tab host is unsupported.",
    ACTIVE_TAB_UNAVAILABLE: "Active tab is unavailable.",
    TRANSIENT_NOT_FOUND: "No thread snapshot available yet.",
    missing_conversation_id: "Waiting for stable conversation URL.",
    empty_payload: "No parsed messages available to archive.",
    storage_limit_blocked: "Storage is full. Export or clean up first.",
    persist_failed: "Archive failed during persistence.",
    FORCE_ARCHIVE_FAILED: "Archive action failed. Retry.",
    content_unreachable: "Capture context is temporarily unreachable.",
  },
};

const capsuleZh = {
  unavailable: "不可用",
  mirroring: "正在镜像",
  held: "已暂存",
  ready: "就绪",
  archiving: "正在归档...",
  saved: "已保存",
  actionFailed: "操作失败",
  archiveNow: "立即归档",
  mirrorModeHint: "镜像模式会自动保存内容。",
  archiveCompleted: "归档完成。",
  vestiCapsule: "Vesti 胶囊",
  openVestiCapsule: "打开 Vesti 胶囊",
  openVestiDock: "打开 Vesti 面板",
  openDock: "打开面板",
  collapseAria: "收起胶囊",
  collapseTitle: "收起",
  waitingForStatus: "正在获取状态…",
  pm: {
    heading: "提示词助手",
    optimize: "优化",
    optimizing: "优化中...",
    continue: "续写",
    continuing: "续写中...",
    searchPlaceholder: "使用唤醒词/关键词 搜索常用提示词/优质提示词（来自提示词广场）",
    empty: "暂无提示词。",
    noResults: "无匹配。",
    noDraft: "请先在对话输入框中输入内容。",
    fill: "填入",
    cancel: "取消",
    failed: "生成失败，请重试。",
    offlineHint: "在设置中连接模型后即可优化提示词。",
    hint: "输入即匹配 · 回车填入",
    plazaBadge: "广场",
  },
  errorMessages: {
    ARCHIVE_MODE_DISABLED: "镜像模式下归档已禁用。",
    ACTIVE_TAB_UNSUPPORTED: "当前标签页不受支持。",
    ACTIVE_TAB_UNAVAILABLE: "活动标签页不可用。",
    TRANSIENT_NOT_FOUND: "尚无可用对话快照。",
    missing_conversation_id: "正在等待稳定的对话 URL。",
    empty_payload: "没有可归档的解析消息。",
    storage_limit_blocked: "存储已满。请先导出或清理数据。",
    persist_failed: "归档持久化失败。",
    FORCE_ARCHIVE_FAILED: "归档操作失败。请重试。",
    content_unreachable: "捕获上下文暂时无法访问。",
  },
} as const;

const capsuleJa: typeof capsuleEn = {
  unavailable: "利用不可",
  mirroring: "ミラーリング中",
  held: "保留中",
  ready: "準備完了",
  archiving: "アーカイブ中...",
  saved: "保存しました",
  actionFailed: "操作に失敗しました",
  archiveNow: "今すぐアーカイブ",
  mirrorModeHint: "ミラーモードは内容を自動的に保存します。",
  archiveCompleted: "アーカイブが完了しました。",
  vestiCapsule: "Vesti カプセル",
  openVestiCapsule: "Vesti カプセルを開く",
  openVestiDock: "Vesti ドックを開く",
  openDock: "ドックを開く",
  collapseAria: "カプセルを折りたたむ",
  collapseTitle: "折りたたむ",
  waitingForStatus: "ステータスを取得中…",
  pm: {
    heading: "プロンプトアシスタント",
    optimize: "最適化",
    optimizing: "最適化中...",
    continue: "続きを生成",
    continuing: "生成中...",
    searchPlaceholder: "トリガー/キーワードで、あなたのプロンプトと広場のおすすめを検索...",
    empty: "まだプロンプトがありません。",
    noResults: "一致なし。",
    noDraft: "先にチャット入力欄に何か入力してください。",
    fill: "入力",
    cancel: "キャンセル",
    failed: "生成できませんでした。もう一度お試しください。",
    offlineHint: "設定でモデルを接続するとプロンプトを最適化できます。",
    hint: "入力すると一致 · Enter で入力",
    plazaBadge: "広場",
  },
  errorMessages: {
    ARCHIVE_MODE_DISABLED: "ミラーモードではアーカイブは無効です。",
    ACTIVE_TAB_UNSUPPORTED: "現在のタブのホストはサポートされていません。",
    ACTIVE_TAB_UNAVAILABLE: "アクティブなタブを利用できません。",
    TRANSIENT_NOT_FOUND: "利用可能な会話スナップショットがまだありません。",
    missing_conversation_id: "安定した会話 URL を待っています。",
    empty_payload: "アーカイブできる解析済みメッセージがありません。",
    storage_limit_blocked: "ストレージがいっぱいです。まずエクスポートまたは整理してください。",
    persist_failed: "アーカイブの保存中に失敗しました。",
    FORCE_ARCHIVE_FAILED: "アーカイブ操作に失敗しました。再試行してください。",
    content_unreachable: "キャプチャコンテキストに一時的にアクセスできません。",
  },
};

const capsuleKo: typeof capsuleEn = {
  unavailable: "사용 불가",
  mirroring: "미러링 중",
  held: "보류됨",
  ready: "준비됨",
  archiving: "보관 중...",
  saved: "저장됨",
  actionFailed: "작업 실패",
  archiveNow: "지금 보관",
  mirrorModeHint: "미러 모드는 콘텐츠를 자동으로 저장합니다.",
  archiveCompleted: "보관이 완료되었습니다.",
  vestiCapsule: "Vesti 캡슐",
  openVestiCapsule: "Vesti 캡슐 열기",
  openVestiDock: "Vesti 독 열기",
  openDock: "독 열기",
  collapseAria: "캡슐 접기",
  collapseTitle: "접기",
  waitingForStatus: "상태를 가져오는 중…",
  pm: {
    heading: "프롬프트 어시스턴트",
    optimize: "최적화",
    optimizing: "최적화 중...",
    continue: "이어쓰기",
    continuing: "생성 중...",
    searchPlaceholder: "트리거/키워드로 내 프롬프트와 광장 추천을 검색...",
    empty: "아직 프롬프트가 없습니다.",
    noResults: "일치 항목 없음.",
    noDraft: "먼저 채팅 입력창에 내용을 입력하세요.",
    fill: "채우기",
    cancel: "취소",
    failed: "생성하지 못했습니다. 다시 시도하세요.",
    offlineHint: "설정에서 모델을 연결하면 프롬프트를 최적화할 수 있습니다.",
    hint: "입력하면 일치 · Enter로 채우기",
    plazaBadge: "광장",
  },
  errorMessages: {
    ARCHIVE_MODE_DISABLED: "미러 모드에서는 보관이 비활성화됩니다.",
    ACTIVE_TAB_UNSUPPORTED: "현재 탭 호스트는 지원되지 않습니다.",
    ACTIVE_TAB_UNAVAILABLE: "활성 탭을 사용할 수 없습니다.",
    TRANSIENT_NOT_FOUND: "아직 사용 가능한 대화 스냅샷이 없습니다.",
    missing_conversation_id: "안정적인 대화 URL을 기다리는 중입니다.",
    empty_payload: "보관할 분석된 메시지가 없습니다.",
    storage_limit_blocked: "저장 공간이 가득 찼습니다. 먼저 내보내거나 정리하세요.",
    persist_failed: "보관 저장 중 실패했습니다.",
    FORCE_ARCHIVE_FAILED: "보관 작업에 실패했습니다. 다시 시도하세요.",
    content_unreachable: "캡처 컨텍스트에 일시적으로 접근할 수 없습니다.",
  },
};

const capsuleTranslations: Record<CapsuleLocale, typeof capsuleEn> = {
  en: capsuleEn,
  zh: capsuleZh,
  ja: capsuleJa,
  ko: capsuleKo,
};

let capsuleLocale: CapsuleLocale = "en";
let capsuleT = capsuleTranslations.en;

async function initCapsuleLocale(): Promise<void> {
  try {
    const locale = await detectAndSetLanguage();
    capsuleLocale = resolveLocale(locale);
    capsuleT = capsuleTranslations[capsuleLocale] ?? capsuleTranslations.en;
  } catch {
    // Keep default English
  }
}

function capsuleResolveError(key: string): string {
  return (capsuleT.errorMessages as Record<string, string>)[key] ?? key;
}

const ERROR_MESSAGE_MAP: Record<string, string> = {
  ARCHIVE_MODE_DISABLED: "Archive is disabled in mirror mode.",
  ACTIVE_TAB_UNSUPPORTED: "Current tab host is unsupported.",
  ACTIVE_TAB_UNAVAILABLE: "Active tab is unavailable.",
  TRANSIENT_NOT_FOUND: "No thread snapshot available yet.",
  missing_conversation_id: "Waiting for stable conversation URL.",
  empty_payload: "No parsed messages available to archive.",
  storage_limit_blocked: "Storage is full. Export or clean up first.",
  persist_failed: "Archive failed during persistence.",
  FORCE_ARCHIVE_FAILED: "Archive action failed. Retry.",
  content_unreachable: "Capture context is temporarily unreachable.",
};

const normalizeThemeMode = (value: unknown): UiThemeMode =>
  value === "dark" ? "dark" : "light";

const parseThemeModeFromStorageValue = (value: unknown): UiThemeMode => {
  if (!value || typeof value !== "object") return "light";
  return normalizeThemeMode((value as { themeMode?: unknown }).themeMode);
};

const resolvePlatformTone = (
  platform: Platform | undefined,
  themeMode: UiThemeMode
): PlatformTone => {
  if (!platform) return FALLBACK_PLATFORM_TONE[themeMode];
  return PLATFORM_TONE[themeMode][platform] ?? FALLBACK_PLATFORM_TONE[themeMode];
};

const CAPSULE_FONT_FACE_STYLE_TEXT = `
@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_400_URL}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0100-024F, U+0259, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_500_URL}") format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0100-024F, U+0259, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_600_URL}") format("woff2");
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0100-024F, U+0259, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_CJK_400_URL}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  unicode-range: U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_CJK_500_URL}") format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  unicode-range: U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_CJK_600_URL}") format("woff2");
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  unicode-range: U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF;
}

@font-face {
  font-family: "Vesti Title Serif";
  src: url("${FONT_TITLE_400_URL}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  font-synthesis: weight;
  unicode-range: U+0000-00FF, U+0100-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F;
}
`;

const SHADOW_STYLE = `
:host {
  all: initial;
}

.capsule-shell {
  --capsule-bg: hsl(220 24% 95%);
  --capsule-bg2: hsl(220 23% 94%);
  --capsule-bg3: hsl(220 22% 92%);
  --capsule-border: hsl(220 17% 84%);
  --capsule-divider: hsl(220 20% 88%);
  --capsule-text1: hsl(224 15% 12%);
  --capsule-text2: hsl(224 9% 36%);
  --capsule-text3: hsl(224 7% 56%);
  --capsule-shadow: 0 8px 22px rgba(28, 20, 15, 0.1), 0 2px 6px rgba(28, 20, 15, 0.08);
  --capsule-shadow-hover: 0 10px 28px rgba(28, 20, 15, 0.12), 0 3px 9px rgba(28, 20, 15, 0.1);
  --status-held-bg: hsl(36 90% 43% / 0.12);
  --status-held-text: hsl(36 90% 43%);
  --status-held-border: hsl(36 90% 43% / 0.28);
  --status-live-bg: hsl(146 50% 38% / 0.12);
  --status-live-text: hsl(146 50% 38%);
  --status-live-border: hsl(146 50% 38% / 0.28);
  --status-ready-bg: hsl(265 83% 60% / 0.12);
  --status-ready-text: hsl(265 83% 60%);
  --status-ready-border: hsl(265 83% 60% / 0.28);
  --status-neutral-bg: hsl(224 9% 36% / 0.08);
  --status-neutral-text: hsl(224 9% 36%);
  --status-neutral-border: hsl(224 9% 36% / 0.2);
  --status-error-bg: hsl(0 55% 51% / 0.1);
  --status-error-text: hsl(0 55% 51%);
  --status-error-border: hsl(0 55% 51% / 0.24);
  --btn-primary-bg: hsl(224 15% 12%);
  --btn-primary-text: hsl(0 0% 100%);
  --btn-secondary-bg: hsl(220 23% 94%);
  --btn-secondary-text: hsl(224 9% 36%);
  --btn-secondary-border: hsl(220 17% 84%);
  --capsule-pill-bg: hsl(0 0% 100% / 0.82);
  --capsule-pill-bg-strong: hsl(0 0% 100% / 0.92);
  --capsule-pill-border: hsl(220 18% 80% / 0.92);
  --capsule-pill-shadow: 0 12px 28px rgba(28, 20, 15, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.42);
  --capsule-pill-shadow-subtle: 0 8px 18px rgba(28, 20, 15, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.34);
  position: fixed;
  pointer-events: auto;
  touch-action: none;
  z-index: ${CAPSULE_Z_INDEX};
  font-family: "Vesti Sans UI", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--capsule-text1);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  color-scheme: light;
}

.capsule-shell[data-theme="dark"] {
  --capsule-bg: hsl(0 0% 13%);
  --capsule-bg2: hsl(0 0% 16%);
  --capsule-bg3: hsl(0 0% 17%);
  --capsule-border: hsl(0 0% 25%);
  --capsule-divider: hsl(0 0% 20%);
  --capsule-text1: hsl(0 0% 96%);
  --capsule-text2: hsl(0 0% 78%);
  --capsule-text3: hsl(0 0% 62%);
  --capsule-shadow: 0 12px 30px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.3);
  --capsule-shadow-hover: 0 10px 28px rgba(0, 0, 0, 0.35), 0 3px 9px rgba(0, 0, 0, 0.25);
  --status-held-bg: hsl(40 85% 58% / 0.2);
  --status-held-text: hsl(40 85% 58%);
  --status-held-border: hsl(40 85% 58% / 0.34);
  --status-live-bg: hsl(145 55% 46% / 0.2);
  --status-live-text: hsl(145 55% 46%);
  --status-live-border: hsl(145 55% 46% / 0.34);
  --status-ready-bg: hsl(262 92% 76% / 0.2);
  --status-ready-text: hsl(262 92% 76%);
  --status-ready-border: hsl(262 92% 76% / 0.34);
  --status-neutral-bg: hsl(0 0% 78% / 0.12);
  --status-neutral-text: hsl(0 0% 78%);
  --status-neutral-border: hsl(0 0% 78% / 0.26);
  --status-error-bg: hsl(0 72% 60% / 0.2);
  --status-error-text: hsl(0 72% 60%);
  --status-error-border: hsl(0 72% 60% / 0.34);
  --btn-primary-bg: hsl(0 0% 96%);
  --btn-primary-text: hsl(0 0% 10%);
  --btn-secondary-bg: hsl(0 0% 16%);
  --btn-secondary-text: hsl(0 0% 78%);
  --btn-secondary-border: hsl(0 0% 25%);
  --capsule-pill-bg: hsl(0 0% 16% / 0.8);
  --capsule-pill-bg-strong: hsl(0 0% 19% / 0.88);
  --capsule-pill-border: hsl(0 0% 26% / 0.95);
  --capsule-pill-shadow: 0 14px 30px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  --capsule-pill-shadow-subtle: 0 10px 22px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color-scheme: dark;
}

.capsule-shell.is-dragging,
.capsule-shell.is-dragging * {
  cursor: grabbing !important;
  user-select: none;
}

.capsule-collapsed {
  width: ${COLLAPSED_SIZE}px;
  height: ${COLLAPSED_SIZE}px;
  border: 1px solid hsl(220 17% 84%);
  border-radius: 9999px;
  background: hsl(220 24% 95%);
  box-shadow: 0 3px 9px rgba(28, 20, 15, 0.16), 0 1px 2px rgba(28, 20, 15, 0.1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
  cursor: grab;
  font-family: inherit;
  padding: 0;
  touch-action: none;
}

.capsule-collapsed:hover {
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 6px 14px rgba(28, 20, 15, 0.2), 0 2px 5px rgba(28, 20, 15, 0.12);
}

.capsule-collapsed:active {
  transform: scale(0.97);
}

.capsule-logo {
  width: ${LOGO_SIZE}px;
  height: ${LOGO_SIZE}px;
  object-fit: contain;
  -webkit-user-drag: none;
  user-select: none;
}

.capsule-panel {
  width: min(296px, calc(100vw - 16px));
  box-sizing: border-box;
  border: 1px solid var(--capsule-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--capsule-bg) 88%, white 12%);
  box-shadow: var(--capsule-shadow);
  overflow: hidden;
  backdrop-filter: blur(18px) saturate(1.02);
}

.capsule-shell[data-view="collapsed"] .capsule-panel {
  display: none;
}

.capsule-shell[data-view="expanded"] .capsule-collapsed {
  display: none;
}

.capsule-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 11px 7px;
  border-bottom: 1px solid var(--capsule-divider);
}

.capsule-drag-handle {
  cursor: grab;
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.capsule-title {
  font-family: "Vesti Title Serif", "Tiempos Headline", "Tiempos Text", "Tiempos", ui-serif, "Apple-System-UI-Serif", "BlinkMacSystemFont", serif;
  font-size: 18px;
  line-height: 1.25;
  font-weight: 700;
  font-synthesis: weight;
  letter-spacing: -0.004em;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.capsule-platform {
  font-size: 9.5px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.2px;
  padding: 3px 9px;
  border-radius: 9999px;
  border: 1px solid transparent;
}

.capsule-collapse-btn {
  width: 24px;
  height: 24px;
  font-family: inherit;
  border: none;
  border-radius: 9999px;
  background: transparent;
  box-shadow: none;
  color: var(--capsule-text2);
  font-size: 11px;
  line-height: 1;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
}

.capsule-collapse-btn:hover {
  background: color-mix(in srgb, var(--capsule-text1) 8%, transparent 92%);
  color: var(--capsule-text1);
}

.capsule-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 0;
  margin: 8px 11px 0;
  padding: 0;
}

.capsule-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
}

.capsule-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
}

.capsule-status-badge[data-state="idle"] {
  color: var(--status-neutral-text);
}

.capsule-status-badge[data-state="holding"] {
  color: var(--status-held-text);
}

.capsule-status-badge[data-state="ready_to_archive"] {
  color: var(--status-ready-text);
}

.capsule-status-badge[data-state="mirroring"],
.capsule-status-badge[data-state="archiving"] {
  color: var(--status-live-text);
}

.capsule-status-badge[data-state="saved"] {
  color: var(--status-live-text);
}

.capsule-status-badge[data-state="error"] {
  color: var(--status-error-text);
}

.capsule-domain-label {
  font-size: 10.5px;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--capsule-text2);
  position: relative;
  max-width: 134px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 9px;
  margin-left: 2px;
}

.capsule-domain-label::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  width: 1px;
  height: 9px;
  transform: translateY(-50%);
  background: var(--capsule-divider);
}

.capsule-reason {
  min-height: 0;
  font-size: 10.5px;
  line-height: 1.3;
  color: var(--capsule-text2);
  margin: 8px 0 0;
  padding: 0 11px;
  text-align: center;
}

.capsule-reason:empty {
  display: none;
}

.capsule-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 8px 11px 12px;
}

.capsule-action-btn {
  min-height: 34px;
  font-family: inherit;
  border: 1px solid var(--btn-secondary-border);
  border-radius: 12px;
  padding: 0 10px;
  font-size: 11.5px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.005em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--capsule-bg2) 86%, white 14%);
  color: var(--btn-secondary-text);
  box-shadow: none;
  transition:
    opacity 120ms ease,
    transform 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease;
}

.capsule-action-btn:hover:enabled {
  opacity: 0.82;
  background: color-mix(in srgb, var(--capsule-bg3) 90%, white 10%);
}

.capsule-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.capsule-action-btn.is-primary {
  background: var(--btn-primary-bg);
  border-color: transparent;
  color: var(--btn-primary-text);
  box-shadow: none;
}

.capsule-action-btn:not(.is-primary) {
  border-color: var(--btn-secondary-border);
}

/* ---- prompt manager (lower dock section) ------------------------------- */
.capsule-pm {
  border-top: 1px solid var(--capsule-divider);
  padding: 9px 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capsule-pm[hidden] {
  display: none;
}

.capsule-pm-heading {
  font-size: 9.5px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--capsule-text3);
}

.capsule-pm-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.capsule-pm-btn {
  min-height: 30px;
  font-family: inherit;
  border: 1px solid var(--btn-secondary-border);
  border-radius: 10px;
  padding: 0 8px;
  font-size: 11.5px;
  line-height: 1;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--capsule-bg2) 86%, white 14%);
  color: var(--btn-secondary-text);
  transition: opacity 120ms ease, background-color 120ms ease;
}

.capsule-pm-btn:hover:enabled {
  opacity: 0.82;
  background: color-mix(in srgb, var(--capsule-bg3) 90%, white 10%);
}

.capsule-pm-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.capsule-pm-search {
  width: 100%;
  box-sizing: border-box;
  min-height: 30px;
  font-family: inherit;
  border: 1px solid var(--btn-secondary-border);
  border-radius: 10px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--capsule-text1);
  background: color-mix(in srgb, var(--capsule-bg2) 80%, white 20%);
  outline: none;
}

.capsule-pm-search::placeholder {
  color: var(--capsule-text3);
}

.capsule-pm-search:focus {
  border-color: color-mix(in srgb, var(--capsule-text1) 40%, transparent 60%);
}

.capsule-pm-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 168px;
  overflow-y: auto;
  margin: 0 -3px;
}

.capsule-pm-item {
  text-align: left;
  border: none;
  background: none;
  border-radius: 9px;
  padding: 6px 8px;
  cursor: pointer;
  font-family: inherit;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.capsule-pm-item:hover {
  background: color-mix(in srgb, var(--capsule-text1) 7%, transparent 93%);
}

.capsule-pm-item-title {
  font-size: 12px;
  line-height: 1.25;
  font-weight: 600;
  color: var(--capsule-text1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capsule-pm-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 9999px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.5;
  vertical-align: middle;
  color: var(--capsule-text2);
  background: color-mix(in srgb, var(--capsule-text1) 10%, transparent 90%);
}

.capsule-pm-item-body {
  font-size: 10.5px;
  line-height: 1.3;
  color: var(--capsule-text3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.capsule-pm-empty {
  font-size: 11px;
  line-height: 1.3;
  color: var(--capsule-text3);
  text-align: center;
  padding: 8px 4px;
}

.capsule-pm-preview {
  border: 1px solid var(--capsule-divider);
  border-radius: 10px;
  background: color-mix(in srgb, var(--capsule-bg2) 78%, white 22%);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capsule-pm-preview[hidden] {
  display: none;
}

.capsule-pm-preview-text {
  white-space: pre-wrap;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--capsule-text2);
  max-height: 150px;
  overflow-y: auto;
}

.capsule-pm-preview-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.capsule-pm-hint {
  font-size: 9.5px;
  line-height: 1.3;
  color: var(--capsule-text3);
  text-align: center;
}

.capsule-status-badge[data-state="mirroring"] .capsule-status-dot,
.capsule-status-badge[data-state="archiving"] .capsule-status-dot,
.capsule-status-badge[data-state="saved"] .capsule-status-dot {
  animation: capsule-live-blink 1.6s ease-in-out infinite;
}

@keyframes capsule-live-blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.capsule-shell.is-dragging .capsule-collapsed,
.capsule-shell.is-dragging .capsule-panel {
  transition: none !important;
}

.fallback-shell .capsule-collapsed {
  cursor: pointer;
}

.fallback-shell .capsule-panel {
  display: none !important;
}

.capsule-shell[data-theme="dark"] .capsule-panel {
  box-shadow: var(--capsule-shadow);
}

.capsule-shell[data-theme="dark"] .capsule-action-btn:hover:enabled {
  opacity: 0.82;
}

.capsule-shell[data-theme="dark"] .capsule-domain-label,
.capsule-shell[data-theme="dark"] .capsule-reason {
  color: var(--capsule-text2);
}

.capsule-shell[data-theme="dark"] .capsule-collapse-btn {
  color: var(--capsule-text2);
}

.capsule-shell[data-theme="dark"] .capsule-collapse-btn:hover {
  color: var(--capsule-text1);
}

.capsule-shell[data-theme="dark"] .capsule-action-btn:not(.is-primary) {
  border-color: var(--btn-secondary-border);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="idle"] {
  color: var(--status-neutral-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="error"] {
  color: var(--status-error-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="holding"] {
  color: var(--status-held-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="ready_to_archive"] {
  color: var(--status-ready-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="mirroring"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="archiving"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="saved"] {
  color: var(--status-live-text);
}

.capsule-shell[data-view="expanded"] {
  cursor: default;
}

.capsule-shell[data-view="collapsed"] .capsule-collapsed {
  cursor: grab;
}

.capsule-shell[data-view="collapsed"].is-dragging .capsule-collapsed {
  cursor: grabbing;
}

.capsule-shell[data-view="expanded"].is-dragging .capsule-drag-handle {
  cursor: grabbing !important;
}

.capsule-shell[data-view="expanded"] .capsule-drag-handle {
  cursor: grab;
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-platform {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-title {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-drag-handle {
  overflow: hidden;
}

.capsule-shell[data-view="expanded"] .capsule-title,
.capsule-shell[data-view="expanded"] .capsule-platform,
.capsule-shell[data-view="expanded"] .capsule-domain-label {
  white-space: nowrap;
}

.capsule-shell[data-view="expanded"] .capsule-domain-label {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 146px;
}

.capsule-shell[data-view="expanded"] .capsule-actions .capsule-action-btn {
  white-space: nowrap;
}

.capsule-shell[data-view="expanded"] .capsule-reason {
  word-break: break-word;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge {
  white-space: nowrap;
}

.capsule-shell[data-view="expanded"] .capsule-status-row {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge {
  max-width: 160px;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge .capsule-status-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge {
  overflow: hidden;
}

.capsule-shell[data-view="expanded"] .capsule-status-dot {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-status-label {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-actions {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-action-btn {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-header {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-drag-handle {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-title {
  color: var(--capsule-text1);
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn {
  color: var(--capsule-text2);
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn:hover {
  color: var(--capsule-text1);
}

.capsule-shell[data-view="expanded"] .capsule-status-row,
.capsule-shell[data-view="expanded"] .capsule-reason,
.capsule-shell[data-view="expanded"] .capsule-actions {
  box-sizing: border-box;
}

.capsule-shell[data-view="expanded"] .capsule-panel,
.capsule-shell[data-view="collapsed"] .capsule-collapsed {
  -webkit-font-smoothing: antialiased;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  text-rendering: optimizeLegibility;
}

.capsule-shell[data-view="expanded"] .capsule-header {
  background: transparent;
}

.capsule-shell[data-view="expanded"] .capsule-reason {
  transition: opacity 0.2s;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  border-color: var(--capsule-border);
}

.capsule-shell[data-view="expanded"] .capsule-header {
  border-bottom-color: var(--capsule-divider);
}

.capsule-shell[data-view="expanded"] .capsule-action-btn.is-primary {
  border-color: transparent;
}

.capsule-shell[data-view="expanded"] .capsule-action-btn:not(.is-primary) {
  border-color: var(--btn-secondary-border);
}

.capsule-shell[data-view="expanded"] .capsule-collapsed {
  display: none;
}

.capsule-shell[data-view="collapsed"] .capsule-panel {
  display: none;
}

.capsule-shell[data-view="collapsed"] .capsule-collapsed {
  display: inline-flex;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  display: block;
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn:focus-visible,
.capsule-shell[data-view="expanded"] .capsule-action-btn:focus-visible,
.capsule-shell[data-view="collapsed"] .capsule-collapsed:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}

.capsule-shell[data-theme="dark"][data-view="expanded"] .capsule-collapse-btn:focus-visible,
.capsule-shell[data-theme="dark"][data-view="expanded"] .capsule-action-btn:focus-visible {
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.32);
}
`;

const ensureCapsuleFontFaceStyleInjected = (): void => {
  if (document.getElementById(CAPSULE_FONT_FACE_STYLE_ID)) return;
  const styleNode = document.createElement("style");
  styleNode.id = CAPSULE_FONT_FACE_STYLE_ID;
  styleNode.textContent = CAPSULE_FONT_FACE_STYLE_TEXT;
  (document.head ?? document.documentElement).appendChild(styleNode);
};

const clamp = (value: number, min: number, max: number): number => {
  const normalizedMax = Math.max(min, max);
  return Math.min(Math.max(value, min), normalizedMax);
};

const normalizeHost = (host: string): string =>
  String(host ?? "")
    .trim()
    .toLowerCase();

const resolvePlatform = (host: string): Platform | undefined => {
  const normalizedHost = normalizeHost(host);
  return PLATFORM_BY_HOST[normalizedHost];
};

const resolveReasonMessage = (errorCode?: string | null): string | null => {
  if (!errorCode) return null;
  const direct = capsuleResolveError(errorCode);
  if (direct !== errorCode) return direct;
  const key = Object.keys(capsuleT.errorMessages).find((k) =>
    errorCode.includes(k)
  );
  return key ? capsuleResolveError(key) : errorCode;
};

const labelForState = (state: CapsuleRuntimeState): string => {
  switch (state) {
    case "idle":
      return capsuleT.unavailable;
    case "mirroring":
      return capsuleT.mirroring;
    case "holding":
      return capsuleT.held;
    case "ready_to_archive":
      return capsuleT.ready;
    case "archiving":
      return capsuleT.archiving;
    case "saved":
      return capsuleT.saved;
    case "error":
      return capsuleT.actionFailed;
  }
};

const openSidepanel = async (): Promise<boolean> => {
  if (!chrome?.runtime?.sendMessage) return false;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "OPEN_SIDEPANEL", source: "capsule-ui" },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        // Trust the background's honest ok flag — sidePanel.open can fail even
        // when the message itself round-trips successfully.
        resolve((response as { ok?: boolean } | undefined)?.ok === true);
      }
    );
  });
};

const getRetryDelay = (failureCount: number): number => {
  if (failureCount <= 0) return POLL_INTERVAL_MS;
  if (failureCount <= RETRY_BACKOFF_MS.length) {
    return RETRY_BACKOFF_MS[failureCount - 1];
  }
  return POLL_INTERVAL_MS;
};

// ---- prompt-manager background RPC helpers --------------------------------
// All route through the offscreen dispatcher (handleOffscreenRequest in the
// background). Failures degrade to empty/no-op so the dock stays usable.
const pmSearchPrompts = async (query: string): Promise<Prompt[]> => {
  try {
    return (await sendRequest({
      type: "SEARCH_PROMPTS",
      target: "offscreen",
      payload: { query, limit: 8 },
    })) as Prompt[];
  } catch (error) {
    logger.debug("content", "Capsule prompt search failed", {
      error: (error as Error)?.message ?? String(error),
    });
    return [];
  }
};

const pmCompleteDraft = async (
  draft: string,
  platform: Platform | undefined,
  mode: "optimize" | "continue",
): Promise<{ completion: string; usedLlm: boolean }> => {
  return (await sendRequest(
    {
      type: "COMPLETE_PROMPT",
      target: "offscreen",
      payload: { draft, platform, useLibrary: true, mode },
    },
    120000,
  )) as { completion: string; usedLlm: boolean };
};

const pmIncrementUsage = async (id: number): Promise<void> => {
  try {
    await sendRequest({
      type: "INCREMENT_PROMPT_USAGE",
      target: "offscreen",
      payload: { id },
    });
  } catch {
    // best-effort
  }
};

const mount = async () => {
  if (window.top !== window.self) return;
  if (document.getElementById(CAPSULE_ROOT_ID)) return;
  await initCapsuleLocale();
  ensureCapsuleFontFaceStyleInjected();

  const hostname = normalizeHost(window.location.hostname);
  const isPrimaryRolloutHost = PRIMARY_ROLLOUT_HOSTS.has(hostname);

  let settings: CapsuleSettings = DEFAULT_CAPSULE_SETTINGS;
  try {
    settings = await getCapsuleSettingsForHost(hostname);
  } catch (error) {
    logger.warn("content", "Failed to load capsule settings, fallback to defaults", {
      host: hostname,
      error: (error as Error).message,
    });
  }

  let themeMode: UiThemeMode = "light";
  try {
    const uiSettings = await getUiSettings();
    themeMode = normalizeThemeMode(uiSettings.themeMode);
  } catch (error) {
    logger.warn("content", "Failed to load UI theme settings, fallback to light", {
      host: hostname,
      error: (error as Error).message,
    });
  }

  if (!settings.enabled || settings.hiddenHosts.includes(hostname)) {
    logger.info("content", "Capsule hidden by settings", { host: hostname });
    return;
  }

  const host = document.createElement("div");
  host.id = CAPSULE_ROOT_ID;
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = String(CAPSULE_Z_INDEX);
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleNode = document.createElement("style");
  styleNode.textContent = SHADOW_STYLE;
  shadow.appendChild(styleNode);

  const shell = document.createElement("div");
  shell.className = isPrimaryRolloutHost ? "capsule-shell" : "capsule-shell fallback-shell";
  shell.dataset.view = "collapsed";
  shell.dataset.state = "idle";
  shell.dataset.theme = themeMode;
  shadow.appendChild(shell);

  const collapsedButton = document.createElement("button");
  collapsedButton.type = "button";
  collapsedButton.className = "capsule-collapsed";
  collapsedButton.setAttribute("aria-label", capsuleT.vestiCapsule);
  collapsedButton.title = isPrimaryRolloutHost
    ? capsuleT.openVestiCapsule
    : capsuleT.openVestiDock;
  const logo = document.createElement("img");
  logo.className = "capsule-logo";
  logo.src = LOGO_BASE64;
  logo.alt = "Vesti";
  logo.draggable = false;
  collapsedButton.appendChild(logo);
  shell.appendChild(collapsedButton);

  const panel = document.createElement("section");
  panel.className = "capsule-panel";
  panel.hidden = true;

  const header = document.createElement("div");
  header.className = "capsule-header";

  const dragHandle = document.createElement("div");
  dragHandle.className = "capsule-drag-handle";
  dragHandle.setAttribute("role", "presentation");

  const title = document.createElement("span");
  title.className = "capsule-title";
  title.textContent = "Vesti";

  const platformBadge = document.createElement("span");
  platformBadge.className = "capsule-platform";
  platformBadge.textContent = resolvePlatform(hostname) ?? "Unknown";
  const initialPlatform = resolvePlatform(hostname);
  const initialPlatformTone = resolvePlatformTone(initialPlatform, themeMode);
  platformBadge.style.backgroundColor = initialPlatformTone.bg;
  platformBadge.style.color = initialPlatformTone.text;
  platformBadge.style.borderColor = initialPlatformTone.border;

  dragHandle.appendChild(title);
  dragHandle.appendChild(platformBadge);

  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "capsule-collapse-btn";
  collapseBtn.textContent = "⌃";
  collapseBtn.setAttribute("aria-label", capsuleT.collapseAria);
  collapseBtn.title = capsuleT.collapseTitle;

  header.appendChild(dragHandle);
  header.appendChild(collapseBtn);

  const statusRow = document.createElement("div");
  statusRow.className = "capsule-status-row";

  const statusBadge = document.createElement("span");
  statusBadge.className = "capsule-status-badge";
  statusBadge.dataset.state = "idle";
  const statusDot = document.createElement("span");
  statusDot.className = "capsule-status-dot";
  const statusLabel = document.createElement("span");
  statusLabel.className = "capsule-status-label";
  statusLabel.textContent = "Unavailable";
  statusBadge.appendChild(statusDot);
  statusBadge.appendChild(statusLabel);

  const statusHost = document.createElement("span");
  statusHost.className = "capsule-domain-label";
  statusHost.textContent = hostname;

  statusRow.appendChild(statusBadge);
  statusRow.appendChild(statusHost);

  const reasonLine = document.createElement("div");
  reasonLine.className = "capsule-reason";
  reasonLine.textContent = capsuleT.waitingForStatus;

  const actions = document.createElement("div");
  actions.className = "capsule-actions";

  const archiveBtn = document.createElement("button");
  archiveBtn.type = "button";
  archiveBtn.className = "capsule-action-btn is-primary";
  archiveBtn.textContent = capsuleT.archiveNow;

  const openDockBtn = document.createElement("button");
  openDockBtn.type = "button";
  openDockBtn.className = "capsule-action-btn";
  openDockBtn.textContent = capsuleT.openDock;

  actions.appendChild(archiveBtn);
  actions.appendChild(openDockBtn);

  // ---- prompt manager (lower dock section) --------------------------------
  // The owl/dock is the single open/close toggle for this unified feature:
  // optimize / continue work on the page composer, and the search list fills a
  // saved prompt by trigger (Enter = top match, click = that item).
  const pm = document.createElement("div");
  pm.className = "capsule-pm";

  const pmHeading = document.createElement("div");
  pmHeading.className = "capsule-pm-heading";
  pmHeading.textContent = capsuleT.pm.heading;

  const pmTools = document.createElement("div");
  pmTools.className = "capsule-pm-tools";
  const optimizeBtn = document.createElement("button");
  optimizeBtn.type = "button";
  optimizeBtn.className = "capsule-pm-btn";
  optimizeBtn.textContent = capsuleT.pm.optimize;
  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.className = "capsule-pm-btn";
  continueBtn.textContent = capsuleT.pm.continue;
  pmTools.appendChild(optimizeBtn);
  pmTools.appendChild(continueBtn);

  const pmSearch = document.createElement("input");
  pmSearch.type = "text";
  pmSearch.className = "capsule-pm-search";
  pmSearch.placeholder = capsuleT.pm.searchPlaceholder;

  const pmList = document.createElement("div");
  pmList.className = "capsule-pm-list";

  const pmPreview = document.createElement("div");
  pmPreview.className = "capsule-pm-preview";
  pmPreview.hidden = true;
  const pmPreviewText = document.createElement("div");
  pmPreviewText.className = "capsule-pm-preview-text";
  const pmPreviewActions = document.createElement("div");
  pmPreviewActions.className = "capsule-pm-preview-actions";
  const pmCancelBtn = document.createElement("button");
  pmCancelBtn.type = "button";
  pmCancelBtn.className = "capsule-pm-btn";
  pmCancelBtn.textContent = capsuleT.pm.cancel;
  const pmFillBtn = document.createElement("button");
  pmFillBtn.type = "button";
  pmFillBtn.className = "capsule-action-btn is-primary";
  pmFillBtn.textContent = capsuleT.pm.fill;
  pmPreviewActions.appendChild(pmCancelBtn);
  pmPreviewActions.appendChild(pmFillBtn);
  pmPreview.appendChild(pmPreviewText);
  pmPreview.appendChild(pmPreviewActions);

  const pmHint = document.createElement("div");
  pmHint.className = "capsule-pm-hint";
  pmHint.textContent = capsuleT.pm.hint;

  pm.appendChild(pmHeading);
  pm.appendChild(pmTools);
  pm.appendChild(pmSearch);
  pm.appendChild(pmList);
  pm.appendChild(pmPreview);
  pm.appendChild(pmHint);

  panel.appendChild(header);
  panel.appendChild(statusRow);
  panel.appendChild(reasonLine);
  panel.appendChild(actions);
  panel.appendChild(pm);

  if (isPrimaryRolloutHost) {
    shell.appendChild(panel);
  }

  const quietDefaultView: CapsuleViewMode = "collapsed";
  const quietPosition: CapsulePosition = {
    anchor: DEFAULT_CAPSULE_SETTINGS.anchor,
    offsetX: DEFAULT_CAPSULE_SETTINGS.offsetX,
    offsetY: DEFAULT_CAPSULE_SETTINGS.offsetY,
  };

  let viewMode: CapsuleViewMode = quietDefaultView;
  let runtimeStatus: ActiveCaptureStatus | null = null;
  let runtimeError: string | null = null;
  let uiState: CapsuleRuntimeState = "idle";
  let inFlightArchive = false;
  let savedUntil = 0;
  let pollTimer: number | null = null;
  let autoCollapseTimer: number | null = null;
  let failureCount = 0;
  let destroyed = false;
  let suppressCollapsedClick = false;
  let positionRef: CapsulePosition = { ...quietPosition };
  let lastDragAt = 0;
  let persistInFlight = false;
  let pendingSettingsPatch: Partial<CapsuleSettings> | null = null;

  // ---- prompt manager state ----
  const promptPlatform = resolvePlatform(hostname);
  let pmEnabled = true;
  let pmBusy: "optimize" | "continue" | null = null;
  let pmResults: PmResult[] = [];
  let pmPreviewBody = "";
  let pmSearchDebounce: number | null = null;
  // Monotonic search token: a slower earlier query must not overwrite the
  // results of a newer one once its awaited lookups resolve.
  let pmSearchSeq = 0;
  let unsubscribePromptAssist: (() => void) | null = null;
  // The composer the user last typed in. Clicking the shadow panel moves
  // document.activeElement to the shadow host, so resolveComposer() can miss the
  // real composer on rich editors (Claude/Kimi) — fall back to this.
  let lastComposer: ComposerEl | null = null;

  const dragSession: DragSession = {
    active: false,
    pointerId: null,
    source: null,
    canDrag: false,
    startedWithModifier: false,
    dragging: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  };

  const getShellSize = () => {
    const rect = shell.getBoundingClientRect();
    return {
      width: Math.max(rect.width || 0, COLLAPSED_SIZE),
      height: Math.max(rect.height || 0, COLLAPSED_SIZE),
    };
  };

  const clampOffsetsToViewport = (
    anchor: CapsuleAnchor,
    offsetX: number,
    offsetY: number
  ) => {
    const { width, height } = getShellSize();
    const maxOffsetX = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxOffsetY = window.innerHeight - height - VIEWPORT_MARGIN;
    return {
      anchor,
      offsetX: clamp(offsetX, VIEWPORT_MARGIN, maxOffsetX),
      offsetY: clamp(offsetY, VIEWPORT_MARGIN, maxOffsetY),
    };
  };

  const applyAnchoredPosition = () => {
    const next = clampOffsetsToViewport(
      positionRef.anchor,
      positionRef.offsetX,
      positionRef.offsetY
    );
    positionRef = {
      anchor: next.anchor,
      offsetX: next.offsetX,
      offsetY: next.offsetY,
    };
    settings = {
      ...settings,
      anchor: next.anchor,
      offsetX: next.offsetX,
      offsetY: next.offsetY,
    };

    shell.style.top = "auto";
    shell.style.bottom = `${next.offsetY}px`;

    if (next.anchor === "bottom_right") {
      shell.style.left = "auto";
      shell.style.right = `${next.offsetX}px`;
      return;
    }

    shell.style.left = `${next.offsetX}px`;
    shell.style.right = "auto";
  };

  const logAction = (
    action: "open_dock" | "archive_now" | "drag_end",
    ok: boolean,
    detail?: Record<string, unknown>
  ) => {
    const payload = {
      action,
      state: uiState,
      ok,
      ...detail,
    };
    if (ok) {
      logger.info("content", "Capsule action", payload);
    } else {
      logger.warn("content", "Capsule action failed", payload);
    }
  };

  const persistSettingsPatch = (patch: Partial<CapsuleSettings>) => {
    pendingSettingsPatch = {
      ...(pendingSettingsPatch ?? {}),
      ...patch,
    };
    if (persistInFlight) return;
    persistInFlight = true;
    void (async () => {
      while (pendingSettingsPatch) {
        const patchToWrite = pendingSettingsPatch;
        pendingSettingsPatch = null;
        try {
          const nextSettings = await updateCapsuleSettingsForHost(hostname, patchToWrite);
          settings = {
            ...nextSettings,
            anchor: positionRef.anchor,
            offsetX: positionRef.offsetX,
            offsetY: positionRef.offsetY,
          };
        } catch (error) {
          logger.warn("content", "Failed to persist capsule settings", {
            host: hostname,
            patch: patchToWrite,
            error: (error as Error).message,
          });
        }
      }
      persistInFlight = false;
    })();
  };


  if (isPrimaryRolloutHost) {
    const needsQuietDefaults =
      settings.defaultView !== quietDefaultView ||
      settings.anchor !== quietPosition.anchor ||
      settings.offsetX !== quietPosition.offsetX ||
      settings.offsetY !== quietPosition.offsetY;

    if (needsQuietDefaults) {
      persistSettingsPatch({
        defaultView: quietDefaultView,
        anchor: quietPosition.anchor,
        offsetX: quietPosition.offsetX,
        offsetY: quietPosition.offsetY,
      });
    }
  }

  const deriveUiState = (): CapsuleRuntimeState => {
    if (inFlightArchive) return "archiving";
    if (savedUntil > Date.now()) return "saved";
    if (runtimeError) return "error";

    if (!runtimeStatus || !runtimeStatus.supported) {
      return "idle";
    }

    if (runtimeStatus.reason === "content_unreachable") {
      return "error";
    }

    if (runtimeStatus.mode === "mirror") {
      return "mirroring";
    }

    if (runtimeStatus.available) {
      return "ready_to_archive";
    }

    return "holding";
  };

  const buildReasonLine = () => {
    if (uiState === "error") {
      return resolveReasonMessage(runtimeError) ?? capsuleT.actionFailed;
    }

    switch (uiState) {
      case "idle":
        return "Open an active chat thread to continue.";
      case "mirroring":
        return capsuleT.mirrorModeHint;
      case "holding":
        return "Waiting for archivable thread snapshot.";
      case "ready_to_archive":
        return "Thread snapshot ready for manual archive.";
      case "archiving":
        return "Persisting snapshot...";
      case "saved":
        return capsuleT.archiveCompleted;
      default:
        return null;
    }
  };

  const renderCapsule = () => {
    if (destroyed) return;

    uiState = deriveUiState();
    shell.dataset.view = viewMode;
    shell.dataset.state = uiState;
    shell.dataset.theme = themeMode;

    if (!isPrimaryRolloutHost) {
      shell.classList.add("fallback-shell");
      return;
    }

    panel.hidden = viewMode !== "expanded";
    collapsedButton.hidden = viewMode === "expanded";
    statusBadge.dataset.state = uiState;
    statusLabel.textContent = labelForState(uiState);

    const platform =
      runtimeStatus?.platform ?? resolvePlatform(hostname) ?? "ChatGPT";
    platformBadge.textContent = platform;
    const platformTone = resolvePlatformTone(platform, themeMode);
    platformBadge.style.backgroundColor = platformTone.bg;
    platformBadge.style.color = platformTone.text;
    platformBadge.style.borderColor = platformTone.border;

    archiveBtn.disabled = uiState !== "ready_to_archive";
    archiveBtn.textContent = uiState === "archiving" ? capsuleT.archiving : capsuleT.archiveNow;
    reasonLine.textContent = buildReasonLine() ?? "";
    openDockBtn.textContent = capsuleT.openDock;
    collapsedButton.setAttribute("aria-label", capsuleT.vestiCapsule);
    collapsedButton.title = isPrimaryRolloutHost ? capsuleT.openVestiCapsule : capsuleT.openVestiDock;

    pm.hidden = !pmEnabled;
    pmHeading.textContent = capsuleT.pm.heading;
    optimizeBtn.textContent = pmBusy === "optimize" ? capsuleT.pm.optimizing : capsuleT.pm.optimize;
    continueBtn.textContent = pmBusy === "continue" ? capsuleT.pm.continuing : capsuleT.pm.continue;
    optimizeBtn.disabled = pmBusy !== null;
    continueBtn.disabled = pmBusy !== null;
    pmSearch.placeholder = capsuleT.pm.searchPlaceholder;
    pmCancelBtn.textContent = capsuleT.pm.cancel;
    pmFillBtn.textContent = capsuleT.pm.fill;
    pmHint.textContent = capsuleT.pm.hint;
  };

  const syncPosition = () => {
    if (destroyed || dragSession.dragging) return;
    window.requestAnimationFrame(() => {
      if (destroyed || dragSession.dragging) return;
      applyAnchoredPosition();
    });
  };

  const setViewMode = (next: CapsuleViewMode, persist = true) => {
    if (!isPrimaryRolloutHost) return;
    if (viewMode === next) return;
    viewMode = next;
    renderCapsule();
    syncPosition();
    if (next === "expanded" && pmEnabled) {
      void renderPromptResults(pmSearch.value);
    } else if (next === "collapsed") {
      hidePmPreview();
    }
    if (persist) {
      persistSettingsPatch({ defaultView: next });
    }
  };

  // ---- prompt manager logic ----
  const currentComposer = (): ComposerEl | null =>
    resolveComposer(window.location.hostname) ?? lastComposer;

  const hidePmPreview = () => {
    pmPreviewBody = "";
    pmPreview.hidden = true;
    pmPreviewText.textContent = "";
  };

  const fillComposer = (text: string, replace: boolean): boolean => {
    const composer = currentComposer();
    if (!composer) {
      logger.info("content", "Capsule prompt fill: composer not found", { host: hostname });
      return false;
    }
    if (replace) {
      setComposerText(composer, text);
    } else {
      const existing = getComposerText(composer).trim();
      setComposerText(composer, existing ? `${existing}\n${text}` : text);
    }
    return true;
  };

  const insertPrompt = (result: PmResult) => {
    if (fillComposer(result.body, false)) {
      if (typeof result.promptId === "number") void pmIncrementUsage(result.promptId);
      setViewMode("collapsed");
    }
  };

  const renderPromptResults = async (query: string) => {
    if (!pmEnabled) return;
    const seq = ++pmSearchSeq;
    const trimmed = query.trim();
    // Search the user's saved 常用提示词 (DB) AND the curated 优质提示词 (plaza).
    const [saved, curated] = await Promise.all([
      pmSearchPrompts(trimmed),
      // Curated plaza prompts only ship en/zh content; other locales fall back to
      // English plaza data while the capsule's own UI stays fully localized.
      Promise.resolve(
        searchCuratedPrompts(trimmed, capsuleLocale === "zh" ? "zh" : "en", 6)
      ),
    ]);
    // A newer keystroke superseded this search while it was in flight.
    if (seq !== pmSearchSeq) return;
    const seen = new Set<string>();
    const merged: PmResult[] = [];
    for (const p of saved) {
      const key = p.body.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ title: p.title || p.body.slice(0, 32), body: p.body, promptId: p.id });
    }
    for (const c of curated) {
      const key = c.body.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ title: c.title || c.body.slice(0, 32), body: c.body, fromPlaza: true });
    }
    pmResults = merged;
    pmList.innerHTML = "";
    if (merged.length === 0) {
      const empty = document.createElement("div");
      empty.className = "capsule-pm-empty";
      empty.textContent = trimmed ? capsuleT.pm.noResults : capsuleT.pm.empty;
      pmList.appendChild(empty);
      return;
    }
    for (const result of merged) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "capsule-pm-item";
      const title = document.createElement("span");
      title.className = "capsule-pm-item-title";
      title.textContent = result.title;
      if (result.fromPlaza) {
        const badge = document.createElement("span");
        badge.className = "capsule-pm-badge";
        badge.textContent = capsuleT.pm.plazaBadge;
        title.appendChild(badge);
      }
      const body = document.createElement("span");
      body.className = "capsule-pm-item-body";
      body.textContent = result.body;
      item.appendChild(title);
      item.appendChild(body);
      item.addEventListener("click", () => insertPrompt(result));
      pmList.appendChild(item);
    }
  };

  const showPmPreview = (completion: string) => {
    pmPreviewBody = completion;
    pmPreviewText.textContent = completion;
    pmPreview.hidden = false;
  };

  const runCompletion = async (mode: "optimize" | "continue") => {
    if (pmBusy) return;
    const composer = currentComposer();
    const draft = composer ? getComposerText(composer).trim() : "";
    if (!draft) {
      showPmPreview(capsuleT.pm.noDraft);
      return;
    }
    pmBusy = mode;
    renderCapsule();
    try {
      const result = await pmCompleteDraft(draft, promptPlatform, mode);
      if (!result.usedLlm && result.completion.trim() === draft) {
        showPmPreview(capsuleT.pm.offlineHint);
      } else {
        showPmPreview(result.completion);
      }
    } catch (error) {
      logger.debug("content", "Capsule prompt completion failed", {
        host: hostname,
        mode,
        error: (error as Error)?.message ?? String(error),
      });
      showPmPreview(capsuleT.pm.failed);
    } finally {
      pmBusy = null;
      renderCapsule();
    }
  };

  const triggerOpenDock = async () => {
    const ok = await openSidepanel();
    logAction("open_dock", ok, { host: hostname });
  };

  const scheduleAutoCollapse = () => {
    if (autoCollapseTimer) {
      window.clearTimeout(autoCollapseTimer);
      autoCollapseTimer = null;
    }

    if (settings.autoCollapseMs <= 0) return;
    autoCollapseTimer = window.setTimeout(() => {
      if (destroyed) return;
      savedUntil = 0;
      setViewMode("collapsed", false);
      renderCapsule();
      syncPosition();
    }, settings.autoCollapseMs);
  };

  const scheduleNextPoll = (delay: number) => {
    if (!isPrimaryRolloutHost || destroyed) return;
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollTimer = window.setTimeout(() => {
      void pollRuntimeStatus();
    }, delay);
  };

  const pollRuntimeStatus = async () => {
    if (!isPrimaryRolloutHost || destroyed) return;

    try {
      const status = await sendRequest<"GET_ACTIVE_CAPTURE_STATUS">(
        {
          type: "GET_ACTIVE_CAPTURE_STATUS",
          target: "background",
        },
        5000
      );

      runtimeStatus = status;
      runtimeError =
        status.reason === "content_unreachable" ? "content_unreachable" : null;
      failureCount = 0;
      renderCapsule();
      syncPosition();
      logger.info("content", "Capsule status", {
        host: hostname,
        platform: status.platform,
        mode: status.mode,
        state: deriveUiState(),
        supported: status.supported,
        available: status.available,
        paused: false,
        reason: status.reason,
        messageCount: status.messageCount,
        turnCount: status.turnCount,
        updatedAt: status.updatedAt,
      });

      scheduleNextPoll(POLL_INTERVAL_MS);
    } catch (error) {
      failureCount += 1;
      runtimeError = (error as Error).message || "ACTIVE_TAB_UNAVAILABLE";
      renderCapsule();
      scheduleNextPoll(getRetryDelay(failureCount));
      logger.warn("content", "Capsule status polling failed", {
        host: hostname,
        failureCount,
        error: runtimeError,
      });
    }
  };

  const handleArchiveNow = async () => {
    if (!isPrimaryRolloutHost || uiState !== "ready_to_archive") return;

    const startedAt = Date.now();
    inFlightArchive = true;
    runtimeError = null;
    renderCapsule();

    try {
      await sendRequest<"FORCE_ARCHIVE_TRANSIENT">(
        {
          type: "FORCE_ARCHIVE_TRANSIENT",
          target: "background",
        },
        10000
      );

      inFlightArchive = false;
      savedUntil = Date.now() + settings.autoCollapseMs;
      renderCapsule();
      scheduleAutoCollapse();
      logAction("archive_now", true, { durationMs: Date.now() - startedAt });
      void pollRuntimeStatus();
    } catch (error) {
      inFlightArchive = false;
      runtimeError = (error as Error).message || "FORCE_ARCHIVE_FAILED";
      renderCapsule();
      logAction("archive_now", false, {
        durationMs: Date.now() - startedAt,
        error: runtimeError,
      });
    }
  };

  const beginDrag = (event: PointerEvent, source: DragSource) => {
    if (!event.isPrimary || event.button !== 0 || dragSession.active) return;

    dragSession.active = true;
    dragSession.pointerId = event.pointerId;
    dragSession.source = source;
    dragSession.startedWithModifier = source === "collapsed" && event.altKey;
    dragSession.canDrag = true;
    dragSession.dragging = false;
    dragSession.startX = event.clientX;
    dragSession.startY = event.clientY;

    const rect = shell.getBoundingClientRect();
    dragSession.startLeft = rect.left;
    dragSession.startTop = rect.top;

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: PointerEvent) => {
    if (!dragSession.active || dragSession.pointerId !== event.pointerId) return;
    if (!dragSession.canDrag) return;

    const dx = event.clientX - dragSession.startX;
    const dy = event.clientY - dragSession.startY;

    if (!dragSession.dragging && Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
    if (!dragSession.dragging) {
      dragSession.dragging = true;
      shell.classList.add("is-dragging");
    }

    const { width, height } = getShellSize();
    const nextLeft = clamp(
      dragSession.startLeft + dx,
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN
    );
    const nextTop = clamp(
      dragSession.startTop + dy,
      VIEWPORT_MARGIN,
      window.innerHeight - height - VIEWPORT_MARGIN
    );

    shell.style.left = `${nextLeft}px`;
    shell.style.top = `${nextTop}px`;
    shell.style.right = "auto";
    shell.style.bottom = "auto";
    event.preventDefault();
  };

  const endDrag = (event: PointerEvent, cancelled: boolean) => {
    if (!dragSession.active || dragSession.pointerId !== event.pointerId) return;

    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    const completedDragging = dragSession.dragging;
    const startedWithModifier = dragSession.startedWithModifier;
    const source = dragSession.source;

    if (completedDragging) {
      const rect = shell.getBoundingClientRect();
      const anchor: CapsuleAnchor =
        rect.left + rect.width / 2 >= window.innerWidth / 2
          ? "bottom_right"
          : "bottom_left";

      const offsetXRaw =
        anchor === "bottom_right"
          ? window.innerWidth - rect.right
          : rect.left;
      const offsetYRaw = window.innerHeight - rect.bottom;
      const next = clampOffsetsToViewport(anchor, offsetXRaw, offsetYRaw);
      positionRef = {
        anchor: next.anchor,
        offsetX: next.offsetX,
        offsetY: next.offsetY,
      };
      lastDragAt = Date.now();
      applyAnchoredPosition();
      persistSettingsPatch({
        anchor: next.anchor,
        offsetX: next.offsetX,
        offsetY: next.offsetY,
      });
      logAction("drag_end", true, {
        anchor: next.anchor,
        offsetX: next.offsetX,
        offsetY: next.offsetY,
      });
      suppressCollapsedClick = true;
    } else if (source === "collapsed" && startedWithModifier && !cancelled) {
      suppressCollapsedClick = true;
    }

    dragSession.active = false;
    dragSession.pointerId = null;
    dragSession.source = null;
    dragSession.canDrag = false;
    dragSession.startedWithModifier = false;
    dragSession.dragging = false;
    shell.classList.remove("is-dragging");
  };

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (destroyed || areaName !== "local") return;

    const languageChange = changes["vesti_language_settings"];
    if (languageChange && languageChange.newValue) {
      const { locale: nextLocale } = languageChange.newValue as { locale?: string };
      if (nextLocale && nextLocale !== capsuleLocale) {
        capsuleLocale = resolveLocale(nextLocale);
        capsuleT = capsuleTranslations[capsuleLocale] ?? capsuleTranslations.en;
        renderCapsule();
        syncPosition();
      }
    }

    const uiThemeChange = changes[UI_SETTINGS_STORAGE_KEY];
    if (uiThemeChange) {
      const nextTheme = parseThemeModeFromStorageValue(uiThemeChange.newValue);
      if (nextTheme !== themeMode) {
        themeMode = nextTheme;
        renderCapsule();
        syncPosition();
        logger.info("content", "Capsule theme updated", {
          host: hostname,
          themeMode,
        });
      }
    }

    const capsuleChange = changes[CAPSULE_SETTINGS_STORAGE_KEY];
    if (!capsuleChange) return;

    void (async () => {
      if (destroyed) return;
      if (dragSession.dragging) return;
      if (Date.now() - lastDragAt < POSITION_SYNC_GRACE_MS) return;
      try {
        const nextSettings = await getCapsuleSettingsForHost(hostname);
        if (destroyed) return;
        settings = nextSettings;
        positionRef = {
          anchor: nextSettings.anchor,
          offsetX: nextSettings.offsetX,
          offsetY: nextSettings.offsetY,
        };
        renderCapsule();
        syncPosition();
      } catch (error) {
        logger.warn("content", "Failed to sync capsule settings", {
          host: hostname,
          error: (error as Error).message,
        });
      }
    })();
  };

  const onResize = () => {
    syncPosition();
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (autoCollapseTimer) {
      window.clearTimeout(autoCollapseTimer);
      autoCollapseTimer = null;
    }
    if (pmSearchDebounce) {
      window.clearTimeout(pmSearchDebounce);
      pmSearchDebounce = null;
    }
    if (unsubscribePromptAssist) {
      unsubscribePromptAssist();
      unsubscribePromptAssist = null;
    }
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", destroy);
    document.removeEventListener("input", onDocInput, true);
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    }
    host.remove();
  };

  // Track the composer the user last typed in (rich editors lose focus when the
  // shadow panel is clicked). Hoisted (not anonymous) so destroy() can remove it —
  // otherwise it leaks and runs composer resolution on every page keystroke.
  const onDocInput = (event: Event) => {
    const target = resolveComposerFromEvent(event.target, window.location.hostname);
    if (target) lastComposer = target;
  };

  const onPageHide = (event: PageTransitionEvent) => {
    // Skip teardown for bfcache: the page (and capsule) is frozen, not unloaded,
    // and resumes intact on pageshow. Destroying here would leave the dock gone
    // until a full reload after a back/forward navigation.
    if (event.persisted) return;
    destroy();
  };

  collapsedButton.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (isPrimaryRolloutHost) {
      setViewMode("expanded");
      return;
    }
    void triggerOpenDock();
  });

  if (!isPrimaryRolloutHost) {
    collapsedButton.addEventListener("click", () => {
      void triggerOpenDock();
    });
  } else {
    collapsedButton.addEventListener("click", (event) => {
      if (suppressCollapsedClick) {
        suppressCollapsedClick = false;
        event.preventDefault();
        return;
      }
      setViewMode("expanded");
    });

    collapsedButton.addEventListener("pointerdown", (event) => {
      beginDrag(event, "collapsed");
    });
    collapsedButton.addEventListener("pointermove", (event) => {
      moveDrag(event);
    });
    collapsedButton.addEventListener("pointerup", (event) => {
      endDrag(event, false);
    });
    collapsedButton.addEventListener("pointercancel", (event) => {
      endDrag(event, true);
    });

    dragHandle.addEventListener("pointerdown", (event) => {
      beginDrag(event, "expanded");
    });
    dragHandle.addEventListener("pointermove", (event) => {
      moveDrag(event);
    });
    dragHandle.addEventListener("pointerup", (event) => {
      endDrag(event, false);
    });
    dragHandle.addEventListener("pointercancel", (event) => {
      endDrag(event, true);
    });

    collapseBtn.addEventListener("click", () => {
      setViewMode("collapsed");
    });
    archiveBtn.addEventListener("click", () => {
      void handleArchiveNow();
    });
    openDockBtn.addEventListener("click", () => {
      void triggerOpenDock();
    });

    // ---- prompt manager listeners ----
    optimizeBtn.addEventListener("click", () => {
      void runCompletion("optimize");
    });
    continueBtn.addEventListener("click", () => {
      void runCompletion("continue");
    });
    pmSearch.addEventListener("input", () => {
      if (pmSearchDebounce) window.clearTimeout(pmSearchDebounce);
      pmSearchDebounce = window.setTimeout(() => {
        void renderPromptResults(pmSearch.value);
      }, 180);
    });
    pmSearch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      // Smart 唤醒: Enter fills the top match in one shot.
      if (pmResults.length > 0) insertPrompt(pmResults[0]);
    });
    pmFillBtn.addEventListener("click", () => {
      if (pmPreviewBody) {
        if (fillComposer(pmPreviewBody, true)) {
          hidePmPreview();
          setViewMode("collapsed");
        }
      }
    });
    pmCancelBtn.addEventListener("click", () => {
      hidePmPreview();
    });

    // Capture phase to see nested editor nodes (handler hoisted as onDocInput so
    // destroy() can detach it).
    document.addEventListener("input", onDocInput, true);
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", destroy);
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(onStorageChanged);
  }

  // Load + subscribe the prompt-manager master toggle. It reuses the existing
  // per-host "real-time prompt assistant" setting so that toggle keeps working
  // now that the standalone assist UI is merged into this dock.
  if (isPrimaryRolloutHost) {
    try {
      pmEnabled = (await getPromptAssistSettingsForHost(hostname)).realtimeEnabled;
    } catch {
      pmEnabled = true;
    }
    unsubscribePromptAssist = subscribePromptAssistSettings(hostname, (next) => {
      if (destroyed) return;
      pmEnabled = next.realtimeEnabled;
      if (!pmEnabled) hidePmPreview();
      renderCapsule();
      syncPosition();
      if (pmEnabled && viewMode === "expanded") {
        void renderPromptResults(pmSearch.value);
      }
    });
  }

  renderCapsule();
  syncPosition();

  if (isPrimaryRolloutHost) {
    void pollRuntimeStatus();
  } else {
    logger.info("content", "Capsule fallback mode enabled for host", {
      host: hostname,
      mode: "fallback_open_dock_only",
    });
  }
};

if (document.readyState === "loading") {
  window.addEventListener(
    "DOMContentLoaded",
    () => {
      void mount();
    },
    { once: true }
  );
} else {
  void mount();
}

































