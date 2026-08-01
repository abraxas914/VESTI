import { extractKeywords, tokenizeForMatch } from "./keywordExtraction";

// Legacy regex list kept for backward compatibility (insightUiUtils re-exports
// inferTechTagsFromText/resolveTechTags). New code should prefer
// buildHeuristicTags below.
export const TECH_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\breact\b/i, label: "React" },
  { pattern: /typescript|\bts\b/i, label: "TypeScript" },
  { pattern: /plasmo/i, label: "Plasmo" },
  { pattern: /tailwind/i, label: "Tailwind CSS" },
  { pattern: /dexie|indexeddb/i, label: "IndexedDB" },
  { pattern: /chrome extension|mv3|manifest/i, label: "Chrome Extension" },
  { pattern: /modelscope|qwen|deepseek/i, label: "ModelScope" },
  { pattern: /python/i, label: "Python" },
  { pattern: /node\.js|nodejs|node /i, label: "Node.js" },
  { pattern: /zod/i, label: "Zod" },
  { pattern: /parser|selector/i, label: "Parser" },
  { pattern: /prompt|schema/i, label: "Prompt Engineering" },
];

export interface DomainKeyword {
  pattern: RegExp;
  label: string;
  category:
    | "language"
    | "frontend"
    | "backend"
    | "ai"
    | "data"
    | "devops"
    | "writing"
    | "learning"
    | "career"
    | "life";
}

