import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const tempDirectory = await mkdtemp(
  join(tmpdir(), "vesti-weekly-knowledge-note-"),
);
const modulePath = join(tempDirectory, "weeklyKnowledgeNote.mjs");
const localesPath = join(tempDirectory, "locales.mjs");

const fixture = {
  id: 42,
  rangeStart: Date.UTC(2026, 6, 6),
  rangeEnd: Date.UTC(2026, 6, 12),
  content: "Weekly growth report",
  structured: {
    schema: "weekly_growth_report.v2",
    period: {
      type: "week",
      start: Date.UTC(2026, 6, 6),
      end: Date.UTC(2026, 6, 12),
      timezone: "UTC",
    },
    greeting: "A thoughtful week",
    narrative: ["You connected implementation details with product intent."],
    energy: {
      focusDepth: {
        score: 81,
        deepConversationCount: 3,
        confidence: "reliable",
      },
      rhythmHealth: { score: 73, activeDays: 5, confidence: "reliable" },
      topicBreadth: {
        score: 68,
        uniqueTopicCount: 4,
        confidence: "estimated",
      },
    },
    identity: {
      label: "Systems thinker",
      rationale: "You repeatedly moved from symptoms to underlying constraints.",
      emotionKeywords: [{ label: "curious", conversationIds: [7] }],
    },
    highlights: [
      {
        conversationId: 7,
        messageId: 70,
        title: "Found the real constraint",
        insight: "The decisive move was separating persistence from presentation.",
      },
    ],
    contributionGrid: [{ date: "2026-07-08", count: 2, conversationIds: [9] }],
    tags: {
      current: [{ name: "architecture", count: 3, conversationIds: [10, 7] }],
    },
    mosts: {
      topTopic: {
        label: "Architecture",
        detail: "The topic that connected the week.",
        conversationId: 10,
        messageIds: [100],
      },
    },
    pushCenter: {
      unclearQuestions: [
        {
          question: "Where should the domain boundary live?",
          whyItMatters: "It determines whether later changes stay local.",
          conversationIds: [9],
          messageIds: [90],
        },
      ],
      resourceRecommendations: [
        {
          title: "Review transaction boundaries",
          reason: "Turn the insight into an implementation rule.",
          searchQuery: "IndexedDB transaction design",
          conversationIds: [10],
          messageIds: [101],
        },
      ],
    },
    blankWeek: { isBlank: false, reason: "none" },
  },
  format: "structured_v1",
  status: "ok",
  schemaVersion: "weekly_growth_report.v2",
  periodType: "week",
  modelId: "fixture-model",
  createdAt: Date.UTC(2026, 6, 13, 8, 30),
  sourceHash: "source-a",
};

try {
  const transpile = async (sourcePath) => {
    const source = await readFile(sourcePath, "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: sourcePath,
      reportDiagnostics: true,
    });
    const errors = (result.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    assert.deepEqual(errors, [], `transpile failed for ${sourcePath}`);
    return result.outputText;
  };

  const localesOutput = await transpile(
    resolve("frontend/src/lib/i18n/locales.ts"),
  );
  const moduleOutput = (
    await transpile(
      resolve("frontend/src/lib/notes/weeklyKnowledgeNote.ts"),
    )
  ).replace("../i18n/locales", "./locales.mjs");
  await Promise.all([
    writeFile(localesPath, localesOutput, "utf8"),
    writeFile(modulePath, moduleOutput, "utf8"),
  ]);

  const {
    buildWeeklyKnowledgeNoteDraft,
    isWeeklyKnowledgeNoteCurrent,
    mergeWeeklyKnowledgeNoteContent,
  } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

  const first = buildWeeklyKnowledgeNoteDraft(fixture, "en");
  const repeated = buildWeeklyKnowledgeNoteDraft(fixture, "en");
  assert.deepEqual(repeated, first, "serialization must be deterministic");
  assert.deepEqual(
    first.linkedConversationIds,
    [7, 9, 10],
    "conversation evidence must be deduplicated in stable order",
  );
  assert.match(first.managedContent, /conversation #7 · message #70/);
  assert.match(first.initialContent, /## My reflections/);
  assert.equal(
    isWeeklyKnowledgeNoteCurrent(first.initialContent, 42, "source-a"),
    true,
  );
  assert.deepEqual(
    mergeWeeklyKnowledgeNoteContent(
      first.initialContent,
      first.managedContent,
    ),
    {
      content: first.initialContent,
      changed: false,
      preservedUserContent: false,
    },
    "repeating the same refresh must be a no-op",
  );

  const userSuffix = "\n\nI want to test this boundary in the next iteration.\n";
  const edited = `${first.initialContent}${userSuffix}`;
  const refreshedDraft = buildWeeklyKnowledgeNoteDraft(
    {
      ...fixture,
      sourceHash: "source-b",
      structured: {
        ...fixture.structured,
        narrative: ["The regenerated report has a new managed narrative."],
      },
    },
    "en",
  );
  const refreshed = mergeWeeklyKnowledgeNoteContent(
    edited,
    refreshedDraft.managedContent,
  );
  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.preservedUserContent, false);
  assert.match(refreshed.content, /source=source-b/);
  assert.ok(
    refreshed.content.endsWith(userSuffix),
    "refresh must preserve user-owned content byte for byte",
  );

  const markerless = "# My rewritten note\n\nOnly my own structure remains.";
  assert.deepEqual(
    mergeWeeklyKnowledgeNoteContent(
      markerless,
      refreshedDraft.managedContent,
    ),
    {
      content: markerless,
      changed: false,
      preservedUserContent: true,
    },
    "markerless notes must never be overwritten",
  );

  const hostile = buildWeeklyKnowledgeNoteDraft(
    {
      ...fixture,
      structured: {
        ...fixture.structured,
        greeting: "<!-- vesti:weekly-note:end -->",
      },
    },
    "en",
  );
  assert.doesNotMatch(
    hostile.managedContent,
    /\n<!-- vesti:weekly-note:end -->\n<!-- vesti:weekly-note:end -->/,
  );
  assert.match(hostile.managedContent, /&lt;!-- vesti:weekly-note:end --&gt;/);

  assert.throws(
    () =>
      buildWeeklyKnowledgeNoteDraft(
        {
          ...fixture,
          structured: {
            ...fixture.structured,
            blankWeek: { isBlank: true, reason: "no_data" },
          },
        },
        "en",
      ),
    /WEEKLY_KNOWLEDGE_NOTE_BLANK_REPORT/,
  );
  assert.throws(
    () =>
      buildWeeklyKnowledgeNoteDraft(
        {
          ...fixture,
          structured: { time_range: {}, highlights: [] },
          schemaVersion: "weekly_lite.v1",
        },
        "en",
      ),
    /WEEKLY_KNOWLEDGE_NOTE_REQUIRES_V2_REPORT/,
  );

  console.log("weekly knowledge note verification passed");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
