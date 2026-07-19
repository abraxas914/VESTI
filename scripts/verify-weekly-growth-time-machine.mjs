import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const DAY = 24 * 60 * 60 * 1_000;
const CURRENT_START = Date.UTC(2026, 6, 13);
const WEEK_SPAN = 6 * DAY;

function rangeForWeeksAgo(weeksAgo) {
  const rangeStart = CURRENT_START - weeksAgo * 7 * DAY;
  return { rangeStart, rangeEnd: rangeStart + WEEK_SPAN };
}

function seriesPoint(
  weeksAgo,
  {
    conversationCount = 0,
    activeDays = 0,
    focusDepthScore = 0,
    rhythmScore = 0,
    topicBreadthScore = 0,
  } = {},
) {
  return {
    ...rangeForWeeksAgo(weeksAgo),
    conversationCount,
    activeDays,
    focusDepthScore,
    rhythmScore,
    topicBreadthScore,
  };
}

function report(
  id,
  weeksAgo,
  {
    metrics = {},
    identityLabel = null,
    topics = null,
    blank = false,
    periodType = "week",
  } = {},
) {
  const range = rangeForWeeksAgo(weeksAgo);
  const point = seriesPoint(weeksAgo, metrics);
  return {
    id,
    ...range,
    content: `report-${id}`,
    structured: {
      schema: "weekly_growth_report.v2",
      period: { type: periodType, ...range, timezone: "UTC" },
      energy: {
        focusDepth: { score: point.focusDepthScore },
        rhythmHealth: { score: point.rhythmScore },
        topicBreadth: { score: point.topicBreadthScore },
      },
      growth: { series: [point] },
      identity: identityLabel ? { label: identityLabel } : undefined,
      tags:
        topics === null
          ? undefined
          : { current: topics.map((name) => ({ name, count: 1 })) },
      blankWeek: { isBlank: blank, reason: blank ? "no_data" : "none" },
    },
    format: "structured_v1",
    status: "ok",
    schemaVersion: "weekly_growth_report.v2",
    periodType,
    modelId: "fixture-model",
    createdAt: range.rangeEnd + id,
    sourceHash: `source-${id}`,
  };
}

const currentRange = rangeForWeeksAgo(0);
const current = report(100, 0, {
  metrics: {
    conversationCount: 10,
    activeDays: 5,
    focusDepthScore: 80,
    rhythmScore: 70,
    topicBreadthScore: 60,
  },
  identityLabel: "Systems thinker",
  topics: ["architecture", "Architecture", "retrieval", "new idea"],
});
current.structured.growth.series = [
  seriesPoint(4),
  seriesPoint(2, {
    conversationCount: 4,
    activeDays: 3,
    focusDepthScore: 55,
    rhythmScore: 62,
    topicBreadthScore: 58,
  }),
  seriesPoint(1, {
    conversationCount: 5,
    activeDays: 4,
    focusDepthScore: 59,
    rhythmScore: 64,
    topicBreadthScore: 69,
  }),
  seriesPoint(0, {
    conversationCount: 10,
    activeDays: 5,
    focusDepthScore: 80,
    rhythmScore: 70,
    topicBreadthScore: 60,
  }),
];

const enrichedBaseline = report(90, 1, {
  metrics: {
    conversationCount: 6,
    activeDays: 4,
    focusDepthScore: 60,
    rhythmScore: 65,
    topicBreadthScore: 70,
  },
  identityLabel: "System builder",
  topics: ["architecture", "old topic"],
});
const returningEvidence = report(70, 3, {
  metrics: {
    conversationCount: 3,
    activeDays: 2,
    focusDepthScore: 50,
    rhythmScore: 80,
    topicBreadthScore: 40,
  },
  identityLabel: "Explorer",
  topics: ["retrieval"],
});
const blank = report(60, 4, {
  metrics: { conversationCount: 8, focusDepthScore: 75 },
  blank: true,
});
const legacy = {
  ...report(50, 5),
  structured: { time_range: rangeForWeeksAgo(5), highlights: [] },
  schemaVersion: "weekly_lite.v1",
};
const overlapping = report(40, 1);
overlapping.rangeStart = currentRange.rangeStart - 2 * DAY;
overlapping.rangeEnd = currentRange.rangeStart + 2 * DAY;
overlapping.structured.period = {
  type: "week",
  start: overlapping.rangeStart,
  end: overlapping.rangeEnd,
  timezone: "UTC",
};

const tempDirectory = await mkdtemp(
  join(tmpdir(), "vesti-weekly-growth-time-machine-"),
);
const modulePath = join(tempDirectory, "weeklyGrowthTimeMachine.mjs");

