import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tryout',
  description: 'Do the job, not watch it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
