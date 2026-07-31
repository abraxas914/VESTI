import { describe, expect, it } from "vitest"

import {
  getOnboardingGuideCopy,
  getExplorePromptStageFromSearch,
  normalizeExplorePromptStage
} from "./onboardingTourService"

describe("onboarding explore handoff", () => {
  it("hydrates the Explore-title stage directly from the options URL", () => {
    expect(
      getExplorePromptStageFromSearch(
        "?tab=library&onboarding=explore-tab"
      )
    ).toBe("explore_tab")
  })

  it("drops the retired knowledge-base click stage", () => {
    expect(
      getExplorePromptStageFromSearch("?onboarding=knowledge-qa")
    ).toBeNull()
    expect(normalizeExplorePromptStage("explore_tab")).toBe("explore_tab")
    expect(normalizeExplorePromptStage("knowledge_qa")).toBeNull()
  })

  it("directs the library handoff to the Explore tab beside the library", () => {
    expect(getOnboardingGuideCopy("zh").explore[1]).toBe(
      "点击对话知识库旁边的“探索”，进入问答"
    )
  })
})
