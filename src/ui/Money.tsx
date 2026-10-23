import { Text } from '@mantine/core'
import { formatILS } from '../lib/format'
import { he } from '../lib/he'

export interface MoneyProps {
  amount: number
  tone?: 'auto' | 'neutral'
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

type Tone = 'debt' | 'paid' | 'neutral'

const FONT_SIZE: Record<NonNullable<MoneyProps['size']>, string> = {
  sm: '1rem',
  md: '1.125rem',
  lg: '1.75rem',
  xl: '2.25rem',
}
// paid.7 rather than paid.6 so small amounts stay AA on white.
const COLOR: Record<Tone, string | undefined> = { debt: 'debt.6', paid: 'paid.7', neutral: undefined }

function toneOf(amount: number, tone: MoneyProps['tone']): Tone {
  if (tone === 'neutral') return 'neutral'
  return amount > 0 ? 'debt' : 'paid'
}

/** A ₪ amount: > 0 owed (debt), 0 settled (paid), < 0 credit (paid, absolute value + "זיכוי"). */
export function Money({ amount, tone = 'auto', size = 'md' }: MoneyProps) {
  const t = toneOf(amount, tone)
  const credit = tone === 'auto' && amount < 0
  return (
    <Text component="span" className="bm-display bm-num" data-tone={t} c={COLOR[t]} fz={FONT_SIZE[size]}>
      {formatILS(credit ? Math.abs(amount) : amount)}
      {credit && ` ${he.credit}`}
    </Text>
  )
}
