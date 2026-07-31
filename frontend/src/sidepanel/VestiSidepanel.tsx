import { useEffect, useReducer, useRef, useState } from "react"

import {
  ONBOARDING_EXPLORE_PROMPT_PENDING_KEY
} from "~lib/features/onboardingTourService"
import {
  consumeSidepanelNavigation,
  isSidepanelRoute,
  type SidepanelRoute
} from "~lib/features/sidepanelNavigation"
import type { InsightPipelineProgressPayload } from "~lib/messaging/protocol"
import { isInsightPipelineProgressMessage } from "~lib/messaging/protocol"
import type { Conversation, PageId } from "~lib/types"

import { Dock } from "./components/Dock"
import { OnboardingCoachmark } from "./components/OnboardingCoachmark"
import { ReaderView } from "./containers/ReaderView"
import { useOnboardingGuide } from "./hooks/useOnboardingGuide"
import {
  createInitialThreadsState,
  getReaderQuery,
  resolveFirstMatchedIdForConversation,
  threadsReducer
} from "./lib/threadsSearchReducer"
import { DataPage } from "./pages/DataPage"
import { InsightsPage } from "./pages/InsightsPage"
import { SettingsPage } from "./pages/SettingsPage"
import { TimelinePage } from "./pages/TimelinePage"

const DASHBOARD_NAV_REQUEST_KEY = "vesti_dashboard_open_tab"
// Capture/import bursts emit one VESTI_DATA_UPDATED per write; each one would
// otherwise trigger a full list+topics+stats reload. Coalesce them into a
// single refresh 500 ms after the last update.
const DATA_REFRESH_DEBOUNCE_MS = 500

function pageFromRoute(route: SidepanelRoute): PageId {
  if (route === "/dashboard") return "timeline"
  return route.slice(1) as PageId
}

function initialPage(): PageId {
  if (typeof window === "undefined") return "timeline"
  if (window.location.hash === "#weekly") return "insights"
  return "timeline"
}

function focusFinalOnboardingPage(): void {
  const finalUrl = chrome.runtime.getURL("onboarding.html")
  const generatedFinalUrl = chrome.runtime.getURL("tabs/onboarding.html")
  chrome.tabs.query({}, (tabs) => {
    const error = chrome.runtime.lastError
    if (error) {
      chrome.tabs.create({ url: finalUrl, active: true })
      return
    }
    const existing = tabs.find(
      (tab) => tab.url === finalUrl || tab.url === generatedFinalUrl
    )
    if (typeof existing?.id === "number") {
      chrome.tabs.update(existing.id, { active: true }, () => {
        void chrome.runtime.lastError
        if (typeof existing.windowId === "number") {
          chrome.windows.update(existing.windowId, { focused: true }, () =>
            void chrome.runtime.lastError
          )
        }
      })
      return
    }
    chrome.tabs.create({ url: finalUrl, active: true })
  })
}

