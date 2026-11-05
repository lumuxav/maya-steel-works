// Menu of Maya Branch raw-stock batches that can be used for a production standard.
//
// The matching rule lives in ONE place: public.maya_recipe_batches() in Supabase
// (supabase/migrations/20261105_maya_raw_stock_matching.sql). The same rule is enforced
// again when the production is saved, so the menu and the save can never disagree.
// Production and Make & Sell both use this helper - do not re-implement the matching
// in the browser.

export async function fetchRecipeBatches(supabase, rec) {
  const { data, error } = await supabase.rpc('maya_recipe_batches', { p_recipe_id: rec.id })
  if (error) {
    return { rows: [], note: { type: 'error', text: `Could not load stock for this standard: ${error.message}` } }
  }
  const rows = data || []
  if (rows.length > 0) return { rows, note: null }
  const wanted = [rec.raw_category, rec.raw_gauge, rec.raw_size].filter(Boolean).join(' ')
  return {
    rows,
    note: { type: 'warn', text: `No Maya Branch stock currently matches "${wanted}". Receive the stock first, or ask the boss to check this standard.` },
  }
}

export const batchLabel = (b) => {
  const name = [b.category, b.gauge, b.size_dimensions].filter(Boolean).join(' ')
  const received = new Date(b.created_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala' })
  return `${name} · ${Number(b.quantity).toLocaleString()} ${b.unit} · received ${received}`
}

export const batchNoteClass = (note) =>
  note?.type === 'error' ? 'text-red-500' : note?.type === 'warn' ? 'text-amber-500' : 'text-muted'
