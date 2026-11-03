import { useId, type ReactNode } from 'react'
import { formatDate, formatILS, HEBREW_MONTHS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import type { AnnualReport, AppendixRow, BudgetReport, ExpenseTable, FundBalance } from './annualReport'

const A = he.annual

export interface AnnualDocumentProps {
  report: AnnualReport
  building: { name: string; address: string | null } | null
  today: string
  notes: string
}

function Section({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={`bm-annual-section ${className ?? ''}`.trim()}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  )
}

const pct = (value: number, max: number): string => `${max > 0 ? Math.min((value / max) * 100, 100) : 0}%`

function Cover({ report, building, today }: Omit<AnnualDocumentProps, 'notes'>) {
  const partial = Number(today.slice(0, 4)) <= report.year
  return (
    <header className="bm-annual-cover">
      <p className="bm-annual-building">{building?.name ?? he.appName}</p>
      {building?.address && <p>{building.address}</p>}
      <h1>{A.cover.heading(report.year)}</h1>
      <p>{A.cover.for}</p>
      <p className="bm-annual-dim">{A.cover.prepared(formatDate(today))}</p>
      {partial && <p className="bm-annual-dim">{A.cover.partial(formatDate(today))}</p>}
    </header>
  )
}

function Income({ report }: { report: AnnualReport }) {
  const i = report.income
  const lines: [string, number][] = i ? [[A.income.fees, i.fees], [A.income.levies, i.levies], [A.income.ev, i.ev], [A.income.other, i.other]] : []
  return (
    <Section title={A.income.title}>
      {i && <p className="bm-annual-dim">{A.income.hint}</p>}
      <table className="bm-annual-table">
        {i && <thead><tr><th>{A.income.kind}</th><th>{A.income.amount}</th></tr></thead>}
        <tbody>
          {lines.map(([label, amount]) => <tr key={label}><td>{label}</td><td className="bm-num">{formatILS(amount)}</td></tr>)}
          {i && <tr className="bm-annual-total"><td>{A.income.total}</td><td className="bm-num">{formatILS(i.total)}</td></tr>}
          <tr><td>{A.income.expected}</td><td className="bm-num">{formatILS(report.expectedIncome)}</td></tr>
          {report.receivedIncome !== null && <tr><td>{A.income.received}</td><td className="bm-num">{formatILS(report.receivedIncome)}</td></tr>}
        </tbody>
      </table>
    </Section>
  )
}

/** The twelve monthly totals as plain CSS bars (printed in colour: print-color-adjust in global.css). */
function MonthChart({ table }: { table: ExpenseTable }) {
  const max = Math.max(...table.monthTotals, 0)
  return (
    <figure className="bm-annual-chart" aria-label={A.expenses.chart}>
      <figcaption>{A.expenses.chart}</figcaption>
      <div className="bm-annual-bars">
        {table.monthTotals.map((total, i) => (
          <div key={table.months[i]} className="bm-annual-bar" title={`${HEBREW_MONTHS[i]}: ${formatILS(total)}`}>
            <span className="bm-annual-bar-fill" style={{ height: pct(total, max) }} />
            <span className="bm-annual-bar-label">{HEBREW_MONTHS[i]?.slice(0, 3)}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

function Expenses({ table }: { table: ExpenseTable }) {
  if (table.categories.length === 0) return <Section title={A.expenses.title}><p>{A.expenses.empty}</p></Section>
  return (
    <Section title={A.expenses.title}>
      <MonthChart table={table} />
      <div className="bm-annual-scroll">
        <table className="bm-annual-table bm-annual-wide">
          <thead><tr><th>{A.expenses.category}</th>{HEBREW_MONTHS.map((m) => <th key={m}>{m.slice(0, 3)}</th>)}<th>{A.expenses.total}</th></tr></thead>
          <tbody>
            {table.categories.map((c) => (
              <tr key={c.categoryId}><td>{c.category}</td>{c.months.map((v, i) => <td key={table.months[i]} className="bm-num">{v ? formatILS(v) : '—'}</td>)}<td className="bm-num">{formatILS(c.total)}</td></tr>
            ))}
            <tr className="bm-annual-total"><td>{A.expenses.monthTotal}</td>{table.monthTotals.map((v, i) => <td key={table.months[i]} className="bm-num">{formatILS(v)}</td>)}<td className="bm-num">{formatILS(table.total)}</td></tr>
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function BudgetChart({ budget }: { budget: BudgetReport }) {
  const max = Math.max(...budget.lines.flatMap((l) => [l.planned, l.actual]), 0)
  return (
    <figure className="bm-annual-chart" aria-label={A.budget.title}>
      {budget.lines.map((l) => (
        <div key={l.category} className="bm-annual-hbar">
          <span className="bm-annual-hbar-name">{l.category}</span>
          <span className="bm-annual-hbar-track">
            <span className="bm-annual-hbar-plan" style={{ width: pct(l.planned, max) }} />
            <span className={`bm-annual-hbar-actual${l.variance < 0 ? ' bm-annual-over' : ''}`} style={{ width: pct(l.actual, max) }} />
          </span>
        </div>
      ))}
      <figcaption className="bm-annual-legend"><span className="bm-annual-key-plan" />{A.budget.planned} <span className="bm-annual-key-actual" />{A.budget.actual}</figcaption>
    </figure>
  )
}

function Budget({ budget }: { budget: BudgetReport }) {
  if (budget.lines.length === 0) return <Section title={A.budget.title}><p>{A.budget.empty}</p></Section>
  return (
    <Section title={A.budget.title}>
      <BudgetChart budget={budget} />
      <table className="bm-annual-table">
        <thead><tr><th>{A.budget.category}</th><th>{A.budget.planned}</th><th>{A.budget.actual}</th><th>{A.budget.variance}</th><th>{A.budget.used}</th></tr></thead>
        <tbody>
          {budget.lines.map((l) => (
            <tr key={l.category}>
              <td>{l.category}</td><td className="bm-num">{formatILS(l.planned)}</td><td className="bm-num">{formatILS(l.actual)}</td>
              <td className={`bm-num${l.variance < 0 ? ' bm-annual-over' : ''}`}>{formatILS(l.variance)}</td>
              <td className="bm-num">{l.used === null ? '—' : A.budget.usedPct(l.used)}</td>
            </tr>
          ))}
          <tr className="bm-annual-total"><td>{A.budget.total}</td><td className="bm-num">{formatILS(budget.planned)}</td><td className="bm-num">{formatILS(budget.actual)}</td><td className="bm-num">{formatILS(budget.variance)}</td><td /></tr>
        </tbody>
      </table>
    </Section>
  )
}

function Fund({ fund }: { fund: FundBalance }) {
  const end = fund.endIsToday ? A.fund.today(formatDate(fund.endDate)) : A.fund.end(formatDate(fund.endDate))
  return (
    <Section title={A.fund.title}>
      <table className="bm-annual-table">
        <tbody>
          <tr><td>{A.fund.start(formatDate(fund.startDate))}</td><td className="bm-num">{formatILS(fund.start)}</td></tr>
          <tr><td>{end}</td><td className="bm-num">{formatILS(fund.end)}</td></tr>
          <tr className="bm-annual-total"><td>{A.fund.change}</td><td className="bm-num">{formatILS(fund.change)}</td></tr>
        </tbody>
      </table>
    </Section>
  )
}

function Collection({ report }: { report: AnnualReport }) {
  const c = report.collection
  return (
    <Section title={A.collection.title}>
      <p className="bm-annual-dim">{A.collection.asOf(monthLabel(c.month))}</p>
      <p className="bm-annual-big">{A.collection.line(c.paidUp, c.total)}</p>
      <div className="bm-annual-meter" aria-hidden="true"><span style={{ width: pct(c.paidUp, c.total) }} /></div>
      <table className="bm-annual-table">
        <tbody>
          <tr><td>{A.collection.paidUp}</td><td className="bm-num">{c.paidUp}</td></tr>
          <tr><td>{A.collection.owing}</td><td className="bm-num">{c.owing}</td></tr>
        </tbody>
      </table>
    </Section>
  )
}

function Appendix({ rows }: { rows: AppendixRow[] }) {
  const H = A.appendix
  return (
    <Section title={H.title} className="bm-annual-appendix">
      <table className="bm-annual-table">
        <thead><tr><th>{H.apartment}</th><th>{H.charged}</th><th>{H.paid}</th><th>{H.balance}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.number}><td>{r.number}</td><td className="bm-num">{formatILS(r.charged)}</td><td className="bm-num">{formatILS(r.paid)}</td><td className="bm-num">{formatILS(r.balance)}</td></tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

/** "דוח שנתי": the same document on screen and in print (A4, a cover page, sections that keep tables and charts whole). */
export function AnnualReportDocument({ report, building, today, notes }: AnnualDocumentProps) {
  return (
    <article className="bm-annual" dir="rtl">
      <Cover report={report} building={building} today={today} />
      <Income report={report} />
      <Expenses table={report.expenses} />
      <Budget budget={report.budget} />
      {report.fund && <Fund fund={report.fund} />}
      <Collection report={report} />
      {notes.trim() && <Section title={A.notes.title}><p className="bm-pre">{notes.trim()}</p></Section>}
      {report.appendix && <Appendix rows={report.appendix} />}
    </article>
  )
}
