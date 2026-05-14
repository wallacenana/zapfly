import React, { useState, useEffect } from 'react';
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
  Bot
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
    { path: '/menu', label: 'Meus Produtos', icon: Package },
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
    <div className="flex h-screen bg-[#09090b] text-slate-200 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-72' : 'w-20'} bg-[#121214] border-r border-slate-800 transition-all duration-300 flex flex-col z-50`}>
        {/* Logo */}
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-pink-600 rounded-xl flex items-center justify-center shadow-lg shadow-pink-900/20 flex-shrink-0">
            <Zap className="text-white fill-white" size={24} />
          </div>
          {isSidebarOpen && <span className="font-black text-2xl tracking-tighter text-white">DIGIZAP</span>}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto custom-scrollbar">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`
                flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all group
                ${location.pathname === item.path 
                  ? 'bg-pink-600/10 text-pink-500 shadow-sm' 
                  : 'hover:bg-slate-800/50 text-slate-400 hover:text-slate-100'}
              `}
            >
              <item.icon size={22} className={location.pathname === item.path ? 'text-pink-500' : 'group-hover:scale-110 transition-transform'} />
              {isSidebarOpen && <span className="font-bold text-sm tracking-tight">{item.label}</span>}
              {location.pathname === item.path && isSidebarOpen && (
                <div className="ml-auto w-1.5 h-1.5 bg-pink-500 rounded-full shadow-[0_0_8px_rgba(236,72,153,0.8)]"></div>
              )}
            </Link>
          ))}
        </nav>

        {/* User / Logout */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/50 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center font-black text-white">
              {userName.charAt(0)}
            </div>
            {isSidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-white truncate">{userName}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Plano Pro</p>
              </div>
            )}
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-slate-500 hover:bg-red-500/10 hover:text-red-500 transition-all font-bold text-sm"
          >
            <LogOut size={22} />
            {isSidebarOpen && <span>Sair do Painel</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Topbar */}
        <header className="h-20 border-b border-slate-800 flex items-center justify-between px-8 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-40">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors">
            {isSidebarOpen ? <X size={20} /> : <MenuIcon size={20} />}
          </button>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-[11px] font-black text-emerald-500 uppercase tracking-widest">Sistema Operacional</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-[#09090b] to-[#020617] p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
