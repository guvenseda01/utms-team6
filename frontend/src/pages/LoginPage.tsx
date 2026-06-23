import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AxiosError } from 'axios'
import { GraduationCap, User, Eye, EyeOff } from 'lucide-react'
import { loginSchema, type LoginFormData } from '../schemas/auth'
import { login, extractErrorMessage, resendVerification } from '../api/auth'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuth()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(data: LoginFormData) {
    setLoading(true)
    try {
      const res = await login(data)
      setAuth(res.role, data.email.split('@')[0], res.must_change_password)
      if (res.must_change_password) {
        navigate('/change-password', { replace: true })
      } else {
        toast.success('Welcome back!')
        navigate('/dashboard', { replace: true })
      }
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : null
      if (status === 401) {
        toast.error('Invalid email or password.')
      } else if (status === 403) {
        setUnverifiedEmail(data.email)
        toast.error('Please verify your email address before logging in.')
      } else if (status === 423) {
        toast.error('Account locked. Too many failed attempts.')
      } else {
        toast.error(extractErrorMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleResendVerification() {
    if (!unverifiedEmail) return
    setResending(true)
    try {
      await resendVerification(unverifiedEmail)
      toast.success('Verification email sent. Check your inbox.')
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <GraduationCap className="w-12 h-12 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-semibold text-indigo-900 mb-1">IZTECH UTMS</h1>
          <p className="text-gray-600 text-sm">Undergraduate Transfer Management System</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="flex items-center justify-center mb-6">
            <User className="w-12 h-12 text-indigo-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-1">Sign In</h2>
          <p className="text-gray-500 text-sm text-center mb-6">Use your university account to continue</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">University Email</label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@iyte.edu.tr"
                {...register('email')}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/forgot-password" className="text-xs text-indigo-600 hover:text-indigo-700">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register('password')}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-2.5 px-4 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {unverifiedEmail && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
              <p className="text-xs text-amber-800 mb-2">
                Your account is not verified yet. Check your email or resend the verification link.
              </p>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resending}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-60"
              >
                {resending ? 'Sending…' : 'Resend verification email'}
              </button>
            </div>
          )}

          <div className="mt-6 text-center">
            <Link to="/register" className="text-indigo-600 hover:text-indigo-700 text-sm">
              Don't have an account? Register
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
