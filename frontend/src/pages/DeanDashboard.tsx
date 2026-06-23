import { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import {
  GraduationCap, Search, CheckCircle, XCircle, FileText, LogOut, Loader2, X,
  AlertTriangle, Bell,
} from 'lucide-react'
import { extractErrorMessage } from '../api/auth'
import {
  listDeanApplications,
  approveDeanApplication,
  rejectDeanApplication,
  getDeanApplicationDetail,
  DEAN_REJECTION_OPTIONS,
  type DeanApplicationSummary,
  type DeanApplicationDetail,
  type DeanRejectionCode,
  type DeanRejectResponse,
} from '../api/dean'

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function DeanSidebar({
  userName, pending, approved, rejected, onLogout,
}: {
  userName: string
  pending: number
  approved: number
  rejected: number
  onLogout: () => void
}) {
  return (
    <aside className="w-64 bg-indigo-900 text-white min-h-screen p-6 flex flex-col flex-shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2 mb-6">
        <GraduationCap className="w-7 h-7" />
        <span className="text-sm font-semibold tracking-wide">Transfer System</span>
      </div>

      {/* User block */}
      <div className="border-t border-indigo-700 pt-4 mb-8">
        <p className="text-indigo-300 text-xs mb-1">Logged in as</p>
        <p className="font-medium text-sm truncate">{userName}</p>
        <p className="text-indigo-300 text-xs mt-1">Dean's Office</p>
      </div>

      {/* Stats */}
      <div className="space-y-3 mb-auto">
        <SidebarStat label="Pending Review" value={pending}  accent="bg-indigo-500/30 text-white"      activeBorder />
        <SidebarStat label="Approved"       value={approved} accent="bg-indigo-500/10 text-emerald-200" />
        <SidebarStat label="Rejected"       value={rejected} accent="bg-indigo-500/10 text-rose-200" />
      </div>

      <button
        onClick={onLogout}
        className="flex items-center gap-2 text-indigo-300 hover:text-white transition-colors mt-6 pt-4 border-t border-indigo-700"
      >
        <LogOut className="w-4 h-4" />
        <span className="text-sm">Logout</span>
      </button>
    </aside>
  )
}

function SidebarStat({
  label, value, accent, activeBorder = false,
}: {
  label: string; value: number; accent: string; activeBorder?: boolean
}) {
  return (
    <div className={`rounded-lg px-4 py-3 ${accent} ${activeBorder ? 'ring-1 ring-indigo-300/40' : ''}`}>
      <p className="text-[11px] tracking-wider opacity-90">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status badge (top-right of each card)
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'Pending'  ? 'bg-amber-100 text-amber-700' :
    status === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
    status === 'Rejected' ? 'bg-rose-100 text-rose-700' :
                            'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Application card
// ---------------------------------------------------------------------------

function ApplicationCard({
  app, onAfterAction, onViewDetails, onReject,
}: {
  app: DeanApplicationSummary
  onAfterAction: () => void
  onViewDetails: (id: string) => void
  onReject: (app: DeanApplicationSummary) => void
}) {
  const [busy, setBusy] = useState<null | 'approve'>(null)
  const isPending = app.dean_status === 'Pending'
  const submittedDate = app.submitted_at ? app.submitted_at.slice(0, 10) : '—'
  const gpaText = app.gpa != null ? app.gpa.toFixed(1) : '—'

  async function handleApprove() {
    setBusy('approve')
    try {
      await approveDeanApplication(app.id)
      toast.success(`${app.applicant ?? 'Application'} approved — routed to Transfer Commission.`)
      onAfterAction()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">{app.applicant ?? '—'}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Application ID: {app.tracking_number ?? app.id.slice(0, 8)}
          </p>
        </div>
        <StatusBadge status={app.dean_status} />
      </div>

      {/* 4-col details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Field label="Current University" value={app.current_university ?? '—'} />
        <Field label="Target Department"  value={app.program ?? '—'} />
        <Field label="GPA"                value={gpaText} />
        <Field label="Submitted"          value={submittedDate} />
      </div>

      {/* On non-pending cards, only show a View Details link */}
      {!isPending && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onViewDetails(app.id)}
            className="flex items-center gap-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            <FileText className="w-3.5 h-3.5" />
            View Details
          </button>
        </div>
      )}

      {/* Actions — only on Pending */}
      {isPending && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
          <button
            onClick={handleApprove}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {busy === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Approve
          </button>
          <button
            onClick={() => onReject(app)}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            <XCircle className="w-4 h-4" />
            Reject Application
          </button>
          <button
            type="button"
            onClick={() => onViewDetails(app.id)}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg"
          >
            <FileText className="w-4 h-4" />
            View Details
          </button>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-900">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function DeanDashboard({
  userName, onLogout,
}: {
  userName: string; onLogout: () => void
}) {
  const [apps, setApps] = useState<DeanApplicationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<DeanApplicationSummary | null>(null)
  const [rejectResult, setRejectResult] = useState<{
    result: DeanRejectResponse
    tracking_number: string | null
    applicant: string | null
  } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listDeanApplications()
      setApps(data)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const pending  = apps.filter((a) => a.dean_status === 'Pending').length
  const approved = apps.filter((a) => a.dean_status === 'Approved').length
  const rejected = apps.filter((a) => a.dean_status === 'Rejected').length

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = apps
    if (q) {
      list = list.filter((a) =>
        (a.applicant ?? '').toLowerCase().includes(q) ||
        (a.tracking_number ?? '').toLowerCase().includes(q),
      )
    }
    // Sort by tracking number ascending to match the Figma ordering
    // (APP-2024-001, 002, 003, …); status badges differ per row.
    return [...list].sort((a, b) =>
      (a.tracking_number ?? '').localeCompare(b.tracking_number ?? ''),
    )
  }, [apps, query])

  return (
    <div className="flex flex-1 min-h-screen">
      <DeanSidebar
        userName={userName}
        pending={pending}
        approved={approved}
        rejected={rejected}
        onLogout={onLogout}
      />
      <main className="flex-1 p-8 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-lg font-medium text-gray-700 mb-6">
            Dean's Office — Application Review
          </h1>

          {/* Search */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-2 mb-6 flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or application ID"
              className="flex-1 bg-transparent outline-none text-sm py-2 placeholder-gray-400"
            />
          </div>

          {loading ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Loading applications…
            </div>
          ) : visible.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center text-sm text-gray-500">
              No applications in the dean's review cycle.
            </div>
          ) : (
            <div className="space-y-4">
              {visible.map((a) => (
                <ApplicationCard
                  key={a.id}
                  app={a}
                  onAfterAction={refresh}
                  onViewDetails={setDetailId}
                  onReject={setRejectTarget}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {detailId && (
        <DetailModal
          applicationId={detailId}
          onClose={() => setDetailId(null)}
          onAfterAction={() => { setDetailId(null); refresh() }}
          onReject={(app) => { setDetailId(null); setRejectTarget(app) }}
        />
      )}

      {rejectTarget && !rejectResult && (
        <RejectApplicationModal
          app={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={(result) => {
            setRejectResult({
              result,
              tracking_number: rejectTarget.tracking_number,
              applicant: rejectTarget.applicant,
            })
            setRejectTarget(null)
          }}
        />
      )}

      {rejectResult && (
        <RejectResultModal
          result={rejectResult.result}
          trackingNumber={rejectResult.tracking_number ?? undefined}
          applicantName={rejectResult.applicant ?? undefined}
          onClose={() => { setRejectResult(null); refresh() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// View Details modal
// ---------------------------------------------------------------------------

const EXAM_TYPE_LABELS: Record<string, string> = {
  TOEFL_IBT: 'TOEFL iBT',
  TOEFL: 'TOEFL',
  IELTS: 'IELTS',
  YDS: 'YDS',
  YOKDIL: 'YÖKDİL',
  IZTECH_EXAM: 'IZTECH Proficiency Exam',
}

const DOC_TYPE_LABELS: Record<string, string> = {
  TRANSCRIPT: 'Transcript',
  YKS_RESULT: 'YKS Result',
  LANGUAGE_CERT: 'Language Certificate',
  ID_COPY: 'ID Copy',
  MILITARY_STATUS: 'Military Status',
  DISCIPLINE_RECORD: 'Discipline Record',
  OTHER: 'Other',
}

function DetailModal({
  applicationId, onClose, onAfterAction, onReject,
}: {
  applicationId: string
  onClose: () => void
  onAfterAction: () => void
  onReject: (app: DeanApplicationSummary) => void
}) {
  const [detail, setDetail] = useState<DeanApplicationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<null | 'approve'>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getDeanApplicationDetail(applicationId)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((err) => { if (!cancelled) toast.error(extractErrorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [applicationId])

  async function handleApprove() {
    setBusy('approve')
    try {
      await approveDeanApplication(applicationId)
      toast.success('Transfer Accepted.')
      onAfterAction()
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  function handleReject() {
    if (!detail) return
    onReject({
      id: detail.id,
      tracking_number: detail.tracking_number,
      status: detail.status,
      dean_status: detail.dean_status,
      program: detail.program,
      applicant: detail.applicant?.name ?? null,
      current_university: detail.academic_record?.institution ?? null,
      gpa: detail.academic_record?.gpa_4 ?? null,
      submitted_at: detail.submitted_at,
      ranking_position: detail.ranking_entry?.position ?? null,
      composite_score: detail.ranking_entry?.composite_score ?? null,
      intibak_status: detail.intibak_table?.status ?? null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Application Review</h2>
            {detail && (
              <p className="text-xs text-gray-500 mt-1">
                {detail.tracking_number ?? detail.id.slice(0, 8)} &nbsp;·&nbsp; {detail.applicant?.name ?? '—'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {loading || !detail ? (
            <div className="py-10 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Loading…
            </div>
          ) : (
            <>
              <Section title="Applicant">
                <Row label="Name"        value={detail.applicant?.name ?? '—'} />
                <Row label="Email"       value={detail.applicant?.email ?? '—'} />
                <Row label="National ID" value={detail.applicant?.national_id ?? '—'} />
                <Row label="Submitted"   value={detail.submitted_at ? detail.submitted_at.slice(0, 10) : '—'} />
                <Row label="Target"      value={detail.program ?? '—'} />
              </Section>

              <Section title="Academic Record">
                {detail.academic_record ? (
                  <>
                    <Row label="Current Institution" value={detail.academic_record.institution ?? '—'} />
                    <Row label="GPA (4.00)"  value={detail.academic_record.gpa_4   != null ? detail.academic_record.gpa_4.toFixed(2)   : '—'} />
                    <Row label="GPA (100)"   value={detail.academic_record.gpa_100 != null ? detail.academic_record.gpa_100.toFixed(2) : '—'} />
                    <Row label="YKS Score"   value={detail.academic_record.yks_score != null ? detail.academic_record.yks_score.toFixed(2) : '—'} />
                    <Row label="Credits"     value={detail.academic_record.credits_completed != null ? String(detail.academic_record.credits_completed) : '—'} />
                  </>
                ) : (
                  <Empty>No academic record on file.</Empty>
                )}
              </Section>

              <Section title="English Proficiency (YDYO)">
                {detail.english_review ? (
                  <>
                    <Row
                      label="Decision"
                      value={
                        detail.english_review.approved === true  ? 'Approved' :
                        detail.english_review.approved === false ? 'Not Satisfied' :
                        detail.english_review.must_take_exam     ? 'Awaiting proficiency exam' :
                        'Pending verification'
                      }
                    />
                    <Row label="Exam type"  value={detail.english_review.exam_type ? (EXAM_TYPE_LABELS[detail.english_review.exam_type] ?? detail.english_review.exam_type) : '—'} />
                    <Row label="Score"      value={detail.english_review.exam_score != null ? String(detail.english_review.exam_score) : '—'} />
                    <Row label="Exam date"  value={detail.english_review.exam_date ?? '—'} />
                    <Row label="Reviewed"   value={detail.english_review.reviewed_at ? new Date(detail.english_review.reviewed_at).toLocaleString() : '—'} />
                    <Row label="Published"  value={detail.english_review.published_at ? new Date(detail.english_review.published_at).toLocaleString() : '—'} />
                    {detail.english_review.notes && (
                      <div className="col-span-2 mt-2 text-xs text-gray-600 italic bg-gray-50 rounded px-3 py-2">
                        "{detail.english_review.notes}"
                      </div>
                    )}
                  </>
                ) : (
                  <Empty>No YDYO review record.</Empty>
                )}
              </Section>

              <Section title="Faculty Commission Evaluations">
                {detail.department_evaluations.length === 0 ? (
                  <Empty>No commission evaluations recorded.</Empty>
                ) : (
                  <div className="col-span-2 space-y-2">
                    {detail.department_evaluations.map((ev) => (
                      <div key={ev.id} className="border border-gray-100 rounded-lg p-3 text-xs">
                        <div className="flex justify-between">
                          <span className="font-medium text-gray-700">
                            {ev.decision ?? 'Score'}: {ev.score != null ? ev.score.toFixed(2) : '—'}
                          </span>
                          <span className="text-gray-400">
                            {ev.evaluated_at ? new Date(ev.evaluated_at).toLocaleDateString() : '—'}
                          </span>
                        </div>
                        {ev.notes && <p className="text-gray-500 mt-1">{ev.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Ranking / Intibak">
                {detail.ranking_entry ? (
                  <>
                    <Row label="Position"        value={`#${detail.ranking_entry.position}${detail.ranking_entry.is_primary ? ' (primary)' : ''}`} />
                    <Row label="Composite score" value={detail.ranking_entry.composite_score.toFixed(3)} />
                  </>
                ) : (
                  <Empty>Not yet ranked.</Empty>
                )}
                <Row label="Intibak table" value={detail.intibak_table ? detail.intibak_table.status : 'Not generated'} />
              </Section>

              <Section title={`Documents (${detail.documents.length})`}>
                {detail.documents.length === 0 ? (
                  <Empty>No documents uploaded.</Empty>
                ) : (
                  <div className="col-span-2 space-y-2">
                    {detail.documents.map((d) => (
                      <div key={d.id} className="border border-gray-100 rounded-lg p-3 text-xs flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <span className="font-medium text-gray-700">
                              {DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                              d.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-700' :
                              d.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                                                       'bg-amber-100 text-amber-700'
                            }`}>
                              {d.status}
                            </span>
                          </div>
                          <p className="text-gray-500 truncate mt-1 font-mono text-[11px]">
                            {d.file_name ?? '—'}
                          </p>
                          {d.extracted_data && Object.keys(d.extracted_data).length > 0 && (
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                              {Object.entries(d.extracted_data).map(([k, v]) => (
                                <div key={k} className="text-[11px]">
                                  <span className="text-gray-400">{k}:</span>{' '}
                                  <span className="text-gray-700">{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>

        {/* Footer actions — only when Pending */}
        {detail && detail.dean_status === 'Pending' && (
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
            <button
              onClick={handleReject}
              disabled={busy !== null}
              className="flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              <XCircle className="w-4 h-4" />
              Reject Application
            </button>
            <button
              onClick={handleApprove}
              disabled={busy !== null}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {busy === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Approve
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-3 font-medium">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xs text-gray-900 text-right">{value}</div>
    </>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-2 text-xs text-gray-400 italic">{children}</div>
  )
}

// ---------------------------------------------------------------------------
// Reject flow — standardized codes + on-screen audit log
// ---------------------------------------------------------------------------

function RejectApplicationModal({
  app, onClose, onRejected,
}: {
  app: DeanApplicationSummary
  onClose: () => void
  onRejected: (result: DeanRejectResponse) => void
}) {
  const [code, setCode] = useState<DeanRejectionCode>('INSUFFICIENT_ACADEMIC_STANDING')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    try {
      const result = await rejectDeanApplication(app.id, code, note.trim())
      onRejected(result)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Reject Application</h2>
            <p className="text-xs text-gray-500 mt-1">
              {app.tracking_number ?? app.id.slice(0, 8)} &nbsp;·&nbsp; {app.applicant ?? '—'}
            </p>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            Select a standardized rejection reason. This decision is final and irreversible.
          </p>

          <div className="space-y-2">
            {DEAN_REJECTION_OPTIONS.map((opt) => (
              <label
                key={opt.code}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  code === opt.code
                    ? 'border-rose-300 bg-rose-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="rejection_code"
                  value={opt.code}
                  checked={code === opt.code}
                  onChange={() => setCode(opt.code)}
                  className="mt-1"
                />
                <span className="text-sm text-gray-800">{opt.label}</span>
              </label>
            ))}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Additional note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Supplementary details…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            {submitting ? 'Rejecting…' : 'Confirm Rejection'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RejectResultModal({
  result, trackingNumber, applicantName, onClose,
}: {
  result: DeanRejectResponse
  trackingNumber?: string
  applicantName?: string
  onClose: () => void
}) {
  const { audit_log: log } = result
  const ts = new Date(log.timestamp).toLocaleString()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-rose-700">{result.message}</h2>
              {(trackingNumber || applicantName) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {trackingNumber ?? ''}{trackingNumber && applicantName ? ' · ' : ''}{applicantName ?? ''}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-rose-50 border border-rose-100 rounded-lg p-4">
            <p className="text-xs uppercase tracking-wider text-rose-600 font-medium mb-1">
              Cause of Rejection
            </p>
            <p className="text-sm text-rose-900">{result.rejection_reason}</p>
            {log.note && (
              <p className="text-xs text-rose-700 mt-2 italic">Note: {log.note}</p>
            )}
          </div>

          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-lg p-4">
            <Bell className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-800 font-medium">{result.notification_message}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">
              Audit Log Entry
            </p>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
              <AuditRow label="Dean ID" value={log.dean_id} mono />
              <AuditRow label="Dean" value={log.dean_name ?? log.dean_email ?? '—'} />
              <AuditRow label="Action" value={log.action} />
              <AuditRow label="Timestamp" value={ts} />
              <AuditRow label="Rejection Code" value={log.rejection_code} mono />
              <AuditRow label="Rejection Reason" value={log.rejection_reason} />
              <AuditRow label="IP Address" value={log.ip_address} mono />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function AuditRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className={`text-gray-900 text-xs text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
