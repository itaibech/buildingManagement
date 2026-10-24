import { he } from '../../lib/he'

/** Picker options: "דירה N · resident names", so typing a resident's name finds the apartment too. */
export function apartmentOptions(
  apartments: { id: string; number: number }[],
  residents: { apartment_id: string; full_name: string }[],
): { value: string; label: string; number: number }[] {
  return apartments.map((a) => {
    const names = residents.filter((r) => r.apartment_id === a.id).map((r) => r.full_name).join(', ')
    return { value: a.id, label: names ? `${he.apartment(a.number)} · ${names}` : he.apartment(a.number), number: a.number }
  })
}
