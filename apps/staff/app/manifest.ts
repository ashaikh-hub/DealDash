import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DealDash Staff',
    short_name: 'DealDash Staff',
    description: 'Scan, validate and redeem',
    start_url: '/en',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F8F9FD',
    theme_color: '#5B1AFC',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
