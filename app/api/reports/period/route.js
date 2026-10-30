import { createClient } from '@supabase/supabase-js'
import { handlePeriodReport } from '../../../../lib/mayaPeriodApi.mjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req) {
  return handlePeriodReport(req, { createClient })
}
