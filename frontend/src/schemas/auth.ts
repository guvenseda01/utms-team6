import { z } from 'zod'

const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters required')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/\d/, 'Must contain at least one digit')
  .regex(/[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]/, 'Must contain at least one special character')

export const registerSchema = z
    .object({
        national_id: z
            .string()
            .length(11, 'National ID must be exactly 11 digits')
            .regex(/^\d{11}$/, 'National ID must contain only digits'),
        date_of_birth: z
            .string()
            .min(1, 'Date of birth is required')
            .refine((date) => new Date(date) >= new Date('1900-01-01'), {
                message: 'Date of birth cannot be before 1900',
            })
            .refine((date) => new Date(date) <= new Date(), {
                message: 'Date of birth cannot be in the future',
            }),
        first_name: z.string().min(1, 'First name is required').max(100),
        last_name: z.string().min(1, 'Last name is required').max(100),

        university_email: z
            .string()
            .email('Enter a valid email address')
            .regex(
                /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.edu\.tr$/,
                'Only .edu.tr university email addresses are allowed'
            ),

        password: passwordSchema,
        password_confirm: z.string().min(1, 'Please confirm your password'),
    })
    .refine((d) => d.password === d.password_confirm, {
        message: 'Passwords do not match',
        path: ['password_confirm'],
    })

export type RegisterFormData = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginFormData = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    new_password: passwordSchema,
    new_password_confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.new_password === d.new_password_confirm, {
    message: 'Passwords do not match',
    path: ['new_password_confirm'],
  })

export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>
