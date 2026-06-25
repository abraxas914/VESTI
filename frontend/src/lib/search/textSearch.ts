// Local, dependency-free relevance search over chat text. Replaces naive
// substring matching with: CJK-aware tokenization (Lucene-style character
// bigrams — the thing Western tools structurally can't do), multi-term AND
// matching (find "design database" when you typed "database design"), trailing
// prefix match for type-ahead, and a relevance score so the best hit ranks first.
// Fully offline; works with no model configured.

// CJK ranges (CJK Unified + Ext-A + compatibility + common Japanese kana).
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch);
}
function isAlnum(ch: string): boolean {
  return /[a-z0-9]/i.test(ch);
}

/**
 * Tokenize text into search terms: Latin/digit words verbatim (lowercased), CJK
 * runs into adjacent-character bigrams (single char → unigram). Bigrams give
 * Chinese/Japanese queries real word-ish matching without a segmentation model.
 */
export function tokenize(input: string): string[] {
  const text = input.toLowerCase();
  const tokens: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (isAlnum(ch)) {
      let j = i + 1;
      while (j < n && isAlnum(text[j])) j += 1;
      tokens.push(text.slice(i, j));
      i = j;
    } else if (isCjk(ch)) {
      let j = i + 1;
      while (j < n && isCjk(text[j])) j += 1;
      const run = text.slice(i, j);
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let k = 0; k < run.length - 1; k += 1) tokens.push(run.slice(k, k + 2));
      }
      i = j;
    } else {
      i += 1; // separator / punctuation
    }
  }
  return tokens;
}

export interface ParsedQuery {
  /** all query tokens that must be present (the last one may be prefix-matched) */
  tokens: string[];
  /** the trailing Latin token, eligible for prefix match (type-ahead); else null */
  prefix: string | null;
  /** normalized raw query, for the contiguous-phrase bonus */
  raw: string;
  empty: boolean;
}

export function parseQuery(normalizedQuery: string): ParsedQuery {
  const raw = normalizedQuery.toLowerCase().trim();
  const tokens = tokenize(raw);
  // The trailing token is treated as prefix-capable iff the raw query ends in a
  // Latin/digit char (user may be mid-word) — helps search-as-you-type.
  const lastChar = raw.slice(-1);
  const prefix =
    tokens.length > 0 && isAlnum(lastChar) ? tokens[tokens.length - 1] : null;
  return { tokens, prefix, raw, empty: tokens.length === 0 };
}

/**
 * Score `text` against a parsed query. Returns 0 when not all query terms are
 * present (AND semantics); a positive relevance score otherwise. Higher = better.
 */
export function scoreText(text: string, q: ParsedQuery): number {
  if (q.empty) return 0;
  const lower = text.toLowerCase();
  const docTokens = tokenize(lower);
  if (docTokens.length === 0) return 0;

  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  for (let idx = 0; idx < q.tokens.length; idx += 1) {
    const term = q.tokens[idx];
    const count = tf.get(term) ?? 0;
    if (count > 0) {
      // diminishing returns on term frequency; rarer-looking (longer) terms weigh a bit more
      score += Math.min(count, 4) * (1 + Math.min(term.length, 4) * 0.15);
      continue;
    }
    // Trailing prefix term: allow a startsWith match for type-ahead.
    if (term === q.prefix && idx === q.tokens.length - 1) {
      let prefixHit = false;
      for (const dt of tf.keys()) {
        if (dt.length > term.length && dt.startsWith(term)) {
          prefixHit = true;
          break;
        }
      }
      if (prefixHit) {
        score += 0.6; // weaker than an exact term hit
        continue;
      }
    }
    return 0; // a required term is missing → not a match
  }

  // Contiguous full-phrase occurrence is the strongest signal.
  if (q.raw.length >= 2 && lower.includes(q.raw)) score += 12;
  return score;
}

export function matchesQuery(text: string, q: ParsedQuery): boolean {
  return scoreText(text, q) > 0;
}
