import type { Metadata } from 'next';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Eurorack Panel Generator',
  description:
    'Turn a photo of a Eurorack module into a customisable, 3D-printable faceplate. Exports STL and 3MF.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Settles the theme before anything is drawn. Without this every load
            flashes the wrong one for a frame. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
