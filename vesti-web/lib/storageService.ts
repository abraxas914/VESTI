import type { ExploreMode, ExploreAskOptions, CreateNoteInput, UpdateNoteChanges } from '../../packages/vesti-ui/src/types';
import type {
  ChatSummaryData,
  Annotation,
  Conversation,
  ExportFormat,
  GardenerResult,
  Message,
  Note,
  Platform,
  RelatedConversation,
  RagResponse,
  StorageUsageSnapshot,
  SummaryRecord,
  Topic,
} from './types';

type ConversationFilters = {
  platform?: Platform;
  search?: string;
  dateRange?: { start: number; end: number };
};

type RequestMessage =
  | {
      type: 'GET_CONVERSATIONS';
      target?: 'offscreen';
      requestId?: string;
      payload?: ConversationFilters;
    }
  | {
      type: 'GET_TOPICS';
      target?: 'offscreen';
      requestId?: string;
    }
  | {
      type: 'CREATE_TOPIC';
      target?: 'offscreen';
      requestId?: string;
      payload: { name: string; parent_id?: number | null };
    }
  | {
      type: 'UPDATE_CONVERSATION_TOPIC';
      target?: 'offscreen';
      requestId?: string;
      payload: { id: number; topic_id: number | null };
    }
  | {
      type: 'UPDATE_CONVERSATION';
      target?: 'offscreen';
      requestId?: string;
      payload: { id: number; changes: { topic_id?: number | null; is_starred?: boolean; tags?: string[] } };
    }
  | {
      type: 'RUN_GARDENER';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: 'GET_RELATED_CONVERSATIONS';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number; limit?: number };
    }
  | {
      type: 'GET_ALL_EDGES';
      target?: 'offscreen';
      requestId?: string;
      payload?: { threshold?: number; conversationIds?: number[] };
    }
  | {
      type: 'RENAME_FOLDER_TAG';
      target?: 'offscreen';
      requestId?: string;
      payload: { from: string; to: string };
    }
  | {
      type: 'MOVE_FOLDER_TAG';
      target?: 'offscreen';
      requestId?: string;
      payload: { from: string; to: string };
    }
  | {
      type: 'REMOVE_FOLDER_TAG';
      target?: 'offscreen';
      requestId?: string;
      payload: { tag: string };
    }
  | {
      type: 'ASK_KNOWLEDGE_BASE';
      target?: 'offscreen';
      requestId?: string;
      payload: { query: string; sessionId?: string; limit?: number; mode?: ExploreMode; options?: ExploreAskOptions };
    }
  | {
      type: 'GET_MESSAGES';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: 'GET_ANNOTATIONS_BY_CONVERSATION';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: 'SAVE_ANNOTATION';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number; messageId: number; contentText: string };
    }
  | {
      type: 'DELETE_ANNOTATION';
      target?: 'offscreen';
      requestId?: string;
      payload: { annotationId: number };
    }
  | {
      type: 'EXPORT_ANNOTATION_TO_NOTE';
      target?: 'offscreen';
      requestId?: string;
      payload: { annotationId: number };
    }
  | {
      type: 'EXPORT_ANNOTATION_TO_NOTION';
      target?: 'offscreen';
      requestId?: string;
      payload: { annotationId: number };
    }
  | {
      type: 'GET_NOTES';
      target?: 'offscreen';
      requestId?: string;
    }
  | {
      type: 'CREATE_NOTE';
      target?: 'offscreen';
      requestId?: string;
      payload: CreateNoteInput;
    }
  | {
      type: 'UPDATE_NOTE';
      target?: 'offscreen';
      requestId?: string;
      payload: { id: number; changes: UpdateNoteChanges };
    }
  | {
      type: 'DELETE_NOTE';
      target?: 'offscreen';
      requestId?: string;
      payload: { id: number };
    }
  | {
      type: 'GET_CONVERSATION_SUMMARY';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: 'GENERATE_CONVERSATION_SUMMARY';
      target?: 'offscreen';
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: 'GET_STORAGE_USAGE';
      target?: 'offscreen';
      requestId?: string;
    }
  | {
      type: 'EXPORT_DATA';
      target?: 'offscreen';
      requestId?: string;
      payload: { format: ExportFormat };
    }
  | {
      type: 'CLEAR_ALL_DATA';
      target?: 'offscreen';
      requestId?: string;
    }
  | {
      type: 'DELETE_CONVERSATION';
      target?: 'offscreen';
      requestId?: string;
      payload: { id: number };
    }
  | {
      type: 'UPDATE_CONVERSATION_TITLE';
      target?: 'offscreen';
      requestId?: string;
      payload: { id: number; title: string };
    };

