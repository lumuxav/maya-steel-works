export default function manifest() {
  return {
    name: 'Maya Steel Works Management',
    short_name: 'Maya Steel',
    description: 'Stock, sales, production, cash and business management for Maya Steel Works.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    background_color: '#f4f7fb',
    theme_color: '#1f3f70',
    orientation: 'any',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Inventory', short_name: 'Stock', url: '/inventory', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
      { name: 'New Sale', short_name: 'Sales', url: '/sales', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
      { name: 'Cash & Banking', short_name: 'Cash', url: '/cashbook', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
    ],
  }
}
