// Sidepanel large-library performance benchmark (1500 conversations x 20 messages).
//
// Measures the Dexie-side read paths that run on every sidepanel open/refresh:
//   listConversations / getTopics / getDashboardStats / searchConversationMatchesByText
//
// Method: bundles BOTH the pristine repository (git show HEAD:...) and the
// current working-tree repository, seeds one fake-indexeddb dataset, and runs
// each function against both bundles — a same-process before/after comparison.
//
// Run from the repo root:
//   node scripts/perf-sidepanel-bench.mjs
//
// First run auto-installs `fake-indexeddb` into .tmp/perf-deps (gitignored).
// Numbers are in-process proxy metrics (fake-indexeddb, not browser IDB) — use
// them for before/after comparison, not as absolute browser timings.

import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tmpDir = path.join(repoRoot, ".tmp", "perf");
const depsDir = path.join(repoRoot, ".tmp", "perf-deps");
const baselineTsPath = path.join(
  repoRoot,
  "frontend",
  "src",
  "lib",
  "db",
  "repository.baseline.ts"
);
fs.mkdirSync(tmpDir, { recursive: true });

const CONVERSATIONS = 1500;
const MESSAGES_PER_CONVERSATION = 20;
const TOPICS = 30;
const RUNS = 7;

// --- deps -----------------------------------------------------------------

const frontendRequire = createRequire(
  path.join(repoRoot, "frontend", "package.json")
);
const depsRequire = createRequire(path.join(depsDir, "package.json"));

function ensureFakeIndexedDb() {
  try {
    depsRequire.resolve("fake-indexeddb/auto");
    return;
  } catch {
    console.log("[bench] installing fake-indexeddb into .tmp/perf-deps ...");
    fs.mkdirSync(depsDir, { recursive: true });
    // A local manifest keeps npm from walking up into the pnpm workspace.
    fs.writeFileSync(
      path.join(depsDir, "package.json"),
      JSON.stringify({ name: "vesti-perf-deps", private: true })
    );
    execSync("npm install --no-save --no-audit --no-fund fake-indexeddb", {
      cwd: depsDir,
      stdio: "inherit",
    });
  }
}

function bundle(entrySource, outfileName) {
  const esbuild = frontendRequire("esbuild");
  const entry = path.join(tmpDir, `${outfileName}.entry.ts`);
  fs.writeFileSync(entry, entrySource);
  const outfile = path.join(tmpDir, `${outfileName}.cjs`);
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    tsconfig: path.join(repoRoot, "frontend", "tsconfig.json"),
    outfile,
    logLevel: "silent",
  });
  return outfile;
}

function entrySource(repositoryPath) {
  return [
    'export { db } from "../../frontend/src/lib/db/schema";',
    "export {",
    "  listConversations,",
    "  getTopics,",
    "  getDashboardStats,",
    "  searchConversationMatchesByText,",
    `} from "${repositoryPath}";`,
    "",
  ].join("\n");
}

// --- seed -------------------------------------------------------------------

const WORDS =
  "alpha beta gamma design database schema query vector index cache memory thread conversation capture summary topic delta epsilon lambda sigma omega react state render component hook effect".split(
    " "
  );

