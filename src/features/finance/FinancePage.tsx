import { useAuth } from '../../auth/AuthProvider'
import { AdminFinance } from './AdminFinance'
import { ResidentFinance } from './ResidentFinance'

/** "כספים": the admin workspace, or the resident's own view. */
export default function FinancePage() {
  const { isAdmin } = useAuth()
  return isAdmin ? <AdminFinance /> : <ResidentFinance />
}
