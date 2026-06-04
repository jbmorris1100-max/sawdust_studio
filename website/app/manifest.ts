import type { MetadataRoute } from 'next';

// PWA manifest — enables "Add to Home Screen" / standalone launch, which is
// required for Web Push to work on iOS (notifications only fire from the
// home-screen PWA, not Safari tabs).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'InlineIQ',
    short_name: 'InlineIQ',
    description: 'Shop floor management for cabinet and millwork shops.',
    start_url: '/app',
    display: 'standalone',
    background_color: '#050608',
    theme_color: '#050608',
    icons: [
      { src: '/inlineiq-logo.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/inlineiq-logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
