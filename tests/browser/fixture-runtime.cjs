// Loaded only by the isolated browser test child; never by the production app.
const OriginalDate = Date
const fixed = new OriginalDate('2026-11-04T10:00:00Z').getTime()
global.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [fixed])) }
  static now() { return fixed }
  static parse(value) { return OriginalDate.parse(value) }
  static UTC(...args) { return OriginalDate.UTC(...args) }
}
const originalFetch = global.fetch
global.fetch = (input, options) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith('https://ci-placeholder.supabase.co/')) {
    return originalFetch(url.replace('https://ci-placeholder.supabase.co', 'http://127.0.0.1:3107'), options)
  }
  return originalFetch(input, options)
}
