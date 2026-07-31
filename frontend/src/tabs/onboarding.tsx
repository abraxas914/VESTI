import "~style.css"
import "../onboarding.css"

import { ArrowRight, Check, Sparkles, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { clearSeededMockData } from "~lib/features/mockDataCleanup"
import {
  beginOnboardingTour,
  getOnboardingGuideCopy,
  setExplorePromptStage,
  setOnboardingGuideProgress
} from "~lib/features/onboardingTourService"
import { seedMockData } from "~lib/features/seedMockData"
import { navigateSidepanel } from "~lib/features/sidepanelNavigation"
import { I18nProvider, useI18n } from "~lib/i18n"
import { sendRequest } from "~lib/messaging/runtime"
import { openOnboardingSidePanel } from "~lib/onboarding/sidepanel"
import {
  getFirstIncompleteFeature,
  getOnboardingState,
  resolveOnboardingDestination
} from "~lib/onboarding/state"
import { LOGO_BASE64 } from "~lib/ui/logo"
import { OnboardingCoachmark } from "~sidepanel/components/OnboardingCoachmark"

type ActionState = "idle" | "quick_start" | "skip" | "clear" | "keep"
type PageView = "loading" | "welcome" | "intro" | "final"

const DASHBOARD_NAV_REQUEST_KEY = "vesti_dashboard_open_tab"

function resumeDashboardMode(
  mode: "ask" | "aiti" | "learn" | "roundtable"
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(
      {
        [DASHBOARD_NAV_REQUEST_KEY]: {
          tab: "explore",
          exploreMode: mode,
          requestedAt: Date.now()
        }
      },
      () => {
        const error = chrome.runtime.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        window.location.replace(chrome.runtime.getURL("options.html?tab=explore"))
        resolve()
      }
    )
  })
}

function leaveOnboarding(): void {
  window.close()
  window.setTimeout(() => {
    window.location.replace(chrome.runtime.getURL("sidepanel.html"))
  }, 200)
}

