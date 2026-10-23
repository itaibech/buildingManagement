import { he } from '../lib/he'

export interface AptPlateProps {
  number: number
  size?: 'sm' | 'md' | 'lg'
}

/** The enamel house-number sign. Used wherever an apartment is identified, and nowhere else. */
export function AptPlate({ number, size = 'md' }: AptPlateProps) {
  return (
    <span className="bm-plate" data-size={size} role="img" aria-label={he.apartment(number)}>
      <span aria-hidden="true">{number}</span>
    </span>
  )
}

/** The app's identity mark: the same enamel sign, carrying "ניהול בניין" instead of a number. */
export function PlateMark() {
  return (
    <span className="bm-plate" data-size="mark">
      {he.appName}
    </span>
  )
}
