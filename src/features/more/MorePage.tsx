import { Button, NavLink, Stack } from '@mantine/core'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { useExit } from '../../auth/useExit'
import { he } from '../../lib/he'
import { PageHeader } from '../../ui'
import { YearExport } from '../export/YearExport'

const COMMON = [
  { to: '/directory', label: he.nav.directory },
  { to: '/maintenance', label: he.nav.maintenance },
]
const ADMIN = [
  { to: '/apartments', label: he.nav.apartments },
  { to: '/users', label: he.nav.users },
  { to: '/ev', label: he.nav.ev },
  { to: '/import', label: he.nav.import },
  { to: '/settings', label: he.nav.settings },
]

export default function MorePage() {
  const { isAdmin } = useAuth()
  const exit = useExit()
  const items = isAdmin ? [...COMMON, ...ADMIN] : COMMON
  return (
    <Stack>
      <PageHeader title={he.nav.more} />
      {items.map((i) => (
        <NavLink key={i.to} component={Link} to={i.to} label={i.label} />
      ))}
      <YearExport />
      <Button variant="light" color="debt" onClick={() => void exit()}>
        {he.exit}
      </Button>
    </Stack>
  )
}
