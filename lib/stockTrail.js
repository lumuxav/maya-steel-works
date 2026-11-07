// Shared look-and-wording for the stock history (Stock Movements page and each item's
// Lifecycle page), so a movement reads the same wherever it is shown.
//
// Where the rows come from:
//   * public.maya_stock_trail()  (supabase/migrations/20261106_maya_stock_trail.sql) returns the
//     whole Maya Branch history with item names, who did it and a running balance.
//   * stock_movements rows themselves are written ONLY inside the database functions
//     (receive delivery, production, sale, custom job, stocktake), in the same transaction as the stock
//     change, so the history can never drift from the quantity on the shelf.

export const MOVE_META = {
  received: { label: 'Received', icon: '📥', card: 'border-green-500/35 bg-green-500/10', accent: 'text-green-600' },
  used_in_production: { label: 'Used in production', icon: '🏭', card: 'border-purple-500/35 bg-purple-500/10', accent: 'text-purple-600' },
  produced: { label: 'Produced', icon: '✅', card: 'border-blue-500/35 bg-blue-500/10', accent: 'text-blue-600' },
  used_in_job: { label: 'Used in custom job', icon: '🔧', card: 'border-orange-500/35 bg-orange-500/10', accent: 'text-orange-600' },
  sold: { label: 'Sold', icon: '💰', card: 'border-amber-500/35 bg-amber-500/10', accent: 'text-amber-600' },
  stocktake_adjustment: { label: 'Count correction', icon: '📋', card: 'border-red-500/35 bg-red-500/10', accent: 'text-red-600' },
}

export const moveMeta = (type) =>
  MOVE_META[type] || {
    label: String(type || 'Movement').replace(/_/g, ' '),
    icon: '•',
    card: 'border-[var(--line)] bg-[var(--panel)]',
    accent: 'text-accent',
  }

export const fmtQty = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 3 })

export const fmtSigned = (n) => {
  const v = Number(n)
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtQty(Math.abs(v))}`
}

export const fmtWhen = (iso) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Kampala', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

// YYYY-MM-DD in Kampala, for the date filters
export const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })

export const TRAIL_LIMIT = 1000

export async function fetchStockTrail(supabase, limit = TRAIL_LIMIT) {
  const { data, error } = await supabase.rpc('maya_stock_trail', { p_limit: limit })
  if (error) return { rows: [], error: error.message }
  return { rows: data || [], error: null }
}

// Running balance for one item's movements, oldest first. `hiddenSum` is the total of movements
// that are not shown (transfers), so the check against current stock still adds up.
export function withBalances(moves) {
  let bal = 0
  return moves.map((m) => {
    bal += Number(m.quantity_change)
    return { ...m, balance_after: bal }
  })
}

export function summarise(moves, allMovesSum, currentQty) {
  let added = 0
  let removed = 0
  for (const m of moves) {
    const v = Number(m.quantity_change)
    if (v > 0) added += v
    else removed += -v
  }
  const diff = Number(currentQty) - Number(allMovesSum)
  return { added, removed, reconciles: Math.abs(diff) < 0.0005, diff }
}
