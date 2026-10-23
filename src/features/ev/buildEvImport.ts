// Turns the parsed EV workbook into the payload for rpc('import_ev'): chargers with their readings, derived rates
// and (optionally) the "שולם" payments.

export type EvImportPayload = {
  chargers: { apartment: number; initial_reading: number; readings: { month: string; reading: number }[] }[]
  rates: { effective_from: string; rate: number }[]
  payments: { apartment: number; paid_on: string; amount: number }[]
}
