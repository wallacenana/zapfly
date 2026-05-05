import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, GitMerge, MessageSquare, Megaphone, Users, Calendar, Settings, Smartphone, Bot, PackageOpen, BellRing, Grid2X2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { api, socket } from '../api';

const Layout = () => {
  const location = useLocation();
  const audioRef = useRef(null);
  const [hasPendingOrders, setHasPendingOrders] = useState(false);

  // ─── ALERTA GLOBAL DE NOVOS PEDIDOS (DING) ──────────────────────────────────
  useEffect(() => {
    // Cria o elemento de áudio uma única vez
    audioRef.current = new Audio('/alarme.wav');
    audioRef.current.loop = true;

    const checkOrders = async () => {
      try {
        const res = await api.get('/orders');
        // Agora monitora QUALQUER pedido pendente (Delivery ou Encomenda)
        const pending = res.data.filter(o => o.status === 'pending');
        const has = pending.length > 0;
        setHasPendingOrders(has);

        if (has) {
          audioRef.current.play().catch(() => { });
        } else {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
      } catch (err) {
        // silencioso
      }
    };

    // Escuta via Socket para ser instantâneo
    socket.on('new_order_pending', () => {
      checkOrders();
    });

    socket.on('order_confirmed', () => {
      checkOrders();
    });

    checkOrders();
    const interval = setInterval(checkOrders, 15000); // Polling de segurança

    return () => {
      clearInterval(interval);
      socket.off('new_order_pending');
      socket.off('order_confirmed');
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);

  const isChatPage = location.pathname.includes('/chat');
  const isFlowEditorPage = location.pathname.includes('/flows/') && location.pathname !== '/flows';
  const isFullScreenPage = isChatPage || isFlowEditorPage;

  const getPageTitle = () => {
    const path = location.pathname;
    if (path.includes('/dashboard')) return 'Dashboard';
    if (path.includes('/flows')) return 'Fluxos de Automação';
    if (path.includes('/agenda')) return 'Agenda de Pedidos';
    if (path.includes('/production')) return 'Gestão de Pedidos';
    if (path.includes('/estoque')) return 'Estoque & Disponibilidade';
    if (path.includes('/connections')) return 'Conexões / Números';
    if (path.includes('/settings')) return 'Configurações';
    if (path.includes('/prompts')) return 'Prompts e Inteligência';
    return 'ZAP Fly';
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(37, 99, 235, 0.4)'
          }}>
            <MessageSquare size={18} color="#fff" />
          </div>
          <span style={{ letterSpacing: '-0.02em' }}>ZAP Fly</span>
        </div>

        <nav className="sidebar-nav">
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', margin: '10px 0 10px 15px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Principal</div>

          <NavLink to="/dashboard" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>

          <NavLink to="/chat" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
            <MessageSquare size={18} />
            Atendimento
          </NavLink>

          <NavLink to="/prompts" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
            <Bot size={18} />
            Prompts da IA
          </NavLink>

          <NavLink to="/flows" className={({ isActive }) => isActive || location.pathname.includes('/flows') ? "nav-item active" : "nav-item"}>
            <GitMerge size={18} />
            Fluxos Automáticos
          </NavLink>

          <NavLink to="/agenda" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
            <Calendar size={18} />
            Agenda de Pedidos
          </NavLink>

          <NavLink to="/production" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"} style={{ position: 'relative' }}>
            <Grid2X2 size={18} />
            Gestão de Pedidos
            {hasPendingOrders && (
              <span style={{
                position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444',
                boxShadow: '0 0 8px #ef4444',
                animation: 'pulse 1.2s infinite'
              }} />
            )}
          </NavLink>

          <NavLink to="/estoque" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
            <PackageOpen size={18} />
            Estoque & Delivery
          </NavLink>

          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', margin: '25px 0 10px 15px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Configurações</div>

          <NavLink to="/connections" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
            <Smartphone size={18} />
            Conexões / WhatsApp
          </NavLink>

          <NavLink to="/settings" className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
            <Settings size={18} />
            Ajustes do Sistema
          </NavLink>
        </nav>

        <div style={{ marginTop: 'auto', padding: '15px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-tertiary)'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(45deg, #71717a, #3f3f46)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 700
            }}>
              WA
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Wallace Admin</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Plano Pro</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {!isFullScreenPage && (
          <header className="header">
            <h1>{getPageTitle()}</h1>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              {hasPendingOrders && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: '20px', padding: '6px 14px', color: '#ef4444', fontWeight: 700, fontSize: '13px',
                  animation: 'pulse 1.2s infinite'
                }}>
                  <BellRing size={15} />
                  Pedido Pendente!
                </div>
              )}
              <div className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--success)', boxShadow: '0 0 5px var(--success)' }}></div>
                Sistema Operacional
              </div>
            </div>
          </header>
        )}

        <div className="page-content" style={{ padding: isFullScreenPage ? 0 : '40px', paddingTop: location.pathname === '/production' ? 0 : '40px' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
