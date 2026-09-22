import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono } from 'next/font/google';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';

/**
 * The two brand faces, self-hosted by next/font rather than fetched from
 * Google at run time: one request fewer on every load, and no third party in
 * the path.
 *
 * Bricolage is variable, and its optical-size axis is the reason to take the
 * variable cut: the wordmark is specified at opsz 96 while the same face sets
 * interface text at reading size, and only the axis lets one file do both.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-display',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  // Not --font-mono: Tailwind defines a token of that name from the theme,
  // and the two would overwrite each other on :root.
  variable: '--font-mono-face',
});

export const metadata: Metadata = {
  title: 'Panelmate',
  description:
    'Design matching Eurorack faceplates from a photo of any module, so a rack of '
    + 'mismatched hardware ends up looking like one instrument. Exports STL and 3MF.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Settles the theme before anything is drawn. Without this every load
            flashes the wrong one for a frame. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
