import { useEffect, useReducer, useRef, useState } from "react";
import type { Conversation, PageId } from "~lib/types";
import type { InsightPipelineProgressPayload } from "~lib/messaging/protocol";
import { isInsightPipelineProgressMessage } from "~lib/messaging/protocol";
import { Dock } from "./components/Dock";
import { TimelinePage } from "./pages/TimelinePage";
import { InsightsPage } from "./pages/InsightsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReaderView } from "./containers/ReaderView";
import { DataPage } from "./pages/DataPage";
import {
  createInitialThreadsState,
  getReaderQuery,
  resolveFirstMatchedIdForConversation,
  threadsReducer,
} from "./lib/threadsSearchReducer";

const DASHBOARD_NAV_REQUEST_KEY = "vesti_dashboard_open_tab";

export function VestiSidepanel() {
  const [currentPage, setCurrentPage] = useState<PageId>("timeline");
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [threadsState, dispatch] = useReducer(
    threadsReducer,
    undefined,
    () => createInitialThreadsState()
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [pipelineProgressEvent, setPipelineProgressEvent] =
    useState<InsightPipelineProgressPayload | null>(null);
  const latestPipelineSeqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const handler = (message: unknown) => {
      if (!message || typeof message !== "object") return;

      if (isInsightPipelineProgressMessage(message)) {
        const { pipelineId, seq } = message.payload;
        const lastSeq = latestPipelineSeqRef.current[pipelineId] ?? 0;
        if (seq > lastSeq) {
          latestPipelineSeqRef.current[pipelineId] = seq;
          setPipelineProgressEvent(message.payload);
        }
        return;
      }

      const type = (message as { type?: string }).type;
      if (type === "VESTI_DATA_UPDATED") {
        setRefreshToken(Date.now());
      }
    };
    chrome?.runtime?.onMessage?.addListener(handler);
    return () => {
      chrome?.runtime?.onMessage?.removeListener?.(handler);
    };
  }, []);

  const handleSelectConversation = (conversation: Conversation) => {
    const firstMatchedMessageId = resolveFirstMatchedIdForConversation(
      threadsState.session,
      conversation.id
    );
    dispatch({
      type: "OPEN_READER",
      conversationId: conversation.id,
      firstMatchedMessageId,
    });
    setSelectedConversation(conversation);
  };

  const handleOpenWeeklyHighlight = (
    conversation: Conversation,
    messageId: number
  ) => {
    dispatch({
      type: "OPEN_READER",
      conversationId: conversation.id,
      firstMatchedMessageId: messageId,
    });
    setSelectedConversation(conversation);
    setCurrentPage("timeline");
  };

  const handleBack = () => {
    dispatch({ type: "BACK_TO_LIST" });
    setSelectedConversation(null);
  };

  const handleNavigate = (page: PageId) => {
    setCurrentPage(page);
  };

  const handleNavigateToLibrary = () => {
    const fallbackUrl = chrome.runtime.getURL("options.html?tab=library");
    const openDashboard = () => {
      if (chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage(() => {
          if (chrome.runtime?.lastError) {
            chrome.tabs.create({ url: fallbackUrl });
          }
        });
        return;
      }
      chrome.tabs.create({ url: fallbackUrl });
    };

    if (chrome.storage?.local) {
      chrome.storage.local.set(
        {
          [DASHBOARD_NAV_REQUEST_KEY]: {
            tab: "library",
            requestedAt: Date.now(),
          },
        },
        openDashboard
      );
      return;
    }

    openDashboard();
  };

  const handleNavigateToData = () => {
    setCurrentPage("data");
  };

  const isReaderMode =
    threadsState.mode === "reader_loading_messages" ||
    threadsState.mode === "reader_building_index" ||
    threadsState.mode === "reader_ready";
  const readerFirstMatchedMessageId = isReaderMode
    ? threadsState.firstMatchedMessageId
    : null;
  const readerSearchModel =
    threadsState.mode === "reader_ready" ? threadsState.searchModel : null;
  const readerQuery = getReaderQuery(threadsState.session);
  const shouldShowReader =
    currentPage === "timeline" && isReaderMode && selectedConversation;

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
    </div>
  );
}

export default VestiSidepanel;

