import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Flows from './pages/Flows';
import FlowEditor from './pages/FlowEditor';
import Connections from './pages/Connections';
import Agenda from './pages/Agenda';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import Prompts from './pages/Prompts';
import Estoque from './pages/Estoque';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="flows" element={<Flows />} />
          <Route path="flows/new" element={<FlowEditor />} />
          <Route path="flows/:id" element={<FlowEditor />} />
          <Route path="chat" element={<Chat />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="agenda" element={<Agenda />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="connections" element={<Connections />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
