/**
 * Manual smoke tests for academic data merge (run: npx tsx src/lib/academicFromDocuments.test.ts)
 */
import type { AcademicRecord, Document } from '../types/application'
import {
  academicRecordFromDocuments,
  mergeAcademicRecord,
  yksScoreFromDocuments,
  hasYksDocument,
} from './academicFromDocuments'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`PASS: ${msg}`)
}

const transcript: Document = {
  id: 't1',
  application_id: 'a1',
  doc_type: 'TRANSCRIPT',
  file_name: 'transcript.pdf',
  file_size_bytes: 1000,
  status: 'PENDING',
  uploaded_at: '2026-01-01T00:00:00Z',
  extracted_data: { gpa: 3.55, institution: 'EXAMPLE UNIVERSITY', completed_credits: 34 },
  extraction_confirmed: false,
}

const yksParsed: Document = {
  id: 'y1',
  application_id: 'a1',
  doc_type: 'YKS_RESULT',
  file_name: 'yks.pdf',
  file_size_bytes: 1000,
  status: 'PENDING',
  uploaded_at: '2026-01-02T00:00:00Z',
  extracted_data: {
    placement_score: 392.144,
    score: 392.144,
    score_type: 'SAY',
    exam_year: 2026,
  },
  extraction_confirmed: false,
}

const yksEmpty: Document = {
  ...yksParsed,
  id: 'y2',
  extracted_data: {},
}

const yksNull: Document = {
  ...yksParsed,
  id: 'y3',
  extracted_data: null as unknown as Record<string, unknown>,
}

// YKS score from parsed YKS doc
assert(yksScoreFromDocuments([yksParsed]) === 392.144, 'yksScoreFromDocuments reads placement_score from YKS PDF')

// Empty / null extracted_data → no score (this is what user sees as —)
assert(yksScoreFromDocuments([yksEmpty]) === null, 'empty extracted_data blocks YKS score display')
assert(yksScoreFromDocuments([yksNull]) === null, 'null extracted_data blocks YKS score display')

// Transcript only → TRANSCRIPT source, no YKS
const transcriptOnly = academicRecordFromDocuments([transcript])
assert(transcriptOnly?.gpa_4 === 3.55, 'GPA from transcript')
assert(transcriptOnly?.yks_score === null, 'no YKS score without YKS doc parse')
assert(transcriptOnly?.source === 'TRANSCRIPT (parsed from documents)', 'source TRANSCRIPT only when YKS missing')

// Both docs → merged
const both = academicRecordFromDocuments([transcript, yksParsed])
assert(both?.yks_score === 392.144, 'YKS score merged when YKS PDF parsed')
assert(both?.source === 'TRANSCRIPT+YKS (parsed from documents)', 'source includes YKS when parsed')

// YKS uploaded but parse failed → hide mock API 450
const mockApi: AcademicRecord = {
  institution: 'API UNI',
  gpa_4: 3.5,
  gpa_100: null,
  yks_score: 450,
  credits_completed: null,
  fetched_at: '2026-01-01',
  source: 'OSYM',
  errors: null,
}
const mergedBlocked = mergeAcademicRecord(mockApi, transcriptOnly!, [transcript, yksEmpty])
assert(mergedBlocked?.yks_score === null, 'YKS PDF uploaded but empty parse → show — not mock 450')
assert(hasYksDocument([transcript, yksEmpty]), 'YKS doc detected even when parse empty')

const mergedOk = mergeAcademicRecord(mockApi, both, [transcript, yksParsed])
assert(mergedOk?.yks_score === 392.144, 'parsed YKS overrides mock API score')
assert(mergedOk?.source === 'TRANSCRIPT+YKS (parsed from documents)', 'merged source shows both')

console.log('\nAll frontend academicFromDocuments tests passed.')
