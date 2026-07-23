import { describe, expect, it } from "vitest";
import type { Topic } from "../../types";
import {
  flattenTopicTree,
  scoreTopicCandidate,
  selectBestTopicMatch,
  TOPIC_MATCH_THRESHOLD,
} from "../topicMatching";

function makeTopic(id: number, name: string, children: Topic[] = []): Topic {
  return {
    id,
    name,
    parent_id: null,
    created_at: 0,
    updated_at: 0,
    children,
  };
}

describe("flattenTopicTree", () => {
  it("flattens nested topics with hierarchy paths", () => {
    const tree = [
      makeTopic(1, "编程", [makeTopic(2, "前端", [makeTopic(3, "React")])]),
      makeTopic(4, "生活"),
    ];
    const flat = flattenTopicTree(tree);
    expect(flat).toHaveLength(4);
    expect(flat[2].path).toBe("编程 / 前端 / React");
    expect(flat[2].depth).toBe(2);
    expect(flat[3].path).toBe("生活");
  });
});

describe("scoreTopicCandidate", () => {
  const input = (keywords: string[], text = "") => {
    const tokens = new Set<string>();
    for (const k of keywords) tokens.add(k.toLowerCase());
    return { keywordTokens: tokens, textLower: text.toLowerCase() };
  };

  it("gives full name score when topic name appears in text", () => {
    const score = scoreTopicCandidate(
      input([], "we discussed react performance"),
      { name: "React", tags: [] }
    );
    expect(score).toBeCloseTo(0.65, 5);
  });

  it("scores zero for unrelated topics", () => {
    const score = scoreTopicCandidate(input(["cooking", "recipe"], "cooking recipe"), {
      name: "Kubernetes",
      tags: ["docker", "helm"],
    });
    expect(score).toBe(0);
  });

  it("adds tag overlap signal", () => {
    const withTags = scoreTopicCandidate(
      input(["hooks", "state"], "hooks state management"),
      { name: "Frontend", tags: ["hooks", "state", "react"] }
    );
    const withoutTags = scoreTopicCandidate(
      input(["hooks", "state"], "hooks state management"),
      { name: "Frontend", tags: [] }
    );
    expect(withTags).toBeGreaterThan(withoutTags);
  });
});

describe("selectBestTopicMatch", () => {
  const candidates = [
    { id: 1, name: "React", depth: 1, tags: ["hooks", "组件"] },
    { id: 2, name: "Python", depth: 0, tags: ["爬虫", "pandas"] },
    { id: 3, name: "旅行", depth: 0, tags: ["攻略", "日本"] },
  ];

  it("selects the matching topic above threshold", () => {
    const result = selectBestTopicMatch(
      { keywords: ["react", "hooks", "useEffect"], text: "react hooks 问题" },
      candidates
    );
    expect(result?.id).toBe(1);
    expect(result!.score).toBeGreaterThanOrEqual(TOPIC_MATCH_THRESHOLD);
  });

  it("matches Chinese topics via keyword overlap", () => {
    const result = selectBestTopicMatch(
      { keywords: ["旅行", "攻略", "行程"], text: "帮我规划一次旅行，需要详细攻略" },
      candidates
    );
    expect(result?.id).toBe(3);
  });

  it("returns null instead of force-archiving weak matches", () => {
    const result = selectBestTopicMatch(
      { keywords: ["quantum", "physics"], text: "quantum physics discussion" },
      candidates
    );
    expect(result).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    expect(
      selectBestTopicMatch({ keywords: ["react"], text: "react" }, [])
    ).toBeNull();
  });

  it("prefers deeper topics on ties", () => {
    const tied = [
      { id: 10, name: "AI", depth: 0, tags: [] },
      { id: 11, name: "AI", depth: 2, tags: [] },
    ];
    const result = selectBestTopicMatch(
      { keywords: ["ai"], text: "ai discussion about ai" },
      tied
    );
    expect(result?.id).toBe(11);
  });

  // V2: embedding similarity blend
  it("boosts a topic with higher embedding similarity", () => {
    // "Docker/K8s" topic matches poorly on keywords but well on embedding.
    const candidates = [
      { id: 1, name: "Docker/K8s", depth: 1, tags: ["container", "devops"] },
      { id: 2, name: "前端工具", depth: 1, tags: ["frontend", "build"] },
    ];
    // Conversation about "容器编排" (no keyword overlap with "Docker/K8s"
    // but semantically identical). Without embedding, both score 0.
    // With embedding similarity 0.8 for topic 1, it should win.
    const embeddingSim = new Map<number, number>();
    embeddingSim.set(1, 0.8);
    embeddingSim.set(2, 0.1);

    const result = selectBestTopicMatch(
      { keywords: ["容器", "编排"], text: "讨论容器编排方案" },
      candidates,
      0.15, // low threshold to allow embedding to carry
      embeddingSim,
    );
    expect(result?.id).toBe(1);
  });
});
