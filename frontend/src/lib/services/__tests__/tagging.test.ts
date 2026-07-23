import { describe, expect, it } from "vitest";
import {
  buildHeuristicTags,
  dedupeTags,
  DOMAIN_KEYWORDS,
  inferDomainTags,
} from "../tagging";

describe("DOMAIN_KEYWORDS", () => {
  it("covers 40+ layered entries across multiple categories", () => {
    expect(DOMAIN_KEYWORDS.length).toBeGreaterThanOrEqual(40);
    const categories = new Set(DOMAIN_KEYWORDS.map((item) => item.category));
    expect(categories.size).toBeGreaterThanOrEqual(6);
  });
});

describe("inferDomainTags", () => {
  it("matches technical domains", () => {
    const tags = inferDomainTags("Building a React app with TypeScript and Tailwind");
    expect(tags).toContain("React");
    expect(tags).toContain("TypeScript");
    expect(tags).toContain("Tailwind CSS");
  });

  it("matches non-technical Chinese domains with Chinese labels", () => {
    const tags = inferDomainTags("帮我制定一个健身计划，每周锻炼三次，目标是减肥");
    expect(tags).toContain("健身");
  });

  it("matches life/learning domains in English", () => {
    const tags = inferDomainTags("Plan a 7-day travel itinerary for Japan");
    expect(tags).toContain("Travel");
  });

  it("ranks by hit frequency", () => {
    const tags = inferDomainTags(
      "python python python 爬虫 python data analysis pandas"
    );
    expect(tags[0]).toBe("Python");
  });

  it("returns empty for no matches", () => {
    expect(inferDomainTags("xyzzy plugh")).toEqual([]);
  });
});

describe("buildHeuristicTags", () => {
  it("returns 3-6 tags for rich text", () => {
    const tags = buildHeuristicTags(
      "How to deploy a Django app with Docker? I need nginx config, " +
        "gunicorn setup and postgres connection pooling for my Django project."
    );
    expect(tags.length).toBeGreaterThanOrEqual(3);
    expect(tags.length).toBeLessThanOrEqual(6);
    expect(tags.some((t) => t === "Python Web")).toBe(true);
  });

  it("keeps Chinese keywords for Chinese conversations", () => {
    const tags = buildHeuristicTags(
      "我最近在准备考研数学，想制定一个复习计划。考研数学的重点是微积分和线性代数，" +
        "复习计划需要覆盖三个月。"
    );
    expect(tags.length).toBeGreaterThanOrEqual(3);
    expect(tags.some((t) => /[\u4E00-\u9FFF]/.test(t))).toBe(true);
  });

  it("falls back to General only for signal-free text", () => {
    expect(buildHeuristicTags("")).toEqual(["General"]);
  });

  it("does not duplicate a keyword already covered by a domain tag", () => {
    const tags = buildHeuristicTags("react react react hooks useEffect");
    const lower = tags.map((t) => t.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(lower.filter((t) => t === "react")).toHaveLength(1);
  });
});

describe("dedupeTags", () => {
  it("dedupes case-insensitively and trims whitespace", () => {
    expect(dedupeTags(["React", "react", "  React  ", "Vue"])).toEqual([
      "React",
      "Vue",
    ]);
  });
});
