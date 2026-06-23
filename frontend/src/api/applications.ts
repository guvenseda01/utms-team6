import axios from 'axios'
import type {
  ApplicationDetail,
  ApplicationStatus,
  ApplicationSummary,
  AcademicRecord,
  Document,
  DocType,
  SubmitResult,
  NotificationMessage,
} from '../types/application'

const _base = import.meta.env.VITE_API_BASE_URL ?? ''

const client = axios.create({
  baseURL: `${_base}/api`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

let _refreshing: Promise<void> | null = null

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        if (!_refreshing) {
          _refreshing = axios
            .post(`${_base}/api/auth/refresh`, {}, { withCredentials: true })
            .then(() => { _refreshing = null })
            .catch((e) => { _refreshing = null; throw e })
        }
        await _refreshing
        return client(original)
      } catch {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function listApplications(): Promise<ApplicationSummary[]> {
  const { data } = await client.get<ApplicationSummary[]>('/applications')
  return data
}

export async function getApplication(id: string): Promise<ApplicationDetail> {
  const { data } = await client.get<ApplicationDetail>(`/applications/${id}`)
  return data
}

export async function createApplication(payload: {
  program_id: string
  period_id: string
}): Promise<{ application_id: string; status: string }> {
  const { data } = await client.post('/applications', payload)
  return data
}

export async function fetchAcademicData(applicationId: string): Promise<AcademicRecord> {
  const { data } = await client.post<AcademicRecord>(
    `/applications/${applicationId}/fetch-academic-data`,
  )
  return data
}

export async function getApplicationStatus(applicationId: string): Promise<ApplicationStatus> {
  const { data } = await client.get<ApplicationStatus>(`/applications/${applicationId}/status`)
  return data
}

export async function listNotifications(applicationId: string): Promise<NotificationMessage[]> {
  const { data } = await client.get<NotificationMessage[]>(
    `/applications/${applicationId}/notifications`,
  )
  return data
}

export async function submitApplication(applicationId: string): Promise<SubmitResult> {
  const { data } = await client.post<SubmitResult>(
    `/applications/${applicationId}/submit`,
  )
  return data
}

export async function resubmitAfterCorrection(applicationId: string): Promise<{ application_id: string; status: string }> {
  const { data } = await client.post<{ application_id: string; status: string }>(
    `/applications/${applicationId}/resubmit`,
  )
  return data
}

export async function verifyDocument(
  applicationId: string,
  documentId: string,
): Promise<{ id: string; extraction_confirmed: boolean }> {
  const { data } = await client.post<{ id: string; extraction_confirmed: boolean }>(
    `/applications/${applicationId}/documents/${documentId}/verify`,
  )
  return data
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function listDocuments(applicationId: string): Promise<Document[]> {
  const { data } = await client.get<Document[]>(
    `/applications/${applicationId}/documents`,
  )
  return data
}

export async function uploadDocument(
  applicationId: string,
  docType: DocType,
  file: File,
): Promise<Document> {
  const form = new FormData()
  form.append('doc_type', docType)
  form.append('file', file)
  const { data } = await client.post<Document>(
    `/applications/${applicationId}/documents/upload`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}

export function getPreviewUrl(documentId: string): { preview_url: string } {
  return { preview_url: `/api/documents/${documentId}/stream` }
}

// ---------------------------------------------------------------------------
// Programs & Periods
// ---------------------------------------------------------------------------

export interface ProgramOption {
  id: string
  name: string
  code: string
  faculty: string
  quota: number
  min_gpa: number | null
}

export interface PeriodOption {
  id: string
  label: string
  opens_at: string
  closes_at: string
}

export async function listPrograms(): Promise<ProgramOption[]> {
  const { data } = await client.get<ProgramOption[]>('/programs')
  return data
}

export async function listOpenPeriods(): Promise<PeriodOption[]> {
  const { data } = await client.get<PeriodOption[]>('/periods')
  return data
}
