import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Eurorack Panel Generator',
  description:
    'Turn a photo of a Eurorack module into a customisable, 3D-printable faceplate. Exports STL and 3MF.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  );
}