type ResponseDataMap = {
  GET_CONVERSATIONS: Conversation[];
  GET_TOPICS: Topic[];
  CREATE_TOPIC: { topic: Topic };
  UPDATE_CONVERSATION_TOPIC: { updated: boolean; conversation: Conversation };
  UPDATE_CONVERSATION: { updated: boolean; conversation: Conversation };
  RUN_GARDENER: { updated: boolean; conversation: Conversation; result: GardenerResult };
  GET_RELATED_CONVERSATIONS: RelatedConversation[];
  GET_ALL_EDGES: Array<{ source: number; target: number; weight: number }>;
  RENAME_FOLDER_TAG: { updated: number };
  MOVE_FOLDER_TAG: { updated: number };
  REMOVE_FOLDER_TAG: { updated: number };
  ASK_KNOWLEDGE_BASE: RagResponse & { sessionId: string };
  GET_MESSAGES: Message[];
  GET_ANNOTATIONS_BY_CONVERSATION: Annotation[];
  SAVE_ANNOTATION: { annotation: Annotation };
  DELETE_ANNOTATION: { deleted: boolean };
  EXPORT_ANNOTATION_TO_NOTE: { note: Note };
  EXPORT_ANNOTATION_TO_NOTION: { pageId: string; url?: string };
  GET_NOTES: Note[];
  CREATE_NOTE: { note: Note };
  UPDATE_NOTE: { note: Note };
  DELETE_NOTE: { deleted: boolean };
  GET_CONVERSATION_SUMMARY: SummaryRecord | null;
  GENERATE_CONVERSATION_SUMMARY: SummaryRecord;
  GET_STORAGE_USAGE: StorageUsageSnapshot;
  EXPORT_DATA: { content: string; filename: string; mime: string };
  CLEAR_ALL_DATA: { cleared: boolean };
  DELETE_CONVERSATION: { deleted: boolean };
  UPDATE_CONVERSATION_TITLE: { updated: boolean; conversation: Conversation };
};

