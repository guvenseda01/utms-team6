import { createContext, useContext, useState, type ReactNode } from 'react'

interface AuthState {
  role: string | null
  userName: string | null
  mustChangePassword: boolean
}

interface AuthContextValue extends AuthState {
  setAuth: (role: string, userName: string, mustChangePassword?: boolean) => void
  setRole: (role: string) => void
  clearMustChangePassword: () => void
  clearAuth: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<string | null>(
    () => localStorage.getItem('role'),
  )
  const [userName, setUserNameState] = useState<string | null>(
    () => localStorage.getItem('userName'),
  )
  const [mustChangePassword, setMustChangePasswordState] = useState<boolean>(
    () => localStorage.getItem('mustChangePassword') === 'true',
  )

  function setAuth(r: string, name: string, mcp = false) {
    localStorage.setItem('role', r)
    localStorage.setItem('userName', name)
    localStorage.setItem('mustChangePassword', String(mcp))
    setRoleState(r)
    setUserNameState(name)
    setMustChangePasswordState(mcp)
  }

  function setRole(r: string) {
    localStorage.setItem('role', r)
    setRoleState(r)
  }

  function clearMustChangePassword() {
    localStorage.setItem('mustChangePassword', 'false')
    setMustChangePasswordState(false)
  }

  function clearAuth() {
    localStorage.removeItem('role')
    localStorage.removeItem('userName')
    localStorage.removeItem('mustChangePassword')
    setRoleState(null)
    setUserNameState(null)
    setMustChangePasswordState(false)
  }

  return (
    <AuthContext.Provider value={{ role, userName, mustChangePassword, setAuth, setRole, clearMustChangePassword, clearAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
