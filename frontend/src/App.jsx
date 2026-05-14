import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

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
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" />;
  return children;
};

function App() {
  return (
    <Router>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/first-login" element={<FirstLoginSetup />} />
        
        <Route path="/" element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }>
          <Route index element={<Dashboard />} />
          <Route path="inventory" element={<Estoque />} />
          <Route path="production" element={<Production />} />
          <Route path="agenda" element={<Agenda />} />
          <Route path="connections" element={<Connections />} />
          <Route path="chat" element={<Chat />} />
          <Route path="flows" element={<Flows />} />
          <Route path="flows/edit/:id" element={<FlowEditor />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="settings" element={<Settings />} />
          <Route path="site-settings" element={<SiteSettings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
