import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Explainer',
  description: 'A script becomes a narrated, animated 2D explainer video, drawn by code in the browser.',
  robots: { index: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* The canvas draws with Inter; it falls back to the system font while this loads. */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..900&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
