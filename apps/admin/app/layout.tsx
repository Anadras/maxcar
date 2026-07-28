import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MAXCAR — Media Network',
  description: 'Operação inteligente de mídia em movimento.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
