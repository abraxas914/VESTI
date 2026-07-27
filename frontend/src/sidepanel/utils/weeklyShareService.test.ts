import { describe, expect, it } from "vitest"

import {
  resolveWeeklyExportHeight,
  resolveWeeklyExportWidth
} from "./weeklyShareService"

describe("resolveWeeklyExportWidth", () => {
  it("keeps the export aligned to the visible side-panel report", () => {
    expect(
      resolveWeeklyExportWidth({
        visibleWidth: 328.2,
        scrollWidth: 924
      })
    ).toBe(329)
  })

  it("uses scroll width only when the report has no measurable width", () => {
    expect(
      resolveWeeklyExportWidth({
        visibleWidth: Number.NaN,
        scrollWidth: 412.1
      })
    ).toBe(413)
  })
})

describe("resolveWeeklyExportHeight", () => {
  it("crops inherited layout whitespace below rendered content", () => {
    expect(
      resolveWeeklyExportHeight({
        scrollHeight: 5_000,
        rootHeight: 5_000,
        contentBottom: 1_200
      })
    ).toBe(1_224)
  })

  it("never expands beyond the measured layout", () => {
    expect(
      resolveWeeklyExportHeight({
        scrollHeight: 640,
        rootHeight: 640,
        contentBottom: 700
      })
    ).toBe(640)
  })

  it("falls back to layout height when content bounds are unavailable", () => {
    expect(
      resolveWeeklyExportHeight({
        scrollHeight: 720,
        rootHeight: 680,
        contentBottom: null
      })
    ).toBe(720)
  })
})
