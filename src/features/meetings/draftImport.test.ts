import { describe, expect, it } from 'vitest'
import { draftProblem, parseAgendaDraft } from './draftImport'
import { withDraft, type AgendaRow } from './formModel'

describe('parseAgendaDraft', () => {
  it('numbered lines start topics: 1. 2) א. and the text after them is the details', () => {
    const text = '1. אישור תקציב 2027\nהצעת התקציב מצורפת.\n2) שיפוץ הלובי\nשלוש הצעות מחיר.\nא. בחירת ועד\nמועמדים: רות, דני.'
    expect(parseAgendaDraft(text)).toEqual([
      { title: 'אישור תקציב 2027', discussion: 'הצעת התקציב מצורפת.' },
      { title: 'שיפוץ הלובי', discussion: 'שלוש הצעות מחיר.' },
      { title: 'בחירת ועד', discussion: 'מועמדים: רות, דני.' },
    ])
  })

  it('a short line right after a finished sentence counts as standalone', () => {
    expect(parseAgendaDraft('1. נושא\nסוף משפט.\nכותרת חדשה\nגוף הנושא.').map((t) => t.title)).toEqual(['נושא', 'כותרת חדשה'])
  })

  it('a short standalone heading followed by body text starts a topic', () => {
    const text = 'שיפוץ הלובי\nהוועד קיבל שלוש הצעות מחיר.\nההצעה הזולה: 45,000 ₪.\n\nגינון:\nהחלפת קבלן הגינון.'
    expect(parseAgendaDraft(text)).toEqual([
      { title: 'שיפוץ הלובי', discussion: 'הוועד קיבל שלוש הצעות מחיר.\nההצעה הזולה: 45,000 ₪.' },
      { title: 'גינון', discussion: 'החלפת קבלן הגינון.' },
    ])
  })

  it('a line ending with a period, a long line or a line without body text is not a heading', () => {
    const long = 'א'.repeat(61)
    expect(parseAgendaDraft(`1. נושא\n\nזו שורה קצרה.\n${long}\nהמשך הפסקה בלי נקודה\nסוף.`)).toEqual([
      { title: 'נושא', discussion: `זו שורה קצרה.\n${long}\nהמשך הפסקה בלי נקודה\nסוף.` },
    ])
    expect(parseAgendaDraft('כותרת בודדת')).toEqual([])
  })

  it('bullets (- • –) are details of the current topic, never topics', () => {
    const text = '1. ניקיון\n- החלפת חברה\n• הגדלת שעות\n– פעמיים בשבוע'
    expect(parseAgendaDraft(text)).toEqual([{ title: 'ניקיון', discussion: '- החלפת חברה\n• הגדלת שעות\n– פעמיים בשבוע' }])
  })

  it('text before the first topic goes into the first topic', () => {
    const text = 'סדר היום לאסיפה השנתית.\n\n1. תקציב\nפרטים.\n2. שונות'
    expect(parseAgendaDraft(text)).toEqual([
      { title: 'תקציב', discussion: 'סדר היום לאסיפה השנתית.\n\nפרטים.' },
      { title: 'שונות', discussion: '' },
    ])
  })

  it('collapses blank-line runs, trims, and drops PDF direction marks and stray spaces', () => {
    const text = '\r\n‏1.   תקציב  \r\n\r\n\r\n\r\n  שורה ראשונה  \n\n\n\nשורה שנייה\n\n\n'
    expect(parseAgendaDraft(text)).toEqual([{ title: 'תקציב', discussion: 'שורה ראשונה\n\nשורה שנייה' }])
  })

  it('a number alone on its line takes the next line as the title; "1.אישור" without a space still counts', () => {
    expect(parseAgendaDraft('1.\nתקציב\nפרטים.\n2.שונות')).toEqual([
      { title: 'תקציב', discussion: 'פרטים.' },
      { title: 'שונות', discussion: '' },
    ])
  })

  it('decimals, years and Hebrew words with a period are not numbering', () => {
    expect(parseAgendaDraft('1. תקציב\n1.5 מיליון ₪ לשנה.\n2026. שנה טובה.\nלא. כן.')).toEqual([
      { title: 'תקציב', discussion: '1.5 מיליון ₪ לשנה.\n2026. שנה טובה.\nלא. כן.' },
    ])
  })

  it('returns no topics for empty or topic-less text', () => {
    expect(parseAgendaDraft('')).toEqual([])
    expect(parseAgendaDraft('רק משפט אחד ארוך שמסתיים בנקודה.')).toEqual([])
  })

  it('keeps titles and details within the DB limits', () => {
    const [t] = parseAgendaDraft(`1. ${'א'.repeat(400)}\n${'ב'.repeat(12000)}`)
    expect(t.title).toHaveLength(300)
    expect(t.discussion).toHaveLength(10000)
  })
})

describe('draftProblem', () => {
  it('refuses 0 topics and more than 30', () => {
    const topics = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `נושא ${i + 1}`, discussion: '' }))
    expect(draftProblem([])).toBe('empty')
    expect(draftProblem(topics(30))).toBeNull()
    expect(draftProblem(topics(31))).toBe('tooMany')
    expect(draftProblem(parseAgendaDraft(Array.from({ length: 31 }, (_, i) => `${i + 1}. נושא`).join('\n')))).toBe('tooMany')
  })
})

describe('withDraft', () => {
  const rows: AgendaRow[] = [{ key: 'a', id: 'i1', title: 'קיים', discussion: '' }, { key: 'b', title: '', discussion: '' }]
  const topics = [{ title: 'חדש', discussion: 'פרטים' }]
  it('replace: only the imported topics', () => {
    expect(withDraft(rows, topics, 'replace').map((r) => [r.id, r.title, r.discussion])).toEqual([[undefined, 'חדש', 'פרטים']])
  })
  it('append: after the filled-in rows, empty rows dropped', () => {
    expect(withDraft(rows, topics, 'append').map((r) => r.title)).toEqual(['קיים', 'חדש'])
  })
})
