import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Users, 
  ShoppingBag, 
  Calendar, 
  Package, 
  Zap, 
  Settings, 
  LogOut, 
  Menu as MenuIcon, 
  X,
  Palette,
  Bot,
  Activity
} from 'lucide-react';

const Layout = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const userName = localStorage.getItem('userName') || 'Usuário';

  const menuItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/connections', label: 'Conexões', icon: Zap },
    { path: '/production', label: 'Cozinha / Produção', icon: ShoppingBag },
    { path: '/agenda', label: 'Agenda de Pedidos', icon: Calendar },
    { path: '/inventory', label: 'Estoque', icon: Users },
    { path: '/flows', label: 'Automações (Fluxos)', icon: MessageSquare },
    { path: '/prompts', label: 'Lily AI (Prompts)', icon: Bot },
    { path: '/site', label: 'Aparência do Site', icon: Palette },
    { path: '/settings', label: 'Configurações', icon: Settings },
  ];

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar" style={{ 
          width: isSidebarOpen ? 'var(--sidebar-width)' : '80px',
          transition: 'width 0.3s ease'
      }}>
        {/* Logo */}
        <div className="sidebar-header" style={{ justifyContent: isSidebarOpen ? 'flex-start' : 'center' }}>
          <div style={{ 
              width: '40px', 
              height: '40px', 
              backgroundColor: '#3b82f6', 
              borderRadius: '10px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexShrink: 0
          }}>
            <Zap size={20} color="white" fill="white" />
          </div>
          {isSidebarOpen && <span>DIGIZAP</span>}
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              style={{ justifyContent: isSidebarOpen ? 'flex-start' : 'center' }}
            >
              <item.icon size={20} />
              {isSidebarOpen && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        {/* User / Logout */}
        <div style={{ marginTop: 'auto', padding: '20px 0' }}>
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px', 
                padding: '12px', 
                backgroundColor: 'var(--bg-tertiary)', 
                borderRadius: '12px',
                marginBottom: '10px'
            }}>
                <div style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '8px', 
                    backgroundColor: 'var(--border-color)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: '12px'
                }}>
                    {userName.charAt(0)}
                </div>
                {isSidebarOpen && <span style={{ fontSize: '13px', fontWeight: 600 }}>{userName}</span>}
            </div>
            
            <button 
                onClick={handleLogout}
                className="btn-secondary"
                style={{ 
                    width: '100%', 
                    padding: '10px', 
                    justifyContent: isSidebarOpen ? 'flex-start' : 'center',
                    gap: '12px',
                    border: 'none',
                    backgroundColor: 'transparent'
                }}
            >
                <LogOut size={18} />
                {isSidebarOpen && <span>Sair</span>}
            </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content" style={{ 
          marginLeft: isSidebarOpen ? 'var(--sidebar-width)' : '80px',
          transition: 'margin-left 0.3s ease'
      }}>
        {/* Topbar */}
        <header className="header">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="btn-icon"
          >
            {isSidebarOpen ? <X size={20} /> : <MenuIcon size={20} />}
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor' }}></div>
                Sistema Online
            </div>
          </div>
        </header>

        <div className="page-content">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
