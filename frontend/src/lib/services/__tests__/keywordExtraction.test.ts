import { describe, expect, it } from "vitest";
import { extractKeywords, tokenizeForMatch } from "../keywordExtraction";

describe("extractKeywords", () => {
  it("returns empty for empty input", () => {
    expect(extractKeywords("")).toEqual([]);
    expect(extractKeywords("   ")).toEqual([]);
  });

  it("extracts repeated English terms and drops stopwords", () => {
    const text =
      "How do I configure webpack aliases? The webpack config keeps failing. " +
      "I want the webpack build to resolve aliases correctly.";
    const terms = extractKeywords(text).map((k) => k.term.toLowerCase());
    expect(terms).toContain("webpack");
    expect(terms).toContain("aliases");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("how");
    expect(terms).not.toContain("want");
  });

  it("keeps original casing for proper nouns", () => {
    const text = "React hooks in React components. React state management.";
    const top = extractKeywords(text)[0];
    expect(top.term).toBe("React");
  });

  it("extracts CJK terms with sliding-window grams", () => {
    const text =
      "我在学习机器学习，机器学习的模型训练很有意思，模型训练需要大量数据。";
    const terms = extractKeywords(text).map((k) => k.term);
    expect(terms).toContain("机器学习");
    expect(terms.some((t) => t.includes("模型"))).toBe(true);
  });

  it("removes CJK stopwords and function-word grams", () => {
    const text = "这个问题我们可以怎么解决呢？我们需要一个方案。";
    const terms = extractKeywords(text).map((k) => k.term);
    expect(terms).not.toContain("这个");
    expect(terms).not.toContain("我们");
    expect(terms).not.toContain("可以");
  });

  it("handles mixed Chinese and English text", () => {
    const text =
      "用 Python 写一个爬虫抓取网页数据，Python 的 requests 库怎么用？爬虫需要处理反爬。";
    const terms = extractKeywords(text).map((k) => k.term);
    expect(terms.some((t) => t.toLowerCase() === "python")).toBe(true);
    expect(terms).toContain("爬虫");
  });

  it("ranks repeated terms above one-off terms", () => {
    const text = "docker docker docker compose nginx";
    const terms = extractKeywords(text);
    expect(terms[0].term).toBe("docker");
    expect(terms[0].count).toBe(3);
  });

  it("respects maxKeywords", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta";
    expect(extractKeywords(text, { maxKeywords: 3 })).toHaveLength(3);
  });
});

describe("tokenizeForMatch", () => {
  it("tokenizes English words lowercase without stopwords", () => {
    const tokens = tokenizeForMatch("The React Router setup");
    expect(tokens.has("react")).toBe(true);
    expect(tokens.has("router")).toBe(true);
    expect(tokens.has("the")).toBe(false);
  });

  it("produces CJK grams", () => {
    const tokens = tokenizeForMatch("前端开发");
    expect(tokens.has("前端")).toBe(true);
    expect(tokens.has("开发")).toBe(true);
  });

  it("returns empty set for empty text", () => {
    expect(tokenizeForMatch("").size).toBe(0);
  });
});
