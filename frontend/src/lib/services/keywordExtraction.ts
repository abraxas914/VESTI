// Lightweight bilingual term-frequency keyword extraction.
//
// English text is tokenized by word; CJK text uses a 2/3-char sliding window
// (no external segmenter). Stopwords are removed and terms are ranked by
// frequency with a small length bonus so that longer, more specific terms win.
// This is intentionally dependency-free: it must run in the extension's
// background/offscreen context with zero setup.

export interface ExtractedKeyword {
  /** Display form: original casing for English, raw characters for CJK. */
  term: string;
  count: number;
  score: number;
}

const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "while",
  "for", "to", "of", "in", "on", "at", "by", "with", "from", "as", "into",
  "about", "after", "before", "between", "through", "during", "above", "below",
  "up", "down", "out", "off", "over", "under", "again", "further", "once",
  "is", "am", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "having", "do", "does", "did", "doing", "will", "would", "can",
  "could", "should", "shall", "may", "might", "must", "not", "no", "nor",
  "so", "than", "too", "very", "just", "also", "only", "own", "same", "such",
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "this", "that", "these",
  "those", "what", "which", "who", "whom", "how", "why", "where", "there",
  "here", "all", "any", "both", "each", "few", "more", "most", "other",
  "some", "because", "until", "against", "yes", "ok", "okay", "please",
  "thanks", "thank", "hello", "hi", "im", "ive", "dont", "cant", "let",
  "lets", "get", "got", "like", "want", "need", "use", "using", "used",
  "make", "made", "one", "two", "way", "thing", "things", "something",
  "anything", "everything", "now", "new", "help", "know", "think", "see",
  "look", "well", "good", "really", "actually", "still", "much", "many",
  "even", "back", "first", "right", "sure", "etc", "e.g", "i.e",
]);

// Common CJK function words / low-signal chat words. Filtering these keeps
// sliding-window grams from surfacing phrases like 这个 / 我们 / 可以.
const CJK_STOP_TERMS = new Set([
  "我们", "你们", "他们", "她们", "它们", "自己", "大家", "这个", "那个",
  "这些", "那些", "这样", "那样", "这里", "那里", "什么", "怎么", "怎样",
  "如何", "为什么", "哪些", "哪个", "多少", "可以", "不能", "能够", "应该",
  "需要", "必须", "或者", "还是", "而且", "但是", "然后", "所以", "因为",
  "如果", "虽然", "已经", "正在", "还有", "没有", "就是", "不是", "也是",
  "都是", "只是", "还要", "不要", "一个", "一些", "一下", "一种", "一样",
  "时候", "现在", "今天", "昨天", "明天", "东西", "事情", "问题", "地方",
  "觉得", "知道", "认为", "希望", "想要", "进行", "使用", "帮我", "请问",
  "谢谢", "你好", "对于", "关于", "根据", "通过", "以及", "其他", "其中",
  "比如", "例如", "可能", "一直", "非常", "真的", "感觉", "告诉", "看看",
  "出来", "起来", "下面", "上面", "里面", "外面", "之后", "之前", "以后",
  "以前", "首先", "其次", "最后", "总之", "另外", "同时", "情况", "方面",
  "内容", "方式", "结果", "开始", "继续", "直接", "重新", "主要", "具体",
]);

// Single CJK chars that should never begin or end a keyword gram.
const CJK_STOP_CHARS = new Set(
  "的了是在和就不也很都与及或等着过吗呢吧啊呀哦嗯之其此该每被把给让向从对将会能可要有无你我他她它们个只条项种类点儿以么但而并如若还再最更些即则"
);

// Sliding-window sizes for CJK: 2-4 chars covers most Chinese terms
// (前端 / 爬虫 / 数据分析 / 机器学习).
const CJK_GRAM_SIZES = [2, 3, 4];

const ENGLISH_TOKEN_RE = /[A-Za-z][A-Za-z0-9+#._-]*/g;
const CJK_RUN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]+/g;
const DEFAULT_MAX_KEYWORDS = 12;

function normalizeEnglishToken(raw: string): string {
  return raw.replace(/^[._-]+|[._-]+$/g, "");
}

interface TermStat {
  count: number;
  display: string;
  isCjk: boolean;
  length: number;
}

