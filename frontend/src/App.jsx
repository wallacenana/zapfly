import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
import Layout from './components/Layout';
import { Toaster } from 'react-hot-toast';

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  const mustChangePassword = localStorage.getItem('mustChangePassword') === 'true';
  
  if (!token) return <Navigate to="/login" />;
  if (mustChangePassword && window.location.pathname !== '/setup') return <Navigate to="/setup" />;
  
  return <Layout>{children}</Layout>;
};

function App() {
  return (
    <Router>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<PrivateRoute><FirstLoginSetup /></PrivateRoute>} />
        
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/connections" element={<PrivateRoute><Connections /></PrivateRoute>} />
        <Route path="/menu" element={<PrivateRoute><Menu /></PrivateRoute>} />
        <Route path="/production" element={<PrivateRoute><Production /></PrivateRoute>} />
        <Route path="/agenda" element={<PrivateRoute><Agenda /></PrivateRoute>} />
        <Route path="/inventory" element={<PrivateRoute><Estoque /></PrivateRoute>} />
        <Route path="/flows" element={<PrivateRoute><Flows /></PrivateRoute>} />
        <Route path="/flows/edit/:id" element={<PrivateRoute><FlowEditor /></PrivateRoute>} />
        <Route path="/prompts" element={<PrivateRoute><Prompts /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="/site" element={<PrivateRoute><SiteSettings /></PrivateRoute>} />
        
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
