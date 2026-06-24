import { useState, useEffect } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Home, ClipboardList, ArrowLeft, Eye, CheckCircle, XCircle,
  Edit2, AlertTriangle, Lock, FileText, Activity, ShieldCheck,
  BookOpen, AlertCircle, RefreshCw, Link2, BarChart2, Table,
  Users, ChevronUp,
} from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import { StatusBadge } from '../components/StatusBadge'
import Spinner from '../components/Spinner'
import { extractErrorMessage } from '../api/auth'
import { getApplicationStatus, listPrograms, listOpenPeriods } from '../api/applications'
import type { ProgramOption, PeriodOption } from '../api/applications'
import { getPreviewUrl } from '../api/applications'
import {
  listYGKApplications,
  getEvaluationDetail,
  verifyScores,
  rejectApplication,
  correctScore,
  getDeptConditions,
  evaluateConditions,
  manualCourseMapping,
  generateRanking,
  getRanking,
  approveRanking,
  deleteRanking,
  returnRankingForCorrection,
  getWaitlist,
  promoteWaitlisted,
} from '../api/ygk'
import type {
  YGKApplicationSummary,
  YGKEvaluationDetail,
  CorrectionField,
  DeptConditionsResponse,
  RankingResult,
} from '../types/ygk'

// ---------------------------------------------------------------------------
// Helpers
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

const STATUS_LABELS: Record<string, string> = {
  UNDER_REVIEW: 'Under Review',
  DEPT_EVAL: 'Department Evaluation',
  ENGLISH_REVIEW: 'English Review',
  RANKING: 'Ranking',
  ANNOUNCED: 'Announced',
  REJECTED: 'Rejected',
}

function formatSource(source: string | null | undefined): string {
  if (!source) return '—'
  if (source === 'MANUAL') return 'YGK Manual Correction'
  // All automated/declared sources map to a single human-readable label
  return 'Extracted from YKS Report'
}

const DOC_TYPE_LABELS: Record<string, string> = {
  TRANSCRIPT: 'Transcript',
  YKS_RESULT: 'YKS Score Report',
  LANGUAGE_CERT: 'Language Certificate',
  ID_COPY: 'ID Copy',
  MILITARY_STATUS: 'Military Status',
  DISCIPLINE_RECORD: 'Discipline Record',
  OTHER: 'Other',
}

// Navigate to the intibak page — the page itself handles create-or-get flow.
function openIntibakTable(applicationId: string, navigate: NavigateFunction) {
  navigate(`/intibak/${applicationId}`)

}

// ---------------------------------------------------------------------------
// Application List
// ---------------------------------------------------------------------------

