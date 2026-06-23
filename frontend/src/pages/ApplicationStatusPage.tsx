import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft, CheckCircle, Clock, Eye, FileText, Home, Upload,
} from 'lucide-react'
import { logout, extractErrorMessage } from '../api/auth'
import {
  getApplication,
  getApplicationStatus,
  listDocuments,
  uploadDocument,
  getPreviewUrl,
} from '../api/applications'
import { useAuth } from '../context/AuthContext'
import { Sidebar } from '../components/Sidebar'
import { StatusBadge } from '../components/StatusBadge'
import { ApplicationStageTracker } from '../components/ApplicationStageTracker'
import Spinner from '../components/Spinner'
import type { ApplicationDetail, ApplicationStatus, Document, DocType } from '../types/application'

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

const OUTCOME_LABELS: Record<string, { title: string; color: string; bg: string }> = {
  ACCEPTED: { title: 'Accepted', color: 'text-green-800', bg: 'bg-green-50 border-green-200' },
  WAITLISTED: { title: 'Waitlisted', color: 'text-amber-800', bg: 'bg-amber-50 border-amber-200' },
  REJECTED: { title: 'Rejected', color: 'text-red-800', bg: 'bg-red-50 border-red-200' },
}

function DocumentReadOnlyRow({ doc }: { doc: Document }) {
  function handlePreview() {
    const { preview_url } = getPreviewUrl(doc.id)
    window.open(preview_url, '_blank')
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3">
        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <div>
          <p className="text-sm text-gray-900">{DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}</p>
          <p className="text-xs text-gray-400">{doc.file_name}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={doc.status} />
        <button
          type="button"
          onClick={handlePreview}
          className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded"
        >
          <Eye className="w-3 h-3" /> Preview
        </button>
      </div>
    </div>
  )
}

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

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm text-gray-900">{DOC_TYPE_LABELS[docType]}</p>
        {existing && <p className="text-xs text-gray-400">{existing.file_name}</p>}
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {uploading ? <Spinner /> : <Upload className="w-3 h-3" />}
          Upload Documents
        </button>
      </div>
    </div>
  )
}

