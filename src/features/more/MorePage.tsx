import { Button, NavLink, Stack, Title } from '@mantine/core'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'

const COMMON = [
  { to: '/directory', label: he.nav.directory },
  { to: '/maintenance', label: he.nav.maintenance },
]
const ADMIN = [
  { to: '/apartments', label: he.nav.apartments },
  { to: '/users', label: he.nav.users },
  { to: '/import', label: he.nav.import },
]

export default function MorePage() {
  const { isAdmin, signOut } = useAuth()
  const items = isAdmin ? [...COMMON, ...ADMIN] : COMMON
  return (
    <Stack>
      <Title order={2}>{he.nav.more}</Title>
      {items.map((i) => (
        <NavLink key={i.to} component={Link} to={i.to} label={i.label} />
      ))}
      <Button variant="light" color="red" onClick={() => void signOut()}>
        {he.signOut}
      </Button>
    </Stack>
  )
}
