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

// Auth Guard
const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) return null; // Ou um loading spinner
  
  if (!user) return <Navigate to="/login" />;
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/first-login" element={<FirstLoginSetup />} />
      
      <Route path="/" element={
        <PrivateRoute>
          <MainLayout />
        </PrivateRoute>
      }>
        <Route index element={<Dashboard />} />
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
        <Route path="settings" element={<Settings />} />
        <Route path="site-settings" element={<SiteSettings />} />
      </Route>
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
