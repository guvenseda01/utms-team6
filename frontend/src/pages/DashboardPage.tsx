import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Home, FileText, Send, CheckCircle, Clock, Users,
  Settings, BarChart2, Upload, Eye, RefreshCw, PlusCircle,
  UserPlus, Trash2, Edit2, X, UserCheck, CalendarDays, ShieldCheck,
  Megaphone, AlertTriangle, Trophy, ClipboardList,
} from 'lucide-react'
import { logout } from '../api/auth'
import {
  listStaff, createStaff, updateStaffRole, deactivateStaff, activateStaff,
  listPeriods, createPeriod, updatePeriod, extendPeriod, emergencyClosePeriod, activatePeriod, deactivatePeriod,
  listConditions, addCondition, updateCondition, deleteCondition,
} from '../api/admin'
import type {
  StaffMember, UserRole as StaffRole,
  ApplicationPeriod, PeriodCreatePayload,
  DepartmentCondition, ConditionCreatePayload, RuleKey,
} from '../types/admin'
import {
  listApplications,
  getApplication,
  getApplicationStatus,
  createApplication,
  fetchAcademicData,
  submitApplication,
  resubmitAfterCorrection,
  listDocuments,
  uploadDocument,
  verifyDocument,
  getPreviewUrl,
  listPrograms,
  listOpenPeriods,
  type ProgramOption,
  type PeriodOption,
} from '../api/applications'
import {
  getResults, publishResults,
  listStaffApplications, getStaffApplication,
  approveVerification, requestCorrection, rejectStaffApplication,
  announceApplication,
} from '../api/staff'
import type {
  ResultsResponse, ApplicantResult,
  StaffApplicationSummary, StaffApplicationDetail,
  RejectionReasonCode,
} from '../types/staff'
import { listNotifications } from '../api/applications'
import type { NotificationMessage } from '../types/application'
import { useAuth } from '../context/AuthContext'
import YGKDashboard from './YGKDashboard'
import YDYODashboard from './YDYODashboard'
import DeanDashboard from './DeanDashboard'
import { Sidebar } from '../components/Sidebar'
import { StatusBadge } from '../components/StatusBadge'
import Spinner from '../components/Spinner'
import { ApplicantMessagesPanel, StaffMessagesPanel } from '../components/Messages'
import { ApplicationStageTracker } from '../components/ApplicationStageTracker'
import type { ApplicationDetail, ApplicationStatus, AcademicRecord, Document, DocType } from '../types/application'
import { extractErrorMessage } from '../api/auth'

const ROLE_LABELS: Record<string, string> = {
  APPLICANT: 'Applicant',
  STUDENT_AFFAIRS: 'Student Affairs',
  TRANSFER_COMMISSION: 'Transfer Commission',
  YDYO: 'Foreign Languages Office',
  DEAN_OFFICE: "Dean's Office",
  SYSTEM_ADMIN: 'IT Administrator',
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  TRANSCRIPT: 'Transcript',
  YKS_RESULT: 'YKS Score Report',
  LANGUAGE_CERT: 'Language Certificate',
  ID_COPY: 'ID Copy',
  MILITARY_STATUS: 'Military Status',
  DISCIPLINE_RECORD: 'Discipline Record',
  OTHER: 'Other',
}

const REQUIRED_DOCS: DocType[] = ['TRANSCRIPT', 'YKS_RESULT', 'ID_COPY']

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
// New Application Form
// ---------------------------------------------------------------------------

function NewApplicationForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [periods, setPeriods] = useState<PeriodOption[]>([])
  const [programId, setProgramId] = useState('')
  const [periodId, setPeriodId] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(true)

  useEffect(() => {
    Promise.all([listPrograms(), listOpenPeriods()])
      .then(([progs, pers]) => {
        setPrograms(progs)
        setPeriods(pers)
        if (progs.length > 0) setProgramId(progs[0].id)
        if (pers.length > 0) setPeriodId(pers[0].id)
      })
      .catch(() => toast.error('Failed to load programs or periods.'))
      .finally(() => setLoadingOptions(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!programId || !periodId) {
      toast.error('Please select a program and a period.')
      return
    }
    setLoading(true)
    try {
      const result = await createApplication({ program_id: programId, period_id: periodId })
      toast.success('Application created!')
      onCreated(result.application_id)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (loadingOptions) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 flex justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Start a New Application</h2>
      <p className="text-gray-500 text-sm mb-6">Select the program and application period for your transfer application.</p>

      {periods.length === 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          No open application periods at this time. Please check back later.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm text-gray-700 mb-1">Program</label>
          <select
            value={programId}
            onChange={e => setProgramId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            {programs.length === 0 && <option value="">No programs available</option>}
            {programs.map(p => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name} ({p.faculty})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Application Period</label>
          <select
            value={periodId}
            onChange={e => setPeriodId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            {periods.length === 0 && <option value="">No open periods</option>}
            {periods.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={loading || periods.length === 0 || programs.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Spinner /> : <PlusCircle className="w-4 h-4" />}
          Create Application
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Extracted data label helpers
// ---------------------------------------------------------------------------

const EXTRACTION_LABELS: Record<string, string> = {
  gpa: 'GPA',
  completed_credits: 'Completed Credits',
  total_credits: 'Total Credits',
  institution: 'Institution',
  score: 'Score',
  score_type: 'Score Type',
  exam_year: 'Exam Year',
  certificate_type: 'Certificate Type',
  validity_date: 'Valid Until',
  national_id_verified: 'National ID Verified',
}

function ExtractionCard({
  applicationId,
  documentId,
  data,
  confirmed,
  onConfirmed,
}: {
  applicationId: string
  documentId: string
  data: Record<string, unknown>
  confirmed: boolean
  onConfirmed: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  const missing = (data._missing as string[] | undefined) ?? []
  const found = Object.entries(data).filter(([k]) => k !== '_missing')
  const isIncomplete = missing.length > 0
  const hasNothing = found.length === 0

  async function handleConfirm() {
    setConfirming(true)
    try {
      await verifyDocument(applicationId, documentId)
      toast.success('Document verified.')
      onConfirmed()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setConfirming(false)
    }
  }

  if (confirmed) {
    return (
      <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-3">
        <p className="text-xs font-medium text-green-700 mb-1">Extracted Information (Confirmed)</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {found.map(([key, val]) => (
            <div key={key}>
              <span className="text-gray-400 text-xs">{EXTRACTION_LABELS[key] ?? key}: </span>
              <span className="text-gray-800 text-xs font-medium">{String(val)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isIncomplete || hasNothing) {
    const noExtractionDefined = found.length === 0 && missing.length === 0
    return (
      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-700 mb-2">
          {noExtractionDefined
            ? 'No automatic extraction available for this document type'
            : hasNothing
              ? 'No information could be extracted from this file'
              : 'Some information could not be extracted'}
        </p>

        {found.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-gray-500 mb-1">Found:</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {found.map(([key, val]) => (
                <div key={key}>
                  <span className="text-gray-400 text-xs">{EXTRACTION_LABELS[key] ?? key}: </span>
                  <span className="text-gray-800 text-xs font-medium">{String(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {missing.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-gray-500 mb-1">Missing:</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {missing.map((key) => (
                <div key={key}>
                  <span className="text-gray-400 text-xs">{EXTRACTION_LABELS[key] ?? key}: </span>
                  <span className="text-red-500 text-xs font-medium">Not found</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-red-600 mb-2">
          {noExtractionDefined
            ? 'Please confirm you have uploaded the correct document.'
            : 'Please check that you uploaded the correct document. You may re-upload or confirm anyway.'}
        </p>
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
        >
          {confirming ? <Spinner /> : <CheckCircle className="w-3 h-3" />}
          Confirm Anyway
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
      <p className="text-xs font-medium text-yellow-700 mb-2">Extracted Information — Please verify</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
        {found.map(([key, val]) => (
          <div key={key}>
            <span className="text-gray-400 text-xs">{EXTRACTION_LABELS[key] ?? key}: </span>
            <span className="text-gray-800 text-xs font-medium">{String(val)}</span>
          </div>
        ))}
      </div>
      <button
        onClick={handleConfirm}
        disabled={confirming}
        className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:opacity-50"
      >
        {confirming ? <Spinner /> : <CheckCircle className="w-3 h-3" />}
        Confirm
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Document upload row
// ---------------------------------------------------------------------------

function DocumentUploadRow({
  applicationId,
  docType,
  existing,
  onUploaded,
}: {
  applicationId: string
  docType: DocType
  existing: Document | undefined
  onUploaded: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      toast.error('Invalid file format. Please upload a PDF file.')
      return
    }
    if (file.size > 5_242_880) {
      toast.error('File exceeds 5 MB limit.')
      return
    }

    setUploading(true)
    try {
      await uploadDocument(applicationId, docType, file)
      toast.success(`${DOC_TYPE_LABELS[docType]} uploaded.`)
      onUploaded()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handlePreview() {
    if (!existing) return
    const { preview_url } = getPreviewUrl(existing.id)
    window.open(preview_url, '_blank')
  }

  const hasExtraction = existing?.extracted_data !== null && existing?.extracted_data !== undefined

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${existing ? 'bg-green-500' : 'bg-gray-300'}`} />
          <div>
            <p className="text-sm text-gray-900">{DOC_TYPE_LABELS[docType]}</p>
            {existing && (
              <p className="text-xs text-gray-400">{existing.file_name} · {existing.status}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {existing && (
            <button
              onClick={handlePreview}
              className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded"
            >
              <Eye className="w-3 h-3" /> Preview
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? <Spinner /> : <Upload className="w-3 h-3" />}
            {existing ? 'Replace' : 'Upload'}
          </button>
        </div>
      </div>
      {existing && hasExtraction && (
        <div className="ml-5">
          <ExtractionCard
            applicationId={applicationId}
            documentId={existing.id}
            data={existing.extracted_data as Record<string, unknown>}
            confirmed={existing.extraction_confirmed}
            onConfirmed={onUploaded}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Applicant Dashboard
// ---------------------------------------------------------------------------

function ApplicantDashboardContent({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'application' | 'messages' | 'results'>('overview')
  const [application, setApplication] = useState<ApplicationDetail | null>(null)
  const [appStatus, setAppStatus] = useState<ApplicationStatus | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [academicRecord, setAcademicRecord] = useState<AcademicRecord | null>(null)
  const [loadingApp, setLoadingApp] = useState(true)
  const [fetchingAcademic, setFetchingAcademic] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hasNoApp, setHasNoApp] = useState(false)
  const [notifications, setNotifications] = useState<NotificationMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  async function loadApplication(id?: string) {
    try {
      let appId = id
      if (!appId) {
        const apps = await listApplications()
        if (apps.length === 0) { setHasNoApp(true); setLoadingApp(false); return }
        appId = apps[0].id
      }
      const [detail, statusData, docs] = await Promise.all([
        getApplication(appId),
        getApplicationStatus(appId),
        listDocuments(appId),
      ])
      setApplication(detail)
      setAppStatus(statusData)
      setHasNoApp(false)
      setDocuments(docs)
    } catch {
      setHasNoApp(true)
    } finally {
      setLoadingApp(false)
    }
  }

  useEffect(() => { loadApplication() }, [])

  useEffect(() => {
    if (activeTab !== 'messages' || !application) return
    setLoadingMessages(true)
    listNotifications(application.id)
      .then(setNotifications)
      .catch(() => toast.error('Failed to load messages.'))
      .finally(() => setLoadingMessages(false))
  }, [activeTab, application?.id])

  // SSE: auto-refresh on status change
  useEffect(() => {
    if (!application) return
    const terminal = ['ANNOUNCED', 'REJECTED']
    if (terminal.includes(application.status)) return

    const es = new EventSource(`/api/applications/${application.id}/events`, { withCredentials: true })
    es.onmessage = () => { loadApplication(application.id) }
    es.onerror = () => { es.close() }
    return () => es.close()
  }, [application?.id, application?.status])

  async function handleFetchAcademic() {
    if (!application) return
    setFetchingAcademic(true)
    try {
      const record = await fetchAcademicData(application.id)
      setAcademicRecord(record)
      if (record.errors?.length) {
        toast.error(`Partial data: ${record.errors.join(', ')}`)
      } else {
        toast.success('Academic data fetched successfully.')
      }
      await loadApplication(application.id)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setFetchingAcademic(false)
    }
  }

  async function handleSubmit() {
    if (!application) return
    setSubmitting(true)
    try {
      const result = await submitApplication(application.id)
      toast.success(`Submitted! Tracking number: ${result.tracking_number}`)
      await loadApplication(application.id)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDocUploaded() {
    if (application) {
      const docs = await listDocuments(application.id)
      setDocuments(docs)
    }
  }

  async function handleResubmit() {
    if (!application) return
    setSubmitting(true)
    try {
      await resubmitAfterCorrection(application.id)
      toast.success('Corrections submitted — Student Affairs will review your updated documents.')
      await loadApplication(application.id)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingApp) {
    return (
      <div className="flex flex-1 min-h-screen items-center justify-center bg-gray-50">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-screen">
      <Sidebar userName={userName} role="Applicant" onLogout={onLogout}>
        <NavBtn active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={Home} label="Overview" />
        <NavBtn active={activeTab === 'application'} onClick={() => setActiveTab('application')} icon={FileText} label="My Application" />
        <NavBtn active={activeTab === 'messages'} onClick={() => setActiveTab('messages')} icon={Send} label="Messages" />
        <NavBtn active={activeTab === 'results'} onClick={() => setActiveTab('results')} icon={CheckCircle} label="Results" />
      </Sidebar>

      <div className="flex-1 p-8 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">IZTECH Transfer Application</h1>
          <p className="text-gray-500 text-sm mb-8">Izmir Institute of Technology</p>

          {/* ── Overview tab ──────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {hasNoApp ? (
                <NewApplicationForm onCreated={(id) => { setLoadingApp(true); loadApplication(id) }} />
              ) : application ? (
                <>
                  {/* CORRECTION_REQUESTED banner */}
                  {application.status === 'CORRECTION_REQUESTED' && (
                    <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex items-start gap-3">
                      <Clock className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-yellow-800">Correction Required</p>
                        <p className="text-xs text-yellow-700 mt-0.5">
                          Your documents need corrections. Please upload the updated files in the Documents tab, then click "Submit Corrections" to notify Student Affairs.
                        </p>
                        <button
                          onClick={handleResubmit}
                          disabled={submitting}
                          className="mt-3 px-4 py-1.5 text-xs font-medium bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50"
                        >
                          {submitting ? 'Submitting…' : 'Submit Corrections'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* REJECTED banner */}
                  {application.status === 'REJECTED' && (
                    <div className="bg-red-50 border border-red-300 rounded-lg p-4">
                      <p className="text-sm font-semibold text-red-800 mb-1">Application Rejected</p>
                      {appStatus?.result?.reason && (
                        <p className="text-sm text-red-700">{appStatus.result.reason}</p>
                      )}
                    </div>
                  )}

                  {/* Status card */}
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-1">Application Status</h2>
                        <p className="text-gray-500 text-sm">
                          {application.tracking_number
                            ? `Tracking: ${application.tracking_number}`
                            : 'Not yet submitted'}
                        </p>
                      </div>
                      <StatusBadge status={application.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      {academicRecord?.institution && (
                        <div><p className="text-gray-400 text-xs mb-1">Institution</p><p className="text-gray-900 text-sm">{academicRecord.institution}</p></div>
                      )}
                      {academicRecord?.gpa_4 != null && (
                        <div><p className="text-gray-400 text-xs mb-1">GPA (4.0)</p><p className="text-gray-900 text-sm">{academicRecord.gpa_4}</p></div>
                      )}
                      {academicRecord?.yks_score != null && (
                        <div><p className="text-gray-400 text-xs mb-1">YKS Score</p><p className="text-gray-900 text-sm">{academicRecord.yks_score}</p></div>
                      )}
                      <div><p className="text-gray-400 text-xs mb-1">Created</p><p className="text-gray-900 text-sm">{new Date(application.created_at).toLocaleDateString()}</p></div>
                      {application.submitted_at && (
                        <div><p className="text-gray-400 text-xs mb-1">Submitted</p><p className="text-gray-900 text-sm">{new Date(application.submitted_at).toLocaleDateString()}</p></div>
                      )}
                    </div>
                  </div>

                  {/* Progress tracker with visual stage circles */}
                  <ApplicationStageTracker
                    currentStatus={application.status}
                    history={appStatus?.history}
                    language="en"
                  />

                  {/* Status history */}
                  {appStatus && appStatus.history.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm p-6">
                      <h2 className="text-lg font-semibold text-gray-900 mb-4">Status History</h2>
                      <div className="space-y-4">
                        {appStatus.history.map((entry, i) => (
                          <div key={i} className="flex items-start gap-4">
                            <div className="mt-0.5">
                              <CheckCircle className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div className="flex-1 flex items-center justify-between">
                              <div>
                                <p className="text-sm text-gray-900">{entry.status.replace(/_/g, ' ')}</p>
                                {entry.note && <p className="text-xs text-gray-400">{entry.note}</p>}
                                {entry.changed_by_role && <p className="text-xs text-gray-400">{entry.changed_by_role.replace(/_/g, ' ')}</p>}
                              </div>
                              <span className="text-xs text-gray-400">{new Date(entry.changed_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Eligibility checks */}
                  {application.eligibility_checks.length > 0 && (
                    <div className="bg-white rounded-lg shadow-sm p-6">
                      <h2 className="text-lg font-semibold text-gray-900 mb-4">Eligibility Checks</h2>
                      <div className="space-y-2">
                        {application.eligibility_checks.map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-gray-700">{c.rule_key}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500 text-xs">{c.detail}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {c.passed ? 'Pass' : 'Fail'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* ── Application tab ───────────────────────────────────────── */}
          {activeTab === 'application' && (
            <div className="space-y-6">
              {!application ? (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <p className="text-gray-500 text-sm">No application yet. Go to Overview to create one.</p>
                </div>
              ) : (
                <>
                  {/* Academic data */}
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900">Academic Data</h2>
                        <p className="text-gray-500 text-xs mt-0.5">Fetched automatically from UBYS, YÖKSİS, and ÖSYM</p>
                      </div>
                      <button
                        onClick={handleFetchAcademic}
                        disabled={fetchingAcademic}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        {fetchingAcademic ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
                        Fetch Academic Data
                      </button>
                    </div>
                    {academicRecord ? (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><p className="text-gray-400 text-xs mb-0.5">Institution</p><p>{academicRecord.institution ?? '—'}</p></div>
                        <div><p className="text-gray-400 text-xs mb-0.5">GPA (4.0)</p><p>{academicRecord.gpa_4 ?? '—'}</p></div>
                        <div><p className="text-gray-400 text-xs mb-0.5">YKS Score</p><p>{academicRecord.yks_score ?? '—'}</p></div>
                        <div><p className="text-gray-400 text-xs mb-0.5">Credits Completed</p><p>{academicRecord.credits_completed ?? '—'}</p></div>
                        <div><p className="text-gray-400 text-xs mb-0.5">Source</p><p>{academicRecord.source ?? '—'}</p></div>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm">No academic data yet. Click "Fetch Academic Data".</p>
                    )}
                  </div>

                  {/* Documents */}
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Documents</h2>
                    <p className="text-gray-500 text-xs mb-4">PDF only · max 5 MB per file · required: Transcript, YKS Result, ID Copy</p>
                    <div>
                      {([...REQUIRED_DOCS, 'LANGUAGE_CERT', 'MILITARY_STATUS', 'DISCIPLINE_RECORD'] as DocType[]).map((dt) => (
                        <DocumentUploadRow
                          key={dt}
                          applicationId={application.id}
                          docType={dt}
                          existing={documents.find(d => d.doc_type === dt)}
                          onUploaded={handleDocUploaded}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Submit */}
                  {application.status === 'DRAFT' && (
                    <div className="bg-white rounded-lg shadow-sm p-6">
                      <h2 className="text-lg font-semibold text-gray-900 mb-2">Submit Application</h2>
                      <p className="text-gray-500 text-sm mb-4">
                        Make sure all required documents are uploaded and academic data is fetched before submitting.
                      </p>
                      <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {submitting ? <Spinner /> : <Send className="w-4 h-4" />}
                        Submit Application
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Messages tab ──────────────────────────────────────────── */}
          {activeTab === 'messages' && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Messages & Notifications</h2>
              {loadingMessages ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : notifications.length === 0 ? (
                <p className="text-gray-500 text-sm">No notifications yet.</p>
              ) : (
                <div className="space-y-3">
                  {notifications.map((n) => (
                    <div key={n.id} className="border border-gray-100 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{n.subject ?? 'Notification'}</p>
                          <p className="text-sm text-gray-600 mt-1">{n.message}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                          n.status === 'SENT' ? 'bg-green-100 text-green-700'
                          : n.status === 'FAILED' ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {n.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        {new Date(n.sent_at ?? n.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'messages' && (
            <div className="mt-6">
              <ApplicantMessagesPanel applicationId={application?.id ?? null} />
            </div>
          )}

          {/* ── Results tab ───────────────────────────────────────────── */}
          {activeTab === 'results' && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              {application?.status === 'ANNOUNCED' ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                  <h3 className="text-gray-900 font-semibold mb-1">Transfer Accepted</h3>
                  <p className="text-gray-500 text-sm">Congratulations! Your transfer application has been approved.</p>
                </div>
              ) : application?.status === 'REJECTED' ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-red-600 text-2xl font-bold">✗</span>
                  </div>
                  <h3 className="text-gray-900 font-semibold mb-1">Application Rejected</h3>
                  <p className="text-gray-500 text-sm">Unfortunately, your application was not approved.</p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-gray-700 font-medium mb-2">Results Not Yet Announced</h3>
                  <p className="text-gray-500 text-sm">Your application is still being processed.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UC-03-02: Results & Announcement — Confirmation Modal
// ---------------------------------------------------------------------------

function PublishConfirmModal({
  primaryCount,
  waitlistedCount,
  publishing,
  onConfirm,
  onCancel,
}: {
  primaryCount: number
  waitlistedCount: number
  publishing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Confirm Result Publication</h2>
            <p className="text-sm text-gray-500 mt-1">
              This action is <span className="font-semibold text-gray-700">irreversible</span>. Please review the details before proceeding.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Primary (Asil) candidates</span>
            <span className="font-semibold text-gray-900">{primaryCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Waitlisted (Yedek) candidates</span>
            <span className="font-semibold text-gray-900">{waitlistedCount}</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between">
            <span className="text-gray-500">Total to be notified</span>
            <span className="font-semibold text-indigo-600">{primaryCount + waitlistedCount}</span>
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-5">
          All applicants will receive an email notification and their application status will be updated to <span className="font-medium text-gray-700">Announced</span>.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={publishing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {publishing ? <Spinner /> : <Megaphone className="w-4 h-4" />}
            {publishing ? 'Publishing…' : 'Confirm & Notify'}
          </button>
          <button
            onClick={onCancel}
            disabled={publishing}
            className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UC-03-02: Results & Announcement — Panel
// ---------------------------------------------------------------------------

function ResultsAnnouncementPanel() {
  const [periods, setPeriods] = useState<PeriodOption[]>([])
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
  const [selectedProgramId, setSelectedProgramId] = useState('')
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [loadingResults, setLoadingResults] = useState(false)
  const [results, setResults] = useState<ResultsResponse | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    Promise.all([listOpenPeriods(), listPrograms()])
      .then(([pers, progs]) => {
        setPeriods(pers)
        setPrograms(progs)
        if (pers.length > 0) setSelectedPeriodId(pers[0].id)
        if (progs.length > 0) setSelectedProgramId(progs[0].id)
      })
      .catch(() => toast.error('Failed to load periods or programs.'))
      .finally(() => setLoadingOptions(false))
  }, [])

  async function handleLoad() {
    if (!selectedPeriodId || !selectedProgramId) return
    setLoadingResults(true)
    setResults(null)
    setNotFound(false)
    try {
      const data = await getResults(selectedPeriodId, selectedProgramId)
      setResults(data)
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response?.status
      if (httpStatus === 404) {
        setNotFound(true)
      } else {
        toast.error(extractErrorMessage(err))
      }
    } finally {
      setLoadingResults(false)
    }
  }

  async function handlePublishConfirmed() {
    setPublishing(true)
    try {
      const result = await publishResults(selectedPeriodId, selectedProgramId)
      toast.success(
        `Results published successfully! ${result.announced_count} applicant(s) have been notified and their status updated to Announced.`,
        { duration: 6000 },
      )
      setShowConfirm(false)
      await handleLoad()
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response?.status
      if (httpStatus === 409) {
        toast.error('Results have already been published for this period and program.')
      } else if (httpStatus === 422) {
        toast.error('The ranking must be approved before results can be published.')
      } else {
        toast.error(extractErrorMessage(err))
      }
      setShowConfirm(false)
    } finally {
      setPublishing(false)
    }
  }

  const rankingStatusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600',
    APPROVED: 'bg-green-100 text-green-700',
    PUBLISHED: 'bg-indigo-100 text-indigo-700',
  }

  return (
    <div className="space-y-6">
      {showConfirm && results && (
        <PublishConfirmModal
          primaryCount={results.primary.length}
          waitlistedCount={results.waitlisted.length}
          publishing={publishing}
          onConfirm={handlePublishConfirmed}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Results & Announcement</h1>
        <p className="text-gray-500 text-sm mt-1">
          View the approved ranking and publish transfer results to notify applicants.
        </p>
      </div>

      {/* Selection card */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Select Period & Program</h2>
        {loadingOptions ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Application Period</label>
              <select
                value={selectedPeriodId}
                onChange={e => { setSelectedPeriodId(e.target.value); setResults(null); setNotFound(false) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {periods.length === 0 && <option value="">No open periods</option>}
                {periods.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Program</label>
              <select
                value={selectedProgramId}
                onChange={e => { setSelectedProgramId(e.target.value); setResults(null); setNotFound(false) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {programs.length === 0 && <option value="">No programs</option>}
                {programs.map(p => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleLoad}
              disabled={loadingResults || !selectedPeriodId || !selectedProgramId}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loadingResults ? <Spinner /> : <ClipboardList className="w-4 h-4" />}
              Load Results
            </button>
          </div>
        )}
      </div>

      {/* No ranking found */}
      {notFound && (
        <div className="bg-white rounded-lg shadow-sm p-10 text-center">
          <Trophy className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No ranking found for the selected period and program combination.</p>
        </div>
      )}

      {/* Results loaded */}
      {results && (
        <>
          {/* Status & action bar */}
          <div className="bg-white rounded-lg shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Ranking Status</p>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${rankingStatusColors[results.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {results.status}
                </span>
              </div>
              {results.published_at && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Published At</p>
                  <p className="text-sm text-gray-700">
                    {new Date(results.published_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
              )}
            </div>

            {results.status === 'APPROVED' && !results.published_at && (
              <button
                onClick={() => setShowConfirm(true)}
                disabled={publishing}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                <Megaphone className="w-4 h-4" />
                Notify Results
              </button>
            )}

            {(results.status === 'PUBLISHED' || results.published_at) && (
              <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-700">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Results already published & applicants notified
              </div>
            )}

            {results.status === 'DRAFT' && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Ranking must be approved before publishing
              </div>
            )}
          </div>

          {/* Primary candidates table */}
          <ResultsTable
            title="Primary Candidates (Asil)"
            subtitle={`${results.primary.length} candidate(s) accepted for transfer`}
            entries={results.primary}
            accentColor="green"
          />

          {/* Waitlisted candidates table */}
          <ResultsTable
            title="Waitlisted Candidates (Yedek)"
            subtitle={`${results.waitlisted.length} candidate(s) on the waitlist`}
            entries={results.waitlisted}
            accentColor="amber"
          />
        </>
      )}
    </div>
  )
}

function ResultsTable({
  title,
  subtitle,
  entries,
  accentColor,
}: {
  title: string
  subtitle: string
  entries: ApplicantResult[]
  accentColor: 'green' | 'amber'
}) {
  const headerColor = accentColor === 'green'
    ? 'border-green-200 bg-green-50'
    : 'border-amber-200 bg-amber-50'
  const titleColor = accentColor === 'green' ? 'text-green-800' : 'text-amber-800'
  const subtitleColor = accentColor === 'green' ? 'text-green-600' : 'text-amber-600'
  const badgeColor = accentColor === 'green'
    ? 'bg-green-100 text-green-700'
    : 'bg-amber-100 text-amber-700'

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className={`px-6 py-4 border-b ${headerColor}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-base font-semibold ${titleColor}`}>{title}</h2>
            <p className={`text-xs mt-0.5 ${subtitleColor}`}>{subtitle}</p>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeColor}`}>
            {entries.length}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-10">No candidates in this list.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="px-6 py-3 font-medium w-16">Rank</th>
              <th className="px-6 py-3 font-medium">Applicant Info</th>
              <th className="px-6 py-3 font-medium text-right">Composite Score</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.application_id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold">
                    {entry.position}
                  </span>
                </td>
                <td className="px-6 py-3">
                  {entry.first_name || entry.last_name ? (
                    <div>
                      <p className="text-sm font-medium text-gray-900">{entry.first_name} {entry.last_name}</p>
                      <p className="text-xs text-gray-400">{entry.email}</p>
                    </div>
                  ) : (
                    <span className="font-mono text-gray-500 text-xs">{entry.application_id}</span>
                  )}
                </td>
                <td className="px-6 py-3 text-right">
                  <span className="font-semibold text-gray-900">{entry.composite_score.toFixed(2)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SPEC-006: Application Review Panel
// ---------------------------------------------------------------------------

const REJECTION_CODES: RejectionReasonCode[] = [
  'INVALID_DOCUMENT', 'FRAUDULENT_DOCUMENT', 'DUPLICATE_APPLICATION', 'MISSED_DEADLINE', 'OTHER',
]

function ApplicationsReviewPanel() {
  const [apps, setApps] = useState<StaffApplicationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('SUBMITTED')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StaffApplicationDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [acting, setActing] = useState(false)
  const [showCorrection, setShowCorrection] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [correctionNote, setCorrectionNote] = useState('')
  const [rejectCode, setRejectCode] = useState<RejectionReasonCode>('INVALID_DOCUMENT')
  const [rejectNote, setRejectNote] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)

  async function loadList() {
    setLoading(true)
    try {
      const data = await listStaffApplications(
        statusFilter ? { status: statusFilter } : undefined,
      )
      setApps(data)
    } catch {
      toast.error('Failed to load applications.')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    setLoadingDetail(true)
    setPreviewError(null)
    try {
      const data = await getStaffApplication(id)
      setDetail(data)
      setSelectedId(id)
    } catch {
      toast.error('Failed to load application detail.')
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => { loadList() }, [statusFilter])

  async function handleApprove() {
    if (!selectedId) return
    setActing(true)
    try {
      await approveVerification(selectedId)
      toast.success('Documents verified — application moved to Under Review.')
      await loadList()
      await loadDetail(selectedId)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setActing(false)
    }
  }

  async function handleCorrection() {
    if (!selectedId || !correctionNote.trim()) {
      toast.error('Correction note is required.')
      return
    }
    setActing(true)
    try {
      await requestCorrection(selectedId, correctionNote.trim())
      toast.success('Correction requested — applicant notified.')
      setShowCorrection(false)
      setCorrectionNote('')
      await loadList()
      await loadDetail(selectedId)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setActing(false)
    }
  }

  async function handleReject() {
    if (!selectedId) return
    setActing(true)
    try {
      await rejectStaffApplication(selectedId, rejectCode, rejectNote)
      toast.success('Application rejected — applicant notified.')
      setShowReject(false)
      setRejectNote('')
      await loadList()
      await loadDetail(selectedId)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setActing(false)
    }
  }

  function handlePreview(docId: string) {
    setPreviewError(null)
    const { preview_url } = getPreviewUrl(docId)
    const win = window.open(preview_url, '_blank')
    if (!win) {
      setPreviewError('Document Cannot Be Viewed — popup blocked or file may be corrupted.')
    }
  }

  const canAct = detail?.status === 'SUBMITTED'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Application Review</h1>
          <p className="text-gray-500 text-sm mt-1">Review documents and take verification actions.</p>
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setSelectedId(null); setDetail(null) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="SUBMITTED">Submitted</option>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="CORRECTION_REQUESTED">Correction Requested</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* List */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Applications ({apps.length})</h2>
          </div>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : apps.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-12">No applications found.</p>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              {apps.map(app => (
                <button
                  key={app.id}
                  onClick={() => loadDetail(app.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                    selectedId === app.id ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900">
                    {app.applicant_name ?? app.tracking_number ?? app.id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{app.applicant_email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={app.status} />
                    {app.auto_validation_results[0] && (
                      <span className={`text-xs ${app.auto_validation_results[0].passed ? 'text-green-600' : 'text-amber-600'}`}>
                        {app.auto_validation_results[0].passed ? 'Valid' : 'Issues'}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3 space-y-4">
          {!selectedId ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Select an application to review documents.</p>
            </div>
          ) : loadingDetail || !detail ? (
            <div className="bg-white rounded-lg shadow-sm flex justify-center py-12"><Spinner /></div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {detail.applicant_name ?? 'Applicant'}
                    </h2>
                    <p className="text-sm text-gray-500">{detail.applicant_email}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Tracking: {detail.tracking_number ?? '—'}
                    </p>
                  </div>
                  <StatusBadge status={detail.status} />
                </div>

                {canAct && (
                  <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                    <button
                      onClick={handleApprove}
                      disabled={acting}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {acting ? <Spinner /> : <CheckCircle className="w-4 h-4" />}
                      Approve Verification
                    </button>
                    <button
                      onClick={() => setShowCorrection(true)}
                      disabled={acting}
                      className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 disabled:opacity-50"
                    >
                      <Edit2 className="w-4 h-4" />
                      Request Correction
                    </button>
                    <button
                      onClick={() => setShowReject(true)}
                      disabled={acting}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                )}

                {detail.status === 'REJECTED' && (
                  <p className="text-sm text-red-700 mt-3 pt-3 border-t border-red-100">
                    This application has been rejected. No further actions available.
                  </p>
                )}
              </div>

              {/* Auto-validation */}
              {apps.find(a => a.id === selectedId)?.auto_validation_results && (
                <div className="bg-white rounded-lg shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Auto-Validation</h3>
                  <div className="space-y-1.5">
                    {apps.find(a => a.id === selectedId)!.auto_validation_results
                      .filter(r => r.check !== 'OVERALL')
                      .map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">{r.doc_type} — {r.check}</span>
                          <span className={r.passed ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {r.passed ? 'Pass' : 'Fail'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Documents */}
              <div className="bg-white rounded-lg shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Documents</h3>
                {previewError && (
                  <p className="text-sm text-red-600 mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {previewError}
                  </p>
                )}
                {detail.documents.length === 0 ? (
                  <p className="text-gray-500 text-sm">No documents uploaded.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.documents.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm text-gray-900">{doc.doc_type.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-gray-400">{doc.file_name}</p>
                        </div>
                        <button
                          onClick={() => handlePreview(doc.id)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                        >
                          <Eye className="w-3.5 h-3.5" /> Preview
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {detail.eligibility_checks.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Eligibility Checks</h3>
                  <div className="space-y-2">
                    {detail.eligibility_checks.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{c.rule_key}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {c.passed ? 'Pass' : 'Fail'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Correction modal */}
      {showCorrection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Request Correction</h2>
            <textarea
              value={correctionNote}
              onChange={e => setCorrectionNote(e.target.value)}
              rows={4}
              placeholder="Describe what needs to be corrected…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCorrection(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleCorrection} disabled={acting} className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">
                {acting ? <Spinner /> : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Reject Application</h2>
            <select
              value={rejectCode}
              onChange={e => setRejectCode(e.target.value as RejectionReasonCode)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
            >
              {REJECTION_CODES.map(c => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              rows={3}
              placeholder="Additional notes (optional)…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowReject(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleReject} disabled={acting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {acting ? <Spinner /> : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dean-approved applications awaiting SA announcement
// ---------------------------------------------------------------------------

function DeanApprovalQueuePanel() {
  const [apps, setApps] = useState<StaffApplicationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [announcingId, setAnnouncingId] = useState<string | null>(null)

  async function loadQueue() {
    setLoading(true)
    try {
      const data = await listStaffApplications({ status: 'RANKING' })
      setApps(data)
    } catch {
      toast.error('Failed to load dean-approved applications.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadQueue() }, [])

  async function handleAnnounce(id: string, name: string) {
    setAnnouncingId(id)
    try {
      await announceApplication(id)
      toast.success(`${name} — transfer result announced. Applicant notified.`)
      await loadQueue()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setAnnouncingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Announcement Queue</h1>
        <p className="text-gray-500 text-sm mt-1">
          Applications the Dean has approved. Publish the official transfer result to notify each applicant.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Awaiting Announcement ({apps.length})
          </h2>
          <button
            onClick={loadQueue}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : apps.length === 0 ? (
          <div className="text-center py-16">
            <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No dean-approved applications waiting for announcement.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {apps.map(app => {
              const name = app.applicant_name ?? app.tracking_number ?? 'Applicant'
              return (
                <div key={app.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{app.tracking_number} · {app.applicant_email}</p>
                    <div className="mt-1.5">
                      <StatusBadge status={app.status} />
                    </div>
                  </div>
                  <button
                    onClick={() => handleAnnounce(app.id, name)}
                    disabled={announcingId === app.id}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {announcingId === app.id ? <Spinner /> : <Megaphone className="w-4 h-4" />}
                    {announcingId === app.id ? 'Announcing…' : 'Announce Result'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UC-03-02: Student Affairs Dashboard
// ---------------------------------------------------------------------------

function StudentAffairsOverview() {
  const [stats, setStats] = useState({ pending: 0, underReview: 0, awaitingAnnouncement: 0, rejected: 0 })
  const [recent, setRecent] = useState<StaffApplicationSummary[]>([])

  useEffect(() => {
    listStaffApplications()
      .then(all => {
        setStats({
          pending: all.filter(a => a.status === 'SUBMITTED').length,
          underReview: all.filter(a => a.status === 'UNDER_REVIEW').length,
          awaitingAnnouncement: all.filter(a => a.status === 'RANKING').length,
          rejected: all.filter(a => a.status === 'REJECTED').length,
        })
        setRecent(all.slice(0, 5))
      })
      .catch(() => {})
  }, [])

  return (
    <>
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
          <FileText className="w-6 h-6 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Student Affairs</h1>
          <p className="text-gray-500 text-sm">Izmir Institute of Technology</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Pending Review', value: stats.pending, color: 'text-yellow-600' },
          { label: 'Under Review', value: stats.underReview, color: 'text-blue-600' },
          { label: 'Awaiting Announcement', value: stats.awaitingAnnouncement, color: 'text-emerald-600' },
          { label: 'Rejected', value: stats.rejected, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg shadow-sm p-6">
            <p className="text-gray-500 text-sm mb-1">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Applications</h2>
        {recent.length === 0 ? (
          <p className="text-gray-500 text-sm">No applications to review at this time.</p>
        ) : (
          <div className="space-y-2">
            {recent.map(app => (
              <div key={app.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                <span className="text-gray-900">{app.applicant_name ?? app.tracking_number}</span>
                <StatusBadge status={app.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function StudentAffairsDashboardContent({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'applications' | 'announcement' | 'results' | 'messages'>('overview')

  return (
    <div className="flex flex-1 min-h-screen">
      <Sidebar userName={userName} role="Student Affairs" onLogout={onLogout}>
        <NavBtn active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={Home} label="Dashboard" />
        <NavBtn active={activeTab === 'applications'} onClick={() => setActiveTab('applications')} icon={Users} label="Applications" />
        <NavBtn active={activeTab === 'announcement'} onClick={() => setActiveTab('announcement')} icon={UserCheck} label="Announcement Queue" />
        <NavBtn active={activeTab === 'results'} onClick={() => setActiveTab('results')} icon={Megaphone} label="Results & Announcement" />
        <NavBtn active={activeTab === 'messages'} onClick={() => setActiveTab('messages')} icon={Send} label="Messages" />
      </Sidebar>

      <div className="flex-1 p-8 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'overview' && <StudentAffairsOverview />}
          {activeTab === 'applications' && <ApplicationsReviewPanel />}
          {activeTab === 'announcement' && <DeanApprovalQueuePanel />}
          {activeTab === 'results' && <ResultsAnnouncementPanel />}
          {activeTab === 'messages' && <StaffMessagesPanel />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Staff Dashboard (unchanged)
// ---------------------------------------------------------------------------

function StaffDashboardContent({ userName, roleLabel, icon: Icon, onLogout }: {
  userName: string; roleLabel: string; icon: React.ElementType; onLogout: () => void
}) {
  return (
    <div className="flex flex-1 min-h-screen">
      <Sidebar userName={userName} role={roleLabel} onLogout={onLogout}>
        <NavBtn active={true} onClick={() => {}} icon={Home} label="Dashboard" />
        <NavBtn active={false} onClick={() => {}} icon={Users} label="Applications" />
        <NavBtn active={false} onClick={() => {}} icon={BarChart2} label="Reports" />
        <NavBtn active={false} onClick={() => {}} icon={Settings} label="Settings" />
      </Sidebar>
      <div className="flex-1 p-8 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Icon className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{roleLabel}</h1>
              <p className="text-gray-500 text-sm">Izmir Institute of Technology</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 mb-8">
            {[
              { label: 'Pending Review', value: '—', color: 'text-yellow-600' },
              { label: 'Approved', value: '—', color: 'text-green-600' },
              { label: 'Rejected', value: '—', color: 'text-red-600' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-lg shadow-sm p-6">
                <p className="text-gray-500 text-sm mb-1">{stat.label}</p>
                <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Applications</h2>
            <p className="text-gray-500 text-sm">No applications to review at this time.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

function extractAdminError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (!detail) return fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string }
    return first?.msg?.replace(/^Value error, /, '') ?? fallback
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Admin Dashboard — Staff Management
// ---------------------------------------------------------------------------

const STAFF_ROLES: StaffRole[] = [
  'STUDENT_AFFAIRS',
  'TRANSFER_COMMISSION',
  'YDYO',
  'DEAN_OFFICE',
  'SYSTEM_ADMIN',
]

const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  APPLICANT: 'Applicant',
  STUDENT_AFFAIRS: 'Student Affairs',
  TRANSFER_COMMISSION: 'Transfer Commission',
  YDYO: 'Foreign Languages Office',
  DEAN_OFFICE: "Dean's Office",
  SYSTEM_ADMIN: 'IT Administrator',
}

function RoleBadge({ role }: { role: StaffRole }) {
  const colors: Record<StaffRole, string> = {
    APPLICANT: 'bg-gray-100 text-gray-700',
    STUDENT_AFFAIRS: 'bg-blue-100 text-blue-700',
    TRANSFER_COMMISSION: 'bg-purple-100 text-purple-700',
    YDYO: 'bg-teal-100 text-teal-700',
    DEAN_OFFICE: 'bg-orange-100 text-orange-700',
    SYSTEM_ADMIN: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[role]}`}>
      {STAFF_ROLE_LABELS[role]}
    </span>
  )
}

function CreateStaffModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void | Promise<void> }) {
  const [form, setForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    role: 'STUDENT_AFFAIRS' as StaffRole,
    department: '',
    title: '',
  })
  const [loading, setLoading] = useState(false)
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

    useEffect(() => {
        listPrograms().then(setPrograms).catch(() => {})
    }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await createStaff({
        ...form,
        department: form.department || undefined,
        title: form.title || undefined,
      })
      await onCreated()
      if (result.temp_password) {
        setTempPassword(result.temp_password)
      } else {
        toast.success('Staff account created. Welcome email sent.')
        onClose()
      }
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to create staff'))
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function field(label: string, key: keyof typeof form, type = 'text', required = false) {
    return (
      <div>
        <label className="block text-sm text-gray-700 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
        <input
          type={type}
          required={required}
          value={form[key] as string}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    )
  }

  if (tempPassword) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Account Created</h2>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-green-800 font-medium mb-1">Staff account successfully created!</p>
            <p className="text-xs text-green-700">Share the temporary password below with the new staff member. They must change it on first login.</p>
          </div>
          <div className="mb-2">
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <p className="text-sm font-medium text-gray-800">{form.email}</p>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">Temporary Password</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 select-all">
                {tempPassword}
              </code>
              <button
                onClick={handleCopy}
                className="px-3 py-2 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create Staff Account</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {field('Email (@iyte.edu.tr / @std.iyte.edu.tr)', 'email', 'email', true)}
          {field('First Name', 'first_name', 'text', true)}
          {field('Last Name', 'last_name', 'text', true)}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Role<span className="text-red-500 ml-0.5">*</span></label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as StaffRole }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {STAFF_ROLES.map(r => (
                <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
            <div>
                <label className="block text-sm text-gray-700 mb-1">Department</label>
                <select
                    value={form.department}
                    onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                    <option value="">— Select Department —</option>
                    {programs.map(p => (
                        <option key={p.id} value={p.name}>{p.code} — {p.name}</option>
                    ))}
                </select>
            </div>
          {field('Title', 'title')}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Spinner /> : <UserPlus className="w-4 h-4" />}
              Create Account
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ChangeRoleModal({ staff, onClose, onUpdated }: { staff: StaffMember; onClose: () => void; onUpdated: () => void }) {
  const [role, setRole] = useState<StaffRole>(staff.role)
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    setLoading(true)
    try {
      await updateStaffRole(staff.id, { role })
      toast.success('Role updated. Session invalidated.')
      onUpdated()
      onClose()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to update role'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Change Role</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">{staff.first_name} {staff.last_name} — {staff.email}</p>
        <select
          value={role}
          onChange={e => setRole(e.target.value as StaffRole)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white mb-4"
        >
          {STAFF_ROLES.map(r => (
            <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>
          ))}
        </select>
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={loading || role === staff.role}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Spinner /> : null}
            Save
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Admin Dashboard — Application Periods (SPEC-018)
// ---------------------------------------------------------------------------

function formatDt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function PeriodStatusBadge({ period }: { period: ApplicationPeriod }) {
  const now = new Date()
  const opens = new Date(period.opens_at)
  const closes = new Date(period.closes_at)
  if (!period.is_active) return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Inactive</span>
  if (now < opens) return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">Upcoming</span>
  if (now > closes) return <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-600">Closed</span>
  return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Open</span>
}

function nowLocalMin() {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function CreatePeriodModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<PeriodCreatePayload>({ label: '', opens_at: '', closes_at: '' })
  const [loading, setLoading] = useState(false)
  const minDateTime = nowLocalMin()

  async function handleSubmit(e: React.FormEvent) {
      e.preventDefault()
      const now = new Date()
      if (new Date(form.opens_at) < now) {
          toast.error('Opens At cannot be in the past.')
          return
      }
      if (new Date(form.closes_at) < now) {
          toast.error('Closes At cannot be in the past.')
          return
      }
      setLoading(true)
    try {
        await createPeriod({
            ...form,
            opens_at: new Date(form.opens_at).toISOString(),
            closes_at: new Date(form.closes_at).toISOString(),
        })
      toast.success('Period created.')
      onCreated()
      onClose()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to create period'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create Application Period</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Label<span className="text-red-500 ml-0.5">*</span></label>
            <input
              required
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Fall 2025 Transfer Period"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Opens At<span className="text-red-500 ml-0.5">*</span></label>
            <input
              type="datetime-local"
              required
              min={minDateTime}
              value={form.opens_at}
              onChange={e => setForm(f => ({ ...f, opens_at: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Closes At<span className="text-red-500 ml-0.5">*</span></label>
            <input
              type="datetime-local"
              required
              min={minDateTime}
              value={form.closes_at}
              onChange={e => setForm(f => ({ ...f, closes_at: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Spinner /> : <CalendarDays className="w-4 h-4" />}
              Create Period
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditPeriodModal({ period, onClose, onUpdated }: { period: ApplicationPeriod; onClose: () => void; onUpdated: () => void }) {
  function toLocal(iso: string) {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const [label, setLabel] = useState(period.label)
  const [opensAt, setOpensAt] = useState(toLocal(period.opens_at))
  const [closesAt, setClosesAt] = useState(toLocal(period.closes_at))
  const [loading, setLoading] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
        await updatePeriod(period.id, {
            label,
            opens_at: new Date(opensAt).toISOString(),
            closes_at: new Date(closesAt).toISOString(),
        })
      toast.success('Period updated.')
      onUpdated()
      onClose()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to update period'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Edit Period</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Label<span className="text-red-500 ml-0.5">*</span></label>
            <input
              required
              value={label}
              onChange={e => setLabel(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Start Date<span className="text-red-500 ml-0.5">*</span></label>
            <input
              type="datetime-local"
              required
              value={opensAt}
              onChange={e => setOpensAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">End Date<span className="text-red-500 ml-0.5">*</span></label>
            <input
              type="datetime-local"
              required
              value={closesAt}
              onChange={e => setClosesAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Spinner /> : <Edit2 className="w-4 h-4" />}
              Save
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExtendPeriodModal({ period, onClose, onUpdated }: { period: ApplicationPeriod; onClose: () => void; onUpdated: () => void }) {
  const [newClosesAt, setNewClosesAt] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    if (!newClosesAt) return
    setLoading(true)
    try {
        await extendPeriod(period.id, { new_closes_at: new Date(newClosesAt).toISOString() })
      toast.success('Deadline extended.')
      onUpdated()
      onClose()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to extend deadline'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Extend Deadline</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-600 mb-1">{period.label}</p>
        <p className="text-xs text-gray-400 mb-4">Current deadline: {formatDt(period.closes_at)}</p>
        <div className="mb-4">
          <label className="block text-sm text-gray-700 mb-1">New Deadline<span className="text-red-500 ml-0.5">*</span></label>
          <input
            type="datetime-local"
            value={newClosesAt}
            onChange={e => setNewClosesAt(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={loading || !newClosesAt}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Spinner /> : null}
            Extend
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function PeriodsPanel() {
  const [periods, setPeriods] = useState<ApplicationPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ApplicationPeriod | null>(null)
  const [extending, setExtending] = useState<ApplicationPeriod | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)

  async function load() {
    try {
      setPeriods(await listPeriods())
    } catch {
      toast.error('Failed to load periods.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleToggleActive(period: ApplicationPeriod) {
    setActionId(period.id)
    try {
      if (period.is_active) {
        await deactivatePeriod(period.id)
        toast.success('Period deactivated.')
      } else {
        await activatePeriod(period.id)
        toast.success('Period activated.')
      }
      await load()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Action failed'))
    } finally {
      setActionId(null)
    }
  }

  async function handleEmergencyClose(period: ApplicationPeriod) {
    if (!confirm(`Emergency close "${period.label}"? This closes the period immediately.`)) return
    setActionId(period.id)
    try {
      await emergencyClosePeriod(period.id)
      toast.success('Period emergency-closed.')
      await load()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Action failed'))
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="space-y-6">
      {showCreate && <CreatePeriodModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {editing && <EditPeriodModal period={editing} onClose={() => setEditing(null)} onUpdated={load} />}
      {extending && <ExtendPeriodModal period={extending} onClose={() => setExtending(null)} onUpdated={load} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Application Periods</h1>
          <p className="text-gray-500 text-sm">Configure when the transfer portal is open</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <PlusCircle className="w-4 h-4" />
          New Period
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : periods.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">No application periods yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-6 py-3 font-medium">Label</th>
                <th className="px-6 py-3 font-medium">Opens At</th>
                <th className="px-6 py-3 font-medium">Closes At</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{p.label}</td>
                  <td className="px-6 py-4 text-gray-600">{formatDt(p.opens_at)}</td>
                  <td className="px-6 py-4 text-gray-600">{formatDt(p.closes_at)}</td>
                  <td className="px-6 py-4"><PeriodStatusBadge period={p} /></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleToggleActive(p)}
                        disabled={actionId === p.id}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 ${p.is_active ? 'text-gray-600 hover:bg-gray-100' : 'text-green-600 hover:bg-green-50'}`}
                      >
                        {actionId === p.id ? <Spinner /> : null}
                        {p.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => setEditing(p)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded"
                      >
                        <Edit2 className="w-3 h-3" /> Edit
                      </button>
                      <button
                        onClick={() => setExtending(p)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                      >
                        Extend Deadline
                      </button>
                      {p.is_active && (
                        <button
                          onClick={() => handleEmergencyClose(p)}
                          disabled={actionId === p.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                        >
                          <X className="w-3 h-3" /> Emergency Close
                        </button>
                      )}
                    </div>
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
// Admin Dashboard — Department Conditions (SPEC-019)
// ---------------------------------------------------------------------------

const RULE_KEYS: RuleKey[] = ['MIN_GPA', 'MIN_YKS', 'MIN_CREDITS', 'CORE_COURSE_GRADE', 'PORTFOLIO_REQUIRED', 'REQUIRED_DOC']
const RULE_KEY_LABELS: Record<RuleKey, string> = {
  MIN_GPA: 'Minimum GPA',
  MIN_YKS: 'Minimum YKS Score',
  MIN_CREDITS: 'Minimum Credits',
  CORE_COURSE_GRADE: 'Core Course Grade',
  PORTFOLIO_REQUIRED: 'Portfolio Required',
  REQUIRED_DOC: 'Required Document',
}
const RULE_KEY_PLACEHOLDER: Record<RuleKey, string> = {
  MIN_GPA: '0.00 – 4.00',
  MIN_YKS: 'e.g. 350.0',
  MIN_CREDITS: 'e.g. 60',
  CORE_COURSE_GRADE: 'AA / BA / BB / CB / CC / DC / DD',
  PORTFOLIO_REQUIRED: 'true or false',
  REQUIRED_DOC: 'e.g. PORTFOLIO',
}

function AddConditionModal({ programId, onClose, onAdded }: { programId: string; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState<ConditionCreatePayload>({ rule_key: 'MIN_GPA', rule_value: '', description: '' })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await addCondition(programId, { ...form, description: form.description || undefined })
      toast.success('Condition added.')
      onAdded()
      onClose()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to add condition'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Condition</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Rule<span className="text-red-500 ml-0.5">*</span></label>
            <select
              value={form.rule_key}
              onChange={e => setForm(f => ({ ...f, rule_key: e.target.value as RuleKey, rule_value: '' }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {RULE_KEYS.map(k => <option key={k} value={k}>{RULE_KEY_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Value<span className="text-red-500 ml-0.5">*</span></label>
            <input
              required
              value={form.rule_value}
              onChange={e => setForm(f => ({ ...f, rule_value: e.target.value }))}
              placeholder={RULE_KEY_PLACEHOLDER[form.rule_key]}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Description</label>
            <input
              value={form.description ?? ''}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Spinner /> : <PlusCircle className="w-4 h-4" />}
              Add Condition
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ConditionsPanel() {
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [selectedProgramId, setSelectedProgramId] = useState<string>('')
  const [conditions, setConditions] = useState<DepartmentCondition[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingPrograms, setLoadingPrograms] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)

  useEffect(() => {
    listPrograms()
      .then(progs => {
        setPrograms(progs)
        if (progs.length > 0) setSelectedProgramId(progs[0].id)
      })
      .catch(() => toast.error('Failed to load programs.'))
      .finally(() => setLoadingPrograms(false))
  }, [])

  useEffect(() => {
    if (!selectedProgramId) return
    loadConditions(selectedProgramId)
  }, [selectedProgramId])

  async function loadConditions(programId: string) {
    setLoading(true)
    try {
      setConditions(await listConditions(programId))
    } catch {
      toast.error('Failed to load conditions.')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleActive(c: DepartmentCondition) {
    setActionId(c.id)
    try {
      await updateCondition(selectedProgramId, c.id, { is_active: !c.is_active })
      toast.success(c.is_active ? 'Condition deactivated.' : 'Condition activated.')
      await loadConditions(selectedProgramId)
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Action failed'))
    } finally {
      setActionId(null)
    }
  }

  async function handleDelete(c: DepartmentCondition) {
    if (!confirm(`Permanently delete rule "${RULE_KEY_LABELS[c.rule_key]}: ${c.rule_value}"?`)) return
    setActionId(c.id)
    try {
      await deleteCondition(selectedProgramId, c.id)
      toast.success('Condition deleted.')
      await loadConditions(selectedProgramId)
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to delete condition'))
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="space-y-6">
      {showAdd && selectedProgramId && (
        <AddConditionModal
          programId={selectedProgramId}
          onClose={() => setShowAdd(false)}
          onAdded={() => loadConditions(selectedProgramId)}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Department Conditions</h1>
          <p className="text-gray-500 text-sm">Eligibility rules per program</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          disabled={!selectedProgramId}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          <PlusCircle className="w-4 h-4" />
          Add Condition
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4">
        {loadingPrograms ? (
          <Spinner />
        ) : (
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-700 whitespace-nowrap">Program:</label>
            <select
              value={selectedProgramId}
              onChange={e => setSelectedProgramId(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {programs.length === 0 && <option value="">No programs</option>}
              {programs.map(p => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : conditions.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">No conditions for this program.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-6 py-3 font-medium">Rule</th>
                <th className="px-6 py-3 font-medium">Value</th>
                <th className="px-6 py-3 font-medium">Description</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map(c => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{RULE_KEY_LABELS[c.rule_key]}</td>
                  <td className="px-6 py-4 text-gray-700 font-mono">{c.rule_value}</td>
                  <td className="px-6 py-4 text-gray-500">{c.description ?? '—'}</td>
                  <td className="px-6 py-4">
                    {c.is_active
                      ? <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Inactive</span>}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(c)}
                        disabled={actionId === c.id}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 ${c.is_active ? 'text-gray-600 hover:bg-gray-100' : 'text-green-600 hover:bg-green-50'}`}
                      >
                        {actionId === c.id ? <Spinner /> : null}
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={actionId === c.id}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                      >
                        {actionId === c.id ? <Spinner /> : <Trash2 className="w-3 h-3" />}
                        Delete
                      </button>
                    </div>
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
// Admin Dashboard — Staff Management
// ---------------------------------------------------------------------------

function AdminDashboardContent({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'staff' | 'periods' | 'conditions'>('staff')
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [activating, setActivating] = useState<string | null>(null)

  async function loadStaff() {
    try {
      const list = await listStaff()
      setStaff(list)
    } catch {
      toast.error('Failed to load staff list.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStaff() }, [])

  async function handleActivate(member: StaffMember) {
    if (!confirm(`Reactivate ${member.first_name} ${member.last_name}?`)) return
    setActivating(member.id)
    try {
      await activateStaff(member.id)
      toast.success('Staff reactivated.')
      await loadStaff()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to reactivate staff'))
    } finally {
      setActivating(null)
    }
  }

  async function handleDeactivate(member: StaffMember) {
    if (!confirm(`Deactivate ${member.first_name} ${member.last_name}? Their sessions will be revoked immediately.`)) return
    setDeactivating(member.id)
    try {
      await deactivateStaff(member.id)
      toast.success('Staff deactivated.')
      await loadStaff()
    } catch (err: unknown) {
      toast.error(extractAdminError(err, 'Failed to deactivate staff'))
    } finally {
      setDeactivating(null)
    }
  }

  const active = staff.filter(s => s.is_active)
  const inactive = staff.filter(s => !s.is_active)

  return (
    <div className="flex flex-1 min-h-screen">
       {showCreate && (
            <CreateStaffModal onClose={() => setShowCreate(false)} onCreated={loadStaff} />
       )}
      {editingStaff && (
        <ChangeRoleModal staff={editingStaff} onClose={() => setEditingStaff(null)} onUpdated={loadStaff} />
      )}

      <Sidebar userName={userName} role="IT Administrator" onLogout={onLogout}>
        <NavBtn active={activeTab === 'staff'} onClick={() => setActiveTab('staff')} icon={Users} label="Staff Management" />
        <NavBtn active={activeTab === 'periods'} onClick={() => setActiveTab('periods')} icon={CalendarDays} label="App. Periods" />
        <NavBtn active={activeTab === 'conditions'} onClick={() => setActiveTab('conditions')} icon={ShieldCheck} label="Dept. Conditions" />
      </Sidebar>

      <div className="flex-1 p-8 bg-gray-50">
        <div className="max-w-5xl mx-auto">

          {activeTab === 'periods' && <PeriodsPanel />}
          {activeTab === 'conditions' && <ConditionsPanel />}

          {activeTab === 'staff' && <>
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Staff Management</h1>
              <p className="text-gray-500 text-sm">Izmir Institute of Technology</p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Add Staff
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <p className="text-gray-500 text-sm mb-1">Total Staff</p>
              <p className="text-3xl font-bold text-indigo-600">{staff.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <p className="text-gray-500 text-sm mb-1">Active</p>
              <p className="text-3xl font-bold text-green-600">{active.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <p className="text-gray-500 text-sm mb-1">Deactivated</p>
              <p className="text-3xl font-bold text-gray-400">{inactive.length}</p>
            </div>
          </div>

          {/* Active staff table */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Active Staff</h2>
            </div>
            {loading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : active.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-12">No active staff accounts.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Role</th>
                    <th className="px-6 py-3 font-medium">Department</th>
                    <th className="px-6 py-3 font-medium">Created</th>
                    <th className="px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map(member => (
                    <tr key={member.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {member.first_name} {member.last_name}
                        {member.title && <span className="text-gray-400 font-normal ml-1">· {member.title}</span>}
                      </td>
                      <td className="px-6 py-4 text-gray-600">{member.email}</td>
                      <td className="px-6 py-4"><RoleBadge role={member.role} /></td>
                      <td className="px-6 py-4 text-gray-500">{member.department ?? '—'}</td>
                      <td className="px-6 py-4 text-gray-400">{new Date(member.created_at).toLocaleDateString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingStaff(member)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded"
                          >
                            <Edit2 className="w-3 h-3" /> Role
                          </button>
                          <button
                            onClick={() => handleDeactivate(member)}
                            disabled={deactivating === member.id}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                          >
                            {deactivating === member.id ? <Spinner /> : <Trash2 className="w-3 h-3" />}
                            Deactivate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Deactivated staff */}
          {inactive.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm mt-6">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-400">Deactivated Staff</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Role</th>
                    <th className="px-6 py-3 font-medium">Department</th>
                    <th className="px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inactive.map(member => (
                    <tr key={member.id} className="border-b border-gray-50 opacity-60">
                      <td className="px-6 py-4 text-gray-500">{member.first_name} {member.last_name}</td>
                      <td className="px-6 py-4 text-gray-400">{member.email}</td>
                      <td className="px-6 py-4"><RoleBadge role={member.role} /></td>
                      <td className="px-6 py-4 text-gray-400">{member.department ?? '—'}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleActivate(member)}
                          disabled={activating === member.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                        >
                          {activating === member.id ? <Spinner /> : <UserCheck className="w-3 h-3" />}
                          Activate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </>}

        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { role, userName, clearAuth } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await logout()
    } finally {
      clearAuth()
      navigate('/login', { replace: true })
      toast.success('Logged out.')
    }
  }

  const displayName = userName ?? 'User'
  const roleLabel = ROLE_LABELS[role ?? ''] ?? role ?? 'User'

  switch (role) {
    case 'APPLICANT':
      return <ApplicantDashboardContent userName={displayName} onLogout={handleLogout} />
    case 'STUDENT_AFFAIRS':
      return <StudentAffairsDashboardContent userName={displayName} onLogout={handleLogout} />
    case 'TRANSFER_COMMISSION':
      return <YGKDashboard userName={displayName} onLogout={handleLogout} />
    case 'YDYO':
      return <YDYODashboard userName={displayName} onLogout={handleLogout} />
    case 'DEAN_OFFICE':
      return <DeanDashboard userName={displayName} onLogout={handleLogout} />
    case 'SYSTEM_ADMIN':
      return <AdminDashboardContent userName={displayName} onLogout={handleLogout} />
    default:
      return <StaffDashboardContent userName={displayName} roleLabel={roleLabel} icon={Home} onLogout={handleLogout} />
  }
}
