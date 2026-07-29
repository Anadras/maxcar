'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import type { AppRole } from '@maxcar/shared';
import { logout } from '@/app/(auth)/actions';
import { ROLE_LABELS } from '@/lib/auth/access';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles?: AppRole[];
}

const overviewNav: NavItem[] = [{ label: 'Dashboard', href: '/', icon: '▦' }];

const commercialNav: NavItem[] = [
  {
    label: 'Clientes',
    href: '/clientes',
    icon: '◇',
    roles: ['super_admin', 'admin', 'commercial'],
  },
  { label: 'Estabelecimentos', href: '/estabelecimentos', icon: '⌂' },
  { label: 'Campanhas', href: '/campanhas', icon: '◉' },
  { label: 'Geofences', href: '/geofences', icon: '◎' },
];

const operationsNav: NavItem[] = [
  {
    label: 'Motoristas',
    href: '/motoristas',
    icon: '♙',
    roles: ['super_admin', 'admin', 'operations'],
  },
  {
    label: 'Veículos',
    href: '/veiculos',
    icon: '◆',
    roles: ['super_admin', 'admin', 'operations'],
  },
  {
    label: 'Dispositivos',
    href: '/dispositivos',
    icon: '▣',
    roles: ['super_admin', 'admin', 'operations'],
  },
  { label: 'Tablet / Player', href: '/player', icon: '▷' },
];

const adminNav: NavItem[] = [
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

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: 'VISÃO GERAL', items: overviewNav },
  { label: 'COMERCIAL', items: commercialNav },
  { label: 'OPERAÇÃO', items: operationsNav },
  { label: 'ADMINISTRAÇÃO', items: adminNav },
];

export function AppShell({
  children,
  user,
  environment,
}: {
  children: ReactNode;
  user: { name: string; email: string; role: AppRole };
  environment: string;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.roles || item.roles.includes(user.role),
      ),
    }))
    .filter((group) => group.items.length > 0);
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
          {visibleGroups.map((group, index) => (
            <div key={group.label}>
              <p
                className={`nav-label ${index > 0 ? 'nav-label-secondary' : ''}`}
              >
                {group.label}
              </p>
              {group.items.map(({ label, href, icon }) => (
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
            </div>
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
            <i /> AMBIENTE <strong>{environment.toUpperCase()}</strong>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
