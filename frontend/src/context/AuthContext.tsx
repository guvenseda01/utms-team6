import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

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

  // Reset in-memory state only (don't touch localStorage — the other tab owns it now).
  function _resetState() {
    setRoleState(null)
    setUserNameState(null)
    setMustChangePasswordState(false)
  }

  useEffect(() => {
    // Another tab logged in/out → their login replaced our cookie, so our
    // requests will fail with wrong-role errors. Drop to login screen.
    function onStorage(e: StorageEvent) {
      if (e.key === 'role') _resetState()
    }

    // Axios interceptor signals a 403 (wrong role in cookie) or a failed refresh.
    function onSessionEnd() { _resetState() }

    window.addEventListener('storage', onStorage)
    window.addEventListener('auth:session-conflict', onSessionEnd)
    window.addEventListener('auth:session-expired', onSessionEnd)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('auth:session-conflict', onSessionEnd)
      window.removeEventListener('auth:session-expired', onSessionEnd)
    }
  }, [])

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
