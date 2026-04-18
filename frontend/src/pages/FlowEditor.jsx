import React, { useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Panel,
  ReactFlowProvider,
  useReactFlow
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  Save, 
  Plus, 
  ArrowLeft, 
  MessageSquare, 
  Zap, 
  Clock, 
  Play, 
  FileText, 
  Layout as LayoutIcon, 
  Bot, 
  ChevronLeft,
  X,
  Loader2,
  GitMerge
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const initialNodes = [
  { 
    id: 'node-trigger', 
    type: 'input', 
    data: { label: '🚀 Início do Fluxo' }, 
    position: { x: 250, y: 150 },
    style: { 
      background: 'var(--accent-primary)', 
      color: '#fff', 
      border: 'none', 
      borderRadius: '8px',
      fontWeight: 600,
      padding: '10px 20px',
      boxShadow: '0 4px 15px rgba(59, 130, 246, 0.3)'
    }
  },
];

const initialEdges = [];

const FlowEditorInner = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { screenToFlowPosition } = useReactFlow();
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [flowName, setFlowName] = useState('Novo Fluxo de Automação');

  useEffect(() => {
    if (id && id !== 'new') {
      axios.get(`http://localhost:3001/flows`)
        .then(res => {
          const flow = res.data.find(f => f.id === id);
          if (flow) {
            setFlowName(flow.name);
            const flowData = JSON.parse(flow.data);
            setNodes(flowData.nodes || initialNodes);
            setEdges(flowData.edges || []);
          }
        })
        .catch(err => console.error(err));
    }
  }, [id]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: 'var(--accent-primary)' } }, eds)),
    [setEdges],
  );

  const onDragStart = (event, nodeType, label) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/reactflow-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      const label = event.dataTransfer.getData('application/reactflow-label');

      if (typeof type === 'undefined' || !type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: `node_${Date.now()}`,
        type: 'default',
        position,
        data: { label: `${label}` },
        style: { 
          background: 'var(--bg-secondary)', 
          color: 'var(--text-primary)', 
          border: '1px solid var(--border-color)', 
          borderRadius: '8px',
          padding: '10px 15px',
          fontSize: '13px'
        }
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes],
  );

  const handleSave = async () => {
    setLoading(true);
    try {
      const flowData = {
        id: id === 'new' ? undefined : id,
        name: flowName,
        data: { nodes, edges },
        status: 'Ativo'
      };
      await axios.post('http://localhost:3001/flows', flowData);
      alert('Fluxo salvo com sucesso!');
      if (id === 'new') navigate('/flows');
    } catch (err) {
      alert('Erro ao salvar o fluxo');
    } finally {
      setLoading(false);
    }
  };

  const SidebarItem = ({ icon: Icon, label, type, color }) => (
    <div 
      draggable
      onDragStart={(e) => onDragStart(e, type, label)}
      style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '12px', 
        padding: '12px', 
        borderRadius: '8px', 
        border: '1px solid var(--border-color)',
        marginBottom: '10px',
        fontSize: '13px',
        cursor: 'grab',
        backgroundColor: 'var(--bg-tertiary)',
        transition: 'all 0.2s',
        color: 'var(--text-primary)'
      }}
      className="sidebar-node-item"
    >
      <div style={{ color }}>
        <Icon size={16} />
      </div>
      {label}
    </div>
  );

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 70px)', display: 'flex', backgroundColor: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside style={{ 
        width: '260px', 
        backgroundColor: 'var(--bg-secondary)', 
        borderRight: '1px solid var(--border-color)', 
        padding: '20px', 
        display: 'flex', 
        flexDirection: 'column',
        overflowY: 'auto'
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mensagens</div>
        <SidebarItem icon={MessageSquare} label="Texto" type="text" color="var(--accent-primary)" />
        <SidebarItem icon={FileText} label="Template" type="template" color="#10b981" />
        <SidebarItem icon={LayoutIcon} label="Botões" type="buttons" color="#f59e0b" />
        <SidebarItem icon={Bot} label="Agente IA" type="ai" color="#8b5cf6" />

        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', margin: '20px 0 15px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entradas</div>
        <SidebarItem icon={Zap} label="Gatilho" type="trigger" color="#ef4444" />

        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', margin: '20px 0 15px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lógica</div>
        <SidebarItem icon={GitMerge} label="Condição" type="condition" color="#06b6d4" />
        <SidebarItem icon={Clock} label="Espera" type="wait" color="#64748b" />
      </aside>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          right: 0, 
          height: '60px', 
          backgroundColor: 'var(--bg-secondary)', 
          borderBottom: '1px solid var(--border-color)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '0 25px', 
          zIndex: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button 
              onClick={() => navigate('/flows')}
              className="btn-icon"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft size={18} />
            </button>
            <input 
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', border: 'none', background: 'none', outline: 'none', width: '300px' }}
              placeholder="Nome do Fluxo"
            />
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>STATUS:</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--success)' }}>ATIVO</span>
             </div>
            <button 
              className="btn btn-primary" 
              style={{ gap: '8px' }}
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : <><Save size={16} /> Salvar Alterações</>}
            </button>
          </div>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          fitView
          colorMode="dark"
        >
          <Controls />
          <Background variant="dots" gap={20} size={1} color="var(--border-color)" />
          
          <Panel position="bottom-right">
             <button 
                onClick={() => setShowPreview(!showPreview)}
                className="btn btn-secondary"
                style={{ gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
              >
                <Play size={16} color="var(--success)" /> Preview
              </button>
          </Panel>
        </ReactFlow>

        {/* Preview Panel */}
        {showPreview && (
          <div className="card" style={{ 
            position: 'absolute', 
            top: '80px', 
            right: '20px', 
            width: '340px', 
            height: 'calc(100% - 100px)', 
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            overflow: 'hidden',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)' }}>
              <span style={{ fontWeight: 700, fontSize: '14px' }}>Simulador de Conversa</span>
              <button onClick={() => setShowPreview(false)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', padding: '20px', overflowY: 'auto' }}>
              <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: '12px 15px', borderRadius: '12px 12px 12px 0', fontSize: '13px', maxWidth: '85%', marginBottom: '15px', border: '1px solid var(--border-color)' }}>
                Olá! Este é o simulador do seu fluxo. Envie uma mensagem para testar a lógica.
              </div>
            </div>
            <div style={{ padding: '15px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
              <input 
                placeholder="Digite para testar..."
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: '#fff', marginBottom: '10px', fontSize: '13px' }}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px' }}>Reiniciar</button>
                <button className="btn btn-primary" style={{ flex: 1, fontSize: '12px' }}>Enviar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FlowEditor = () => (
  <ReactFlowProvider>
    <FlowEditorInner />
  </ReactFlowProvider>
);

export default FlowEditor;
