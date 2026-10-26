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

  it('without numbers, a short line right after a finished sentence counts as standalone', () => {
    expect(parseAgendaDraft('מבוא\nסוף משפט.\nכותרת חדשה\nגוף הנושא.').map((t) => t.title)).toEqual(['מבוא', 'כותרת חדשה'])
  })

  it('once there are numbered lines, headings do not start topics', () => {
    expect(parseAgendaDraft('1. נושא\nסוף משפט.\nכותרת קצרה\nגוף.').map((t) => t.title)).toEqual(['נושא'])
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

  it('text before the first numbered line is dropped, not merged into topic 1', () => {
    const text = 'הקדמה לאסיפה השנתית.\nעוד שורת פתיחה\n\n1. תקציב\nפרטים.\n2. שונות'
    expect(parseAgendaDraft(text)).toEqual([
      { title: 'תקציב', discussion: 'פרטים.' },
      { title: 'שונות', discussion: '' },
    ])
  })

  it('a typical Hebrew invitation letter gives exactly its numbered items', () => {
    const letter = [
      'ועד הבית - רחוב הדקל 5, תל אביב', 'טלפון 03-5551234', '', 'תאריך: 1.11.2026', '', 'לכבוד', 'דיירי הבניין', '',
      'הנדון: זימון לאסיפת דיירים כללית', '', 'שלום רב,', 'הנכם מוזמנים לאסיפת דיירים שתתקיים ביום שלישי 17.11.2026 בשעה 19:30 בלובי.',
      '', 'סדר היום:', '1. אישור פרוטוקול האסיפה הקודמת', '2. אישור תקציב 2027', '3. שיפוץ הלובי', '4. שונות', '',
      'דייר שאינו יכול להגיע מתבקש להביא איתו:', 'ייפוי כוח חתום', 'העתק תעודת זהות', '', 'בכבוד רב,', 'ועד הבית', 'רות כהן, יו"ר',
    ].join('\n')
    const topics = parseAgendaDraft(letter)
    expect(topics.map((t) => t.title)).toEqual(['אישור פרוטוקול האסיפה הקודמת', 'אישור תקציב 2027', 'שיפוץ הלובי', 'שונות'])
    expect(topics[3].discussion).toBe('דייר שאינו יכול להגיע מתבקש להביא איתו:\nייפוי כוח חתום\nהעתק תעודת זהות')
    expect(topics.map((t) => t.discussion).join(' ')).not.toMatch(/לכבוד|הנדון|בכבוד רב|ועד הבית/)
  })

  it('"נושאים שיעלו באסיפה" with bullet topics and "–" sub-points', () => {
    const agenda = [
      'נושאים שיעלו באסיפה', '', '• שיפוץ הלובי', '– הוצגו שלוש הצעות מחיר', '– לוח זמנים: חודשיים', '',
      '• החלפת קבלן הגינון', '– הקבלן הנוכחי מסיים בדצמבר', '• שונות',
    ].join('\n')
    expect(parseAgendaDraft(agenda)).toEqual([
      { title: 'שיפוץ הלובי', discussion: '– הוצגו שלוש הצעות מחיר\n– לוח זמנים: חודשיים' },
      { title: 'החלפת קבלן הגינון', discussion: '– הקבלן הנוכחי מסיים בדצמבר' },
      { title: 'שונות', discussion: '' },
    ])
  })

  it('"נושאים שיעלו באסיפה" with plain topic lines and "–" sub-points', () => {
    const agenda = 'נושאים שיעלו באסיפה:\n\nשיפוץ הלובי\n– שלוש הצעות מחיר\n\nגינון\n– החלפת קבלן'
    expect(parseAgendaDraft(agenda)).toEqual([
      { title: 'שיפוץ הלובי', discussion: '– שלוש הצעות מחיר' },
      { title: 'גינון', discussion: '– החלפת קבלן' },
    ])
  })

  it('stops at a sign-off (בברכה, בכבוד רב, בתודה)', () => {
    for (const end of ['בברכה,', 'בכבוד רב', 'בתודה מראש']) {
      expect(parseAgendaDraft(`1. תקציב\nפרטים.\n${end}\nועד הבית`)).toEqual([{ title: 'תקציב', discussion: 'פרטים.' }])
    }
  })

  it('Hebrew numerals טו / טז count; יה / יו do not', () => {
    expect(parseAgendaDraft('יד. נושא א\nטו. נושא ב\nטז) נושא ג\nיה. לא נושא').map((t) => t.title)).toEqual(['נושא א', 'נושא ב', 'נושא ג'])
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
