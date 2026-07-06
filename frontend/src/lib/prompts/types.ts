import type { Conversation, ConversationSummaryV2, Message } from "../types";
import type { SupportedLocale } from "../i18n/locales";
import type { ExportPromptProfile } from "../services/llmModelProfile";
import type { WeeklyStats } from "../services/weeklyStats";

export type PromptType =
  | "compaction"
  | "conversationSummary"
  | "weeklyDigest"
  | "weeklyRecap"
  | "exportCompact"
  | "exportSummary";
export type PromptVariant = "current" | "experimental";

export interface CompactionPromptPayload {
  conversationTitle?: string;
  conversationPlatform?: string;
  conversationOriginAt?: number;
  messages: Message[];
  transcriptOverride?: string;
  locale?: SupportedLocale;
}

export interface ConversationSummaryPromptPayload {
  conversationTitle?: string;
  conversationPlatform?: string;
  conversationOriginAt?: number;
  messages: Message[];
  transcriptOverride?: string;
  locale?: SupportedLocale;
}

export interface WeeklyDigestPromptPayload {
  conversations: Conversation[];
  rangeStart: number;
  rangeEnd: number;
  summaryEntries?: Array<{
    conversationId: number;
    summary: ConversationSummaryV2;
  }>;
  selectedSummaries?: Array<{
    conversationId: number;
    summary: string;
  }>;
  maxConversations?: number;
  locale?: SupportedLocale;
}

export interface WeeklyRecapPromptPayload {
  stats: WeeklyStats;
  highlightContext: {
    title: string;
    topic: string | null;
    messageCount: number;
    turnCount: number;
    isStarred: boolean;
    summaryGist?: string;
  } | null;
  rangeStart: number;
  rangeEnd: number;
  locale: SupportedLocale;
}

export interface ExportCompressionPromptPayload {
  conversationTitle?: string;
  conversationPlatform?: string;
  conversationOriginAt?: number;
  messages: Message[];
  transcriptOverride?: string;
  locale?: "zh" | "en";
  profile?: ExportPromptProfile;
}

export interface ExportPlannerSignal {
  label: string;
  confidence?: "low" | "medium" | "high";
  note?: string;
  targetId?: string;
}

export interface ExportPlannerPromptPayload {
  datasetId: string;
  conversationTitle?: string;
  conversationPlatform?: string;
  conversationOriginAt?: number;
  messages: Message[];
  locale?: "zh" | "en";
  profile?: ExportPromptProfile;
  messageSignals?: ExportPlannerSignal[];
  conversationSignals?: ExportPlannerSignal[];
}

export type ExportDistillMode = "handoff" | "knowledge";
export type AnnotationConfidence = "low" | "medium" | "high";
export type AnnotationSource = "rule" | "heuristic" | "manual" | "llm";
export type ExportDensity = "low" | "medium" | "high";

export interface MessageAnnotation {
  id: string;
  targetType: "message";
  targetId: string;
  label: string;
  confidence: AnnotationConfidence;
  source: AnnotationSource;
  note?: string;
}

export interface ConversationAnnotation {
  id: string;
  targetType: "conversation";
  targetId: string;
  label: string;
  confidence: AnnotationConfidence;
  source: AnnotationSource;
  note?: string;
}

export interface AnnotationEnvelope {
  schemaVersion: "v1";
  conversationId: string;
  sourcePlatform: string;
  messageAnnotations: MessageAnnotation[];
  conversationAnnotations: ConversationAnnotation[];
}

export interface ExportDatasetMetadata {
  title?: string;
  url?: string;
  startedAt?: string;
  capturedAt?: string;
  selectedMessageCount: number;
}

export interface ExportDatasetMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  createdAt?: string;
  content: string;
  artifactRefs?: string[];
}

export interface ExportDataset {
  schemaVersion: "v1";
  mode: ExportDistillMode;
  locale: string;
  conversationId: string;
  sourcePlatform: string;
  metadata: ExportDatasetMetadata;
  messages: ExportDatasetMessage[];
  annotations: AnnotationEnvelope;
}

export interface PlanningNotesBase {
  schemaVersion: "v1";
  mode: ExportDistillMode;
  datasetId: string;
  focusSummary: string;
  inclusionRules: string[];
  exclusionRules: string[];
  riskFlags: string[];
}

export interface HandoffPlanningNotes extends PlanningNotesBase {
  mode: "handoff";
  taskFrame: string;
  artifactDensity: ExportDensity;
  decisionDensity: ExportDensity;
  unresolvedDensity: ExportDensity;
  handoffFocus: string[];
}

export interface KnowledgePlanningNotes extends PlanningNotesBase {
  mode: "knowledge";
  coreQuestion: string;
  progressionDensity: ExportDensity;
  artifactDensity: ExportDensity;
  actionabilityDensity: ExportDensity;
  knowledgeValue: string[];
}

export interface HandoffEvidenceArtifact {
  type: "code" | "command" | "path" | "api" | "reference";
  label: string;
  content: string;
  sourceMessageIds: string[];
}

export interface HandoffEvidenceSkeleton {
  schemaVersion: "v1";
  mode: "handoff";
  background: string[];
  keyQuestions: string[];
  decisionsAndAnswers: Array<{
    decision: string;
    answer: string;
    rationale?: string;
  }>;
  reusableArtifacts: HandoffEvidenceArtifact[];
  unresolved: Array<{
    item: string;
    nextStep?: string;
  }>;
}

export interface HandoffEvidenceCompactorPromptPayload {
  dataset: ExportDataset;
  planningNotes: HandoffPlanningNotes;
}

export interface CompactComposerInput {
  schemaVersion: "v1";
  mode: "handoff";
  profile: string;
  locale: string;
  evidence: HandoffEvidenceSkeleton;
  expectedHeadings: [
    "## Background",
    "## Key Questions",
    "## Decisions And Answers",
    "## Reusable Artifacts",
    "## Unresolved",
  ];
}

export interface RepairInput {
  schemaVersion: "v1";
  mode: ExportDistillMode;
  profile: string;
  failedOutput: string;
  invalidReasons: string[];
  expectedHeadings: string[];
  upstreamArtifactId: string;
}

export interface PromptVersion<TPayload> {
  version: string;
  createdAt: string;
  description: string;
  system: string;
  fallbackSystem?: string;
  userTemplate: (payload: TPayload) => string;
  fallbackTemplate: (payload: TPayload) => string;
}

export interface PromptPayloadMap {
  compaction: CompactionPromptPayload;
  conversationSummary: ConversationSummaryPromptPayload;
  weeklyDigest: WeeklyDigestPromptPayload;
  weeklyRecap: WeeklyRecapPromptPayload;
  exportCompact: ExportCompressionPromptPayload;
  exportSummary: ExportCompressionPromptPayload;
}

export type PromptConfig = {
  [K in keyof PromptPayloadMap]: PromptVersion<PromptPayloadMap[K]>;
};