type ConversationSummaryV2Payload = {
  core_question: string;
  thinking_journey: Array<{
    step: number;
    speaker: "User" | "AI";
    assertion: string;
    real_world_anchor: string | null;
  }>;
  key_insights: Array<{
    term: string;
    definition: string;
  }>;
  unresolved_threads: string[];
  meta_observations: {
    thinking_style: string;
    emotional_tone: string;
    depth_level: "superficial" | "moderate" | "deep";
  };
  actionable_next_steps: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeSpeaker = (value: unknown): "User" | "AI" =>
  value === "User" || value === "AI" ? value : "AI";

const normalizeDepthLevel = (
  value: unknown
): "superficial" | "moderate" | "deep" => {
  if (value === "superficial" || value === "moderate" || value === "deep") {
    return value;
  }
  return "moderate";
};

const isConversationSummaryV2 = (
  value: unknown
): value is ConversationSummaryV2Payload => {
  if (!isRecord(value)) return false;
  if (typeof value.core_question !== "string") return false;
  if (!Array.isArray(value.thinking_journey)) return false;
  if (!Array.isArray(value.key_insights)) return false;
  if (!Array.isArray(value.unresolved_threads)) return false;
  if (!isRecord(value.meta_observations)) return false;
  if (!Array.isArray(value.actionable_next_steps)) return false;
  return true;
};

function toChatSummaryData(
  record: SummaryRecord | null
): ChatSummaryData | null {
  if (!record) return null;
  const generatedAt =
    typeof record.createdAt === "number"
      ? new Date(record.createdAt).toISOString()
      : new Date().toISOString();
  const fallbackText = typeof record.content === "string" ? record.content.trim() : "";
  const fallbackTitle = fallbackText.split("\n")[0] || "Summary";

  const structured = record.structured;
  if (!isConversationSummaryV2(structured)) {
    return {
      meta: {
        title: fallbackTitle,
        generated_at: generatedAt,
        tags: [],
        fallback: true,
      },
      core_question: fallbackText || "Summary",
      thinking_journey: [],
      key_insights: [],
      unresolved_threads: [],
      meta_observations: {
        thinking_style: "",
        emotional_tone: "",
        depth_level: "moderate",
      },
      actionable_next_steps: [],
      plain_text: fallbackText,
    };
  }

  const journey = structured.thinking_journey
    .filter((item) => isRecord(item))
    .map((item, index) => ({
      step: typeof item.step === "number" ? item.step : index + 1,
      speaker: normalizeSpeaker(item.speaker),
      assertion: typeof item.assertion === "string" ? item.assertion : "",
      real_world_anchor:
        typeof item.real_world_anchor === "string" || item.real_world_anchor === null
          ? item.real_world_anchor
          : null,
    }))
    .filter((item) => item.assertion.length > 0);

  const insights = structured.key_insights
    .filter((item) => isRecord(item))
    .map((item) => ({
      term: typeof item.term === "string" ? item.term : "",
      definition: typeof item.definition === "string" ? item.definition : "",
    }))
    .filter((item) => item.term.length > 0 || item.definition.length > 0);

  const unresolved = structured.unresolved_threads.filter(
    (item): item is string => typeof item === "string"
  );
  const nextSteps = structured.actionable_next_steps.filter(
    (item): item is string => typeof item === "string"
  );

  return {
    meta: {
      title: structured.core_question || fallbackTitle,
      generated_at: generatedAt,
      tags: [],
      fallback: false,
    },
    core_question: structured.core_question,
    thinking_journey: journey,
    key_insights: insights,
    unresolved_threads: unresolved,
    meta_observations: {
      thinking_style:
        structured.meta_observations?.thinking_style ??
        "",
      emotional_tone:
        structured.meta_observations?.emotional_tone ??
        "",
      depth_level: normalizeDepthLevel(structured.meta_observations?.depth_level),
    },
    actionable_next_steps: nextSteps,
    plain_text: fallbackText,
  };
}

type ResponseMessage<T extends keyof ResponseDataMap = keyof ResponseDataMap> =
  | {
      ok: true;
      type: T;
      requestId?: string;
      data: ResponseDataMap[T];
    }
  | {
      ok: false;
      type: T;
      requestId?: string;
      error: string;
    };

const DEFAULT_TIMEOUT_MS = 4000;
const LONG_RUNNING_TIMEOUT_MS = 120000;

function assertChromeRuntime(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('CHROME_RUNTIME_UNAVAILABLE');
  }
}

