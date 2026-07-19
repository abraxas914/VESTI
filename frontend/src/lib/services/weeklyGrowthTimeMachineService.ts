import { getWeeklyReportById, listWeeklyReportsBefore } from "../db/repository"
import type { WeeklyGrowthTimeMachineData } from "../types"
import {
  buildWeeklyGrowthTimeMachine,
  resolveWeeklyGrowthTimeMachineCurrent,
  WEEKLY_GROWTH_TIME_MACHINE_QUERY_LIMIT
} from "../weekly/weeklyGrowthTimeMachine"

function requireReportId(reportId: number): void {
  if (!Number.isSafeInteger(reportId) || reportId <= 0) {
    throw new Error("WEEKLY_GROWTH_TIME_MACHINE_INVALID_REPORT_ID")
  }
}

export async function getWeeklyGrowthTimeMachine(
  reportId: number
): Promise<WeeklyGrowthTimeMachineData> {
  requireReportId(reportId)
  const current = await getWeeklyReportById(reportId)
  if (!current) {
    throw new Error("WEEKLY_GROWTH_TIME_MACHINE_REPORT_NOT_FOUND")
  }
  const { range } = resolveWeeklyGrowthTimeMachineCurrent(current)

  const history = await listWeeklyReportsBefore(
    range.rangeStart,
    WEEKLY_GROWTH_TIME_MACHINE_QUERY_LIMIT
  )
  return buildWeeklyGrowthTimeMachine(current, history)
}
