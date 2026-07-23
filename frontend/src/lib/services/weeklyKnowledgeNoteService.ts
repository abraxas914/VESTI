import {
  getWeeklyKnowledgeNote,
  getWeeklyReportById,
  upsertWeeklyKnowledgeNote
} from "../db/repository"
import type { SupportedLocale } from "../i18n/locales"
import {
  buildWeeklyKnowledgeNoteDraft,
  isWeeklyKnowledgeNoteCurrent,
  isWeeklyKnowledgeSourceReport
} from "../notes/weeklyKnowledgeNote"
import type {
  WeeklyKnowledgeNoteSaveResult,
  WeeklyKnowledgeNoteStatus
} from "../types"

function requireReportId(reportId: number): void {
  if (!Number.isSafeInteger(reportId) || reportId <= 0) {
    throw new Error("WEEKLY_KNOWLEDGE_NOTE_INVALID_REPORT_ID")
  }
}

export async function getWeeklyKnowledgeNoteStatus(
  reportId: number
): Promise<WeeklyKnowledgeNoteStatus> {
  requireReportId(reportId)
  const [note, report] = await Promise.all([
    getWeeklyKnowledgeNote(reportId),
    getWeeklyReportById(reportId)
  ])

  return {
    note,
    sourceCurrent: Boolean(
      note &&
        report &&
        isWeeklyKnowledgeSourceReport(report) &&
        isWeeklyKnowledgeNoteCurrent(
          note.content,
          report.id,
          report.sourceHash
        )
    )
  }
}

export async function saveWeeklyKnowledgeNote(
  reportId: number,
  locale: SupportedLocale
): Promise<WeeklyKnowledgeNoteSaveResult> {
  requireReportId(reportId)
  const report = await getWeeklyReportById(reportId)
  if (!report) {
    throw new Error("WEEKLY_KNOWLEDGE_NOTE_REPORT_NOT_FOUND")
  }

  const draft = buildWeeklyKnowledgeNoteDraft(report, locale)
  return upsertWeeklyKnowledgeNote(draft)
}
