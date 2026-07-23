import { describe, expect, it } from "vitest";
import {
  buildClassificationPrompt,
  parseClassificationOutput,
  resolveTopicPathAgainstExisting,
} from "../gardenerClassification";

describe("parseClassificationOutput", () => {
  it("parses a clean JSON object", () => {
    const result = parseClassificationOutput(
      JSON.stringify({
        topic_path: ["编程", "前端"],
        is_new_topic: false,
        tags: ["React 性能优化", "渲染", "hooks"],
        confidence: 0.85,
      })
    );
    expect(result).toEqual({
      topicPath: ["编程", "前端"],
      isNewTopic: false,
      tags: ["React 性能优化", "渲染", "hooks"],
      confidence: 0.85,
    });
  });

  it("parses JSON wrapped in code fences and prose", () => {
    const raw =
      'Here is my classification:\n```json\n{"topic_path": ["Life"], "is_new_topic": true, "tags": ["travel"], "confidence": 0.7}\n```\nDone.';
    const result = parseClassificationOutput(raw);
    expect(result?.topicPath).toEqual(["Life"]);
    expect(result?.isNewTopic).toBe(true);
  });

  it("coerces a slash-joined topic_path string into segments", () => {
    const result = parseClassificationOutput(
      '{"topic_path": "编程 / 前端 / React", "is_new_topic": false, "tags": ["a"], "confidence": 0.9}'
    );
    expect(result?.topicPath).toEqual(["编程", "前端", "React"]);
  });

  it("coerces string confidence and percentage values", () => {
    expect(
      parseClassificationOutput(
        '{"topic_path": [], "is_new_topic": false, "tags": [], "confidence": "0.6"}'
      )?.confidence
    ).toBeCloseTo(0.6);
    expect(
      parseClassificationOutput(
        '{"topic_path": [], "is_new_topic": false, "tags": [], "confidence": 80}'
      )?.confidence
    ).toBeCloseTo(0.8);
  });

  it("clamps out-of-range confidence", () => {
    expect(
      parseClassificationOutput(
        '{"topic_path": [], "is_new_topic": false, "tags": [], "confidence": -3}'
      )?.confidence
    ).toBe(0);
  });

  it("coerces comma-separated tags string and dedupes", () => {
    const result = parseClassificationOutput(
      '{"topic_path": [], "is_new_topic": false, "tags": "旅行, 攻略、旅行", "confidence": 0.4}'
    );
    expect(result?.tags).toEqual(["旅行", "攻略"]);
  });

  it("caps tags at 6 and path segments at 3", () => {
    const result = parseClassificationOutput(
      JSON.stringify({
        topic_path: ["a", "b", "c", "d", "e"],
        is_new_topic: false,
        tags: ["1", "2", "3", "4", "5", "6", "7", "8"],
        confidence: 1,
      })
    );
    expect(result?.topicPath).toHaveLength(3);
    expect(result?.tags).toHaveLength(6);
  });

  it("tolerates missing optional-ish fields via coercion", () => {
    const result = parseClassificationOutput(
      '{"tags": ["x"], "confidence": 0.5}'
    );
    expect(result?.topicPath).toEqual([]);
    expect(result?.isNewTopic).toBe(false);
  });

  it("returns null for non-JSON garbage", () => {
    expect(parseClassificationOutput("I cannot classify this.")).toBeNull();
    expect(parseClassificationOutput("")).toBeNull();
  });

  it("returns null for JSON arrays and primitives", () => {
    expect(parseClassificationOutput("[1,2,3]")).not.toEqual(
      expect.objectContaining({ tags: expect.anything() })
    );
    expect(parseClassificationOutput("42")).toBeNull();
  });
});

describe("resolveTopicPathAgainstExisting", () => {
  const options = [
    { id: 1, path: "编程" },
    { id: 2, path: "编程 / 前端" },
    { id: 3, path: "编程 / 前端 / React" },
    { id: 4, path: "生活" },
  ];

  it("matches an exact path case-insensitively", () => {
    expect(
      resolveTopicPathAgainstExisting(["编程", "前端", "react"], options)
    ).toEqual({ kind: "existing", id: 3 });
  });

  it("matches by leaf name when the full path differs", () => {
    expect(resolveTopicPathAgainstExisting(["Web", "React"], options)).toEqual({
      kind: "existing",
      id: 3,
    });
  });

  it("suggests creating under the deepest existing prefix", () => {
    expect(
      resolveTopicPathAgainstExisting(["编程", "前端", "Vue"], options)
    ).toEqual({ kind: "create", parentId: 2, name: "Vue" });
  });

  it("suggests a new root topic when nothing matches", () => {
    expect(resolveTopicPathAgainstExisting(["健康"], options)).toEqual({
      kind: "create",
      parentId: null,
      name: "健康",
    });
  });

  it("returns null for an empty path", () => {
    expect(resolveTopicPathAgainstExisting([], options)).toBeNull();
  });
});

describe("buildClassificationPrompt", () => {
  it("includes topic paths, title and messages", () => {
    const prompt = buildClassificationPrompt({
      title: "React 性能问题",
      snippet: "讨论渲染优化",
      messages: ["组件重复渲染怎么办", "用 useMemo 试试"],
      topicPaths: [{ id: 1, path: "编程 / 前端" }],
    });
    expect(prompt).toContain("编程 / 前端");
    expect(prompt).toContain("React 性能问题");
    expect(prompt).toContain("[1] 组件重复渲染怎么办");
  });

  it("handles an empty topic tree", () => {
    const prompt = buildClassificationPrompt({
      title: "t",
      snippet: "",
      messages: [],
      topicPaths: [],
    });
    expect(prompt).toContain("(no topics exist yet)");
    expect(prompt).toContain("(no messages)");
  });
});
