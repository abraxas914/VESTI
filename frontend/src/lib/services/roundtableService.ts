// AI 圆桌 (Roundtable) backend — isolated from the Explore agent pipeline. Each
// seat is one callInference with a distinct persona system prompt (sequential, so
// later seats can react to earlier ones via a shared transcript); a Moderator
// then synthesizes a structured verdict. Runs in the background context (where the
// LLM config + fetch live). Degrades to a clear message when no LLM is configured.

import { callInference } from "./llmService";
import { resolveUsableLlmConfig } from "./promptLlmService";
import {
  MAX_PANEL_SEATS,
  PERSONA_LIBRARY,
} from "./roundtablePresets";
import type {
  RoundtablePersonaId,
  RoundtableResult,
  RoundtableSeatTurn,
  RoundtableSynthesis,
} from "../types";
import { logger } from "../utils/logger";

interface RoundtableOpts {
  lang?: "zh" | "en";
}

function personaName(id: RoundtablePersonaId, lang: "zh" | "en"): string {
  const p = PERSONA_LIBRARY[id];
  return lang === "zh" ? p.nameZh : p.nameEn;
}

function systemPromptFor(id: RoundtablePersonaId, lang: "zh" | "en"): string {
  const p = PERSONA_LIBRARY[id];
  return lang === "zh" ? p.systemPromptZh : p.systemPromptEn;
}

function buildSeatPrompt(
  question: string,
  prior: RoundtableSeatTurn[],
  lang: "zh" | "en",
): string {
  const transcript = prior
    .filter((t) => t.ok && t.content.trim())
    .map((t) => `[${personaName(t.personaId, lang)}]\n${t.content.trim()}`)
    .join("\n\n");
  const qLabel = lang === "zh" ? "讨论的问题" : "Question";
  const pLabel = lang === "zh" ? "在你之前的发言" : "What earlier panelists said";
  return transcript
    ? `${qLabel}: ${question}\n\n${pLabel}:\n${transcript}\n\n${lang === "zh" ? "请给出你的发言。" : "Now give your statement."}`
    : `${qLabel}: ${question}\n\n${lang === "zh" ? "请给出你的发言。" : "Give your statement."}`;
}

function normalizeSynthesis(raw: unknown): RoundtableSynthesis | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const recommendation = typeof o.recommendation === "string" ? o.recommendation : "";
  const synthesis: RoundtableSynthesis = {
    consensus: arr(o.consensus),
    disagreements: arr(o.disagreements),
    recommendation,
    openQuestions: arr(o.openQuestions),
  };
  if (
    synthesis.consensus.length === 0 &&
    synthesis.disagreements.length === 0 &&
    !synthesis.recommendation &&
    synthesis.openQuestions.length === 0
  ) {
    return null;
  }
  return synthesis;
}

function extractJsonObject(text: string): string {
  const fenced = text.replace(/```json|```/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  return start !== -1 && end > start ? fenced.slice(start, end + 1) : fenced;
}

export async function runRoundtablePanel(
  question: string,
  personaIds: RoundtablePersonaId[],
  opts: RoundtableOpts = {},
): Promise<RoundtableResult> {
  const startedAt = Date.now();
  // Match the question's language so personas + synthesis read naturally.
  const detected: "zh" | "en" = /[一-鿿]/.test(question) ? "zh" : "en";
  const lang: "zh" | "en" = opts.lang ?? detected;
  const seats = personaIds
    .filter((id) => id !== "moderator" && PERSONA_LIBRARY[id])
    .slice(0, MAX_PANEL_SEATS);

  const config = await resolveUsableLlmConfig();
  if (!config) {
    return {
      question,
      lang,
      grounded: false,
      seatTurns: [],
      synthesis: null,
      synthesisRaw:
        lang === "zh"
          ? "未配置可用的模型。请在设置中连接模型后再试。"
          : "No model configured. Connect a model in Settings and try again.",
      sources: [],
      totalDurationMs: Date.now() - startedAt,
    };
  }

  // Seats, sequential so later panelists react to earlier ones.
  const seatTurns: RoundtableSeatTurn[] = [];
  for (const id of seats) {
    const seatStart = Date.now();
    try {
      const result = await callInference(config, buildSeatPrompt(question, seatTurns, lang), {
        systemPrompt: systemPromptFor(id, lang),
      });
      seatTurns.push({
        personaId: id,
        content: (result.content ?? "").trim(),
        ok: true,
        durationMs: Date.now() - seatStart,
      });
    } catch (error) {
      seatTurns.push({
        personaId: id,
        content: "",
        ok: false,
        error: (error as Error)?.message ?? String(error),
        durationMs: Date.now() - seatStart,
      });
      logger.debug("service", "Roundtable seat failed", {
        persona: id,
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  // Moderator synthesis (structured JSON).
  let synthesis: RoundtableSynthesis | null = null;
  let synthesisRaw = "";
  const usable = seatTurns.filter((t) => t.ok && t.content.trim());
  if (usable.length > 0) {
    const transcript = usable
      .map((t) => `[${personaName(t.personaId, lang)}]\n${t.content.trim()}`)
      .join("\n\n");
    const modPrompt =
      lang === "zh"
        ? `讨论的问题: ${question}\n\n全部成员发言:\n${transcript}\n\n请汇总为结构化结论。`
        : `Question: ${question}\n\nAll panel statements:\n${transcript}\n\nSynthesize into the structured verdict.`;
    try {
      const result = await callInference(config, modPrompt, {
        systemPrompt: systemPromptFor("moderator", lang),
        responseFormat: "json_object",
      });
      const rawContent = (result.content ?? "").trim();
      try {
        synthesis = normalizeSynthesis(JSON.parse(extractJsonObject(rawContent)));
      } catch {
        synthesis = null;
      }
      if (synthesis) {
        synthesisRaw = "";
      } else {
        // Never surface the raw moderator JSON to the UI / exported note — keep
        // it only for debugging and show a friendly fallback instead.
        logger.debug("service", "Roundtable synthesis produced no structure", {
          raw: rawContent.slice(0, 500),
        });
        synthesisRaw =
          lang === "zh"
            ? "未能将圆桌结论整理成结构化形式，请重试。"
            : "Couldn't structure the panel's synthesis. Please try again.";
      }
    } catch (error) {
      synthesisRaw =
        lang === "zh" ? "汇总失败，请重试。" : "Synthesis failed, please retry.";
      logger.debug("service", "Roundtable moderator failed", {
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  return {
    question,
    lang,
    grounded: false,
    seatTurns,
    synthesis,
    synthesisRaw,
    sources: [],
    totalDurationMs: Date.now() - startedAt,
  };
}
