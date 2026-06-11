import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Contexts
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Layouts
import MainLayout from './layouts/MainLayout';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Estoque from './pages/Estoque';
import Connections from './pages/Connections';
import Chat from './pages/Chat';
import Flows from './pages/Flows';
import FlowEditor from './pages/FlowEditor';
import Settings from './pages/Settings';
import SiteSettings from './pages/SiteSettings';
import Production from './pages/Production';
import Agenda from './pages/Agenda';
import FirstLoginSetup from './pages/FirstLoginSetup';
import Prompts from './pages/Prompts';
import Users from './pages/Users';
import AccountHome from './pages/AccountHome';

const FullScreenLoader = () => (
  <div style={{
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-primary)',
    color: '#f4f4f5',
    fontSize: '14px',
  }}>
    Carregando...
  </div>
);

const LoginRoute = () => {
  const { user, loading, logout } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (user) {
    const role = String(user?.role || '').toLowerCase();
    if (!['admin', 'superadmin', 'user'].includes(role)) {
      logout();
      return <Login />;
    }
    return <Navigate to={role === 'user' ? '/conta' : '/dashboard'} replace />;
  }
  return <Login />;
};

// Auth Guard
const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) return <FullScreenLoader />;
  
  if (!user) return <Navigate to="/login" />;
  return children;
};

const SuperAdminRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (String(user?.role || '').toLowerCase() !== 'superadmin') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!['admin', 'superadmin'].includes(String(user?.role || '').toLowerCase())) {
    return <Navigate to="/conta" replace />;
  }
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/first-login" element={<FirstLoginSetup />} />
      <Route path="/conta" element={<PrivateRoute><AccountHome /></PrivateRoute>} />

      <Route element={
        <AdminRoute>
          <MainLayout />
        </AdminRoute>
      }>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="estoque" element={<Estoque />} />
        <Route path="inventory" element={<Navigate to="/estoque" replace />} />
        <Route path="production" element={<Production />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="connections" element={<Connections />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:jid" element={<Chat />} />
        <Route path="flows" element={<Flows />} />
        <Route path="flows/:id" element={<FlowEditor />} />
        <Route path="flows/edit/:id" element={<FlowEditor />} />
        <Route path="prompts" element={<Prompts />} />
        <Route path="users" element={<SuperAdminRoute><Users /></SuperAdminRoute>} />
        <Route path="settings" element={<Settings />} />
        <Route path="site-settings" element={<SiteSettings />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-right" />
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
