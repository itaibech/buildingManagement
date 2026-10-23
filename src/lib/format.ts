import { HEBREW_MONTHS } from './he'

export { HEBREW_MONTHS }

const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })

export function formatILS(n: number): string {
  return ils.format(n)
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatDate(d: string | Date): string {
  if (typeof d === 'string') {
    const [y, m, day] = d.slice(0, 10).split('-')
    return `${day}/${m}/${y}`
  }
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  return `${HEBREW_MONTHS[Number(m) - 1]} ${y}`
}
