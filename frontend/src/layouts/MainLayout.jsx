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
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const isSuperAdmin = String(user?.role || '').toLowerCase() === 'superadmin';
  const storeSlug = String(user?.slug || '').trim();
  const storeUrl = storeSlug ? `https://hotwhats.com.br/${storeSlug}` : '';
  const brandLogo = '/logo%20HotWhats.png';

  const menuItems = [
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
    { path: '/settings', icon: <Settings size={20} />, label: 'Configurações' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--bg-primary)', color: '#fff', overflow: 'hidden' }}>
      <div
        style={{
          width: '260px',
          backgroundColor: '#020c00',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '40px', padding: '0 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: 'rgb(255 255 255 / 13%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <img src={brandLogo} alt="HotWhats" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }} />
            </div>
            <span style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px', color: '#ffffff' }}>HotWhats</span>
          </div>
          {storeUrl ? (
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir loja p?blica"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-primary)',
                backgroundColor: 'transparent',
                border: 'none',
                padding: '2px',
                textDecoration: 'none',
                transition: 'color 0.15s ease, transform 0.15s ease',
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
                  borderRadius: '10px',
                  textDecoration: 'none',
                  color: isActive ? '#ffffff' : 'rgba(255,255,255,0.72)',
                  backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                  transition: 'all 0.2s ease',
                  fontWeight: isActive ? 700 : 500,
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
            borderRadius: '10px',
            border: 'none',
            backgroundColor: 'transparent',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            marginTop: '20px',
          }}
        >
          <LogOut size={20} />
          Sair
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <Outlet />
      </div>
    </div>
  );
};

export default MainLayout;

