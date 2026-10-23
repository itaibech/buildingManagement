import { useNavigate } from 'react-router'
import { useAuth } from './AuthProvider'

/** "יציאה": sign out and land on #/login, with no confirm dialog. */
export function useExit(): () => Promise<void> {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  return async () => {
    try {
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }
}
