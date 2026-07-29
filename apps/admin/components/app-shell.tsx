'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import type { AppRole } from '@maxcar/shared';
import { logout } from '@/app/(auth)/actions';
import { ROLE_LABELS } from '@/lib/auth/access';

const nav: Array<{
  label: string;
  href: string;
  icon: string;
  roles?: AppRole[];
}> = [
  { label: 'Dashboard', href: '/', icon: '▦' },
  { label: 'Campanhas', href: '/campanhas', icon: '◉' },
  {
    label: 'Clientes',
    href: '/clientes',
    icon: '◇',
    roles: ['super_admin', 'admin', 'commercial'],
  },
  { label: 'Estabelecimentos', href: '/estabelecimentos', icon: '⌂' },
  {
    label: 'Veículos',
    href: '/veiculos',
    icon: '◆',
    roles: ['super_admin', 'admin', 'operations'],
  },
  {
    label: 'Motoristas',
    href: '/motoristas',
    icon: '♙',
    roles: ['super_admin', 'admin', 'operations'],
  },
  {
    label: 'Dispositivos',
    href: '/dispositivos',
    icon: '▣',
    roles: ['super_admin', 'admin', 'operations'],
  },
  { label: 'Geofences', href: '/geofences', icon: '◎' },
  { label: 'Tablet / Player', href: '/player', icon: '▷' },
  { label: 'Relatórios', href: '/relatorios', icon: '▥' },
  {
    label: 'Usuários',
    href: '/usuarios',
    icon: '♧',
    roles: ['super_admin', 'admin'],
  },
  { label: 'Meu perfil', href: '/perfil', icon: '◌' },
  { label: 'Configurações', href: '/configuracoes', icon: '⚙' },
];

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string; email: string; role: AppRole };
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleNav = nav.filter(
    (item) => !item.roles || item.roles.includes(user.role),
  );
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MAXCAR</strong>
            <span>MEDIA NETWORK</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
          >
            ×
          </button>
        </div>
        <nav aria-label="Navegação principal">
          <p className="nav-label">OPERAÇÃO</p>
          {visibleNav
            .filter((item) => nav.indexOf(item) < 9)
            .map(({ label, href, icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={pathname === href ? 'active' : ''}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </Link>
            ))}
          <p className="nav-label nav-label-secondary">GESTÃO</p>
          {visibleNav
            .filter((item) => nav.indexOf(item) >= 9)
            .map(({ label, href, icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={pathname === href ? 'active' : ''}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </Link>
            ))}
        </nav>
        <div className="pilot-card">
          <div>
            <i /> PILOTO ATIVO
          </div>
          <strong>Campo Grande, MS</strong>
          <span>Monitoramento via Supabase</span>
        </div>
        <div className="user-card">
          <div className="avatar">{initials}</div>
          <div>
            <Link href="/perfil">
              <strong>{user.name}</strong>
            </Link>
            <span>{ROLE_LABELS[user.role]}</span>
          </div>
          <form action={logout}>
            <button type="submit" aria-label={`Sair da conta ${user.email}`}>
              ↪
            </button>
          </form>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="sidebar-overlay"
          onClick={() => setMenuOpen(false)}
          aria-label="Fechar navegação"
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
          >
            ☰
          </button>
          <div className="live-status">
            <i /> REDE OPERACIONAL <strong>98,7%</strong>
          </div>
          <div className="top-actions">
            <span>
              Última atualização <strong>agora</strong>
            </span>
            <button className="notification-button" aria-label="Notificações">
              ●<small>3</small>
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
