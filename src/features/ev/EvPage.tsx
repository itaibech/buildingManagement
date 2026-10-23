import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { PageHeader } from '../../ui'
import { EvPanel } from './EvPanel'

/** Admin "טעינת רכב חשמלי" (/ev): also reachable as a tab in כספים. */
export default function EvPage() {
  const [adding, setAdding] = useState(false)
  return (
    <>
      <PageHeader title={he.ev.title} action={{ label: he.ev.addCharger, icon: <IconPlus size={22} stroke={1.75} />, onClick: () => setAdding(true) }} />
      <EvPanel adding={adding} onAddingClose={() => setAdding(false)} />
    </>
  )
}