function OnboardingPage() {
  const { t } = useI18n()
  const labels = t.onboarding
  const [view, setView] = useState<PageView>("loading")
  const [action, setAction] = useState<ActionState>("idle")
  const [status, setStatus] = useState("")
  const [introStep, setIntroStep] = useState(0)

  useEffect(() => {
    let cancelled = false
    void getOnboardingState()
      .then(async (state) => {
        if (cancelled) return
        const destination = resolveOnboardingDestination(state)
        if (destination === "sidepanel") {
          window.location.replace(chrome.runtime.getURL("sidepanel.html"))
          return
        }
        if (destination === "final") {
          setView("final")
          return
        }
        if (destination === "tour") {
          const feature = getFirstIncompleteFeature(
            state.onboardingStepCompleted
          )
          if (feature === "deepseek") {
            setIntroStep(state.guideSteps.deepseek)
            setView("intro")
            return
          }
          if (feature === "aiti") {
            await resumeDashboardMode("aiti")
            return
          }
          if (feature === "roundtable") {
            await resumeDashboardMode("roundtable")
            return
          }
          if (feature === "learn") {
            await resumeDashboardMode("learn")
            return
          }
          if (feature === "explore" && state.guideSteps.explore >= 1) {
            await setExplorePromptStage(
              state.guideSteps.explore === 1 ? "explore_tab" : null
            )
            await resumeDashboardMode("ask")
            return
          }
          await navigateSidepanel("/dashboard")
          window.location.replace(chrome.runtime.getURL("sidepanel.html"))
          return
        }
        setView("welcome")
      })
      .catch(() => {
        if (!cancelled) {
          setView("welcome")
          setStatus(labels.actionFailed)
        }
      })
    return () => {
      cancelled = true
    }
  }, [labels.actionFailed])

  const busy = action !== "idle"

  const handleQuickStart = () => {
    if (busy) return
    setAction("quick_start")
    setStatus(labels.quickStartWorking)

    const until = Date.now()
    const since = until - 7 * 24 * 60 * 60 * 1000

    void sendRequest<"ONBOARDING_IMPORT_RECENT_WEEK">(
      {
        type: "ONBOARDING_IMPORT_RECENT_WEEK",
        target: "background",
        payload: { since, until }
      },
      120_000
    )
      .catch(() => ({ saved: 0 }))
      .then(async (capture) => {
        if (capture.saved < 2) await seedMockData()
        await beginOnboardingTour()
        setStatus(labels.quickStartSuccess)
        setAction("idle")
        setIntroStep(0)
        setView("intro")
      })
      .catch(() => {
        setAction("idle")
        setStatus(labels.actionFailed)
      })
  }

  const advanceIntro = async (nextStep: number) => {
    await setOnboardingGuideProgress("deepseek", { step: nextStep })
    setIntroStep(nextStep)
  }

  const enterCoreDemo = () => {
    if (busy) return
    setAction("quick_start")
    void openOnboardingSidePanel()
    void setOnboardingGuideProgress("deepseek", {
      step: 2,
      completed: true
    })
      .then(async () => {
        await navigateSidepanel("/dashboard")
        leaveOnboarding()
      })
      .catch(() => {
        setAction("idle")
        setStatus(labels.actionFailed)
      })
  }

  const endDemo = () => {
    if (busy) return
    setAction("skip")
    void openOnboardingSidePanel()
    void sendRequest<"ONBOARDING_COMPLETE">({
      type: "ONBOARDING_COMPLETE",
      target: "background",
      payload: { via: "skip" }
    })
      .then(async () => {
        await navigateSidepanel("/dashboard")
        leaveOnboarding()
      })
      .catch(() => {
        setAction("idle")
        setStatus(labels.actionFailed)
      })
  }

  const handleSkip = () => {
    if (busy) return
    setAction("skip")
    setStatus("")
    void openOnboardingSidePanel()
    void sendRequest<"ONBOARDING_COMPLETE">({
      type: "ONBOARDING_COMPLETE",
      target: "background",
      payload: { via: "skip" }
    })
      .then(async () => {
        await navigateSidepanel("/dashboard")
        leaveOnboarding()
      })
      .catch(() => {
        setAction("idle")
        setStatus(labels.actionFailed)
      })
  }

  const finishTour = (clean: boolean) => {
    if (busy) return
    setAction(clean ? "clear" : "keep")
    setStatus("")
    void openOnboardingSidePanel()

    void (async () => {
      if (clean) await clearSeededMockData()
      await sendRequest<"ONBOARDING_COMPLETE">({
        type: "ONBOARDING_COMPLETE",
        target: "background",
        payload: {
          via: "quick_start",
          hasCleanedMockData: clean
        }
      })
      await navigateSidepanel("/dashboard")
      leaveOnboarding()
    })().catch(() => {
      setAction("idle")
      setStatus("操作没有完成，请重试。演示数据尚未被误删。")
    })
  }

  if (view === "loading") {
    return <main className="onboarding-root" aria-busy="true" />
  }

  if (view === "final") {
    return (
      <main className="onboarding-final-root">
        <div className="onboarding-final-backdrop" />
        <section
          className="onboarding-final-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-final-title">
          <div className="onboarding-final-mark" aria-hidden="true">
            <Sparkles size={28} strokeWidth={1.7} />
          </div>
          <h1 id="onboarding-final-title">
            演示结束，与小猫一起开启 VESTI 之旅吧
          </h1>
          <p>
            刚才的演示聊天记录已导入你的知识库。你可以选择保留它们作为参考，也可以清空它们，开始完全属于你自己的记录。
          </p>
          <div className="onboarding-final-actions">
            <button
              type="button"
              className="onboarding-final-clear"
              disabled={busy}
              onClick={() => finishTour(true)}>
              <Trash2 size={17} aria-hidden="true" />
              {action === "clear"
                ? "正在清空…"
                : "清空演示，重新开始"}
            </button>
            <button
              type="button"
              className="onboarding-final-keep"
              disabled={busy}
              onClick={() => finishTour(false)}>
              <Check size={17} aria-hidden="true" />
              {action === "keep"
                ? "正在进入…"
                : "保留演示，继续使用"}
            </button>
          </div>
          <p className="onboarding-final-status" role="status">
            {status}
          </p>
        </section>
      </main>
    )
  }

  if (view === "intro") {
    const guideCopy = getOnboardingGuideCopy("zh")
    return (
      <main className="onboarding-root onboarding-demo-root">
        <section
          className="onboarding-card onboarding-demo-card"
          aria-labelledby="onboarding-demo-title">
          <header className="onboarding-brand">
            <img className="onboarding-logo" src={LOGO_BASE64} alt="" />
            <div>
              <p className="onboarding-eyebrow">VESTI 快速认识</p>
              <p className="onboarding-name">先认识网页上的小猫</p>
            </div>
          </header>

          <div className="onboarding-demo-heading">
            <h1 id="onboarding-demo-title">提问时，小猫一直在手边</h1>
            <p>这是动画示意，不会打开任何 AI 网站，也不会替你执行操作。</p>
          </div>

          <div className="onboarding-browser-demo" aria-label="AI 页面动画示意">
            <div className="onboarding-browser-bar" aria-hidden="true">
              <span />
              <span />
              <span />
              <div>AI 对话页面</div>
            </div>
            <div className="onboarding-browser-content">
              <div className="onboarding-demo-question">怎样把这个问题问得更清楚？</div>
              <div className="onboarding-demo-answer">
                在 AI 页面中，小猫可以帮助你打磨问题，也可以延续正在写的内容。
              </div>
              <button
                data-onboarding-target="capsule-demo-cat"
                className="onboarding-demo-cat"
                type="button"
                aria-label="打开 VESTI 小猫"
                onClick={() => void advanceIntro(1)}>
                <img src={LOGO_BASE64} alt="" />
              </button>
              <div
                data-onboarding-target="capsule-demo-actions"
                className={`onboarding-demo-menu ${introStep >= 1 ? "is-open" : ""}`}>
                <p>VESTI 随身工具</p>
                <div className="onboarding-demo-menu-actions">
                  <span>优化</span>
                  <span>续写</span>
                </div>
              </div>
            </div>
          </div>

          <p className="onboarding-status" role="status">{status}</p>
        </section>

        {introStep === 0 ? (
          <OnboardingCoachmark
            targetSelector='[data-onboarding-target="capsule-demo-cat"]'
            icon="🐱"
            locale="zh"
            message={guideCopy.deepseek[0]}
            placement="top"
            primaryLabel="打开小猫"
            onPrimary={() => advanceIntro(1)}
            onSkip={() => advanceIntro(1)}
            onEndDemo={endDemo}
          />
        ) : (
          <OnboardingCoachmark
            targetSelector='[data-onboarding-target="capsule-demo-actions"]'
            icon="✨"
            locale="zh"
            message={guideCopy.deepseek[1]}
            placement="top"
            primaryLabel="开始核心功能演示"
            onPrimary={enterCoreDemo}
            onSkip={enterCoreDemo}
            onEndDemo={endDemo}
          />
        )}
      </main>
    )
  }

  return (
    <main className="onboarding-root">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <header className="onboarding-brand">
          <img className="onboarding-logo" src={LOGO_BASE64} alt="" />
          <div>
            <p className="onboarding-eyebrow">{labels.eyebrow}</p>
            <p className="onboarding-name">{labels.brandName}</p>
          </div>
        </header>

        <div className="onboarding-copy">
          <h1 id="onboarding-title">{labels.subtitle}</h1>
          <p>{labels.intro}</p>
        </div>

        <div className="onboarding-actions">
          <button
            className="onboarding-primary-action"
            type="button"
            onClick={handleQuickStart}
            disabled={busy}>
            <span className="onboarding-action-icon" aria-hidden="true">
              <Sparkles size={20} strokeWidth={1.8} />
            </span>
            <span className="onboarding-action-copy">
              <strong>
                {action === "quick_start"
                  ? labels.quickStartWorking
                  : labels.quickStart}
              </strong>
              <small>{labels.quickStartDescription}</small>
            </span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="onboarding-meta">
          <p>{labels.privacy}</p>
          <p>{labels.supportedPlatforms}</p>
        </div>

        <p className="onboarding-status" role="status" aria-live="polite">
          {status}
        </p>
      </section>

      <button
        className="onboarding-skip"
        type="button"
        onClick={handleSkip}
        disabled={busy}>
        {labels.skip}
      </button>
    </main>
  )
}

export default function OnboardingEntry() {
  return (
    <I18nProvider>
      <OnboardingPage />
    </I18nProvider>
  )
}
