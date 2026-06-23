import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft, FileText, BookOpen, CheckCircle, RefreshCw,
  Save, Send, Lightbulb, AlertTriangle, Eye, Plus,
} from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import Spinner from '../components/Spinner'
import { StatusBadge } from '../components/StatusBadge'
import { extractErrorMessage, logout } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import {
  ensureIntibakTable,
  parseTranscript,
  suggestMatch,
  addMapping,
  updateMapping,
  submitIntibakTable,
} from '../api/intibak'
import type {
  IntibakTable,
  ParsedCourse,
  CourseMapping,
  SuggestedCourse,
  EquivalenceType,
} from '../api/intibak'
import { getEvaluationDetail } from '../api/ygk'
import type { YGKEvaluationDetail } from '../types/ygk'

// ---------------------------------------------------------------------------
// Row state
// ---------------------------------------------------------------------------

interface MappingRowState {
  mappingId: string | null
  sourceCourseCode: string
  sourceCourseName: string
  sourceCredits: number
  sourceGrade: string
  sourceSemester: string
  targetCourseName: string
  targetCourseCode: string
  targetCredits: string
  equivalenceType: EquivalenceType
  notes: string
  saving: boolean
  saved: boolean
  suggestions: SuggestedCourse[]
  showSuggestions: boolean
}

function mappingToRow(m: CourseMapping): MappingRowState {
  return {
    mappingId: m.id,
    sourceCourseCode: m.source_course_code ?? '',
    sourceCourseName: m.source_course_name,
    sourceCredits: m.source_credits,
    sourceGrade: '',
    sourceSemester: '',
    targetCourseName: m.target_course_name ?? '',
    targetCourseCode: m.target_course_code ?? '',
    targetCredits: m.target_credits != null ? String(m.target_credits) : '',
    equivalenceType: m.equivalence_type,
    notes: m.notes ?? '',
    saving: false,
    saved: true,
    suggestions: [],
    showSuggestions: false,
  }
}

function parsedToRow(c: ParsedCourse): MappingRowState {
  return {
    mappingId: null,
    sourceCourseCode: c.course_code ?? '',
    sourceCourseName: c.course_name ?? '',
    sourceCredits: c.credits ?? 0,
    sourceGrade: c.grade ?? '',
    sourceSemester: c.semester ?? '',
    targetCourseName: '',
    targetCourseCode: '',
    targetCredits: '',
    equivalenceType: 'FULL',
    notes: '',
    saving: false,
    saved: false,
    suggestions: [],
    showSuggestions: false,
  }
}

function isUnknownCourseName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return !n || n === 'unknown course'
}

function parsedByCode(courses: ParsedCourse[]): Map<string, ParsedCourse> {
  const map = new Map<string, ParsedCourse>()
  for (const c of courses) {
    const code = c.course_code?.trim().toUpperCase()
    if (code) map.set(code, c)
  }
  return map
}

/** Merge transcript parse into existing mapping rows (by course code). */
function applyParsedToRows(
  rows: MappingRowState[],
  courses: ParsedCourse[],
): MappingRowState[] {
  const usable = courses.filter(c => !isUnknownCourseName(c.course_name ?? ''))
  if (rows.length === 0) {
    return usable.map(parsedToRow)
  }

  const byCode = parsedByCode(usable)

  const updated = rows.map(row => {
    const code = row.sourceCourseCode.trim().toUpperCase()
    const parsed = code ? byCode.get(code) : undefined
    if (!parsed) return row

    const patch: Partial<MappingRowState> = {}
    if (parsed.course_name && !isUnknownCourseName(parsed.course_name)) {
      patch.sourceCourseName = parsed.course_name
    }
    if (parsed.credits != null && parsed.credits > 0) {
      patch.sourceCredits = parsed.credits
    }
    if (parsed.grade) patch.sourceGrade = parsed.grade
    if (parsed.semester) patch.sourceSemester = parsed.semester

    if (Object.keys(patch).length === 0) return row
    return { ...row, ...patch, saved: false }
  })

  const existingCodes = new Set(
    updated.map(r => r.sourceCourseCode.trim().toUpperCase()).filter(Boolean),
  )
  const existingNames = new Set(
    updated.map(r => r.sourceCourseName.trim().toLowerCase()).filter(Boolean),
  )

  const newRows = usable
    .filter(c => {
      if (isUnknownCourseName(c.course_name ?? '')) return false
      const code = c.course_code?.trim().toUpperCase() ?? ''
      const name = c.course_name?.trim().toLowerCase() ?? ''
      if (code && existingCodes.has(code)) return false
      if (name && existingNames.has(name)) return false
      return Boolean(code || name)
    })
    .map(parsedToRow)

  return [...updated, ...newRows]
}

