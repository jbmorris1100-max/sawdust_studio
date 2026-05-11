import type { Metadata } from 'next';
import { Inter_Tight, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const interTight = Inter_Tight({
  variable: '--font-inter-tight',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'InlineIQ — Keep your shop sharp.',
  description:
    'The 1–2 tap shop floor system that captures every minute, every part, and every dollar — then turns it into the data your bids have always been missing.',
  openGraph: {
    title: 'InlineIQ — Keep your shop sharp.',
    description:
      'The 1–2 tap shop floor system for custom fabrication shops. Real-time labor tracking, AI morning brief, job costing intelligence.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'InlineIQ — Keep your shop sharp.',
    description: 'The 1–2 tap shop floor system for custom fabrication shops.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">{children}</body>
    </html>
  );
}