export function VestiSidepanel() {
  const [currentPage, setCurrentPage] = useState<PageId>(initialPage)
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null)
  const [threadsState, dispatch] = useReducer(threadsReducer, undefined, () =>
    createInitialThreadsState()
  )
  const [refreshToken, setRefreshToken] = useState(0)
  const [pipelineProgressEvent, setPipelineProgressEvent] =
    useState<InsightPipelineProgressPayload | null>(null)
  const latestPipelineSeqRef = useRef<Record<string, number>>({})
  const exploreGuide = useOnboardingGuide("explore", 3)
  const insightsGuide = useOnboardingGuide("insights", 2)

  useEffect(() => {
    let refreshTimer: number | null = null
    const handler = (message: unknown) => {
      if (!message || typeof message !== "object") return

      if (isInsightPipelineProgressMessage(message)) {
        const { pipelineId, seq } = message.payload
        const lastSeq = latestPipelineSeqRef.current[pipelineId] ?? 0
        if (seq > lastSeq) {
          latestPipelineSeqRef.current[pipelineId] = seq
          setPipelineProgressEvent(message.payload)
        }
        return
      }

      const type = (message as { type?: string }).type
      if (type === "VESTI_DATA_UPDATED") {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer)
        }
        refreshTimer = window.setTimeout(() => {
          refreshTimer = null
          setRefreshToken(Date.now())
        }, DATA_REFRESH_DEBOUNCE_MS)
      }
    }
    chrome?.runtime?.onMessage?.addListener(handler)
    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
      }
      chrome?.runtime?.onMessage?.removeListener?.(handler)
    }
  }, [])

  const handleSelectConversation = (conversation: Conversation) => {
    const firstMatchedMessageId = resolveFirstMatchedIdForConversation(
      threadsState.session,
      conversation.id
    )
    dispatch({
      type: "OPEN_READER",
      conversationId: conversation.id,
      firstMatchedMessageId
    })
    setSelectedConversation(conversation)
  }

  const handleOpenWeeklyHighlight = (
    conversation: Conversation,
    messageId: number
  ) => {
    dispatch({
      type: "OPEN_READER",
      conversationId: conversation.id,
      firstMatchedMessageId: messageId
    })
    setSelectedConversation(conversation)
    setCurrentPage("timeline")
  }

  const handleBack = () => {
    dispatch({ type: "BACK_TO_LIST" })
    setSelectedConversation(null)
  }

  const handleNavigate = (page: PageId) => {
    setCurrentPage(page)
    if (
      page === "insights" &&
      insightsGuide.active &&
      insightsGuide.step === 0
    ) {
      void insightsGuide.advance(1)
    }
  }

  useEffect(() => {
    const applyRoute = (route: SidepanelRoute) => {
      const page = pageFromRoute(route)
      setCurrentPage(page)
      if (page === "timeline") {
        dispatch({ type: "BACK_TO_LIST" })
        setSelectedConversation(null)
      }
    }

    const handleNavigationMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return
      const candidate = message as { type?: string; route?: unknown }
      if (
        candidate.type === "NAVIGATE_SIDEPANEL" &&
        isSidepanelRoute(candidate.route)
      ) {
        applyRoute(candidate.route)
      }
    }

    void consumeSidepanelNavigation()
      .then((route) => {
        if (route) applyRoute(route)
      })
      .catch(() => undefined)
    chrome.runtime.onMessage.addListener(handleNavigationMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(handleNavigationMessage)
    }
  }, [])

  const openLibrary = (showExploreGuide = false) => {
    const fallbackUrl = chrome.runtime.getURL(
      showExploreGuide
        ? "options.html?tab=library&onboarding=explore-tab"
        : "options.html?tab=library"
    )
    const openDashboard = () => {
      if (showExploreGuide) {
        chrome.tabs.create({ url: fallbackUrl, active: true })
        return
      }
      if (chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage(() => {
          if (chrome.runtime?.lastError) {
            chrome.tabs.create({ url: fallbackUrl })
          }
        })
        return
      }
      chrome.tabs.create({ url: fallbackUrl })
    }

    if (chrome.storage?.local) {
      const payload: Record<string, unknown> = {
        [DASHBOARD_NAV_REQUEST_KEY]: {
          tab: "library",
          requestedAt: Date.now()
        }
      }
      if (showExploreGuide) {
        payload[ONBOARDING_EXPLORE_PROMPT_PENDING_KEY] = "explore_tab"
      }
      chrome.storage.local.set(payload, openDashboard)
      return
    }

    openDashboard()
  }

  const handleNavigateToLibrary = () => {
    if (exploreGuide.active && exploreGuide.step === 0) {
      void exploreGuide.advance(1).then(() => openLibrary(true))
      return
    }
    openLibrary()
  }

  const handleNavigateToData = () => {
    setCurrentPage("data")
  }

  const openInsightsGuide = async () => {
    setCurrentPage("insights")
    await insightsGuide.advance(1)
  }

  const completeInsightsGuide = async () => {
    await insightsGuide.complete()
    focusFinalOnboardingPage()
  }

  const isReaderMode =
    threadsState.mode === "reader_loading_messages" ||
    threadsState.mode === "reader_building_index" ||
    threadsState.mode === "reader_ready"
  const readerFirstMatchedMessageId = isReaderMode
    ? threadsState.firstMatchedMessageId
    : null
  const readerSearchModel =
    threadsState.mode === "reader_ready" ? threadsState.searchModel : null
  const readerQuery = getReaderQuery(threadsState.session)
  const shouldShowReader =
    currentPage === "timeline" && isReaderMode && selectedConversation

  return (
    <div className="flex h-screen w-full bg-bg-tertiary">
      <div className="flex h-full flex-1 overflow-hidden bg-bg-primary">
        <main className="min-w-0 flex-1">
          {shouldShowReader ? (
            <ReaderView
              conversation={selectedConversation}
              onBack={handleBack}
              refreshToken={refreshToken}
              mode={threadsState.mode}
              searchQuery={readerQuery}
              firstMatchedMessageId={readerFirstMatchedMessageId}
              searchModel={readerSearchModel}
              dispatch={dispatch}
            />
          ) : currentPage === "timeline" ? (
            <TimelinePage
              session={threadsState.session}
              dispatch={dispatch}
              onSelectConversation={handleSelectConversation}
              refreshToken={refreshToken}
            />
          ) : currentPage === "insights" ? (
            <InsightsPage
              conversation={selectedConversation}
              refreshToken={refreshToken}
              pipelineProgressEvent={pipelineProgressEvent}
              onOpenWeeklyHighlight={handleOpenWeeklyHighlight}
            />
          ) : currentPage === "settings" ? (
            <SettingsPage onNavigateToData={handleNavigateToData} />
          ) : currentPage === "data" ? (
            <DataPage />
          ) : null}
        </main>

        <Dock
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onNavigateToLibrary={handleNavigateToLibrary}
        />
      </div>
      {exploreGuide.active && exploreGuide.step === 0 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="open-library"]'
          icon="🐱"
          message="现在点击这里进入资料库面板"
          placement="top"
          onSkip={async () => {
            await exploreGuide.advance(1)
            openLibrary(true)
          }}
          onEndDemo={exploreGuide.end}
        />
      ) : null}
      {insightsGuide.active && insightsGuide.step === 0 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="insights-button"]'
          icon="✨"
          targetIcon="🐱"
          message="点击侧栏的“洞察”，查看个人成长周报"
          placement="top"
          primaryLabel="打开洞察"
          onPrimary={openInsightsGuide}
          onSkip={openInsightsGuide}
          onEndDemo={insightsGuide.end}
        />
      ) : null}
      {insightsGuide.active && insightsGuide.step >= 1 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="weekly-report"]'
          icon="📈"
          targetIcon="📈"
          message="洞察会梳理一周内的对话主题、关键进展和成长线索，生成你的个人成长周报。"
          placement="bottom"
          primaryLabel="完成演示"
          onPrimary={completeInsightsGuide}
          onSkip={completeInsightsGuide}
          onEndDemo={insightsGuide.end}
        />
      ) : null}
    </div>
  )
}

export default VestiSidepanel