// ---------------------------------------------------------------------------
// Sidebar nav button (matches YGKDashboard pattern)
// ---------------------------------------------------------------------------

function NavBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm transition-colors ${
        active ? 'bg-indigo-700 text-white' : 'text-indigo-200 hover:bg-indigo-800 hover:text-white'
      }`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntibakPage() {
  const { applicationId } = useParams<{ applicationId: string }>()
  const navigate = useNavigate()
  const { userName } = useAuth()

  const [tableId, setTableId] = useState<string | null>(null)
  const [table, setTable] = useState<IntibakTable | null>(null)
  const [transcriptDocId, setTranscriptDocId] = useState<string | null>(null)
  const [appDetail, setAppDetail] = useState<YGKEvaluationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [rows, setRows] = useState<MappingRowState[]>([])
  const [parsedCourses, setParsedCourses] = useState<ParsedCourse[]>([])
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleLogout() {
    try { await logout() } catch { /* ignore */ }
    navigate('/login')
  }

  async function syncParsedSourceFields(
    activeTableId: string,
    tableStatus: string,
    nextRows: MappingRowState[],
  ) {
    if (tableStatus === 'SUBMITTED') return nextRows
    const synced = [...nextRows]
    for (let i = 0; i < synced.length; i++) {
      const row = synced[i]
      if (!row.mappingId || row.saved) continue
      try {
        await updateMapping(activeTableId, row.mappingId, {
          source_course_code: row.sourceCourseCode || undefined,
          source_course_name: row.sourceCourseName,
          source_credits: row.sourceCredits,
        })
        synced[i] = { ...row, saved: true }
      } catch {
        // keep row editable if persist fails
      }
    }
    return synced
  }

  async function loadParsedCourses(
    activeTableId: string,
    docId: string | null,
    tableStatus: string,
    intoRows: MappingRowState[],
  ): Promise<MappingRowState[]> {
    if (!docId || tableStatus === 'SUBMITTED') return intoRows
    try {
      const result = await parseTranscript(activeTableId)
      setParsedCourses(result.courses)
      if (result.courses.length === 0) return intoRows
      let merged = applyParsedToRows(intoRows, result.courses)
      merged = await syncParsedSourceFields(activeTableId, tableStatus, merged)
      return merged
    } catch (parseErr) {
      console.warn('Transcript parse failed:', parseErr)
      return intoRows
    }
  }

  async function loadData() {
    if (!applicationId) return
    try {
      const t = await ensureIntibakTable(applicationId)
      setTableId(t.id)
      setTable(t)
      setTranscriptDocId(t.transcript_document_id ?? null)
      let initialRows = t.mappings.map(mappingToRow)

      if (t.transcript_document_id && t.status !== 'SUBMITTED') {
        setParsing(true)
        initialRows = await loadParsedCourses(
          t.id,
          t.transcript_document_id,
          t.status,
          initialRows,
        )
        if (initialRows.length > 0) {
          toast.success(
            `Loaded ${initialRows.length} course row${initialRows.length !== 1 ? 's' : ''} from transcript.`,
          )
        }
      }

      setRows(initialRows)
      const detail = await getEvaluationDetail(t.application_id).catch(() => null)
      if (detail) setAppDetail(detail)
    } catch (err) {
      toast.error(extractErrorMessage(err))
      setLoadError(true)
    } finally {
      setLoading(false)
      setParsing(false)
    }
  }

  useEffect(() => { loadData() }, [applicationId])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleParseTranscript() {
    if (!tableId) return
    setParsing(true)
    try {
      const result = await parseTranscript(tableId)
      setParsedCourses(result.courses)
      let merged = applyParsedToRows(rows, result.courses)
      if (table) {
        merged = await syncParsedSourceFields(tableId, table.status, merged)
      }
      setRows(merged)
      toast.success(`Parsed ${result.courses.length} course${result.courses.length !== 1 ? 's' : ''} from transcript.`)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setParsing(false)
    }
  }

  function handleAddBlankRow() {
    setRows(prev => [...prev, {
      mappingId: null,
      sourceCourseCode: '',
      sourceCourseName: '',
      sourceCredits: 0,
      sourceGrade: '',
      sourceSemester: '',
      targetCourseName: '',
      targetCourseCode: '',
      targetCredits: '',
      equivalenceType: 'FULL',
      notes: '',
      saving: false,
      saved: false,
      suggestions: [],
      showSuggestions: false,
    }])
  }

  function updateRow(index: number, patch: Partial<MappingRowState>) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r))
  }

  async function handleSuggest(index: number) {
    const row = rows[index]
    if (!row.sourceCourseName) return
    updateRow(index, { showSuggestions: false, suggestions: [] })
    try {
      const suggestions = await suggestMatch(row.sourceCourseName, '')
      if (suggestions.length === 0) {
        toast('No suggestions found.', { icon: 'ℹ️' })
      } else {
        updateRow(index, { suggestions, showSuggestions: true })
      }
    } catch {
      toast.error('Failed to fetch suggestions.')
    }
  }

  function applySuggestion(index: number, s: SuggestedCourse) {
    updateRow(index, {
      targetCourseName: s.course_name,
      targetCourseCode: s.course_code,
      targetCredits: String(s.credits),
      showSuggestions: false,
      suggestions: [],
      saved: false,
    })
  }

  async function handleSaveRow(index: number) {
    const row = rows[index]
    updateRow(index, { saving: true })
    try {
      if (row.mappingId) {
        await updateMapping(tableId!, row.mappingId, {
          source_course_code: row.sourceCourseCode || undefined,
          source_course_name: row.sourceCourseName,
          source_credits: row.sourceCredits,
          target_course_code: row.targetCourseCode || undefined,
          target_course_name: row.targetCourseName || undefined,
          target_credits: row.targetCredits ? Number(row.targetCredits) : undefined,
          equivalence_type: row.equivalenceType,
          notes: row.notes || undefined,
        })
        updateRow(index, { saving: false, saved: true })
      } else {
        const mapping = await addMapping(tableId!, {
          source_course_code: row.sourceCourseCode || undefined,
          source_course_name: row.sourceCourseName,
          source_credits: row.sourceCredits,
          target_course_code: row.targetCourseCode || undefined,
          target_course_name: row.targetCourseName || undefined,
          target_credits: row.targetCredits ? Number(row.targetCredits) : undefined,
          equivalence_type: row.equivalenceType,
          notes: row.notes || undefined,
        })
        updateRow(index, { mappingId: mapping.id, saving: false, saved: true })
      }
      toast.success('Mapping saved.')
    } catch (err) {
      toast.error(extractErrorMessage(err))
      updateRow(index, { saving: false })
    }
  }

  async function handleSubmit() {
    if (!tableId) return
    if (!window.confirm('Submit this intibak table? This action cannot be undone.')) return
    setSubmitting(true)
    try {
      const updated = await submitIntibakTable(tableId)
      setTable(updated)
      toast.success('Intibak table submitted successfully.', { duration: 6000 })
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isSubmitted = table?.status === 'SUBMITTED'
  const unsavedCount = rows.filter(r => !r.saved).length

  const sidebar = (
    <Sidebar userName={userName ?? ''} role="Transfer Commission" onLogout={handleLogout}>
      <NavBtn
        active={false}
        onClick={() => navigate('/dashboard')}
        icon={ArrowLeft}
        label="Back to Dashboard"
      />
      <NavBtn
        active={true}
        onClick={() => {}}
        icon={BookOpen}
        label="Course Equivalence"
      />
    </Sidebar>
  )

  if (loading) {
    return (
      <div className="flex flex-1 min-h-screen">
        {sidebar}
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <Spinner />
        </div>
      </div>
    )
  }

  if (loadError || !table) {
    return (
      <div className="flex flex-1 min-h-screen">
        {sidebar}
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <p className="text-gray-500 text-sm">Failed to load equivalence table.</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="mt-3 text-indigo-600 text-sm hover:underline"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-screen">
      {sidebar}

      <div className="flex-1 p-8 bg-gray-50 overflow-auto">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Application info */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">
                  Course Equivalence (İntibak)
                </h1>
                <p className="text-gray-500 text-sm mt-1">
                  Application:{' '}
                  <span className="font-mono text-gray-700">{table.application_id}</span>
                </p>
                {appDetail && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-gray-500 text-sm">Status:</span>
                    <StatusBadge status={appDetail.status} />
                  </div>
                )}
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                isSubmitted
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                Table: {table.status}
              </span>
            </div>
          </div>

          {/* Transcript */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-gray-900">Transcript</h2>
              </div>
              <div className="flex items-center gap-2">
                {transcriptDocId && (
                  <a
                    href={`/api/documents/${transcriptDocId}/stream`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-300 text-indigo-700 text-sm rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    Open Transcript PDF
                  </a>
                )}
                <button
                  onClick={handleParseTranscript}
                  disabled={parsing || isSubmitted}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {parsing ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
                  {parsing ? 'Parsing…' : 'Re-parse Transcript'}
                </button>
              </div>
            </div>

            {parsedCourses.length === 0 ? (
              <p className="text-gray-400 text-sm">
                Courses from the applicant&apos;s transcript are loaded automatically into the mapping table below.
                Use &quot;Re-parse Transcript&quot; if the PDF was replaced.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-3 font-medium">Course Code</th>
                      <th className="px-4 py-3 font-medium">Course Name</th>
                      <th className="px-4 py-3 font-medium">Credits</th>
                      <th className="px-4 py-3 font-medium">Grade</th>
                      <th className="px-4 py-3 font-medium">Semester</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedCourses.map((c, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {c.course_code || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-900">{c.course_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{c.credits ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{c.grade || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{c.semester || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Course Mappings */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-semibold text-gray-900">Course Equivalence Mappings</h2>
              <span className="ml-auto text-xs text-gray-400 mr-2">
                {rows.filter(r => r.saved).length} / {rows.length} saved
              </span>
              {!isSubmitted && (
                <button
                  onClick={handleAddBlankRow}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Row
                </button>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="text-center py-10">
                <BookOpen className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">
                  {parsing
                    ? 'Parsing transcript… course rows will appear below automatically.'
                    : transcriptDocId
                      ? 'No courses could be parsed from the transcript. Add rows manually or use Re-parse after uploading a text-based PDF.'
                      : 'No transcript uploaded for this application yet.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                      <th className="px-3 py-3 font-medium min-w-[160px]">Source Course</th>
                      <th className="px-3 py-3 font-medium w-12 text-center">Cr.</th>
                      <th className="px-3 py-3 font-medium w-14 text-center">Gr.</th>
                      <th className="px-3 py-3 font-medium min-w-[220px]">Target IYTE Course</th>
                      <th className="px-3 py-3 font-medium w-14 text-center">Cr.</th>
                      <th className="px-3 py-3 font-medium w-28">Equivalence</th>
                      <th className="px-3 py-3 font-medium min-w-[140px]">Notes</th>
                      <th className="px-3 py-3 font-medium w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={index} className="border-b border-gray-50 align-top">

                        {/* Source course — read-only once saved (mappingId set), editable for new rows */}
                        <td className="px-3 py-3">
                          {row.mappingId ? (
                            <>
                              <p className="font-medium text-gray-900 leading-tight">
                                {isUnknownCourseName(row.sourceCourseName) ? row.sourceCourseCode || '—' : row.sourceCourseName}
                              </p>
                              {row.sourceCourseCode && (
                                <p className="font-mono text-xs text-gray-400 mt-0.5">
                                  {row.sourceCourseCode}
                                </p>
                              )}
                              {row.sourceGrade && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Grade: {row.sourceGrade}
                                  {row.sourceSemester ? ` · ${row.sourceSemester}` : ''}
                                </p>
                              )}
                            </>
                          ) : (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={row.sourceCourseName}
                                onChange={e => updateRow(index, { sourceCourseName: e.target.value, saved: false })}
                                disabled={isSubmitted}
                                placeholder="Source course name…"
                                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                              />
                              <input
                                type="text"
                                value={row.sourceCourseCode}
                                onChange={e => updateRow(index, { sourceCourseCode: e.target.value, saved: false })}
                                disabled={isSubmitted}
                                placeholder="Code (opt.)"
                                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                              />
                            </div>
                          )}
                        </td>

                        {/* Source credits — editable for new rows */}
                        <td className="px-3 py-3 text-center text-gray-600">
                          {row.mappingId ? (
                            row.sourceCredits
                          ) : (
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={row.sourceCredits || ''}
                              onChange={e => updateRow(index, { sourceCredits: Number(e.target.value), saved: false })}
                              disabled={isSubmitted}
                              placeholder="0"
                              className="w-14 border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                            />
                          )}
                        </td>

                        {/* Source grade from transcript */}
                        <td className="px-3 py-3 text-center text-gray-600 text-xs">
                          {row.sourceGrade || '—'}
                        </td>

                        {/* Target course */}
                        <td className="px-3 py-3">
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={row.targetCourseName}
                              onChange={e =>
                                updateRow(index, { targetCourseName: e.target.value, saved: false })
                              }
                              disabled={isSubmitted}
                              placeholder="Target course name…"
                              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
                            />
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={row.targetCourseCode}
                                onChange={e =>
                                  updateRow(index, { targetCourseCode: e.target.value, saved: false })
                                }
                                disabled={isSubmitted}
                                placeholder="Code (opt.)"
                                className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
                              />
                              {!isSubmitted && (
                                <button
                                  onClick={() => handleSuggest(index)}
                                  title="Suggest matching IYTE course"
                                  className="flex items-center justify-center p-1.5 text-indigo-500 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors flex-shrink-0"
                                >
                                  <Lightbulb className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            {row.showSuggestions && row.suggestions.length > 0 && (
                              <div className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden z-10 relative">
                                {row.suggestions.map((s, si) => (
                                  <button
                                    key={si}
                                    onClick={() => applySuggestion(index, s)}
                                    className="w-full text-left px-2.5 py-2 text-xs hover:bg-indigo-50 border-b border-gray-50 last:border-0 transition-colors"
                                  >
                                    <span className="font-medium text-gray-900">{s.course_name}</span>
                                    <span className="text-gray-400 ml-1">({s.course_code})</span>
                                    <span className="text-gray-400 ml-1">· {s.credits} cr.</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Target credits */}
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.targetCredits}
                            onChange={e =>
                              updateRow(index, { targetCredits: e.target.value, saved: false })
                            }
                            disabled={isSubmitted}
                            placeholder="0"
                            className="w-14 border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                        </td>

                        {/* Equivalence type */}
                        <td className="px-3 py-3">
                          <select
                            value={row.equivalenceType}
                            onChange={e =>
                              updateRow(index, {
                                equivalenceType: e.target.value as EquivalenceType,
                                saved: false,
                              })
                            }
                            disabled={isSubmitted}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                          >
                            <option value="FULL">FULL</option>
                            <option value="PARTIAL">PARTIAL</option>
                            <option value="NONE">NONE</option>
                          </select>
                        </td>

                        {/* Notes */}
                        <td className="px-3 py-3">
                          <input
                            type="text"
                            value={row.notes}
                            onChange={e =>
                              updateRow(index, { notes: e.target.value, saved: false })
                            }
                            disabled={isSubmitted}
                            placeholder="Optional notes…"
                            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                        </td>

                        {/* Save button */}
                        <td className="px-3 py-3">
                          {isSubmitted ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 whitespace-nowrap">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Submitted
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSaveRow(index)}
                              disabled={row.saving}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap ${
                                row.saved
                                  ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
                              }`}
                            >
                              {row.saving ? (
                                <Spinner />
                              ) : row.saved ? (
                                <CheckCircle className="w-3 h-3" />
                              ) : (
                                <Save className="w-3 h-3" />
                              )}
                              {row.saved ? 'Saved' : 'Save'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Submit / Submitted */}
          {isSubmitted ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">
                  Equivalence Table Submitted
                </p>
                <p className="text-xs text-green-700 mt-0.5">
                  This intibak table has been finalized and submitted successfully.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Finalize Equivalence Table</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Once submitted, the table cannot be edited. Ensure all mappings are saved first.
                  </p>
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || unsavedCount > 0 || rows.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {submitting ? <Spinner /> : <Send className="w-4 h-4" />}
                  {submitting ? 'Submitting…' : 'Submit Table'}
                </button>
              </div>
              {rows.length === 0 && (
                <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Add at least one course mapping before submitting.
                </p>
              )}
              {rows.length > 0 && unsavedCount > 0 && (
                <p className="text-xs text-amber-600 mt-3 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {unsavedCount} mapping{unsavedCount !== 1 ? 's have' : ' has'} unsaved changes.
                  Save all rows before submitting.
                </p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