// Layered domain dictionary. Chinese and English concept words are kept as
// separate entries with language-native labels so tags stay in the
// conversation's own language; proper nouns (React, Python...) are shared.
export const DOMAIN_KEYWORDS: DomainKeyword[] = [
  // --- Programming languages ---
  { pattern: /typescript|(?<![a-z])\bts\b(?!x)/i, label: "TypeScript", category: "language" },
  { pattern: /javascript|(?<![a-z])\bjs\b/i, label: "JavaScript", category: "language" },
  { pattern: /\bpython\b/i, label: "Python", category: "language" },
  { pattern: /\bjava\b(?!script)/i, label: "Java", category: "language" },
  { pattern: /\bgolang\b|\bgo\s+(?:language|routine|module)/i, label: "Go", category: "language" },
  { pattern: /\brust\b/i, label: "Rust", category: "language" },
  { pattern: /\bc\+\+|\bcpp\b/i, label: "C++", category: "language" },
  { pattern: /\bc#|csharp|\.net\b/i, label: "C#", category: "language" },
  { pattern: /\bsql\b|数据库查询/i, label: "SQL", category: "language" },
  { pattern: /\bbash\b|\bshell\b|powershell|命令行/i, label: "Shell", category: "language" },
  { pattern: /\bhtml\b|\bcss\b/i, label: "HTML/CSS", category: "language" },
  // --- Frontend ---
  { pattern: /\breact\b/i, label: "React", category: "frontend" },
  { pattern: /\bvue\b/i, label: "Vue", category: "frontend" },
  { pattern: /\bangular\b/i, label: "Angular", category: "frontend" },
  { pattern: /\bsvelte\b/i, label: "Svelte", category: "frontend" },
  { pattern: /next\.?js/i, label: "Next.js", category: "frontend" },
  { pattern: /tailwind/i, label: "Tailwind CSS", category: "frontend" },
  { pattern: /chrome extension|浏览器扩展|浏览器插件|\bmv3\b|plasmo/i, label: "Chrome Extension", category: "frontend" },
  { pattern: /小程序/, label: "小程序", category: "frontend" },
  // --- Backend / infra ---
  { pattern: /node\.?js|\bexpress\b|\bkoa\b/i, label: "Node.js", category: "backend" },
  { pattern: /\bdjango\b|\bflask\b|fastapi/i, label: "Python Web", category: "backend" },
  { pattern: /\bspring\b/i, label: "Spring", category: "backend" },
  { pattern: /\bapi\b.{0,12}(design|设计)|restful|graphql/i, label: "API Design", category: "backend" },
  { pattern: /docker|kubernetes|\bk8s\b|容器化/i, label: "Docker/K8s", category: "devops" },
  { pattern: /\blinux\b|\bubuntu\b|\bcentos\b/i, label: "Linux", category: "devops" },
  { pattern: /\bgit\b|github|gitlab/i, label: "Git", category: "devops" },
  { pattern: /单元测试|unit test|\bvitest\b|\bjest\b|\bpytest\b/i, label: "Testing", category: "devops" },
  { pattern: /性能优化/, label: "性能优化", category: "devops" },
  { pattern: /performance (optimization|tuning)/i, label: "Performance", category: "devops" },
  // --- AI ---
  { pattern: /机器学习/, label: "机器学习", category: "ai" },
  { pattern: /machine learning|\bml\b/i, label: "Machine Learning", category: "ai" },
  { pattern: /深度学习|神经网络/, label: "深度学习", category: "ai" },
  { pattern: /deep learning|neural network/i, label: "Deep Learning", category: "ai" },
  { pattern: /大模型|大语言模型/, label: "大模型", category: "ai" },
  { pattern: /\bllm\b|large language model|\bgpt-?\d|chatgpt|claude|gemini|qwen|deepseek|kimi/i, label: "LLM", category: "ai" },
  { pattern: /提示词|提示工程/, label: "提示词工程", category: "ai" },
  { pattern: /prompt engineering|system prompt/i, label: "Prompt Engineering", category: "ai" },
  { pattern: /\brag\b|检索增强|向量检索|embedding|向量数据库/i, label: "RAG", category: "ai" },
  { pattern: /\bagent\b|智能体/i, label: "AI Agent", category: "ai" },
  // --- Data ---
  { pattern: /indexeddb|dexie/i, label: "IndexedDB", category: "data" },
  { pattern: /postgres|mysql|sqlite|mongodb|redis/i, label: "Database", category: "data" },
  { pattern: /数据分析/, label: "数据分析", category: "data" },
  { pattern: /data analy|pandas|numpy/i, label: "Data Analysis", category: "data" },
  { pattern: /爬虫|web scraping|crawler/i, label: "爬虫", category: "data" },
  { pattern: /\bexcel\b|表格公式/i, label: "Excel", category: "data" },
  { pattern: /数据可视化|visualization|echarts|d3\.js/i, label: "数据可视化", category: "data" },
  // --- Writing ---
  { pattern: /写作|文章|作文|文案/, label: "写作", category: "writing" },
  { pattern: /\bwriting\b|copywriting|\bessay\b/i, label: "Writing", category: "writing" },
  { pattern: /翻译/, label: "翻译", category: "writing" },
  { pattern: /translat(e|ion)/i, label: "Translation", category: "writing" },
  { pattern: /简历|求职信/, label: "简历", category: "writing" },
  { pattern: /\bresume\b|cover letter/i, label: "Resume", category: "writing" },
  { pattern: /邮件|周报|汇报/, label: "职场写作", category: "writing" },
  { pattern: /论文|学术写作|文献综述/, label: "论文", category: "writing" },
  { pattern: /\bpaper\b|academic writing|literature review/i, label: "Academic", category: "writing" },
  // --- Learning ---
  { pattern: /学习计划|学习方法|复习/, label: "学习", category: "learning" },
  { pattern: /learning plan|study plan/i, label: "Learning", category: "learning" },
  { pattern: /英语|雅思|托福|四六级/, label: "英语学习", category: "learning" },
  { pattern: /english learning|ielts|toefl|vocabulary/i, label: "English Learning", category: "learning" },
  { pattern: /数学|微积分|线性代数|概率论/, label: "数学", category: "learning" },
  { pattern: /\bmath\b|calculus|linear algebra|statistics/i, label: "Math", category: "learning" },
  { pattern: /考试|考研|考公/, label: "考试", category: "learning" },
  // --- Career ---
  { pattern: /面试|笔试/, label: "面试", category: "career" },
  { pattern: /\binterview\b/i, label: "Interview", category: "career" },
  { pattern: /职业规划|跳槽|升职|职场/, label: "职业发展", category: "career" },
  { pattern: /career (path|plan|advice)/i, label: "Career", category: "career" },
  { pattern: /产品经理|需求文档|产品设计/, label: "产品", category: "career" },
  { pattern: /product manager|\bprd\b/i, label: "Product", category: "career" },
  { pattern: /营销|运营|推广|获客/, label: "营销", category: "career" },
  { pattern: /marketing|\bseo\b|growth hack/i, label: "Marketing", category: "career" },
  { pattern: /创业|商业模式/, label: "创业", category: "career" },
  { pattern: /startup|business model/i, label: "Startup", category: "career" },
  // --- Life ---
  { pattern: /健康|养生|睡眠|饮食/, label: "健康", category: "life" },
  { pattern: /\bhealth\b|\bsleep\b|\bdiet\b/i, label: "Health", category: "life" },
  { pattern: /健身|锻炼|减肥|增肌/, label: "健身", category: "life" },
  { pattern: /fitness|workout|weight loss/i, label: "Fitness", category: "life" },
  { pattern: /旅行|旅游|行程|攻略/, label: "旅行", category: "life" },
  { pattern: /\btravel\b|itinerary/i, label: "Travel", category: "life" },
  { pattern: /做饭|菜谱|烹饪|美食/, label: "美食", category: "life" },
  { pattern: /recipe|cooking/i, label: "Cooking", category: "life" },
  { pattern: /理财|投资|基金|股票|保险/, label: "理财", category: "life" },
  { pattern: /invest(ing|ment)|stock market|personal finance/i, label: "Finance", category: "life" },
  { pattern: /法律|合同|维权|劳动法/, label: "法律", category: "life" },
  { pattern: /\blegal\b|contract law/i, label: "Legal", category: "life" },
  { pattern: /心理|情绪|焦虑|抑郁/, label: "心理", category: "life" },
  { pattern: /psycholog|anxiety|mental health/i, label: "Psychology", category: "life" },
  { pattern: /游戏|steam/i, label: "游戏", category: "life" },
  { pattern: /设计|ui\/ux|figma/i, label: "设计", category: "life" },
];

const MIN_TAGS = 3;
const MAX_TAGS = 6;

function normalizeTag(tag: string): string {
  return tag.replace(/\s+/g, " ").trim();
}

export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function inferTechTagsFromText(text: string): string[] {
  const tags: string[] = [];
  for (const item of TECH_KEYWORDS) {
    if (item.pattern.test(text)) {
      tags.push(item.label);
    }
    if (tags.length >= 3) break;
  }
  return dedupeTags(tags);
}

export function resolveTechTags(
  explicitTags: string[] | undefined,
  fallbackText: string
): string[] {
  const explicit = dedupeTags(explicitTags ?? []).slice(0, 6);
  if (explicit.length > 0) return explicit;

  const inferred = inferTechTagsFromText(fallbackText);
  if (inferred.length > 0) return inferred;

  return ["General"];
}

/**
 * Match the layered domain dictionary against text, ranked by hit frequency.
 */
export function inferDomainTags(text: string, limit = MAX_TAGS): string[] {
  if (!text) return [];
  const scored: Array<{ label: string; hits: number; order: number }> = [];
  DOMAIN_KEYWORDS.forEach((item, order) => {
    const flags = item.pattern.flags.includes("g")
      ? item.pattern.flags
      : `${item.pattern.flags}g`;
    const matches = text.match(new RegExp(item.pattern.source, flags));
    if (matches && matches.length > 0) {
      scored.push({ label: item.label, hits: matches.length, order });
    }
  });
  scored.sort((a, b) => b.hits - a.hits || a.order - b.order);
  return dedupeTags(scored.map((item) => item.label)).slice(0, limit);
}

/**
 * Heuristic tag builder: layered domain dictionary + TF keyword extraction.
 * Produces 3-6 tags in the conversation's own language, "General" only when
 * the text carries no usable signal at all.
 */
export function buildHeuristicTags(text: string): string[] {
  const domainTags = inferDomainTags(text, 4);

  const domainKeys = new Set(domainTags.map((tag) => tag.toLowerCase()));
  const keywordTags = extractKeywords(text, { maxKeywords: MAX_TAGS * 2 })
    .map((keyword) => keyword.term)
    .filter((term) => {
      const key = term.toLowerCase();
      if (domainKeys.has(key)) return false;
      // Skip keywords already embedded in a domain tag (e.g. "react" vs "React").
      return ![...domainKeys].some(
        (domainKey) => domainKey.includes(key) || key.includes(domainKey)
      );
    });

  const merged = dedupeTags([...domainTags, ...keywordTags]);
  if (merged.length === 0) return ["General"];

  const target = Math.max(MIN_TAGS, Math.min(domainTags.length + 2, MAX_TAGS));
  return merged.slice(0, Math.min(Math.max(target, MIN_TAGS), MAX_TAGS));
}

/**
 * Reuse the user's established tag vocabulary when its meaning is present in
 * the new conversation. This makes the offline fallback adaptive instead of
 * limiting it to DOMAIN_KEYWORDS forever.
 */
export function inferLearnedTags(
  text: string,
  existingTags: string[],
  limit = 3,
): string[] {
  if (!text.trim() || existingTags.length === 0 || limit <= 0) return [];

  const textLower = text.toLowerCase();
  const textTokens = tokenizeForMatch(text);
  const scored: Array<{ tag: string; score: number; order: number }> = [];

  dedupeTags(existingTags).forEach((tag, order) => {
    const normalized = tag.trim();
    if (normalized.length < 2 || normalized.toLowerCase() === "general") return;

    const tagTokens = tokenizeForMatch(normalized);
    if (tagTokens.size === 0) return;
    let hits = 0;
    for (const token of tagTokens) {
      if (textTokens.has(token)) hits += 1;
    }
    const coverage = hits / tagTokens.size;
    const exact = textLower.includes(normalized.toLowerCase());
    if (!exact && (hits === 0 || coverage < 0.75)) return;

    scored.push({
      tag: normalized,
      score: (exact ? 3 : 0) + coverage + Math.min(normalized.length / 40, 0.5),
      order,
    });
  });

  return scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit)
    .map((item) => item.tag);
}

/** User-vocabulary tags first; fixed dictionaries and extracted keywords fill
 * any remaining slots so classification continues to work fully offline. */
export function buildAdaptiveTags(text: string, existingTags: string[]): string[] {
  const learned = inferLearnedTags(text, existingTags);
  const heuristic = buildHeuristicTags(text);
  const merged = dedupeTags([...learned, ...heuristic]);
  const withoutPlaceholder = merged.filter((tag) => tag.toLowerCase() !== "general");
  return (withoutPlaceholder.length > 0 ? withoutPlaceholder : merged).slice(0, MAX_TAGS);
}
