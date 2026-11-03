/** One page of a query: rows `from` to `to` inclusive (PostgREST answers at most `max_rows`, 1000 on Supabase). */
export type PageQuery<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export const PAGE_SIZE = 1000

/**
 * Every row of a query, page by page, until a short page comes back. `page` must build a fresh, stably ordered query
 * for each range, e.g. `(f, t) => supabase.from('x').select('a').order('id').range(f, t)`.
 */
export async function fetchAll<T>(page: PageQuery<T>, size: number = PAGE_SIZE): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < size) return all
  }
}
