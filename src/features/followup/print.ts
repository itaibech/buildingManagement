import { he } from '../../lib/he'

/** window.print() with the PDF file name "מכתב-התראה-דירה-N-<date>" (the title is restored afterwards). */
export function printLetter(number: number, today: string): void {
  const previous = document.title
  document.title = he.followup.letter.docTitle(number, today)
  try {
    window.print()
  } finally {
    document.title = previous
  }
}
