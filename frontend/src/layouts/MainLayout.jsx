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
  Zap
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const menuItems = [
    { path: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { path: '/chat', icon: <MessageCircle size={20} />, label: 'Chat' },
    { path: '/inventory', icon: <Package size={20} />, label: 'Estoque' },
    { path: '/production', icon: <ClipboardList size={20} />, label: 'Produção' },
    { path: '/agenda', icon: <Calendar size={20} />, label: 'Agenda' },
    { path: '/flows', icon: <Zap size={20} />, label: 'Automação' },
    { path: '/connections', icon: <Share2 size={20} />, label: 'Conexões' },
    { path: '/prompts', icon: <MessageSquare size={20} />, label: 'Lily AI' },
    { path: '/site-settings', icon: <Globe size={20} />, label: 'Cardápio' },
    { path: '/settings', icon: <Settings size={20} />, label: 'Configurações' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#09090b', color: '#fff', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ 
        width: '260px', 
        backgroundColor: '#111113', 
        borderRight: '1px solid #1f1f22', 
        display: 'flex', 
        flexDirection: 'column',
        padding: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px', padding: '0 10px' }}>
          <div style={{ 
            width: '32px', 
            height: '32px', 
            backgroundColor: '#3b82f6', 
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Zap size={20} color="#fff" />
          </div>
          <span style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px' }}>ZAPFLY</span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
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
                  color: isActive ? '#fff' : '#71717a',
                  backgroundColor: isActive ? '#1f1f22' : 'transparent',
                  transition: 'all 0.2s ease',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '14px'
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
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            marginTop: '20px'
          }}
        >
          <LogOut size={20} />
          Sair
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <Outlet />
      </div>
    </div>
  );
};

export default MainLayout;
