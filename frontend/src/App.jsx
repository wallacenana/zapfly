import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Flows from './pages/Flows';
import FlowEditor from './pages/FlowEditor';
import Connections from './pages/Connections';
import Agenda from './pages/Agenda';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import Prompts from './pages/Prompts';
import Estoque from './pages/Estoque';
import Production from './pages/Production';
import Menu from './pages/Menu';
import SiteSettings from './pages/SiteSettings';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Rota pública */}
          <Route path="/login" element={<Login />} />
          <Route path="/menu" element={<Menu />} />

          {/* Rotas protegidas */}
          <Route element={<PrivateRoute />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="flows" element={<Flows />} />
              <Route path="flows/new" element={<FlowEditor />} />
              <Route path="flows/:id" element={<FlowEditor />} />
              <Route path="chat" element={<Chat />} />
              <Route path="chat/:jid" element={<Chat />} />
              <Route path="prompts" element={<Prompts />} />
              <Route path="agenda" element={<Agenda />} />
              <Route path="estoque" element={<Estoque />} />
              <Route path="connections" element={<Connections />} />
              <Route path="production" element={<Production />} />
              <Route path="settings" element={<Settings />} />
              <Route path="site" element={<SiteSettings />} />
            </Route>
          </Route>

          {/* Menu Digital Dinâmico (Sempre por último para não conflitar) */}
          <Route path="/:slug" element={<Menu />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
