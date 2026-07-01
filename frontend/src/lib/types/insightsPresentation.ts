export interface ArtifactMetaData {
  title: string;
  generated_at: string;
  tags: string[];
  fallback: boolean;
  range_label?: string;
}

export interface ChatSummaryData {
  meta: ArtifactMetaData;
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
  plain_text?: string;
}

export interface WeeklySummaryData {
  meta: ArtifactMetaData;
  highlights: string[];
  recurring_questions: string[];
  cross_domain_echoes?: Array<{
    domain_a: string;
    domain_b: string;
    shared_logic: string;
    evidence_ids: number[];
  }>;
  unresolved_threads: string[];
  suggested_focus: string[];
  evidence: Array<{
    conversation_id: number;
    note: string;
  }>;
  insufficient_data: boolean;
  plain_text?: string;
}

export interface WeeklyRecapData {
  meta: ArtifactMetaData;
  greeting: string;
  persona_tag: string;
  mood_emoji: string;
  stats: {
    conversation_count: number;
    active_days: number;
    streak_weeks: number;
    top_platform: string;
    week_over_week_delta: number | null;
  };
  highlight: { title: string; detail: string } | null;
  narrative: string[];
  plain_text?: string;
}