function sendMessageWithTimeout<T extends keyof ResponseDataMap>(
  message: RequestMessage,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ResponseMessage<T>> {
  assertChromeRuntime();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response: ResponseMessage<T>) => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function sendRequest<T extends keyof ResponseDataMap>(
  message: RequestMessage,
  timeoutMs?: number
): Promise<ResponseDataMap[T]> {
  const response = await sendMessageWithTimeout<T>(message, timeoutMs);
  if (!response.ok) {
    const failure = response as Extract<ResponseMessage<T>, { ok: false }>;
    throw new Error(failure.error || 'Request failed');
  }
  return response.data;
}

export async function getConversations(
  filters?: ConversationFilters
): Promise<Conversation[]> {
  return sendRequest({
    type: 'GET_CONVERSATIONS',
    target: 'offscreen',
    payload: filters,
  }) as Promise<Conversation[]>;
}

export async function getTopics(): Promise<Topic[]> {
  return sendRequest({
    type: 'GET_TOPICS',
    target: 'offscreen',
  }) as Promise<Topic[]>;
}

export async function createTopic(
  name: string,
  parent_id?: number | null
): Promise<Topic> {
  const result = (await sendRequest({
    type: 'CREATE_TOPIC',
    target: 'offscreen',
    payload: { name, parent_id },
  })) as { topic: Topic };
  return result.topic;
}

export async function updateConversationTopic(
  id: number,
  topic_id: number | null
): Promise<Conversation> {
  const result = (await sendRequest({
    type: 'UPDATE_CONVERSATION_TOPIC',
    target: 'offscreen',
    payload: { id, topic_id },
  })) as { updated: boolean; conversation: Conversation };
  return result.conversation;
}

export async function updateConversation(
  id: number,
  changes: { topic_id?: number | null; is_starred?: boolean; tags?: string[] }
): Promise<{ updated: boolean; conversation: Conversation }> {
  return sendRequest({
    type: 'UPDATE_CONVERSATION',
    target: 'offscreen',
    payload: { id, changes },
  }) as Promise<{ updated: boolean; conversation: Conversation }>;
}

export async function runGardener(
  conversationId: number
): Promise<{ updated: boolean; conversation: Conversation; result: GardenerResult }> {
  const result = (await sendRequest({
    type: 'RUN_GARDENER',
    target: 'offscreen',
    payload: { conversationId },
  })) as { updated: boolean; conversation: Conversation; result: GardenerResult };

  if (result.updated && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result;
}

export async function getRelatedConversations(
  conversationId: number,
  limit?: number
): Promise<RelatedConversation[]> {
  return sendRequest({
    type: 'GET_RELATED_CONVERSATIONS',
    target: 'offscreen',
    payload: { conversationId, limit },
  }, LONG_RUNNING_TIMEOUT_MS) as Promise<RelatedConversation[]>;
}

export async function getAllEdges(
  options: { threshold?: number; conversationIds?: number[] } = {}
): Promise<Array<{ source: number; target: number; weight: number }>> {
  return sendRequest({
    type: 'GET_ALL_EDGES',
    target: 'offscreen',
    payload: { threshold: options.threshold ?? 0.3, conversationIds: options.conversationIds },
  }, LONG_RUNNING_TIMEOUT_MS) as Promise<Array<{ source: number; target: number; weight: number }>>;
}

export async function renameFolderTag(
  from: string,
  to: string
): Promise<{ updated: number }> {
  const result = (await sendRequest({
    type: 'RENAME_FOLDER_TAG',
    target: 'offscreen',
    payload: { from, to },
  }, LONG_RUNNING_TIMEOUT_MS)) as { updated: number };

  if (result.updated > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result;
}

export async function moveFolderTag(
  from: string,
  to: string
): Promise<{ updated: number }> {
  const result = (await sendRequest({
    type: 'MOVE_FOLDER_TAG',
    target: 'offscreen',
    payload: { from, to },
  }, LONG_RUNNING_TIMEOUT_MS)) as { updated: number };

  if (result.updated > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result;
}

export async function removeFolderTag(
  tag: string
): Promise<{ updated: number }> {
  const result = (await sendRequest({
    type: 'REMOVE_FOLDER_TAG',
    target: 'offscreen',
    payload: { tag },
  }, LONG_RUNNING_TIMEOUT_MS)) as { updated: number };

  if (result.updated > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result;
}

export async function askKnowledgeBase(
  query: string,
  sessionId?: string,
  limit?: number,
  mode?: ExploreMode,
  options?: ExploreAskOptions
): Promise<RagResponse & { sessionId: string }> {
  return sendRequest({
    type: 'ASK_KNOWLEDGE_BASE',
    target: 'offscreen',
    payload: { query, sessionId, limit, mode, options },
  }, LONG_RUNNING_TIMEOUT_MS) as Promise<RagResponse & { sessionId: string }>;
}

export async function getMessages(
  conversationId: number
): Promise<Message[]> {
  return sendRequest({
    type: 'GET_MESSAGES',
    target: 'offscreen',
    payload: { conversationId },
  }) as Promise<Message[]>;
}

export async function getAnnotationsByConversation(
  conversationId: number
): Promise<Annotation[]> {
  return sendRequest({
    type: 'GET_ANNOTATIONS_BY_CONVERSATION',
    target: 'offscreen',
    payload: { conversationId },
  }) as Promise<Annotation[]>;
}

export async function saveAnnotation(payload: {
  conversationId: number;
  messageId: number;
  contentText: string;
}): Promise<Annotation> {
  const result = (await sendRequest({
    type: 'SAVE_ANNOTATION',
    target: 'offscreen',
    payload,
  })) as { annotation: Annotation };

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result.annotation;
}

export async function deleteAnnotation(annotationId: number): Promise<void> {
  await sendRequest({
    type: 'DELETE_ANNOTATION',
    target: 'offscreen',
    payload: { annotationId },
  });

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }
}

export async function exportAnnotationToNote(annotationId: number): Promise<Note> {
  const result = (await sendRequest({
    type: 'EXPORT_ANNOTATION_TO_NOTE',
    target: 'offscreen',
    payload: { annotationId },
  })) as { note: Note };

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result.note;
}

export async function exportAnnotationToNotion(
  annotationId: number
): Promise<{ pageId: string; url?: string }> {
  return (await sendRequest({
    type: 'EXPORT_ANNOTATION_TO_NOTION',
    target: 'offscreen',
    payload: { annotationId },
  })) as { pageId: string; url?: string };
}

export async function deleteConversation(id: number): Promise<void> {
  await sendRequest({
    type: 'DELETE_CONVERSATION',
    target: 'offscreen',
    payload: { id },
  });

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }
}

export async function updateConversationTitle(
  id: number,
  title: string
): Promise<Conversation> {
  const result = (await sendRequest({
    type: 'UPDATE_CONVERSATION_TITLE',
    target: 'offscreen',
    payload: { id, title },
  })) as { updated: boolean; conversation: Conversation };

  if (result.updated && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'VESTI_DATA_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result.conversation;
}

export async function getNotes(): Promise<Note[]> {
  const data = (await sendRequest({
    type: 'GET_NOTES',
    target: 'offscreen',
  })) as Note[];
  return data;
}

export async function saveNote(
  data: CreateNoteInput
): Promise<Note> {
  const result = (await sendRequest({
    type: 'CREATE_NOTE',
    target: 'offscreen',
    payload: data,
  })) as { note: Note };
  return result.note;
}

export async function updateNote(
  id: number,
  changes: UpdateNoteChanges
): Promise<Note> {
  const result = (await sendRequest({
    type: 'UPDATE_NOTE',
    target: 'offscreen',
    payload: { id, changes },
  })) as { note: Note };
  return result.note;
}

export async function deleteNote(id: number): Promise<void> {
  await sendRequest({
    type: 'DELETE_NOTE',
    target: 'offscreen',
    payload: { id },
  });
}

export async function getSummary(
  conversationId: number
): Promise<ChatSummaryData | null> {
  const record = (await sendRequest({
    type: 'GET_CONVERSATION_SUMMARY',
    target: 'offscreen',
    payload: { conversationId },
  }, LONG_RUNNING_TIMEOUT_MS)) as SummaryRecord | null;
  return toChatSummaryData(record);
}

export async function generateSummary(
  conversationId: number
): Promise<ChatSummaryData> {
  const record = (await sendRequest({
    type: 'GENERATE_CONVERSATION_SUMMARY',
    target: 'offscreen',
    payload: { conversationId },
  }, LONG_RUNNING_TIMEOUT_MS)) as SummaryRecord;
  const data = toChatSummaryData(record);
  if (!data) {
    throw new Error('SUMMARY_GENERATION_FAILED');
  }
  return data;
}

export async function getStorageUsage(): Promise<StorageUsageSnapshot> {
  return sendRequest({
    type: 'GET_STORAGE_USAGE',
    target: 'offscreen',
  }) as Promise<StorageUsageSnapshot>;
}

export async function exportData(
  format: ExportFormat
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const result = (await sendRequest({
    type: 'EXPORT_DATA',
    target: 'offscreen',
    payload: { format },
  })) as { content: string; filename: string; mime: string };

  return {
    blob: new Blob([result.content], { type: result.mime }),
    filename: result.filename,
    mime: result.mime,
  };
}

export async function clearAllData(): Promise<void> {
  await sendRequest({
    type: 'CLEAR_ALL_DATA',
    target: 'offscreen',
  });
}
