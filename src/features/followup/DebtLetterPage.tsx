import { Button, Card, Group, Stack, Text } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { BackLink, ListSkeleton, PageHeader } from '../../ui'
import { useApartmentFinance } from '../finance/hooks'
import type { PlanRow } from '../finance/settlement'
import { useBuilding, type Building } from '../settings/api'
import { useAllApartments, useResidents } from '../tenants/api'
import { printLetter } from './print'

const L = he.followup.letter

export interface LetterData {
  number: number
  names: string[]
  balance: number
  open: readonly PlanRow[]
  building: Pick<Building, 'name' | 'payment_instructions' | 'committee_contact'> | null
  today: string
}

function MonthsTable({ open, balance }: { open: readonly PlanRow[]; balance: number }) {
  return (
    <table className="bm-letter-table">
      <thead><tr><th>{L.month}</th><th>{L.amount}</th></tr></thead>
      <tbody>
        {open.map((m) => <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="bm-num">{formatILS(m.open)}</td></tr>)}
      </tbody>
      <tfoot><tr><th>{L.total}</th><th className="bm-num">{formatILS(balance)}</th></tr></tfoot>
    </table>
  )
}

/** The formal letter: date, addressee, subject, the debt by month, the request, payment details and the signature line. */
export function DebtLetter({ d }: { d: LetterData }) {
  const date = formatDate(d.today)
  const b = d.building
  return (
    <article className="bm-letter" dir="rtl">
      <header className="bm-letter-head"><strong>{L.committee(b?.name ?? '')}</strong><span>{L.date(date)}</span></header>
      <p>{L.to(d.names.length ? d.names.join(', ') : L.toApartment(d.number))}</p>
      <p><strong><u>{L.subject(d.number)}</u></strong></p>
      <p>{L.opening}</p>
      <p>{L.intro(d.number, formatILS(d.balance), date)}</p>
      <MonthsTable open={d.open} balance={d.balance} />
      <p>{L.reminded}</p>
      <p>{L.request}</p>
      <p>{L.warning}</p>
      {b?.payment_instructions && <p style={{ whiteSpace: 'pre-wrap' }}><strong>{L.payHow}</strong>{'\n'}{b.payment_instructions}</p>}
      {b?.committee_contact && <p>{L.contact(b.committee_contact)}</p>}
      <p>{L.paid}</p>
      <footer className="bm-letter-sign">
        <p>{L.regards}</p>
        <p><strong>{L.committee(b?.name ?? '')}</strong></p>
        <p>{L.signerName}</p>
        <p>{L.signature}</p>
      </footer>
    </article>
  )
}

/** Admin #/apartments/:id/letter: the "מכתב התראה" on screen, printed (or saved as PDF) from the browser. */
export default function DebtLetterPage() {
  const { id = '' } = useParams()
  const apartments = useAllApartments()
  const apartment = apartments.data?.find((a) => a.id === id)
  const residents = useResidents(id)
  const fin = useApartmentFinance(id)
  const building = useBuilding()
  const back = <BackLink to={`/apartments/${id}?tab=ledger`} label={L.back} />
  if (apartments.data && !apartment) return <Stack align="flex-start"><BackLink to="/apartments" label={he.tenants.back} /><Text>{he.tenants.notFound}</Text></Stack>
  if (!apartment || !fin.ready || residents.isLoading) return <Stack>{back}<ListSkeleton rows={6} /></Stack>
  const d: LetterData = { number: apartment.number, names: (residents.data ?? []).map((r) => r.full_name), balance: fin.balance,
    open: fin.open, building: building.data ?? null, today: todayISO() }
  return (
    <Stack gap="md">
      {back}
      <PageHeader title={`${L.title} · ${he.apartment(apartment.number)}`} />
      {d.balance <= 0 ? <Text>{L.noDebt}</Text> : (
        <>
          <Group gap="sm" wrap="wrap">
            <Button leftSection={<IconPrinter size={20} stroke={1.75} aria-hidden="true" />} onClick={() => printLetter(d.number, d.today)}>{L.print}</Button>
            <Text size="sm" c="dimmed">{L.hint}</Text>
          </Group>
          <Card maw={800}><DebtLetter d={d} /></Card>
          {createPortal(<div className="bm-print" data-testid="letter-print"><DebtLetter d={d} /></div>, document.body)}
        </>
      )}
    </Stack>
  )
}