function makeText(rng, minWords, maxWords) {
  const count = minWords + Math.floor(rng() * (maxWords - minWords));
  const words = [];
  for (let i = 0; i < count; i += 1) {
    words.push(WORDS[Math.floor(rng() * WORDS.length)]);
  }
  return words.join(" ");
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seed(db) {
  const rng = mulberry32(42);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const topics = [];
  for (let i = 0; i < TOPICS; i += 1) {
    topics.push({
      parent_id: null,
      name: `Topic ${i + 1}`,
      created_at: now - 400 * day,
      updated_at: now - 400 * day,
    });
  }
  await db.topics.bulkAdd(topics);

  const conversations = [];
  const messages = [];
  const annotations = [];
  const summaries = [];
  for (let c = 0; c < CONVERSATIONS; c += 1) {
    const conversationId = c + 1;
    const created = now - Math.floor(rng() * 365) * day;
    const updated = created + Math.floor(rng() * 10) * day;
    conversations.push({
      uuid: `uuid-${conversationId}`,
      platform: "ChatGPT",
      title: `Conversation ${conversationId} ${makeText(rng, 2, 5)}`,
      snippet: makeText(rng, 8, 20),
      url: `https://chatgpt.com/c/${conversationId}`,
      source_created_at: created,
      first_captured_at: created + 1000,
      last_captured_at: updated,
      created_at: created,
      updated_at: updated,
      message_count: MESSAGES_PER_CONVERSATION,
      turn_count: MESSAGES_PER_CONVERSATION / 2,
      is_archived: false,
      is_trash: false,
      tags: [],
      topic_id: c % 3 === 0 ? (c % TOPICS) + 1 : null,
      is_starred: c % 10 === 0,
    });

    for (let m = 0; m < MESSAGES_PER_CONVERSATION; m += 1) {
      const role = m % 2 === 0 ? "user" : "ai";
      const text = makeText(rng, 40, 120);
      const hasAst = role === "ai" && rng() < 0.6;
      messages.push({
        conversation_id: conversationId,
        role,
        content_text: text,
        content_ast: hasAst
          ? {
              type: "root",
              children: [
                { type: "p", children: [{ type: "text", text }] },
              ],
            }
          : null,
        content_ast_version: hasAst ? "ast_v2" : null,
        degraded_nodes_count: 0,
        citations: [],
        attachments: [],
        artifacts: [],
        normalized_html_snapshot: null,
        created_at: created + m * 60000,
      });
    }

    if (c % 5 === 0) {
      annotations.push({
        conversation_id: conversationId,
        message_id: c * MESSAGES_PER_CONVERSATION + 1,
        content_text: `note ${makeText(rng, 3, 8)}`,
        created_at: updated,
        days_after: 0,
      });
    }
    if (c % 10 === 0) {
      summaries.push({
        conversationId,
        content: makeText(rng, 20, 40),
        structured: null,
        format: "plain_text",
        status: "ok",
        modelId: "bench",
        createdAt: updated,
        sourceUpdatedAt: updated,
      });
    }
  }

  await db.conversations.bulkAdd(conversations);
  await db.messages.bulkAdd(messages);
  await db.annotations.bulkAdd(annotations);
  await db.summaries.bulkAdd(summaries);
}

// --- measure ------------------------------------------------------------------

async function measure(fn, runs, { warmup = true } = {}) {
  if (warmup) {
    await fn();
  }
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

function row(label, before, after) {
  const delta = before > 0 ? `${((after / before) * 100).toFixed(0)}%` : "-";
  console.log(
    `  ${label.padEnd(44)} ${before.toFixed(1).padStart(9)} ${after
      .toFixed(1)
      .padStart(9)} ${delta.padStart(7)}`
  );
}

async function main() {
  ensureFakeIndexedDb();
  depsRequire("fake-indexeddb/auto");

  // Pristine baseline: the repository as of HEAD, materialized next to the
  // current one so its relative imports resolve identically. Removed in
  // `finally` so the working tree stays clean.
  const baselineSource = execSync(
    "git show HEAD:frontend/src/lib/db/repository.ts",
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }
  );
  fs.writeFileSync(baselineTsPath, baselineSource);

  try {
    const baselineBundle = bundle(
      entrySource("../../frontend/src/lib/db/repository.baseline"),
      "repo-baseline"
    );
    const currentBundle = bundle(
      entrySource("../../frontend/src/lib/db/repository"),
      "repo-current"
    );

    const before = depsRequire(baselineBundle);
    const after = depsRequire(currentBundle);

    console.log(
      `[bench] seeding ${CONVERSATIONS} conversations x ${MESSAGES_PER_CONVERSATION} messages ...`
    );
    const seedStart = performance.now();
    // Both bundles share the same fake-indexeddb database (same Dexie name),
    // so seeding through one handle serves both.
    await seed(before.db);
    console.log(
      `[bench] seed done in ${((performance.now() - seedStart) / 1000).toFixed(1)}s`
    );

    const allIds = Array.from({ length: CONVERSATIONS }, (_, i) => i + 1);
    const runSearch = (repo) =>
      repo.searchConversationMatchesByText({
        query: "design database",
        conversationIds: allIds,
      });

    console.log("[bench] median timings (ms):");
    console.log(
      `  ${"".padEnd(44)} ${"BEFORE".padStart(9)} ${"AFTER".padStart(9)} ${"after%".padStart(7)}`
    );
    const tListB = await measure(() => before.listConversations(), RUNS);
    const tListA = await measure(() => after.listConversations(), RUNS);
    row("listConversations()", tListB, tListA);

    const tTopicsB = await measure(() => before.getTopics(), RUNS);
    const tTopicsA = await measure(() => after.getTopics(), RUNS);
    row("getTopics()", tTopicsB, tTopicsA);

    const tStatsB = await measure(() => before.getDashboardStats(), RUNS);
    const tStatsA = await measure(() => after.getDashboardStats(), RUNS);
    row("getDashboardStats()", tStatsB, tStatsA);

    // Single cold sample: the BEFORE search scans 30k messages through a
    // 1500-key anyOf (~5-6 min in fake-indexeddb), so there is no budget for
    // a median. AFTER is ~1 s, so the same single-sample rule is harmless.
    const tSearchB = await measure(() => runSearch(before), 1, {
      warmup: false,
    });
    const tSearchA = await measure(() => runSearch(after), 1, {
      warmup: false,
    });
    row('searchConversationMatchesByText("design database")', tSearchB, tSearchA);

    row(
      "one sidepanel refresh (list+topics+stats)",
      tListB + tTopicsB + tStatsB,
      tListA + tTopicsA + tStatsA
    );

    // Result-equivalence checks: the optimization must not change outputs.
    const [idsB, idsA] = await Promise.all([
      before.listConversations(),
      after.listConversations(),
    ]);
    const [searchB, searchA] = await Promise.all([
      runSearch(before),
      runSearch(after),
    ]);
    const [statsB, statsA] = await Promise.all([
      before.getDashboardStats(),
      after.getDashboardStats(),
    ]);
    const sameIds =
      idsB.length === idsA.length &&
      idsB.every((c, i) => c.id === idsA[i].id);
    const sameSearch =
      searchB.length === searchA.length &&
      searchB.every(
        (s, i) =>
          s.conversationId === searchA[i].conversationId &&
          s.score === searchA[i].score &&
          s.bestExcerpt === searchA[i].bestExcerpt
      );
    const heatmapKey = (s) =>
      s.firstCaptureHeatmapData.map((d) => `${d.date}:${d.count}`).join("|");
    const sameStats =
      statsB.firstCapturedTodayCount === statsA.firstCapturedTodayCount &&
      statsB.firstCaptureStreak === statsA.firstCaptureStreak &&
      heatmapKey(statsB) === heatmapKey(statsA);
    console.log(
      `[bench] equivalence: list=${sameIds ? "OK" : "MISMATCH"} search=${
        sameSearch ? "OK" : "MISMATCH"
      } stats=${sameStats ? "OK" : "MISMATCH"}`
    );
  } finally {
    fs.rmSync(baselineTsPath, { force: true });
  }
}

await main();