function ApplicationList({
  onSelect,
}: {
  onSelect: (app: YGKApplicationSummary) => void
}) {
  const [apps, setApps] = useState<YGKApplicationSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listYGKApplications()
      .then(setApps)
      .catch(() => toast.error('Failed to load applications.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Pending Evaluation</h1>
        <p className="text-gray-500 text-sm mt-1">
          Applications awaiting score verification by Transfer Commission
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {apps.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No applications pending evaluation.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-6 py-3 font-medium">Tracking No.</th>
                <th className="px-6 py-3 font-medium">Applicant</th>
                <th className="px-6 py-3 font-medium">Program</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr
                  key={app.id}
                  className="border-b border-gray-50 hover:bg-indigo-50 cursor-pointer transition-colors"
                  onClick={() => onSelect(app)}
                >
                  <td className="px-6 py-4 font-mono text-xs text-gray-600">
                    {app.tracking_number || '—'}
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {app.applicant || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {app.program || '—'}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelect(app) }}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      <Eye className="w-3 h-3" />
                      Evaluate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// İntibak Application List
// ---------------------------------------------------------------------------

function IntibakApplicationList() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<YGKApplicationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [preparing, setPreparing] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      listYGKApplications('RANKING'),
      listYGKApplications('DEPT_EVAL'),
    ])
      .then(([ranking, deptEval]) => setApps([...ranking, ...deptEval]))
      .catch(() => toast.error('Failed to load applications.'))
      .finally(() => setLoading(false))
  }, [])

  async function handlePrepare(applicationId: string) {
    setPreparing(applicationId)
    await openIntibakTable(applicationId, navigate)
    setPreparing(null)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Course Equivalence (İntibak)</h1>
        <p className="text-gray-500 text-sm mt-1">
          Applications eligible for intibak table preparation
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {apps.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              No applications in RANKING or DEPT_EVAL status.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-6 py-3 font-medium">Tracking No.</th>
                <th className="px-6 py-3 font-medium">Applicant</th>
                <th className="px-6 py-3 font-medium">Program</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id} className="border-b border-gray-50 hover:bg-indigo-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-xs text-gray-600">
                    {app.tracking_number || '—'}
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {app.applicant || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {app.program || '—'}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handlePrepare(app.id)}
                      disabled={preparing === app.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {preparing === app.id ? <Spinner /> : <BookOpen className="w-3 h-3" />}
                      {preparing === app.id ? 'Opening…' : 'Prepare İntibak'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score Correction Panel
// ---------------------------------------------------------------------------

function ScoreCorrectionPanel({
  applicationId,
  isLocked,
  forceForeignScale,
  onCorrected,
}: {
  applicationId: string
  isLocked: boolean
  forceForeignScale: boolean
  onCorrected: () => void
}) {
  const [field, setField] = useState<CorrectionField>('gpa_4')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseFloat(value)
    if (isNaN(parsed)) {
      toast.error('Please enter a valid numeric value.')
      return
    }
    if (!note.trim()) {
      toast.error('Correction note is required.')
      return
    }
    setSubmitting(true)
    try {
      await correctScore(applicationId, field, parsed, note.trim())
      toast.success('Score corrected successfully.')
      setValue('')
      setNote('')
      onCorrected()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLocked) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <Lock className="w-4 h-4" />
        Scores are locked — corrections not allowed after verification.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!forceForeignScale && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Field to Correct</label>
          <select
            value={field}
            onChange={e => setField(e.target.value as CorrectionField)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="gpa_4">GPA (4.0 Scale)</option>
            <option value="yks_score">YKS Score</option>
          </select>
        </div>
      )}
      {forceForeignScale && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          Enter the GPA equivalent on the 4.0 scale. The system will convert to 100-scale using the official YÖK table.
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          {forceForeignScale ? 'GPA (4.0 Scale Equivalent)' : field === 'gpa_4' ? 'Corrected GPA (4.0)' : 'Corrected YKS Score'}<span className="text-red-500 ml-0.5">*</span>
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          max={forceForeignScale || field === 'gpa_4' ? '4' : undefined}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={forceForeignScale || field === 'gpa_4' ? '0.00 – 4.00' : 'e.g. 420.5'}
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Correction Note / Justification<span className="text-red-500 ml-0.5">*</span>
        </label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          required
          placeholder={forceForeignScale
            ? 'Describe the grading scale used and how the 4.0 equivalent was calculated…'
            : 'Reason for correction (e.g. data entry error, document discrepancy)…'}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !value || !note.trim()}
        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? <Spinner /> : <Edit2 className="w-4 h-4" />}
        Apply Correction
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// UC-04-02 / SPEC-009 helpers
// ---------------------------------------------------------------------------

type ConditionResultType = 'Met' | 'Not Met' | 'Pending' | 'Unmatched'

function ConditionResultBadge({ result }: { result: ConditionResultType }) {
  const styleMap: Record<ConditionResultType, string> = {
    'Met': 'bg-green-100 text-green-700',
    'Not Met': 'bg-red-100 text-red-700',
    'Pending': 'bg-yellow-100 text-yellow-700',
    'Unmatched': 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${styleMap[result] ?? styleMap['Pending']}`}>
      {result}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Department Specific Requirements (UC-04-02)
// ---------------------------------------------------------------------------

function DeptConditionsSection({
  applicationId,
  currentStatus,
  onEvaluated,
}: {
  applicationId: string
  currentStatus: string
  onEvaluated: (newStatus: string) => void
}) {
  const [conditions, setConditions] = useState<DeptConditionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [manualOverride, setManualOverride] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [courseMappings, setCourseMappings] = useState<Record<string, string>>({})
  const [mappingInProgress, setMappingInProgress] = useState<Record<string, boolean>>({})
  const [portfolioResult, setPortfolioResult] = useState<'Passed' | 'Failed' | ''>('')
  const [rejectionNote, setRejectionNote] = useState('')

  const isReadOnly = currentStatus !== 'UNDER_REVIEW'

  async function reload() {
    try {
      const data = await getDeptConditions(applicationId)
      setConditions(data)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    getDeptConditions(applicationId)
      .then(data => { setConditions(data); setLoadError(false) })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [applicationId])

  async function handleManualMapping(ruleKey: string) {
    const course = courseMappings[ruleKey]?.trim()
    if (!course) { toast.error('Enter the transcript course name.'); return }
    setMappingInProgress(prev => ({ ...prev, [ruleKey]: true }))
    try {
      await manualCourseMapping(applicationId, course, ruleKey)
      toast.success('Course mapped successfully.')
      setCourseMappings(prev => ({ ...prev, [ruleKey]: '' }))
      await reload()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setMappingInProgress(prev => ({ ...prev, [ruleKey]: false }))
    }
  }

  const anyNotMet =
    (conditions?.requirements.some(r => r.result === 'Not Met') ?? false) ||
    portfolioResult === 'Failed'

  async function handleConfirmAll() {
    setSubmitting(true)
    try {
      const result = await evaluateConditions(applicationId, {
        rejectionOverride: anyNotMet,
        portfolioResult: portfolioResult || undefined,
        rejectionJustification: anyNotMet ? rejectionNote.trim() : undefined,
      })
      const newStatus = result.evaluation.passed ? 'ENGLISH_REVIEW' : 'REJECTED'
      toast.success(
        result.evaluation.passed
          ? 'All conditions met — application advanced to English Review.'
          : 'Application rejected — one or more conditions not met.',
      )
      onEvaluated(newStatus)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleManualOverrideSubmit() {
    if (!overrideNote.trim()) { toast.error('Please enter an evaluation note.'); return }
    setSubmitting(true)
    try {
      const result = await evaluateConditions(applicationId, { notes: overrideNote.trim() })
      const newStatus = result.evaluation.passed ? 'ENGLISH_REVIEW' : 'REJECTED'
      toast.success('Manual override evaluation submitted.')
      onEvaluated(newStatus)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const sectionHeader = (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-indigo-600" />
        <h2 className="text-base font-semibold text-gray-900">Department Specific Requirements</h2>
      </div>
      {isReadOnly && (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
          Read Only
        </span>
      )}
    </div>
  )

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        {sectionHeader}
        <div className="flex justify-center py-8"><Spinner /></div>
      </div>
    )
  }

  // TC-2B: Configuration Load Error banner
  if (loadError && !manualOverride) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        {sectionHeader}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800">Configuration Load Error</p>
            <p className="text-xs text-red-700 mt-0.5">
              Unable to load department condition rules. The configuration may be missing or the
              service is temporarily unavailable.
            </p>
          </div>
          {!isReadOnly && (
            <button
              onClick={() => setManualOverride(true)}
              className="flex-shrink-0 px-3 py-1.5 text-xs bg-white border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
            >
              Manual Override
            </button>
          )}
        </div>
        <button
          onClick={reload}
          className="mt-3 flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    )
  }

  // TC-2B: Manual Override mode
  if (manualOverride) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        {sectionHeader}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Manual Override Active</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Condition rules could not be loaded. You may proceed with a manual evaluation note.
              Automated checks will still run on the backend where data is available.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Evaluation Note<span className="text-red-500 ml-0.5">*</span>
            </label>
            <textarea
              value={overrideNote}
              onChange={e => setOverrideNote(e.target.value)}
              rows={3}
              placeholder="Describe your manual evaluation findings…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleManualOverrideSubmit}
              disabled={submitting || !overrideNote.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? <Spinner /> : <CheckCircle className="w-4 h-4" />}
              Submit Manual Evaluation
            </button>
            <button
              onClick={() => setManualOverride(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  const requirements = conditions?.requirements ?? []
  const portfolioReq = requirements.find(r => r.rule_key === 'PORTFOLIO_REQUIRED')
  const otherReqs = requirements.filter(r => r.rule_key !== 'PORTFOLIO_REQUIRED')

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      {sectionHeader}

      {requirements.length === 0 ? (
        <p className="text-gray-400 text-sm">
          No department conditions configured for this program. You may confirm directly.
        </p>
      ) : (
        <>
          <div className="divide-y divide-gray-100 mb-6">
            {/* TC-1A / TC-1B: Automated course checks + manual mapping */}
            {otherReqs.map(req => {
              const badgeResult: ConditionResultType =
                req.result === 'Pending' && req.rule_key === 'CORE_COURSE_GRADE'
                  ? 'Unmatched'
                  : (req.result as ConditionResultType)
              const showMapping =
                !isReadOnly &&
                (req.result === 'Pending' || badgeResult === 'Unmatched')

              return (
                <div key={req.rule_key} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {req.description ?? req.rule_key}
                      </p>
                      {req.required_value && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Minimum / Required: {req.required_value}
                        </p>
                      )}
                      {req.detail && (
                        <p className="text-xs text-gray-500 mt-0.5 italic">{req.detail}</p>
                      )}
                    </div>
                    <ConditionResultBadge result={badgeResult} />
                  </div>

                  {/* TC-1B: Manual Course Matching */}
                  {showMapping && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="text"
                        value={courseMappings[req.rule_key] ?? ''}
                        onChange={e =>
                          setCourseMappings(prev => ({ ...prev, [req.rule_key]: e.target.value }))
                        }
                        placeholder="Enter transcript course name…"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        onClick={() => handleManualMapping(req.rule_key)}
                        disabled={
                          mappingInProgress[req.rule_key] ||
                          !courseMappings[req.rule_key]?.trim()
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {mappingInProgress[req.rule_key] ? (
                          <Spinner />
                        ) : (
                          <Link2 className="w-3 h-3" />
                        )}
                        Map Course
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* TC-1A: Portfolio Review row */}
            {portfolioReq && (
              <div className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">Portfolio Review</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {portfolioReq.description ?? 'Portfolio document required for evaluation'}
                    </p>
                    {portfolioReq.detail && (
                      <p className="text-xs text-gray-500 mt-0.5 italic">{portfolioReq.detail}</p>
                    )}
                  </div>
                  <ConditionResultBadge result={portfolioReq.result as ConditionResultType} />
                </div>

                {!isReadOnly && (
                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Result:</span>
                      {(['Passed', 'Failed'] as const).map(option => (
                        <button
                          key={option}
                          onClick={() =>
                            setPortfolioResult(prev => (prev === option ? '' : option))
                          }
                          className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                            portfolioResult === option
                              ? option === 'Passed'
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-red-600 text-white border-red-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    {/* TC-2A: File Error / Request Re-upload */}
                    <button
                      onClick={() =>
                        toast.success('Re-upload request sent to applicant.')
                      }
                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      File Error / Request Re-upload
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* TC-1C: Rejection justification */}
          {anyNotMet && !isReadOnly && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <p className="text-sm font-semibold text-red-800">
                  One or more conditions not met — rejection justification required
                </p>
              </div>
              <textarea
                value={rejectionNote}
                onChange={e => setRejectionNote(e.target.value)}
                rows={3}
                placeholder="Provide a detailed justification for rejection…"
                className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none bg-white"
              />
            </div>
          )}
        </>
      )}

      {/* Confirm All Conditions button — rendered regardless of requirement count */}
      {!isReadOnly && (
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <button
            onClick={handleConfirmAll}
            disabled={submitting || (anyNotMet && !rejectionNote.trim())}
            className={`flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-sm ${
              anyNotMet ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {submitting ? (
              <Spinner />
            ) : anyNotMet ? (
              <XCircle className="w-4 h-4" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {submitting
              ? 'Submitting…'
              : anyNotMet
              ? 'Confirm & Reject Application'
              : 'Confirm All Conditions'}
          </button>
          {anyNotMet && !rejectionNote.trim() && (
            <p className="text-xs text-red-500">
              Rejection justification required before submitting.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Evaluation Detail Dashboard
// ---------------------------------------------------------------------------

function EvaluationDetail({
  applicationId,
  applicantName,
  onBack,
}: {
  applicationId: string
  applicantName: string
  onBack: () => void
}) {
  const navigate = useNavigate()
  const [detail, setDetail] = useState<YGKEvaluationDetail | null>(null)
  const [statusHistory, setStatusHistory] = useState<Array<{
    status: string; changed_at: string; changed_by_role: string | null; note: string | null
  }>>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [showCorrection, setShowCorrection] = useState(false)
  const [foreignScale, setForeignScale] = useState(false)
  const [preparingIntibak, setPreparingIntibak] = useState(false)

  async function loadDetail() {
    try {
      const [det, statusData] = await Promise.all([
        getEvaluationDetail(applicationId),
        getApplicationStatus(applicationId).catch(() => null),
      ])
      setDetail(det)
      if (statusData) setStatusHistory(statusData.history)

      // Auto-show correction panel if no gpa_4 available (foreign/unknown scale)
      if (!det.academic_record?.gpa_4) {
        setForeignScale(true)
        setShowCorrection(true)
      }
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDetail() }, [applicationId])

  async function handleVerify() {
    if (!detail) return
    setVerifying(true)
    try {
      const result = await verifyScores(applicationId)
      toast.success('Scores verified and locked successfully.')
      // Apply the verified state immediately from the response so the badge
      // updates without waiting for the re-fetch (avoids DB commit race).
      setDetail(prev => {
        if (!prev) return prev
        return {
          ...prev,
          status: result.application_status ?? prev.status,
          academic_record: prev.academic_record
            ? { ...prev.academic_record, is_locked: true }
            : prev.academic_record,
        }
      })
      await loadDetail()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  async function handleReject() {
    if (!detail || !window.confirm('Reject this application? This action cannot be undone.')) return
    setRejecting(true)
    try {
      const result = await rejectApplication(applicationId)
      toast.success('Application rejected.')
      setDetail(prev => prev ? { ...prev, status: result.application_status } : prev)
      await loadDetail()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setRejecting(false)
    }
  }

  async function handlePrepareIntibak() {
    setPreparingIntibak(true)
    await openIntibakTable(applicationId, navigate)
    setPreparingIntibak(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    )
  }

  if (!detail) return null

  const record = detail.academic_record
  const isLocked = record?.is_locked ?? false
  const isManualSource = record?.source === 'MANUAL'
  const needsManualCalc = !record?.gpa_4 && !isLocked
  const canVerify = !isLocked && (record?.gpa_4 != null || record?.yks_score != null)

  const transcriptDocs = detail.documents.filter(d =>
    ['TRANSCRIPT', 'YKS_RESULT'].includes(d.doc_type),
  )
  const otherDocs = detail.documents.filter(d =>
    !['TRANSCRIPT', 'YKS_RESULT'].includes(d.doc_type),
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mt-0.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to list
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-gray-900">{applicantName}</h1>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={detail.status} />
            <span className="text-gray-400 text-xs">{STATUS_LABELS[detail.status] ?? detail.status}</span>
          </div>
        </div>
        <button
          onClick={handlePrepareIntibak}
          disabled={preparingIntibak}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          {preparingIntibak ? <Spinner /> : <BookOpen className="w-4 h-4" />}
          {preparingIntibak ? 'Opening…' : 'Prepare İntibak'}
        </button>
      </div>

      {/* TC-2A: Foreign / Unknown Scale Warning */}
      {needsManualCalc && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Manual Calculation Required</p>
            <p className="text-xs text-amber-700 mt-0.5">
              No 4.0-scale GPA was found for this applicant. This may indicate a foreign or
              non-standard grading scale. A YGK member must manually enter the GPA equivalent
              and provide a justification before scores can be verified.
            </p>
          </div>
        </div>
      )}

      {/* Scores already locked */}
      {isLocked && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Scores Verified & Locked</p>
            <p className="text-xs text-green-700 mt-0.5">
              Academic scores have been confirmed and locked. No further corrections are possible.
            </p>
          </div>
        </div>
      )}

      {/* Documents */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-gray-900">Uploaded Documents</h2>
        </div>

        {detail.documents.length === 0 ? (
          <p className="text-gray-400 text-sm">No documents uploaded.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {[...transcriptDocs, ...otherDocs].map((doc) => (
              <div key={doc.id} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    doc.status === 'VERIFIED' ? 'bg-green-500' :
                    doc.status === 'PENDING' ? 'bg-yellow-400' : 'bg-gray-300'
                  }`} />
                  <div>
                    <p className="text-sm text-gray-900">
                      {DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                    </p>
                    <p className="text-xs text-gray-400">{doc.status}</p>
                  </div>
                </div>
                <button
                  onClick={() => window.open(getPreviewUrl(doc.id).preview_url, '_blank')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  View
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Academic Scores */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-900">Score Verification</h2>
          </div>
          {isManualSource && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              Manual Source
            </span>
          )}
        </div>

        {!record ? (
          <p className="text-gray-400 text-sm">No academic record found for this application.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Declared GPA (4.0 scale)</p>
                <p className="text-2xl font-bold text-gray-900">
                  {record.gpa_4 != null ? record.gpa_4.toFixed(2) : '—'}
                </p>
              </div>
              <div className={`rounded-lg p-4 ${detail.gpa_100_converted != null || record.gpa_100 != null ? 'bg-indigo-50' : 'bg-gray-50'}`}>
                <p className="text-xs text-gray-400 mb-1">YÖK 100-Scale Equivalent</p>
                <p className="text-2xl font-bold text-indigo-700">
                  {record.is_locked && record.gpa_100 != null
                    ? record.gpa_100.toFixed(2)
                    : detail.gpa_100_converted != null
                      ? detail.gpa_100_converted.toFixed(2)
                      : '—'}
                </p>
                {!record.is_locked && detail.gpa_100_converted != null && (
                  <p className="text-xs text-indigo-500 mt-0.5">Auto-computed (YÖK table)</p>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">YKS Score</p>
                <p className="text-xl font-semibold text-gray-900">
                  {record.yks_score != null ? record.yks_score.toFixed(3) : '—'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Data Source</p>
                <p className="text-sm font-medium text-gray-900">{formatSource(record.source)}</p>
              </div>
            </div>

            {/* Verify / Reject buttons */}
            {!isLocked && (
              <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                <button
                  onClick={handleVerify}
                  disabled={verifying || rejecting || !canVerify}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {verifying ? <Spinner /> : <CheckCircle className="w-4 h-4" />}
                  {verifying ? 'Verifying…' : 'Verify & Confirm'}
                </button>
                <button
                  onClick={handleReject}
                  disabled={verifying || rejecting}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white text-red-600 text-sm font-semibold rounded-lg border border-red-300 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {rejecting ? <Spinner /> : <XCircle className="w-4 h-4" />}
                  {rejecting ? 'Rejecting…' : 'Reject Application'}
                </button>
                {!canVerify && (
                  <p className="text-xs text-gray-400">
                    Scores must be corrected before verification.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Manual Correction */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-semibold text-gray-900">
              {foreignScale ? 'Foreign Scale — Manual Entry' : 'Manual Score Correction'}
            </h2>
          </div>
          {!isLocked && !foreignScale && (
            <button
              onClick={() => setShowCorrection(v => !v)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                showCorrection
                  ? 'bg-gray-100 border-gray-300 text-gray-700'
                  : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {showCorrection ? 'Collapse' : 'Edit Score / GPA'}
            </button>
          )}
        </div>

        {(showCorrection || foreignScale) ? (
          <ScoreCorrectionPanel
            applicationId={applicationId}
            isLocked={isLocked}
            forceForeignScale={foreignScale}
            onCorrected={loadDetail}
          />
        ) : (
          !isLocked && (
            <p className="text-gray-400 text-sm">
              Use "Edit Score / GPA" to manually correct a score if the declared data does not
              match the uploaded documents.
            </p>
          )
        )}
      </div>

      {/* Department Specific Requirements (UC-04-02) */}
      <DeptConditionsSection
        applicationId={applicationId}
        currentStatus={detail.status}
        onEvaluated={(newStatus) => {
          setDetail(prev => prev ? { ...prev, status: newStatus } : prev)
          loadDetail()
        }}
      />

      {/* Audit / Activity Log */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-gray-400" />
          <h2 className="text-base font-semibold text-gray-900">Application History</h2>
        </div>

        {statusHistory.length === 0 ? (
          <p className="text-gray-400 text-sm">No status history available.</p>
        ) : (
          <div className="space-y-3">
            {statusHistory.map((entry, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-indigo-500" />
                </div>
                <div className="flex-1 flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-900">
                      {entry.status.replace(/_/g, ' ')}
                    </p>
                    {entry.changed_by_role && (
                      <p className="text-xs text-gray-400">
                        by {entry.changed_by_role.replace(/_/g, ' ')}
                      </p>
                    )}
                    {entry.note && (
                      <p className="text-xs text-gray-500 mt-0.5 italic">"{entry.note}"</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap ml-4">
                    {new Date(entry.changed_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {isManualSource && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Edit2 className="w-2.5 h-2.5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-900">Score Manually Corrected</p>
                <p className="text-xs text-gray-400">
                  Academic record source is MANUAL — at least one score was corrected by a YGK member.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UC-04-03 & UC-04-04 & UC-04-06: Ranking Page
// ---------------------------------------------------------------------------

const RANKING_STORAGE_KEY = 'utms_last_ranking_id'

function RankingPage() {
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [periods, setPeriods] = useState<PeriodOption[]>([])
  const [programId, setProgramId] = useState('')
  const [periodId, setPeriodId] = useState('')
  const [ranking, setRanking] = useState<RankingResult | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [returning, setReturning] = useState(false)
  const [returnNote, setReturnNote] = useState('')
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [waitlist, setWaitlist] = useState<{ vacant_slots: number; waitlisted: Array<{ application_id: string; position: number; composite_score: number }> } | null>(null)
  const [promotingId, setPromotingId] = useState('')
  const [promoting, setPromoting] = useState(false)

  useEffect(() => {
    Promise.all([listPrograms(), listOpenPeriods()]).then(([p, per]) => {
      setPrograms(p)
      setPeriods(per)
      if (p.length > 0) setProgramId(p[0].id)
      if (per.length > 0) setPeriodId(per[0].id)
    }).catch(() => toast.error('Failed to load programs/periods.'))

    // Load last saved ranking from localStorage
    const savedId = localStorage.getItem(RANKING_STORAGE_KEY)
    if (savedId) {
      setLoadingExisting(true)
      getRanking(savedId)
        .then(r => setRanking(r))
        .catch(() => localStorage.removeItem(RANKING_STORAGE_KEY))
        .finally(() => setLoadingExisting(false))
    }
  }, [])

  async function handleGenerate() {
    if (!programId || !periodId) { toast.error('Select a program and period.'); return }
    setGenerating(true)
    try {
      const result = await generateRanking(programId, periodId)
      const full = await getRanking(result.id)
      setRanking({ ...full, excluded_candidates: result.excluded_candidates })
      localStorage.setItem(RANKING_STORAGE_KEY, result.id)
      setWaitlist(null)
      toast.success('Ranking generated successfully.')
    } catch (err: any) {
      const existingId = err?.response?.data?.existing_id
      if (err?.response?.status === 409 && existingId) {
        try {
          const full = await getRanking(existingId)
          setRanking(full)
          localStorage.setItem(RANKING_STORAGE_KEY, existingId)
          setWaitlist(null)
          toast.success('Existing ranking loaded.')
        } catch {
          toast.error('Ranking already exists but could not be loaded.')
        }
      } else {
        toast.error(extractErrorMessage(err))
      }
    } finally {
      setGenerating(false)
    }
  }

  async function handleApprove() {
    if (!ranking) return
    setApproving(true)
    try {
      const result = await approveRanking(ranking.id)
      setRanking(prev => prev ? { ...prev, status: result.status, approved_at: result.approved_at } : prev)
      toast.success('Ranking approved and locked.')
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setApproving(false)
    }
  }

  async function handleReturn() {
    if (!ranking || !returnNote.trim()) { toast.error('Return note is required.'); return }
    setReturning(true)
    try {
      await returnRankingForCorrection(ranking.id, returnNote.trim())
      setRanking(prev => prev ? { ...prev, status: 'CORRECTION_REQUESTED' } : prev)
      setShowReturnForm(false)
      setReturnNote('')
      toast.success('Ranking returned for correction.')
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setReturning(false)
    }
  }

  async function handleLoadWaitlist() {
    if (!ranking) return
    try {
      const data = await getWaitlist(ranking.id)
      setWaitlist(data)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  async function handlePromote() {
    if (!ranking || !promotingId.trim()) { toast.error('Enter the withdrawn application ID.'); return }
    setPromoting(true)
    try {
      const result = await promoteWaitlisted(ranking.id, promotingId.trim())
      toast.success(result.message)
      setPromotingId('')
      const data = await getWaitlist(ranking.id)
      setWaitlist(data)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setPromoting(false)
    }
  }

  const isApproved = ranking?.status === 'APPROVED'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Generate & Approve Ranking</h1>
        <p className="text-gray-500 text-sm mt-1">UC-04-03 · UC-04-04 · UC-04-06</p>
      </div>

      {/* Generate form */}
      <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-gray-900">Generate Ranking (UC-04-03)</h2>
        </div>

        {loadingExisting ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Spinner /> Loading saved ranking…</div>
        ) : !ranking && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Program</label>
                <select value={programId} onChange={e => setProgramId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  {programs.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code}) — Quota: {p.quota}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Period</label>
                <select value={periodId} onChange={e => setPeriodId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {generating ? <Spinner /> : <BarChart2 className="w-4 h-4" />}
              {generating ? 'Generating…' : 'Generate Ranking'}
            </button>
          </>
        )}

        {ranking && !loadingExisting && (
          <div className="flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2">
            <BarChart2 className="w-3 h-3" />
            Ranking loaded: <span className="font-mono">{ranking.id}</span>
          </div>
        )}
      </div>

      {/* Ranking result */}
      {ranking && (
        <>
          <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Table className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-gray-900">Ranking Report</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  isApproved ? 'bg-green-100 text-green-700' :
                  ranking.status === 'CORRECTION_REQUESTED' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>{ranking.status}</span>
                {ranking.approved_at && (
                  <span className="text-xs text-gray-400">
                    Approved: {new Date(ranking.approved_at).toLocaleString()}
                  </span>
                )}
                <button
                  onClick={async () => {
                    try {
                      if (ranking && ranking.status !== 'APPROVED') {
                        await deleteRanking(ranking.id)
                      }
                    } catch { /* ignore */ }
                    setRanking(null)
                    setWaitlist(null)
                    localStorage.removeItem(RANKING_STORAGE_KEY)
                  }}
                  className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  Clear & Start New
                </button>
              </div>
            </div>

            {/* Excluded candidates banner */}
            {ranking.excluded_candidates && ranking.excluded_candidates.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  <p className="text-sm font-semibold text-orange-800">Excluded Candidates (Missing Score Data)</p>
                </div>
                <ul className="space-y-1">
                  {ranking.excluded_candidates.map((c, i) => (
                    <li key={i} className="text-xs text-orange-700 font-mono">{c.application_id} — {c.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Ranking table */}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-2 font-medium">Rank</th>
                  <th className="px-4 py-2 font-medium">Application ID</th>
                  <th className="px-4 py-2 font-medium">Composite Score</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(ranking.entries ?? []).map(entry => (
                  <tr key={entry.application_id} className={`border-b border-gray-50 ${entry.is_primary ? 'bg-green-50' : 'bg-yellow-50'}`}>
                    <td className="px-4 py-3 font-bold text-gray-900">#{entry.position}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{entry.application_id}</td>
                    <td className="px-4 py-3 font-semibold text-indigo-700">{entry.composite_score.toFixed(3)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entry.is_primary ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {entry.is_primary ? 'Asil (Primary)' : 'Yedek (Waitlist)'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Approve / Return buttons (UC-04-04) */}
            {!isApproved && ranking.status !== 'CORRECTION_REQUESTED' && (
              <div className="pt-4 border-t border-gray-100 flex items-center gap-3 flex-wrap">
                <button onClick={handleApprove} disabled={approving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                  {approving ? <Spinner /> : <CheckCircle className="w-4 h-4" />}
                  {approving ? 'Approving…' : 'Approve Ranking (UC-04-04)'}
                </button>
                <button onClick={() => setShowReturnForm(v => !v)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white text-red-600 text-sm font-semibold rounded-lg border border-red-300 hover:bg-red-50 transition-colors">
                  <XCircle className="w-4 h-4" />
                  Return for Correction
                </button>
              </div>
            )}

            {isApproved && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-3">
                <Lock className="w-4 h-4" />
                Ranking is approved and locked — no further modifications allowed.
              </div>
            )}

            {showReturnForm && (
              <div className="pt-4 border-t border-gray-100 space-y-3">
                <label className="block text-xs text-gray-500">Return Note (required)</label>
                <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)} rows={3}
                  placeholder="Describe the inconsistency or reason for return…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
                <div className="flex gap-3">
                  <button onClick={handleReturn} disabled={returning || !returnNote.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50">
                    {returning ? <Spinner /> : <XCircle className="w-4 h-4" />}
                    Submit Return
                  </button>
                  <button onClick={() => setShowReturnForm(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Waitlist management (UC-04-06) */}
          {isApproved && (
            <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  <h2 className="text-base font-semibold text-gray-900">Waitlist Management (UC-04-06)</h2>
                </div>
                <button onClick={handleLoadWaitlist}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 border border-indigo-200">
                  <RefreshCw className="w-3 h-3" /> Load Waitlist
                </button>
              </div>

              {waitlist && (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                    Vacant slots: <strong>{waitlist.vacant_slots}</strong>
                  </div>
                  {waitlist.waitlisted.length === 0 ? (
                    <p className="text-gray-400 text-sm">No candidates remain on waitlist.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                          <th className="px-4 py-2 font-medium">Position</th>
                          <th className="px-4 py-2 font-medium">Application ID</th>
                          <th className="px-4 py-2 font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waitlist.waitlisted.map(w => (
                          <tr key={w.application_id} className="border-b border-gray-50">
                            <td className="px-4 py-3 font-bold">#{w.position}</td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600">{w.application_id}</td>
                            <td className="px-4 py-3 font-semibold text-indigo-700">{w.composite_score.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="pt-4 border-t border-gray-100 space-y-3">
                    <p className="text-xs text-gray-500">Promote next waitlisted candidate — enter the withdrawn applicant's Application ID:</p>
                    <div className="flex gap-3">
                      <input type="text" value={promotingId} onChange={e => setPromotingId(e.target.value)}
                        placeholder="Withdrawn Application ID…"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <button onClick={handlePromote} disabled={promoting || !promotingId.trim()}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                        {promoting ? <Spinner /> : <ChevronUp className="w-4 h-4" />}
                        Promote Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root YGK Dashboard
// ---------------------------------------------------------------------------

export default function YGKDashboard({
  userName,
  onLogout,
}: {
  userName: string
  onLogout: () => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'pending' | 'ranking' | 'intibak'>('pending')
  const [selected, setSelected] = useState<YGKApplicationSummary | null>(null)

  return (
    <div className="flex flex-1 min-h-screen">
      <Sidebar userName={userName} role="Transfer Commission" onLogout={onLogout}>
        <NavBtn
          active={activeTab === 'overview' && !selected}
          onClick={() => { setActiveTab('overview'); setSelected(null) }}
          icon={Home}
          label="Dashboard"
        />
        <NavBtn
          active={activeTab === 'pending' && !selected}
          onClick={() => { setActiveTab('pending'); setSelected(null) }}
          icon={ClipboardList}
          label="Pending Evaluation"
        />
        <NavBtn
          active={activeTab === 'ranking' && !selected}
          onClick={() => { setActiveTab('ranking'); setSelected(null) }}
          icon={BarChart2}
          label="Ranking"
        />
        <NavBtn
          active={activeTab === 'intibak' && !selected}
          onClick={() => { setActiveTab('intibak'); setSelected(null) }}
          icon={BookOpen}
          label="İntibak"
        />
      </Sidebar>

      <div className="flex-1 p-8 bg-gray-50">
        <div className="max-w-5xl mx-auto">

          {/* Evaluation detail view */}
          {selected && (
            <EvaluationDetail
              applicationId={selected.id}
              applicantName={selected.applicant ?? 'Applicant'}
              onBack={() => setSelected(null)}
            />
          )}

          {/* Overview tab */}
          {!selected && activeTab === 'overview' && (
            <>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-gray-900">Transfer Commission</h1>
                  <p className="text-gray-500 text-sm">Izmir Institute of Technology</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <p className="text-gray-500 text-sm">
                  Use the tabs on the left to navigate: <strong>Pending Evaluation</strong>, <strong>Ranking</strong>, or <strong>İntibak</strong>.
                </p>
              </div>
            </>
          )}

          {/* Pending evaluation list */}
          <div className={!selected && activeTab === 'pending' ? '' : 'hidden'}>
            <ApplicationList onSelect={setSelected} />
          </div>

          {/* Ranking tab (UC-04-03, UC-04-04, UC-04-06) */}
          <div className={!selected && activeTab === 'ranking' ? '' : 'hidden'}>
            <RankingPage />
          </div>

          {/* İntibak tab (UC-04-05) */}
          <div className={!selected && activeTab === 'intibak' ? '' : 'hidden'}>
            <IntibakApplicationList />
          </div>

        </div>
      </div>
    </div>
  )
}
