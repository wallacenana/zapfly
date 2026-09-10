import React from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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
  Menu,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PUBLIC_SITE_URL } from '../api';
import TrialBanner from '../components/TrialBanner';
import GetStarted from '../pages/GetStarted';

const MainLayout = ({ clientMode = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const sidebarCollapsed = false;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [trialInfo, setTrialInfo] = useState(null);
  const trialVisible = Boolean(trialInfo?.active);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 800) setMobileMenuOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const isSuperAdmin = String(user?.role || '').toLowerCase() === 'superadmin';
  const storeSlug = String(user?.slug || '').trim();
  const storeUrl = storeSlug ? `${PUBLIC_SITE_URL}/${storeSlug}` : '';
  const brandLogo = '/favicon.svg';

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
    ...adminMenuItems.filter((item) => item.path !== '/users' && item.path !== '/billing'),
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
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: '#ffffff',
        color: '#031614',
        overflow: 'hidden',
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#ffffff',
        '--bg-tertiary': '#f3f8f0',
        '--text-primary': '#031614',
        '--text-secondary': '#35544d',
        '--text-muted': '#6a817b',
        '--border-color': '#d7e7d1',
        '--accent-primary': '#66D711',
        '--accent-glow': 'rgba(102, 215, 17, 0.14)',
        '--card-shadow': '0 12px 30px rgba(15, 23, 42, 0.06)',
      }}
    >
      <TrialBanner global onActiveChange={setTrialInfo} />
      <div style={{ display: 'block', flex: 1, minHeight: '100vh' }}>
      <div className={`dashboard-sidebar${mobileMenuOpen ? ' is-mobile-open' : ''}${trialVisible ? ' has-trial' : ''}`}
        style={{
          width: sidebarCollapsed ? '76px' : '260px',
          minWidth: sidebarCollapsed ? '76px' : '260px',
          maxWidth: sidebarCollapsed ? '76px' : '260px',
          flex: `0 0 ${sidebarCollapsed ? '76px' : '260px'}`,
          height: trialVisible ? 'calc(100vh - 38px)' : '100vh',
          position: 'fixed',
          left: 0,
          top: trialVisible ? '38px' : 0,
          bottom: 0,
          overflowY: 'auto',
          boxSizing: 'border-box',
          backgroundColor: '#ffffff',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 12px',
          boxShadow: '18px 0 40px rgba(15, 23, 42, 0.04)',
          zIndex: 20,
          transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', gap: '10px', marginBottom: '26px', padding: '0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
          backgroundColor: 'rgb(102 215 17 / 12%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <img src={brandLogo} alt="Menzzu" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '5px' }} />
            </div>
            {!sidebarCollapsed && <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--text-primary)', lineHeight: 1.1 }}>Menzzu</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>{clientMode ? 'Área da conta' : 'Painel operacional'}</div>
            </div>}
          </div>
          {!sidebarCollapsed && storeUrl ? (
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
              className="dashboard-nav-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                gap: '11px',
                padding: sidebarCollapsed ? '11px 0' : '10px 12px',
                borderRadius: '11px',
                textDecoration: 'none',
                color: isActive ? '#3e9b00' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'rgba(102, 215, 17, 0.12)' : 'transparent',
                border: isActive ? '1px solid rgba(102, 215, 17, 0.18)' : '1px solid transparent',
                transition: 'all 0.2s ease',
                fontWeight: 500,
                fontSize: '13px',
              }}
              title={sidebarCollapsed ? item.label : undefined}
            >
              {item.icon}
              {!sidebarCollapsed && item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={handleLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            gap: '11px',
            padding: sidebarCollapsed ? '11px 0' : '10px 12px',
            borderRadius: '11px',
            border: '1px solid transparent',
            backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            marginTop: '16px',
          }}
          title={sidebarCollapsed ? 'Sair' : undefined}
        >
          <LogOut size={20} />
          {!sidebarCollapsed && 'Sair'}
        </button>
      </div>
      {mobileMenuOpen && <button className="dashboard-mobile-overlay" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} />}
      <div className={`dashboard-mobile-header${trialVisible ? ' has-trial' : ''}`}>
        <button aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}><Menu size={21} /></button>
      </div>
      <div className={`dashboard-content${trialVisible ? ' has-trial' : ''}`} style={{ minHeight: '100vh', marginLeft: '260px', paddingTop: trialVisible ? '38px' : 0, minWidth: 0, overflowY: 'auto', position: 'relative', backgroundColor: '#f6f8f3', transition: 'margin-left 0.2s ease, padding-top 0.2s ease' }}>
        <Outlet />
        {location.pathname === '/dashboard' && !window.localStorage.getItem('menzzu_onboarding_completed') ? <GetStarted /> : null}
      </div>
      </div>
    </div>
  );
};

export default MainLayout;

