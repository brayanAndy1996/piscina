import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: 'Academia de natación', description: 'Base de la plataforma de gestión' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
