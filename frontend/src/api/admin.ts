import axios from 'axios'
import type {
  StaffMember, StaffCreatePayload, StaffCreateResponse, RoleUpdatePayload,
  ApplicationPeriod, PeriodCreatePayload, PeriodExtendPayload, PeriodUpdatePayload,
  DepartmentCondition, ConditionCreatePayload, ConditionUpdatePayload,
} from '../types/admin'

const _base = import.meta.env.VITE_API_BASE_URL ?? ''

const client = axios.create({
  baseURL: `${_base}/api/admin`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        await axios.post(`${_base}/api/auth/refresh`, {}, { withCredentials: true })
        return client(original)
      } catch {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export async function listStaff(): Promise<StaffMember[]> {
  const { data } = await client.get<StaffMember[]>('/staff')
  return data
}

export async function createStaff(payload: StaffCreatePayload): Promise<StaffCreateResponse> {
  const { data } = await client.post<StaffCreateResponse>('/staff', payload)
  return data
}

export async function updateStaffRole(staffId: string, payload: RoleUpdatePayload): Promise<StaffMember> {
  const { data } = await client.patch<StaffMember>(`/staff/${staffId}/role`, payload)
  return data
}

export async function deactivateStaff(staffId: string): Promise<void> {
  await client.delete(`/staff/${staffId}`)
}

export async function activateStaff(staffId: string): Promise<StaffMember> {
  const { data } = await client.post<StaffMember>(`/staff/${staffId}/activate`)
  return data
}

export async function resetStaffPassword(staffId: string): Promise<StaffCreateResponse> {
  const { data } = await client.post<StaffCreateResponse>(`/staff/${staffId}/reset-password`)
  return data
}

// SPEC-018: Application period management
export async function listPeriods(): Promise<ApplicationPeriod[]> {
  const { data } = await client.get<ApplicationPeriod[]>('/periods')
  return data
}

export async function createPeriod(payload: PeriodCreatePayload): Promise<ApplicationPeriod> {
  const { data } = await client.post<ApplicationPeriod>('/periods', payload)
  return data
}

export async function extendPeriod(periodId: string, payload: PeriodExtendPayload): Promise<ApplicationPeriod> {
  const { data } = await client.patch<ApplicationPeriod>(`/periods/${periodId}/extend`, payload)
  return data
}

export async function emergencyClosePeriod(periodId: string): Promise<ApplicationPeriod> {
  const { data } = await client.patch<ApplicationPeriod>(`/periods/${periodId}/emergency-close`)
  return data
}

export async function activatePeriod(periodId: string): Promise<ApplicationPeriod> {
  const { data } = await client.patch<ApplicationPeriod>(`/periods/${periodId}/activate`)
  return data
}

export async function deactivatePeriod(periodId: string): Promise<ApplicationPeriod> {
  const { data } = await client.patch<ApplicationPeriod>(`/periods/${periodId}/deactivate`)
  return data
}

export async function updatePeriod(periodId: string, payload: PeriodUpdatePayload): Promise<ApplicationPeriod> {
  const { data } = await client.patch<ApplicationPeriod>(`/periods/${periodId}`, payload)
  return data
}

// SPEC-019: Department condition management
export async function listConditions(programId: string): Promise<DepartmentCondition[]> {
  const { data } = await client.get<DepartmentCondition[]>(`/programs/${programId}/conditions`)
  return data
}

export async function addCondition(programId: string, payload: ConditionCreatePayload): Promise<DepartmentCondition> {
  const { data } = await client.post<DepartmentCondition>(`/programs/${programId}/conditions`, payload)
  return data
}

export async function updateCondition(programId: string, conditionId: string, payload: ConditionUpdatePayload): Promise<DepartmentCondition> {
  const { data } = await client.patch<DepartmentCondition>(`/programs/${programId}/conditions/${conditionId}`, payload)
  return data
}

export async function deleteCondition(programId: string, conditionId: string): Promise<void> {
  await client.delete(`/programs/${programId}/conditions/${conditionId}`)
}
