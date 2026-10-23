import { Center, Loader } from '@mantine/core'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAdmin, RequireApproved } from './auth/Guard'
import LoginPage from './auth/LoginPage'
import Shell from './layout/Shell'

const HomePage = lazy(() => import('./features/home/HomePage'))
const MorePage = lazy(() => import('./features/more/MorePage'))
const AnnouncementsPage = lazy(() => import('./features/announcements/AnnouncementsPage'))
const TicketsPage = lazy(() => import('./features/tickets/TicketsPage'))
const TicketPage = lazy(() => import('./features/tickets/TicketPage'))
const FinancePage = lazy(() => import('./features/finance/FinancePage'))
const DirectoryPage = lazy(() => import('./features/tenants/DirectoryPage'))
const MaintenancePage = lazy(() => import('./features/maintenance/MaintenancePage'))
const ApartmentsPage = lazy(() => import('./features/tenants/ApartmentsPage'))
const ApartmentPage = lazy(() => import('./features/tenants/ApartmentPage'))
const UsersPage = lazy(() => import('./features/tenants/UsersPage'))
const ImportPage = lazy(() => import('./features/import/ImportPage'))
const EvPage = lazy(() => import('./features/ev/EvPage'))
const ChargerPage = lazy(() => import('./features/ev/ChargerPage'))
const EvImportPage = lazy(() => import('./features/ev/EvImportPage'))

const fallback = (
  <Center mih="50vh">
    <Loader />
  </Center>
)

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireApproved />}>
            <Route element={<Shell />}>
              <Route index element={<HomePage />} />
              <Route path="announcements" element={<AnnouncementsPage />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="tickets/:id" element={<TicketPage />} />
              <Route path="finance" element={<FinancePage />} />
              <Route path="more" element={<MorePage />} />
              <Route path="directory" element={<DirectoryPage />} />
              <Route path="maintenance" element={<MaintenancePage />} />
              <Route element={<RequireAdmin />}>
                <Route path="apartments" element={<ApartmentsPage />} />
                <Route path="apartments/:id" element={<ApartmentPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="import" element={<ImportPage />} />
                <Route path="ev" element={<EvPage />} />
                <Route path="ev/import" element={<EvImportPage />} />
                <Route path="ev/:id" element={<ChargerPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
