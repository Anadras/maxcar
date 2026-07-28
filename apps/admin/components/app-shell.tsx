'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';

const nav = [
  ['Dashboard', '/', '▦'],
  ['Campanhas', '/campanhas', '◉'],
  ['Clientes', '/clientes', '◇'],
  ['Estabelecimentos', '/estabelecimentos', '⌂'],
  ['Veículos', '/veiculos', '◆'],
  ['Motoristas', '/motoristas', '♙'],
  ['Dispositivos', '/dispositivos', '▣'],
  ['Geofences', '/geofences', '◎'],
  ['Tablet / Player', '/player', '▷'],
  ['Relatórios', '/relatorios', '▥'],
  ['Configurações', '/configuracoes', '⚙'],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

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
          {nav.slice(0, 9).map(([label, href, icon]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={pathname === href ? 'active' : ''}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {label === 'Dispositivos' && <small>3</small>}
            </Link>
          ))}
          <p className="nav-label nav-label-secondary">GESTÃO</p>
          {nav.slice(9).map(([label, href, icon]) => (
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
          <span>48 veículos monitorados</span>
        </div>
        <div className="user-card">
          <div className="avatar">AM</div>
          <div>
            <strong>André Martins</strong>
            <span>Administrador</span>
          </div>
          <button aria-label="Opções do usuário">⋮</button>
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
