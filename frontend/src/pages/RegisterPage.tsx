import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AxiosError } from 'axios'
import { User, Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react'
import { registerSchema, type RegisterFormData } from '../schemas/auth'
import { register as registerUser, extractErrorMessage } from '../api/auth'

export default function RegisterPage() {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [nationalId, setNationalId] = useState('')

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormData>({ resolver: zodResolver(registerSchema) })

  async function onSubmit(data: RegisterFormData) {
    setLoading(true)
    try {
      await registerUser(data)
      setSuccess(true)
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : null
      if (status === 409) {
        toast.error('An account with this information already exists.')
      } else {
        toast.error(extractErrorMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <Mail className="w-8 h-8 text-green-600" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Check Your Email</h2>
            <p className="text-gray-600 text-sm mb-2">Account created successfully.</p>
            <p className="text-gray-500 text-sm mb-6">
              Please check your email for the verification link before signing in.
            </p>
            <Link
              to="/login"
              className="inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <Link
          to="/login"
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 mb-6 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to login
        </Link>

        <div className="text-center mb-6">
          <div className="flex items-center justify-center mb-3">
            <User className="w-10 h-10 text-indigo-600" />
          </div>
          <h1 className="text-xl font-semibold text-indigo-900">IZTECH UTMS</h1>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-1">Create Account</h2>
          <p className="text-gray-500 text-sm text-center mb-6">Register to apply for transfer to IZTECH</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input
                  type="text"
                  autoComplete="given-name"
                  placeholder="Ahmet"
                  {...register('first_name')}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {errors.first_name && <p className="mt-1 text-xs text-red-600">{errors.first_name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input
                  type="text"
                  autoComplete="family-name"
                  placeholder="Yılmaz"
                  {...register('last_name')}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {errors.last_name && <p className="mt-1 text-xs text-red-600">{errors.last_name.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">National ID (TC)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={11}
                  pattern="[0-9]*"
                  placeholder="12345678901"
                  {...register('national_id')}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 11)
                    setNationalId(value)
                    setValue('national_id', value)
                  }}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {nationalId.length > 0 && nationalId.length !== 11 && (
                  <p className="mt-1 text-xs text-red-600">
                    TC Kimlik No 11 haneli olmalıdır. ({nationalId.length}/11)
                  </p>
                )}
                {errors.national_id && <p className="mt-1 text-xs text-red-600">{errors.national_id.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                <input
                  type="date"
                  {...register('date_of_birth')}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {errors.date_of_birth && <p className="mt-1 text-xs text-red-600">{errors.date_of_birth.message}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">University Email</label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@iyte.edu.tr"
                {...register('university_email')}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {errors.university_email && <p className="mt-1 text-xs text-red-600">{errors.university_email.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  {...register('password')}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
              <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500">Min 8 chars · One uppercase · One digit · One special character</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  {...register('password_confirm')}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent pr-10"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password_confirm && <p className="mt-1 text-xs text-red-600">{errors.password_confirm.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-2.5 px-4 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/login" className="text-indigo-600 hover:text-indigo-700 text-sm">
              Already have an account? Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
