import Link from 'next/link'

// Shown under the "Production standard" menu (Production and Make & Sell).
// Stock batches can only be chosen after a standard is picked, so an empty standards
// menu looks like "the raw material is missing". This says what to do instead.
export default function StandardsHint({ loaded, count, isAdmin }) {
  if (!loaded) return null
  if (count === 0) {
    return (
      <p className="mt-2 text-xs text-amber-500">
        No production standards yet.{' '}
        {isAdmin
          ? <Link href="/recipes" className="font-bold underline">Add the first one →</Link>
          : 'Ask an admin to add one.'}
      </p>
    )
  }
  return isAdmin
    ? <p className="mt-2 text-xs text-muted"><Link href="/recipes" className="underline">Manage production standards</Link></p>
    : null
}
