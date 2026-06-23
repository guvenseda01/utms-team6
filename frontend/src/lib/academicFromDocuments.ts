import type { AcademicRecord, Document } from '../types/application'

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function latestDoc(documents: Document[], docType: Document['doc_type']): Document | undefined {
  return documents
    .filter(d => d.doc_type === docType && d.extracted_data && Object.keys(d.extracted_data).length > 0)
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())[0]
}

/** YKS score strictly from YKS_RESULT document extraction. */
export function yksScoreFromDocuments(documents: Document[]): number | null {
  const yks = latestDoc(documents, 'YKS_RESULT')
  if (!yks?.extracted_data) return null
  const data = yks.extracted_data
  return num(
    data.placement_score
    ?? data.score
    ?? data.yks_score
    ?? data.puan,
  )
}

/** Build academic fields from uploaded document extraction already stored on upload. */
export function academicRecordFromDocuments(documents: Document[]): AcademicRecord | null {
  const transcript = latestDoc(documents, 'TRANSCRIPT')
  const yksScore = yksScoreFromDocuments(documents)

  if (!transcript && yksScore == null) return null

  const t = transcript?.extracted_data ?? {}
  const sources: string[] = []

  const record: AcademicRecord = {
    institution: null,
    gpa_4: null,
    gpa_100: null,
    yks_score: null,
    credits_completed: null,
    fetched_at: new Date().toISOString(),
    source: null,
    errors: null,
  }

  const gpa = num(t.gpa ?? t.gpa_4)
  if (gpa != null) {
    record.gpa_4 = gpa
    sources.push('TRANSCRIPT')
  }
  if (t.institution) {
    record.institution = String(t.institution)
    if (!sources.includes('TRANSCRIPT')) sources.push('TRANSCRIPT')
  }
  const credits = num(t.completed_credits ?? t.credits_completed)
  if (credits != null) {
    record.credits_completed = credits
  }
  if (yksScore != null) {
    record.yks_score = yksScore
    sources.push('YKS')
  }

  if (sources.length === 0) return null
  record.source = `${sources.join('+')} (parsed from documents)`
  return record
}

/** Parsed document values override API/mock values when present. */
export function mergeAcademicRecord(
  fromApi: AcademicRecord | null,
  fromDocs: AcademicRecord | null,
  documents: Document[] = [],
): AcademicRecord | null {
  const yksFromPdf = yksScoreFromDocuments(documents)

  if (!fromApi && !fromDocs) return null

  const base = fromApi ?? fromDocs!
  const docFields = fromDocs ?? {
    institution: null,
    gpa_4: null,
    gpa_100: null,
    yks_score: null,
    credits_completed: null,
    fetched_at: null,
    source: null,
    errors: null,
  }

  const merged: AcademicRecord = {
    ...base,
    gpa_4: docFields.gpa_4 ?? fromApi?.gpa_4 ?? null,
    institution: docFields.institution ?? fromApi?.institution ?? null,
    credits_completed: docFields.credits_completed ?? fromApi?.credits_completed ?? null,
    yks_score: yksFromPdf ?? docFields.yks_score ?? fromApi?.yks_score ?? null,
    source: docFields.source ?? fromApi?.source ?? null,
  }

  const sourceParts: string[] = []
  if (merged.gpa_4 != null && latestDoc(documents, 'TRANSCRIPT')) sourceParts.push('TRANSCRIPT')
  if (merged.yks_score != null && yksFromPdf != null) sourceParts.push('YKS')
  if (sourceParts.length > 0) {
    merged.source = `${sourceParts.join('+')} (parsed from documents)`
  }

  return merged
}
