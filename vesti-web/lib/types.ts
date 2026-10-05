export type * from "../../packages/vesti-ui/src/types";

export interface SummaryRecord {
  id: number;
  conversationId: number;
  content: string;
  structured?: Record<string, unknown> | null;
  modelId: string;
  createdAt: number;
  sourceUpdatedAt: number;
}
