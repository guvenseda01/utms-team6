import axios, { AxiosError } from 'axios'
import type { TokenResponse, MeResponse, ApiError } from '../types/auth'

const _base = import.meta.env.VITE_API_BASE_URL ?? ''

const client = axios.create({
  baseURL: `${_base}/api`,
  withCredentials: true, // send HttpOnly cookies automatically
  headers: { 'Content-Type': 'application/json' },
})

export function extractErrorMessage(err: unknown): string {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as ApiError
    if (typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail)) {
      return data.detail.map((e) => e.msg.replace(/^Value error, /, '')).join(' ')
    }
  }
  return 'An unexpected error occurred.'
}

export async function register(payload: {
  national_id: string
  date_of_birth: string
  first_name: string
  last_name: string
  university_email: string
  password: string
  password_confirm: string
}): Promise<{ message: string }> {
  const { data } = await client.post('/auth/register', payload)
  return data
}

export async function login(payload: {
  email: string
  password: string
}): Promise<TokenResponse> {
  const { data } = await client.post<TokenResponse>('/auth/login', payload)
  return data
}

/** Live session identity from the HttpOnly cookie (authoritative role). */
export async function getMe(): Promise<MeResponse> {
  const { data } = await client.get<MeResponse>('/auth/me')
  return data
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  const { data } = await client.post(`/auth/verify-email/${token}`)
  return data
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const { data } = await client.post('/auth/forgot-password', { email })
  return data
}

export async function resendVerification(email: string): Promise<{ message: string }> {
  const { data } = await client.post('/auth/resend-verification', { email })
  return data
}

export async function resetPassword(
  token: string,
  new_password: string,
  new_password_confirm: string,
): Promise<{ message: string }> {
  const { data } = await client.post(`/auth/reset-password/${token}`, {
    new_password,
    new_password_confirm,
  })
  return data
}

export async function changePassword(
  new_password: string,
  new_password_confirm: string,
): Promise<{ message: string }> {
  const { data } = await client.post('/auth/change-password', {
    new_password,
    new_password_confirm,
  })
  return data
}

export async function logout(): Promise<void> {
  await client.post('/auth/logout')
}
