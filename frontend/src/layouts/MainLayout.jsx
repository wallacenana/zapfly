import React from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  MessageSquare,
  Share2,
  Settings,
  Globe,
  LogOut,
  ClipboardList,
  Calendar,
  MessageCircle,
  Zap,
  Users,
  ExternalLink,
  CreditCard,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PUBLIC_SITE_URL } from '../api';

const MainLayout = ({ clientMode = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const isSuperAdmin = String(user?.role || '').toLowerCase() === 'superadmin';
  const storeSlug = String(user?.slug || '').trim();
  const storeUrl = storeSlug ? `${PUBLIC_SITE_URL}/${storeSlug}` : '';
  const brandLogo = '/logo%20HotWhats.png';

  const adminMenuItems = [
    { path: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { path: '/chat', icon: <MessageCircle size={20} />, label: 'Chat' },
    { path: '/estoque', icon: <Package size={20} />, label: 'Estoque' },
    { path: '/production', icon: <ClipboardList size={20} />, label: 'Produção' },
    { path: '/agenda', icon: <Calendar size={20} />, label: 'Agenda' },
    { path: '/flows', icon: <Zap size={20} />, label: 'Automação' },
    { path: '/connections', icon: <Share2 size={20} />, label: 'Conexões' },
    { path: '/prompts', icon: <MessageSquare size={20} />, label: 'Prompts' },
    { path: '/site-settings', icon: <Globe size={20} />, label: 'Cardápio' },
    ...(isSuperAdmin ? [{ path: '/users', icon: <Users size={20} />, label: 'Usuários' }] : []),
    ...(isSuperAdmin ? [{ path: '/billing', icon: <CreditCard size={20} />, label: 'Planos e cobrança' }] : []),
    { path: '/settings', icon: <Settings size={20} />, label: 'Configurações' },
  ];
  const clientMenuItems = [
    { path: '/conta', icon: <UserRound size={20} />, label: 'Minha conta' },
    { path: '/comprar', icon: <CreditCard size={20} />, label: 'Planos e cobrança' },
  ];
  const menuItems = clientMode ? clientMenuItems : adminMenuItems;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: '#f6f8f3',
        color: '#0f172a',
        overflow: 'hidden',
        '--bg-primary': '#f6f8f3',
        '--bg-secondary': '#ffffff',
        '--bg-tertiary': '#eef5ea',
        '--text-primary': '#0f172a',
        '--text-secondary': '#475569',
        '--text-muted': '#64748b',
        '--border-color': '#d9e5d2',
        '--accent-primary': '#5db72c',
        '--accent-glow': 'rgba(93, 183, 44, 0.14)',
        '--card-shadow': '0 12px 30px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div
        style={{
          width: '260px',
          minWidth: '260px',
          maxWidth: '260px',
          flex: '0 0 260px',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          overflowY: 'auto',
          boxSizing: 'border-box',
          backgroundColor: '#ffffff',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          padding: '22px 16px',
          boxShadow: '18px 0 40px rgba(15, 23, 42, 0.04)',
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '28px', padding: '0 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                backgroundColor: 'rgb(93 183 44 / 12%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
                border: '1px solid rgba(93, 183, 44, 0.10)',
              }}
            >
              <img src={brandLogo} alt="Menzzu" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text-primary)', lineHeight: 1.1 }}>Menzzu</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>{clientMode ? 'Área da conta' : 'Painel operacional'}</div>
            </div>
          </div>
          {storeUrl ? (
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir loja pública"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-primary)',
                backgroundColor: '#ffffff',
                border: '1px solid var(--border-color)',
                padding: '4px',
                textDecoration: 'none',
                transition: 'color 0.15s ease, transform 0.15s ease, border-color 0.15s ease, background-color 0.15s ease',
              }}
            >
              <ExternalLink size={16} color="currentColor" />
            </a>
          ) : null}
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
            return (
              <Link
                key={item.path}
                to={item.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '14px',
                textDecoration: 'none',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'rgba(93, 183, 44, 0.12)' : 'transparent',
                border: isActive ? '1px solid rgba(93, 183, 44, 0.18)' : '1px solid transparent',
                transition: 'all 0.2s ease',
                fontWeight: isActive ? 800 : 600,
                fontSize: '14px',
              }}
            >
              {item.icon}
              {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={handleLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            borderRadius: '14px',
            border: '1px solid transparent',
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 700,
            marginTop: '20px',
          }}
        >
          <LogOut size={20} />
          Sair
        </button>
      </div>

      <div style={{ flex: 1, marginLeft: '260px', minWidth: 0, overflowY: 'auto', position: 'relative', backgroundColor: '#f6f8f3' }}>
        <Outlet />
      </div>
    </div>
  );
};

export default MainLayout;

