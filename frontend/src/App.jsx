import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Connections from './pages/Connections';
import Menu from './pages/Menu';
import Production from './pages/Production';
import Agenda from './pages/Agenda';
import Estoque from './pages/Estoque';
import Flows from './pages/Flows';
import FlowEditor from './pages/FlowEditor';
import Prompts from './pages/Prompts';
import Settings from './pages/Settings';
import SiteSettings from './pages/SiteSettings';
import FirstLoginSetup from './pages/FirstLoginSetup';
import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<Login />} />
          
          {/* Rotas Protegidas */}
          <Route element={<PrivateRoute />}>
            <Route path="/setup" element={<FirstLoginSetup />} />
            <Route path="/" element={<Layout><Dashboard /></Layout>} />
            <Route path="/connections" element={<Layout><Connections /></Layout>} />
            <Route path="/production" element={<Layout><Production /></Layout>} />
            <Route path="/agenda" element={<Layout><Agenda /></Layout>} />
            <Route path="/menu" element={<Layout><Menu /></Layout>} />
            <Route path="/inventory" element={<Layout><Estoque /></Layout>} />
            <Route path="/flows" element={<Layout><Flows /></Layout>} />
            <Route path="/flows/edit/:id" element={<Layout><FlowEditor /></Layout>} />
            <Route path="/prompts" element={<Layout><Prompts /></Layout>} />
            <Route path="/settings" element={<Layout><Settings /></Layout>} />
            <Route path="/site" element={<Layout><SiteSettings /></Layout>} />
          </Route>

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
