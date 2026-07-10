import type {
  AitiProfile,
  DashboardLabels,
  LearnProfile,
  RoundtableResult,
  RoundtablePersonaId,
} from "../types";

// Pure Markdown builders for Explore outputs, so the generic "Send to…" can
// promote a reflection (AITI portrait / Learn digest / Roundtable synthesis) into
// Notion / Obsidian / clipboard as a clean document — same payload, many targets.

export function buildAitiMarkdown(
  profile: AitiProfile,
  labels: DashboardLabels["aiti"],
): string {
  const lines: string[] = [`# ${labels.title}`, ""];
  if (labels.empoweringIntro) lines.push(labels.empoweringIntro, "");
  lines.push(`## ${labels.strengthsTitle}`, "");
  const axisStrength: Record<string, [string, string]> = {
    depth: [labels.axisDepthLeftStrength, labels.axisDepthRightStrength],
    maker: [labels.axisMakerLeftStrength, labels.axisMakerRightStrength],
    focus: [labels.axisFocusLeftStrength, labels.axisFocusRightStrength],
    affect: [labels.axisAffectLeftStrength, labels.axisAffectRightStrength],
    curiosity: [labels.axisCuriosityLeftStrength, labels.axisCuriosityRightStrength],
    interdisciplinary: [labels.axisInterdisciplinaryLeftStrength, labels.axisInterdisciplinaryRightStrength],
  };
  for (const axis of profile.axes) {
    const pair = axisStrength[axis.key];
    if (!pair) continue;
    lines.push(`- ${axis.score >= 50 ? pair[1] : pair[0]}`);
  }
  if (profile.trends && profile.trends.length > 0) {
    lines.push("", `## ${labels.trendsTitle}`, "");
    for (const t of profile.trends) {
      const dir = t.direction === "rising" ? labels.trendRising : t.direction === "falling" ? labels.trendFalling : labels.trendStable;
      lines.push(`- ${axisStrength[t.key] ? t.key : t.key}: ${dir}${t.delta ? ` (+${t.delta})` : ""}`);
    }
  }
  if (profile.obsessions.length > 0) {
    lines.push("", `## ${labels.obsessionsTitle}`, "");
    for (const o of profile.obsessions) lines.push(`- ${o.term} (×${o.count})`);
  }
  lines.push("", `_${labels.sample.replace("{n}", String(profile.sampleSize))}_`);
  return lines.join("\n").trim() + "\n";
}

export function buildLearnMarkdown(
  profile: LearnProfile,
  labels: DashboardLabels["learn"],
): string {
  const lines: string[] = [`# ${labels.title}`, ""];
  if (profile.domains.length > 0) {
    lines.push(`## ${labels.domainsTitle}`, "");
    for (const d of profile.domains) {
      lines.push(
        `- **${d.name || labels.uncategorized}** — ${labels.domainConversations.replace("{n}", String(d.count))}`,
      );
    }
    lines.push("");
  }
  if (profile.glossary.length > 0) {
    lines.push(`## ${labels.glossaryTitle}`, "");
    for (const g of profile.glossary) {
      lines.push(g.definition ? `- **${g.term}**: ${g.definition}` : `- **${g.term}**`);
    }
    lines.push("");
  }
  if (profile.openLoops.length > 0) {
    lines.push(`## ${labels.openLoopsTitle}`, "");
    for (const loop of profile.openLoops) lines.push(`- ${loop.text}`);
    lines.push("");
  }
  if (profile.learningPath && profile.learningPath.length > 0) {
    lines.push(`## ${labels.learningPathTitle}`, "");
    for (const stage of profile.learningPath) {
      lines.push(
        `### ${labels.learningPathStage.replace("{n}", String(stage.stage))}: ${stage.title}`,
      );
      lines.push(stage.description);
      if (stage.concepts.length > 0) {
        lines.push("Concepts: " + stage.concepts.join(", "));
      }
      lines.push("");
    }
  }
  if (profile.reviewQueue && profile.reviewQueue.length > 0) {
    lines.push(`## ${labels.reviewQueueTitle}`, "");
    for (const item of profile.reviewQueue) {
      lines.push(`- **${item.term}**`);
    }
    lines.push("");
  }
  if (profile.goals && profile.goals.length > 0) {
    lines.push(`## ${labels.goalsTitle}`, "");
    for (const goal of profile.goals) {
      lines.push(`- **${goal.text}** — ${goal.progress}%`);
    }
    lines.push("");
  }
  lines.push(`_${labels.sample.replace("{n}", String(profile.sampleSize))}_`);
  return lines.join("\n").trim() + "\n";
}

export function buildRoundtableMarkdown(
  result: RoundtableResult,
  labels: DashboardLabels["roundtable"],
): string {
  const nameOf = (id: RoundtablePersonaId): string =>
    ({
      skeptic: labels.personaSkeptic,
      optimist: labels.personaOptimist,
      pragmatist: labels.personaPragmatist,
      domain_expert: labels.personaDomainExpert,
      devils_advocate: labels.personaDevilsAdvocate,
      moderator: "Moderator",
    })[id];

  const lines: string[] = [`# ${labels.title}`, "", `> ${result.question}`, ""];
  lines.push(`## ${labels.seatsTitle}`, "");
  for (const turn of result.seatTurns) {
    if (!turn.ok || !turn.content.trim()) continue;
    lines.push(`### ${nameOf(turn.personaId)}`, "", turn.content.trim(), "");
  }
  const s = result.synthesis;
  if (s) {
    lines.push(`## ${labels.synthesisTitle}`, "");
    const section = (title: string, items: string[]) => {
      if (!items || items.length === 0) return;
      lines.push(`### ${title}`, "");
      for (const it of items) lines.push(`- ${it}`);
      lines.push("");
    };
    section(labels.consensus, s.consensus);
    section(labels.disagreements, s.disagreements);
    if (s.recommendation) lines.push(`### ${labels.recommendation}`, "", s.recommendation, "");
    section(labels.openQuestions, s.openQuestions);
  } else if (result.synthesisRaw) {
    lines.push(`## ${labels.synthesisTitle}`, "", result.synthesisRaw, "");
  }
  return lines.join("\n").trim() + "\n";
}
