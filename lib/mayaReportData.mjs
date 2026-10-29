// Follow every page, including projects configured with a smaller response cap.
// Never present an incomplete or failed query as a zero-valued financial report.
export async function readAllRows(makeQuery, pageSize = 500) {
  const rows = []
  const seen = new Set()
  let expected = null
  for (;;) {
    const { data, error, count } = await makeQuery()
      .order('id', { ascending: true }).range(rows.length, rows.length + pageSize - 1)
    if (error) throw new Error('Financial records could not be loaded. Please retry.')
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('The database did not confirm the complete record count. Please retry.')
    }
    if (expected !== null && count !== expected) throw new Error('Records changed while loading. Refresh the report.')
    expected = count
    for (const row of data) {
      if (row.id == null || seen.has(String(row.id))) throw new Error('Records changed while loading. Refresh the report.')
      seen.add(String(row.id))
      rows.push(row)
    }
    if (rows.length === expected) return rows
    if (!data.length || rows.length > expected || rows.length > 100000) {
      throw new Error('The complete financial history could not be loaded. Please contact management.')
    }
  }
}