try {
  const sourcePath = resolve(
    "frontend/src/lib/weekly/weeklyGrowthTimeMachine.ts",
  );
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
  assert.deepEqual(errors, [], "time-machine domain module must transpile");
  await writeFile(modulePath, result.outputText, "utf8");

  const {
    buildWeeklyGrowthTimeMachine,
    compareWeeklyGrowthTimeMachine,
    isWeeklyGrowthTimeMachineSource,
  } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

  const candidates = [
    legacy,
    overlapping,
    enrichedBaseline,
    blank,
    returningEvidence,
  ];
  const data = buildWeeklyGrowthTimeMachine(current, candidates);
  assert.deepEqual(
    buildWeeklyGrowthTimeMachine(current, candidates),
    data,
    "the same reports must produce deterministic history",
  );
  assert.deepEqual(
    data.history.map((point) => point.storedEvidence),
    [true, false, true],
    "stored reports must enrich matching series points without duplicates",
  );
  assert.equal(data.enrichedHistoryCount, 2);
  assert.deepEqual(
    data.current.topics,
    ["architecture", "retrieval", "new idea"],
    "topic labels must be normalized and deduplicated deterministically",
  );
  assert.ok(
    data.history.every((point) => point.rangeEnd < currentRange.rangeStart),
    "overlapping periods must never become a comparison baseline",
  );
  assert.ok(
    data.history.every((point) => point.metrics.conversationCount > 0),
    "all-zero embedded placeholders must be ignored",
  );
  assert.equal(isWeeklyGrowthTimeMachineSource(blank), false);
  assert.equal(isWeeklyGrowthTimeMachineSource(legacy), false);

  const comparison = compareWeeklyGrowthTimeMachine(
    data,
    data.history[0].key,
  );
  assert.ok(comparison);
  assert.deepEqual(
    comparison.metrics.map(({ key, delta, personalBest }) => ({
      key,
      delta,
      personalBest,
    })),
    [
      { key: "focusDepthScore", delta: 20, personalBest: true },
      { key: "rhythmScore", delta: 5, personalBest: false },
      { key: "topicBreadthScore", delta: -10, personalBest: false },
    ],
  );
  assert.equal(comparison.conversationDelta, 4);
  assert.equal(comparison.activeDaysDelta, 1);
  assert.equal(comparison.momentumScore, 5);
  assert.equal(comparison.momentum, "rising");
  assert.equal(comparison.strongestMetric, "focusDepthScore");
  assert.deepEqual(comparison.topicMovement, {
    emerging: ["new idea"],
    returning: ["retrieval"],
    cooled: ["old topic"],
  });
  assert.deepEqual(comparison.identityTrail, [
    "Explorer",
    "System builder",
    "Systems thinker",
  ]);

  const embeddedComparison = compareWeeklyGrowthTimeMachine(
    data,
    data.history[1].key,
  );
  assert.equal(
    embeddedComparison.topicMovement,
    null,
    "missing topic evidence must not be treated as an empty topic set",
  );
  assert.equal(
    compareWeeklyGrowthTimeMachine(
      data,
      "missing-baseline",
    ).baseline.key,
    data.history[0].key,
    "an unavailable selection must fall back to the newest baseline",
  );

  const manyCandidates = Array.from({ length: 20 }, (_, index) =>
    report(200 + index, index + 1, {
      metrics: {
        conversationCount: index + 1,
        activeDays: 1,
        focusDepthScore: index + 1,
      },
    }),
  );
  const limited = buildWeeklyGrowthTimeMachine(current, manyCandidates);
  assert.equal(limited.history.length, 12);
  assert.deepEqual(
    limited.history.map((point) => point.rangeStart),
    [...limited.history]
      .map((point) => point.rangeStart)
      .sort((left, right) => right - left),
    "history must remain newest-first",
  );

  assert.throws(
    () => buildWeeklyGrowthTimeMachine(blank, []),
    /WEEKLY_GROWTH_TIME_MACHINE_REQUIRES_NON_BLANK_V2/,
  );
  assert.throws(
    () => buildWeeklyGrowthTimeMachine(legacy, []),
    /WEEKLY_GROWTH_TIME_MACHINE_REQUIRES_NON_BLANK_V2/,
  );
  assert.throws(
    () =>
      buildWeeklyGrowthTimeMachine(
        report(300, 0, { periodType: "quarter" }),
        [],
      ),
    /WEEKLY_GROWTH_TIME_MACHINE_REQUIRES_WEEKLY_PERIOD/,
  );

  console.log("weekly growth time machine verification passed");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
