export default function Loading() {
  return (
    <main className="page-wrap maya-route-loading" aria-busy="true" aria-label="Loading Maya page">
      <div className="maya-loading-bar" style={{ height: 26, width: '52%', maxWidth: 300 }} />
      <div className="maya-loading-bar" style={{ height: 108, width: '100%' }} />
      <div className="maya-loading-bar" style={{ height: 74, width: '100%' }} />
      <div className="maya-loading-bar" style={{ height: 74, width: '100%' }} />
    </main>
  )
}
