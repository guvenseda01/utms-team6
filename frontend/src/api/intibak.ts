import axios from 'axios'

const _base = import.meta.env.VITE_API_BASE_URL ?? ''

const client = axios.create({
  baseURL: `${_base}/api/ygk`,
  withCredentials: true,
  timeout: 60000,
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

export interface ParsedCourse {
  course_code: string
  course_name: string
  credits: number
  grade: string
  semester: string
}

export type EquivalenceType = 'FULL' | 'PARTIAL' | 'NONE'

export interface CourseMapping {
  id: string
  source_course_code: string | null
  source_course_name: string
  source_credits: number
  target_course_code: string | null
  target_course_name: string | null
  target_credits: number | null
  equivalence_type: EquivalenceType
  notes: string | null
}

export interface IntibakTable {
  id: string
  application_id: string
  status: string
  transcript_document_id: string | null
  mappings: CourseMapping[]
}

export interface SuggestedCourse {
  course_code: string
  course_name: string
  credits: number
}

// Backend returns course_mappings with source_course/target_course; normalize for the UI.
function splitCourseField(value: string): { code: string | null; name: string } {
  const trimmed = value.trim()
  if (!trimmed) return { code: null, name: '' }
  const match = trimmed.match(/^([A-Za-z0-9]+)\s+(.+)$/)
  if (match) return { code: match[1], name: match[2] }
  return { code: null, name: trimmed }
}

function joinCourseField(code: string | undefined | null, name: string | undefined | null): string {
  const c = code?.trim()
  const n = name?.trim()
  if (c && n) return `${c} ${n}`
  return c || n || ''
}

function normalizeMapping(raw: Record<string, unknown>): CourseMapping {
  const sourceRaw = (raw.source_course_name ?? raw.source_course ?? '') as string
  const targetRaw = (raw.target_course_name ?? raw.target_course ?? '') as string
  const source = splitCourseField(sourceRaw)
  const target = splitCourseField(targetRaw)

  return {
    id: String(raw.id),
    source_course_code: (raw.source_course_code as string) ?? source.code,
    source_course_name: source.name || sourceRaw,
    source_credits: Number(raw.source_credits ?? 0),
    target_course_code: (raw.target_course_code as string) ?? target.code,
    target_course_name: target.name || targetRaw || null,
    target_credits: raw.target_credits != null ? Number(raw.target_credits) : null,
    equivalence_type: raw.equivalence_type as EquivalenceType,
    notes: (raw.notes as string) ?? null,
  }
}

function normalizeIntibakTable(data: Record<string, unknown>): IntibakTable {
  const rawMappings = (data.mappings ?? data.course_mappings ?? []) as Record<string, unknown>[]
  return {
    id: String(data.id),
    application_id: String(data.application_id),
    status: String(data.status),
    transcript_document_id: (data.transcript_document_id as string | null) ?? null,
    mappings: rawMappings.map(normalizeMapping),
  }
}

/** Load existing table, or create one only when none exists (avoids 409 noise). */
export async function ensureIntibakTable(applicationId: string): Promise<IntibakTable> {
  try {
    const { data } = await client.get(`/applications/${applicationId}/intibak`)
    return normalizeIntibakTable(data)
  } catch (err) {
    if (!axios.isAxiosError(err) || err.response?.status !== 404) throw err
    await client.post(`/applications/${applicationId}/intibak`)
    const { data } = await client.get(`/applications/${applicationId}/intibak`)
    return normalizeIntibakTable(data)
  }
}

export async function createIntibakTable(applicationId: string): Promise<IntibakTable> {
  return ensureIntibakTable(applicationId)
}

export async function getIntibakTable(tableId: string): Promise<IntibakTable> {
  const { data } = await client.get(`/intibak/${tableId}`)
  return normalizeIntibakTable(data)
}

export async function getIntibakTableByApplication(applicationId: string): Promise<IntibakTable> {
  const { data } = await client.get(`/applications/${applicationId}/intibak`)
  return normalizeIntibakTable(data)
}

export async function parseTranscript(tableId: string): Promise<{ courses: ParsedCourse[] }> {
  const { data } = await client.post<{ courses: ParsedCourse[] }>(`/intibak/${tableId}/parse-transcript`)
  return data
}

export async function suggestMatch(
  courseName: string,
  programId: string,
): Promise<SuggestedCourse[]> {
  const { data } = await client.get<SuggestedCourse[]>('/intibak/suggest-match', {
    params: { course_name: courseName, program_id: programId },
  })
  return data
}

export async function addMapping(
  tableId: string,
  payload: {
    source_course_code?: string
    source_course_name: string
    source_credits: number
    target_course_code?: string
    target_course_name?: string
    target_credits?: number
    equivalence_type: EquivalenceType
    notes?: string
  },
): Promise<CourseMapping> {
  const { data } = await client.post(`/intibak/${tableId}/mappings`, {
    source_course: joinCourseField(payload.source_course_code, payload.source_course_name),
    source_credits: payload.source_credits,
    target_course: joinCourseField(payload.target_course_code, payload.target_course_name),
    target_credits: payload.target_credits,
    equivalence_type: payload.equivalence_type,
    notes: payload.notes,
  })
  return normalizeMapping(data)
}

export async function updateMapping(
  tableId: string,
  mappingId: string,
  payload: {
    source_course_code?: string
    source_course_name?: string
    source_credits?: number
    target_course_code?: string
    target_course_name?: string
    target_credits?: number
    equivalence_type?: EquivalenceType
    notes?: string
  },
): Promise<CourseMapping> {
  const body: Record<string, unknown> = {}
  if (payload.source_course_name !== undefined || payload.source_course_code !== undefined) {
    body.source_course = joinCourseField(payload.source_course_code, payload.source_course_name)
  }
  if (payload.source_credits !== undefined) body.source_credits = payload.source_credits
  if (payload.target_course_name !== undefined || payload.target_course_code !== undefined) {
    body.target_course = joinCourseField(payload.target_course_code, payload.target_course_name)
  }
  if (payload.target_credits !== undefined) body.target_credits = payload.target_credits
  if (payload.equivalence_type !== undefined) body.equivalence_type = payload.equivalence_type
  if (payload.notes !== undefined) body.notes = payload.notes

  const { data } = await client.put(`/intibak/${tableId}/mappings/${mappingId}`, body)
  return normalizeMapping(data)
}

export async function submitIntibakTable(tableId: string): Promise<IntibakTable> {
  const { data } = await client.post(`/intibak/${tableId}/submit`)
  return normalizeIntibakTable(data)
}