export default function ApplicationStatusPage() {
  const { applicationId } = useParams<{ applicationId: string }>()
  const navigate = useNavigate()
  const { userName, clearAuth } = useAuth()

  const [application, setApplication] = useState<ApplicationDetail | null>(null)
  const [appStatus, setAppStatus] = useState<ApplicationStatus | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    if (!applicationId) return
    try {
      setError(null)
      const [detail, statusData, docs] = await Promise.all([
        getApplication(applicationId),
        getApplicationStatus(applicationId),
        listDocuments(applicationId),
      ])
      setApplication(detail)
      setAppStatus(statusData)
      setDocuments(docs)
    } catch (err) {
      const msg = extractErrorMessage(err)
      if (msg.includes('Unable to retrieve application information')) {
        setError('Unable to retrieve application information. Please try again later.')
      } else if (msg.includes('Network') || !navigator.onLine) {
        setError('Network error. Please check your internet connection.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [applicationId])

  useEffect(() => {
    if (!applicationId || !application) return
    const terminal = ['ANNOUNCED', 'REJECTED']
    if (terminal.includes(application.status)) return

    const es = new EventSource(`/api/applications/${applicationId}/events`, { withCredentials: true })
    es.onmessage = () => { loadData() }
    es.onerror = () => { es.close() }
    return () => es.close()
  }, [applicationId, application?.status])

  async function handleLogout() {
    try {
      await logout()
    } finally {
      clearAuth()
      navigate('/login', { replace: true })
    }
  }

  async function handleDocUploaded() {
    if (!applicationId) return
    const docs = await listDocuments(applicationId)
    setDocuments(docs)
  }

  const status = application?.status
  const isReadOnly = status === 'REJECTED' || status === 'ANNOUNCED'
  const canUpload = status === 'CORRECTION_REQUESTED'
  const outcome = appStatus?.result?.outcome?.toUpperCase()
  const outcomeStyle = outcome ? OUTCOME_LABELS[outcome] : null

  return (
    <div className="flex flex-1 min-h-screen">
      <Sidebar userName={userName ?? 'User'} role="Applicant" onLogout={handleLogout}>
        <button
          type="button"
          onClick={() => navigate('/dashboard?tab=applications')}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm text-indigo-200 hover:bg-indigo-800 hover:text-white transition-colors"
        >
          <Home className="w-5 h-5 flex-shrink-0" />
          My Applications
        </button>
      </Sidebar>

      <div className="flex-1 p-8 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <button
            type="button"
            onClick={() => navigate('/dashboard?tab=applications')}
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to My Applications
          </button>

          {loading ? (
            <div className="flex justify-center py-24"><Spinner /></div>
          ) : error ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <p className="text-red-600 text-sm mb-4">{error}</p>
              <button
                type="button"
                onClick={() => { setLoading(true); loadData() }}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Retry
              </button>
            </div>
          ) : application && appStatus ? (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Application Details</h1>
                    <p className="text-sm text-gray-500 mt-1">
                      Application ID:{' '}
                      <span className="font-mono font-medium text-gray-700">
                        {application.tracking_number ?? application.id.slice(0, 8).toUpperCase()}
                      </span>
                    </p>
                  </div>
                  <StatusBadge status={application.status} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Created</p>
                    <p className="text-sm text-gray-900">{new Date(application.created_at).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Submitted</p>
                    <p className="text-sm text-gray-900">
                      {application.submitted_at
                        ? new Date(application.submitted_at).toLocaleDateString()
                        : 'Not submitted'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Last Updated</p>
                    <p className="text-sm text-gray-900">{new Date(application.updated_at).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Current Stage</p>
                    <p className="text-sm text-gray-900">{appStatus.progress.current_stage.replace(/_/g, ' ')}</p>
                  </div>
                </div>
              </div>

              {status === 'REJECTED' && (
                <div className="bg-red-50 border border-red-300 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-800 mb-1">Application Rejected</p>
                  {appStatus.result?.reason && (
                    <p className="text-sm text-red-700">{appStatus.result.reason}</p>
                  )}
                </div>
              )}

              {status === 'CORRECTION_REQUESTED' && (
                <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800">Missing / Incorrect Documents</p>
                    <p className="text-xs text-yellow-700 mt-0.5">
                      Please upload the corrected documents below.
                    </p>
                  </div>
                </div>
              )}

              {appStatus.result && outcomeStyle && (
                <div className={`rounded-lg border p-6 ${outcomeStyle.bg}`}>
                  <h2 className={`text-lg font-semibold mb-1 ${outcomeStyle.color}`}>Final Result</h2>
                  <p className={`text-2xl font-bold ${outcomeStyle.color}`}>{outcomeStyle.title}</p>
                  {appStatus.result.reason && status !== 'REJECTED' && (
                    <p className="text-sm text-gray-600 mt-2">{appStatus.result.reason}</p>
                  )}
                </div>
              )}

              <ApplicationStageTracker
                currentStatus={application.status}
                history={appStatus.history}
                language="en"
              />

              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Documents</h2>
                {documents.length === 0 && !canUpload ? (
                  <p className="text-gray-500 text-sm">No documents uploaded yet.</p>
                ) : canUpload ? (
                  <div>
                    <p className="text-xs text-gray-500 mb-4">PDF only · max 5 MB per file</p>
                    {([...REQUIRED_DOCS, 'LANGUAGE_CERT'] as DocType[]).map((dt) => (
                      <DocumentUploadRow
                        key={dt}
                        applicationId={application.id}
                        docType={dt}
                        existing={documents.find(d => d.doc_type === dt)}
                        onUploaded={handleDocUploaded}
                      />
                    ))}
                  </div>
                ) : (
                  documents.map(doc => <DocumentReadOnlyRow key={doc.id} doc={doc} />)
                )}
              </div>

              {appStatus.history.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Status History</h2>
                  <div className="space-y-4">
                    {appStatus.history.map((entry, i) => (
                      <div key={i} className="flex items-start gap-4">
                        <CheckCircle className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm text-gray-900">{entry.status.replace(/_/g, ' ')}</p>
                            {entry.note && <p className="text-xs text-gray-500 mt-0.5">{entry.note}</p>}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">
                            {new Date(entry.changed_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isReadOnly && (
                <p className="text-xs text-gray-400 text-center pb-4">
                  This application is finalized. No further actions are available.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