function collectEnglishTerms(text: string, stats: Map<string, TermStat>): void {
  const matches = text.match(ENGLISH_TOKEN_RE) ?? [];
  for (const raw of matches) {
    const token = normalizeEnglishToken(raw);
    if (token.length < 2) continue;
    const key = token.toLowerCase();
    if (ENGLISH_STOPWORDS.has(key)) continue;
    const existing = stats.get(key);
    if (existing) {
      existing.count += 1;
      // Prefer a cased form (e.g. "React", "TypeScript") over all-lowercase.
      if (existing.display === existing.display.toLowerCase() && token !== key) {
        existing.display = token;
      }
    } else {
      stats.set(key, { count: 1, display: token, isCjk: false, length: token.length });
    }
  }
}

function isValidCjkGram(gram: string): boolean {
  if (CJK_STOP_TERMS.has(gram)) return false;
  if (CJK_STOP_CHARS.has(gram[0]) || CJK_STOP_CHARS.has(gram[gram.length - 1])) {
    return false;
  }
  return true;
}

function collectCjkTerms(text: string, stats: Map<string, TermStat>): void {
  const runs = text.match(CJK_RUN_RE) ?? [];
  for (const run of runs) {
    for (const size of CJK_GRAM_SIZES) {
      for (let i = 0; i + size <= run.length; i += 1) {
        const gram = run.slice(i, i + size);
        if (!isValidCjkGram(gram)) continue;
        const existing = stats.get(gram);
        if (existing) {
          existing.count += 1;
        } else {
          stats.set(gram, { count: 1, display: gram, isCjk: true, length: size });
        }
      }
    }
  }
}

/**
 * Drop CJK grams that are merely fragments of a longer gram with the same
 * (or higher) frequency — e.g. 机器学习 subsumes 机器学/器学习/机器/学习
 * unless a fragment also appears independently elsewhere.
 */
function pruneSubsumedCjkGrams(stats: Map<string, TermStat>): void {
  const longestFirst = [...stats.entries()]
    .filter(([, stat]) => stat.isCjk && stat.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [gram, stat] of longestFirst) {
    if (!stats.has(gram)) continue;
    for (let size = 2; size < stat.length; size += 1) {
      for (let i = 0; i + size <= stat.length; i += 1) {
        const piece = gram.slice(i, i + size);
        const pieceStat = stats.get(piece);
        if (pieceStat && pieceStat.isCjk && pieceStat.count <= stat.count) {
          stats.delete(piece);
        }
      }
    }
  }
}

function scoreTerm(stat: TermStat): number {
  const lengthBonus = stat.isCjk
    ? 1 + (stat.length - 2) * 0.35
    : 1 + Math.min(stat.length, 12) / 24;
  // Mild discrimination boost: terms that repeat stand out from one-off noise.
  const repeatBonus = stat.count > 1 ? 1.25 : 1;
  return stat.count * lengthBonus * repeatBonus;
}

/**
 * Extract ranked keywords from mixed Chinese/English text.
 * Returns at most `maxKeywords` terms sorted by descending score.
 */
export function extractKeywords(
  text: string,
  options: { maxKeywords?: number } = {}
): ExtractedKeyword[] {
  const maxKeywords = options.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
  if (!text || !text.trim() || maxKeywords <= 0) return [];

  const stats = new Map<string, TermStat>();
  collectEnglishTerms(text, stats);
  collectCjkTerms(text, stats);
  pruneSubsumedCjkGrams(stats);

  const totalMentions = [...stats.values()].reduce((sum, s) => sum + s.count, 0);
  // In longer texts, one-off terms are noise; in short texts keep them.
  const minCount = totalMentions > 120 ? 2 : 1;

  return [...stats.values()]
    .filter((stat) => stat.count >= minCount)
    .map((stat) => ({
      term: stat.display,
      count: stat.count,
      score: scoreTerm(stat),
    }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, maxKeywords);
}

/**
 * Tokenize arbitrary text into a lowercase token set suitable for overlap
 * scoring (English words + CJK 2/3-grams, stopwords removed).
 */
export function tokenizeForMatch(text: string): Set<string> {
  const tokens = new Set<string>();
  if (!text) return tokens;

  const englishMatches = text.match(ENGLISH_TOKEN_RE) ?? [];
  for (const raw of englishMatches) {
    const token = normalizeEnglishToken(raw).toLowerCase();
    if (token.length >= 2 && !ENGLISH_STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }

  const runs = text.match(CJK_RUN_RE) ?? [];
  for (const run of runs) {
    for (const size of [2, 3]) {
      for (let i = 0; i + size <= run.length; i += 1) {
        const gram = run.slice(i, i + size);
        if (isValidCjkGram(gram)) {
          tokens.add(gram);
        }
      }
    }
  }

  return tokens;
}
