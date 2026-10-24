/** Israeli phone in the house style: mobile 05X-XXXXXXX, landline 0X-XXXXXXX. Anything else is returned trimmed. */
export function formatPhone(raw: string): string {
  const v = raw.trim()
  const digits = v.replace(/\D/g, '')
  if (/^05\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  if (/^0[2-9]\d{7}$/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return v
}
