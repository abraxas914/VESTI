import { BellRing, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "~lib/i18n";
import {
  getWeeklyPushSettings,
  setWeeklyPushSettings,
  testWeeklyPushNotification,
} from "~lib/services/storageService";
import type {
  WeeklyPushSettings,
  WeeklyRecapStyle,
} from "~lib/types";

const COPY = {
  en: {
    title: "Weekly reminder",
    description: "Receive a local reminder when it is time to review your week.",
    enabled: "Enable reminder",
    day: "Day",
    time: "Time",
    style: "Default style",
    humorous: "Humorous",
    professional: "Professional",
    motivational: "Motivational",
    test: "Send test",
    sent: "Test notification sent",
    saved: "Reminder updated",
    failed: "Could not update the reminder",
    next: "Next reminder",
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  },
  zh: {
    title: "周报定时提醒",
    description: "在适合回顾一周的时间，通过本地通知提醒你。",
    enabled: "启用提醒",
    day: "星期",
    time: "时间",
    style: "默认风格",
    humorous: "幽默",
    professional: "专业",
    motivational: "激励",
    test: "发送测试",
    sent: "测试通知已发送",
    saved: "提醒设置已更新",
    failed: "无法更新提醒设置",
    next: "下次提醒",
    weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  },
  ja: {
    title: "週間リマインダー",
    description: "一週間を振り返る時間にローカル通知でお知らせします。",
    enabled: "リマインダーを有効化",
    day: "曜日",
    time: "時刻",
    style: "既定のスタイル",
    humorous: "ユーモア",
    professional: "プロ",
    motivational: "励まし",
    test: "テスト送信",
    sent: "テスト通知を送信しました",
    saved: "設定を更新しました",
    failed: "設定を更新できませんでした",
    next: "次回",
    weekdays: ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"],
  },
  ko: {
    title: "주간 리마인더",
    description: "한 주를 돌아볼 시간에 로컬 알림을 보냅니다.",
    enabled: "리마인더 사용",
    day: "요일",
    time: "시간",
    style: "기본 스타일",
    humorous: "유머",
    professional: "전문적",
    motivational: "동기부여",
    test: "테스트 전송",
    sent: "테스트 알림을 보냈습니다",
    saved: "설정을 업데이트했습니다",
    failed: "설정을 업데이트하지 못했습니다",
    next: "다음 알림",
    weekdays: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  },
} as const;

const INITIAL_SETTINGS: WeeklyPushSettings = {
  enabled: false,
  weekday: 1,
  hour: 9,
  minute: 0,
  style: "professional",
  updatedAt: 0,
};

function formatTime(settings: WeeklyPushSettings): string {
  return `${String(settings.hour).padStart(2, "0")}:${String(
    settings.minute
  ).padStart(2, "0")}`;
}

export function WeeklyPushSettingsCard() {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [settings, setSettings] =
    useState<WeeklyPushSettings>(INITIAL_SETTINGS);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    void getWeeklyPushSettings()
      .then((result) => {
        if (!active) return;
        setSettings(result.settings);
        setNextAt(result.nextAt);
      })
      .catch(() => {
        if (active) setStatus(copy.failed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy.failed]);

  const persist = async (changes: Partial<WeeklyPushSettings>) => {
    setLoading(true);
    setStatus("");
    try {
      const result = await setWeeklyPushSettings(changes);
      setSettings(result.settings);
      setNextAt(result.nextAt);
      setStatus(copy.saved);
    } catch {
      setStatus(copy.failed);
    } finally {
      setLoading(false);
    }
  };

  const handleTimeChange = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    void persist({ hour, minute });
  };

  const handleTest = async () => {
    setLoading(true);
    setStatus("");
    try {
      await testWeeklyPushNotification();
      setStatus(copy.sent);
    } catch {
      setStatus(copy.failed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-3">
          <span className="rounded-lg bg-accent-primary-light p-2 text-accent-primary">
            <BellRing className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <strong className="block text-vesti-sm text-text-primary">
              {copy.title}
            </strong>
            <span className="mt-1 block text-[11px] leading-relaxed text-text-tertiary">
              {copy.description}
            </span>
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-label={copy.enabled}
          aria-checked={settings.enabled}
          disabled={loading}
          onClick={() => {
            void persist({ enabled: !settings.enabled });
          }}
          data-state={settings.enabled ? "checked" : "unchecked"}
          className="settings-switch shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <span className="settings-switch-thumb" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-text-secondary">
          <span className="mb-1 block">{copy.day}</span>
          <select
            value={settings.weekday}
            disabled={loading}
            onChange={(event) => {
              void persist({ weekday: Number(event.target.value) });
            }}
            className="w-full rounded-md border border-border-subtle bg-bg-primary px-2 py-2 text-vesti-xs text-text-primary"
          >
            {copy.weekdays.map((weekday, index) => (
              <option key={weekday} value={index}>
                {weekday}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-text-secondary">
          <span className="mb-1 block">{copy.time}</span>
          <input
            type="time"
            value={formatTime(settings)}
            disabled={loading}
            onChange={(event) => handleTimeChange(event.target.value)}
            className="w-full rounded-md border border-border-subtle bg-bg-primary px-2 py-2 text-vesti-xs text-text-primary"
          />
        </label>
      </div>

      <label className="mt-3 block text-[11px] text-text-secondary">
        <span className="mb-1 block">{copy.style}</span>
        <select
          value={settings.style}
          disabled={loading}
          onChange={(event) => {
            void persist({
              style: event.target.value as WeeklyRecapStyle,
            });
          }}
          className="w-full rounded-md border border-border-subtle bg-bg-primary px-2 py-2 text-vesti-xs text-text-primary"
        >
          <option value="humorous">{copy.humorous}</option>
          <option value="professional">{copy.professional}</option>
          <option value="motivational">{copy.motivational}</option>
        </select>
      </label>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 text-[11px] text-text-tertiary">
          {status ||
            (nextAt
              ? `${copy.next}: ${new Date(nextAt).toLocaleString(locale)}`
              : "")}
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            void handleTest();
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1.5 text-[11px] text-text-secondary hover:border-border-focus disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {copy.test}
        </button>
      </div>
    </section>
  );
}
