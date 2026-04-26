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
  useReactFlow,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath
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
  GitMerge,
  Flag,
  Tag,
  Megaphone,
  List,
  Bell,
  Code
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Swal from 'sweetalert2';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer)
    toast.addEventListener('mouseleave', Swal.resumeTimer)
  }
});

const TriggerNode = ({ id, data }) => {
  const { updateNodeData } = useReactFlow();
  const [instances, setInstances] = useState([]);

  useEffect(() => {
    axios.get('http://localhost:3001/instances')
      .then(res => setInstances(res.data))
      .catch(err => console.error(err));
  }, []);

  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', width: '280px', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
      <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px 10px 0 0' }}>
        <Flag size={16} style={{ color: 'var(--text-secondary)' }} />
        <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Gatilho de Entrada</span>
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Configuracao</label>
            <select
              value={data.configuracao || ''}
              onChange={(e) => updateNodeData(id, { configuracao: e.target.value })}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
            >
              <option value="">Selecione...</option>
              <option value="Mensagem personalizada">Mensagem personalizada (Exata)</option>
              <option value="Mensagem semelhante">Mensagem semelhante (Contém)</option>
              <option value="Qualquer mensagem">Qualquer mensagem (Fluxo de entrada)</option>
            </select>
        </div>

        {(data.configuracao === 'Mensagem personalizada' || data.configuracao === 'Mensagem semelhante') && (
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Qual mensagem?</label>
            <input
              value={data.mensagemPersonalizada || ''}
              onChange={(e) => updateNodeData(id, { mensagemPersonalizada: e.target.value })}
              placeholder="Ex: Quero comprar"
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        )}

        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Numero de entrada</label>
          <select
            value={data.numeroEntrada || 'Qualquer numero'}
            onChange={(e) => updateNodeData(id, { numeroEntrada: e.target.value })}
            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
          >
            <option value="Qualquer numero">Qualquer numero</option>
            {instances.map(inst => (
              <option key={inst.id} value={inst.id}>
                {inst.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Numero de Teste (Opcional)</label>
          <input
            value={data.testNumber || ''}
            onChange={(e) => updateNodeData(id, { testNumber: e.target.value })}
            placeholder="Ex: 5511999999999"
            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
          />
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Se preenchido, o fluxo só dispara para este numero.</span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', right: '-5px' }} />
    </div>
  );
};

// ButtonsNode removido 业务

const TextNode = ({ id, data }) => {
  const { setNodes, updateNodeData } = useReactFlow();
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', minWidth: '280px', width: 'fit-content', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
      <Handle type="target" position={Position.Left} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', left: '-5px' }} />
      <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '10px 10px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={16} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Mensagem de Texto</span>
        </div>
        <button onClick={() => setNodes((nds) => nds.filter(n => n.id !== id))} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <textarea className="nowheel nodrag" value={data.message || ''} onChange={(e) => updateNodeData(id, { message: e.target.value })} placeholder="Digite a mensagem..." style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', resize: 'both', minHeight: '80px', boxSizing: 'border-box' }} />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', right: '-5px' }} />
    </div>
  );
};

const AINode = ({ id, data }) => {
  const { setNodes, updateNodeData } = useReactFlow();
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', minWidth: '320px', width: 'fit-content', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
      <Handle type="target" position={Position.Left} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', left: '-5px' }} />
      <div style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '10px 10px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={16} style={{ color: '#8b5cf6' }} />
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#a78bfa' }}>Agente IA (Contextual)</span>
        </div>
        <button onClick={() => setNodes((nds) => nds.filter(n => n.id !== id))} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>Este nó analisará as últimas mensagens e pode responder ou <strong>chamar o gerente</strong> se o cliente solicitar ajuda humana.</p>
        <div>
          <textarea className="nowheel nodrag" value={data.prompt || ''} onChange={(e) => updateNodeData(id, { prompt: e.target.value })} placeholder="Ex: Você é a Lily da Linda Cake. Seja gentil e ofereça o cardápio de bolos." style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', resize: 'both', minHeight: '120px', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
          <input 
            type="checkbox" 
            id={`activate-${id}`}
            checked={data.activateAgent || false} 
            onChange={(e) => updateNodeData(id, { activateAgent: e.target.checked })}
            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
          />
          <label htmlFor={`activate-${id}`} style={{ fontSize: '12px', fontWeight: 600, color: '#a78bfa', cursor: 'pointer' }}>Ativar Agente após responder</label>
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '15px', marginTop: '5px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>WhatsApp do Admin para Alerta (Opcional)</label>
          <input 
            value={data.adminPhone || ''} 
            onChange={(e) => updateNodeData(id, { adminPhone: e.target.value })} 
            placeholder="Ex: 5511999999999" 
            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} 
          />
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Se vazio, usa o gerente global das configurações.</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', right: '-5px' }} />
    </div>
  );
};

const WaitNode = ({ id, data }) => {
  const { setNodes, updateNodeData } = useReactFlow();
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', width: '250px', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
      <Handle type="target" position={Position.Left} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', left: '-5px' }} />
      <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '10px 10px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={16} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Espera</span>
        </div>
        <button onClick={() => setNodes((nds) => nds.filter(n => n.id !== id))} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Esperar (minutos)</label>
          <input type="number" value={data.minutes || ''} onChange={(e) => updateNodeData(id, { minutes: e.target.value })} placeholder="1440" style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', right: '-5px' }} />
    </div>
  );
};

const TagNode = ({ id, data }) => {
  const { setNodes, updateNodeData } = useReactFlow();
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', width: '250px', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
      <Handle type="target" position={Position.Left} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', left: '-5px' }} />
      <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '10px 10px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Tag size={16} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Aplicar Tag</span>
        </div>
        <button onClick={() => setNodes((nds) => nds.filter(n => n.id !== id))} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Tags (separadas por virgula)</label>
          <input value={data.tags || ''} onChange={(e) => updateNodeData(id, { tags: e.target.value })} placeholder="lead, vip, site" style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Acao</label>
          <select value={data.action || 'Adicionar tags'} onChange={(e) => updateNodeData(id, { action: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}>
            <option>Adicionar tags</option>
            <option>Remover tags</option>
            <option>Substituir todas</option>
          </select>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', right: '-5px' }} />
    </div>
  );
};

const NotifyNode = ({ id, data }) => {
  const { setNodes, updateNodeData } = useReactFlow();
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', minWidth: '280px', width: 'fit-content', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
      <Handle type="target" position={Position.Left} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', left: '-5px' }} />
      <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '10px 10px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Megaphone size={16} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Notificar Admin</span>
        </div>
        <button onClick={() => setNodes((nds) => nds.filter(n => n.id !== id))} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>WhatsApp do Admin (DDI+DDD+Numero)</label>
          <input value={data.phone || ''} onChange={(e) => updateNodeData(id, { phone: e.target.value })} placeholder="5511999999999" style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Mensagem do Alerta</label>
          <textarea className="nowheel nodrag" value={data.message || ''} onChange={(e) => updateNodeData(id, { message: e.target.value })} placeholder="O contato {{nome}} esta aguardando suporte." style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', resize: 'both', minHeight: '80px', boxSizing: 'border-box' }} />
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: '10px', height: '10px', background: 'var(--bg-primary)', border: '2px solid var(--text-secondary)', right: '-5px' }} />
    </div>
  );
};

// ConditionNode removido 业务

const nodeTypes = {
  triggerNode: TriggerNode,
  textNode: TextNode,
  aiNode: AINode,
  waitNode: WaitNode,
  tagNode: TagNode,
  notifyNode: NotifyNode
};

const CustomEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd }) => {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const onEdgeClick = (evt) => {
    evt.stopPropagation();
    setEdges((edges) => edges.filter((e) => e.id !== id));
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, strokeWidth: 2, stroke: 'var(--accent-primary)' }} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <button
            style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.3)', transition: 'all 0.2s' }}
            onClick={onEdgeClick}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#ef4444'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
            title="Excluir conexao"
          >
            <X size={12} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

const edgeTypes = { custom: CustomEdge };

const initialNodes = [
  {
    id: 'node-trigger',
    type: 'triggerNode',
    data: {},
    position: { x: 250, y: 150 }
  },
];

const initialEdges = [];

const FlowEditorInner = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
    (params) => setEdges((eds) => addEdge({ ...params, type: 'custom' }, eds)),
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

  const getNewNodeDef = (type, label, position) => {
    let nodeType = 'default';
    let data = { label: `${label}` };

    if (type === 'buttons') { nodeType = 'buttonsNode'; data.buttons = ['Opção 1', 'Opção 2']; }
    else if (type === 'text') { nodeType = 'textNode'; }
    else if (type === 'ai') { nodeType = 'aiNode'; }
    else if (type === 'wait') { nodeType = 'waitNode'; }
    else if (type === 'tag') { nodeType = 'tagNode'; }
    else if (type === 'notify') { nodeType = 'notifyNode'; }
    else if (type === 'condition') { nodeType = 'conditionNode'; }
    else if (type === 'trigger') { nodeType = 'triggerNode'; }

    return {
      id: `node_${Date.now()}`,
      type: nodeType,
      position,
      data,
    };
  };

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

      const newNode = getNewNodeDef(type, label, position);
      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes],
  );

  const addNodeOnClick = (type, label) => {
    const position = {
      x: 350 + Math.random() * 50,
      y: 150 + Math.random() * 50,
    };

    const newNode = getNewNodeDef(type, label, position);
    setNodes((nds) => nds.concat(newNode));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const currentNodes = getNodes();
      const currentEdges = getEdges();

      const flowData = {
        id: id === 'new' ? undefined : id,
        name: flowName,
        data: { nodes: currentNodes, edges: currentEdges },
        status: 'Ativo'
      };
      await axios.post('http://localhost:3001/flows', flowData);
      Toast.fire({
        icon: 'success',
        title: 'Fluxo salvo com sucesso!'
      });
      if (id === 'new') navigate('/flows');
    } catch (err) {
      Toast.fire({
        icon: 'error',
        title: 'Erro ao salvar o fluxo'
      });
    } finally {
      setLoading(false);
    }
  };

  const SidebarItem = ({ icon: Icon, label, type, color }) => (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, type, label)}
      onClick={() => addNodeOnClick(type, label)}
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
    <div style={{ width: '100%', height: '100vh', display: 'flex', backgroundColor: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside style={{
        width: isSidebarCollapsed ? '0px' : '260px',
        minWidth: isSidebarCollapsed ? '0px' : '260px',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: isSidebarCollapsed ? 'none' : '1px solid var(--border-color)',
        padding: isSidebarCollapsed ? '0px' : '20px',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        whiteSpace: 'nowrap',
        opacity: isSidebarCollapsed ? 0 : 1
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mensagens</div>
        <SidebarItem icon={MessageSquare} label="Texto" type="text" color="var(--accent-primary)" />
        <SidebarItem icon={Bot} label="Agente IA (Resposta)" type="ai" color="#8b5cf6" />

        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', margin: '20px 0 15px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lógica & Ações</div>
        <SidebarItem icon={Clock} label="Espera" type="wait" color="#64748b" />
        <SidebarItem icon={Tag} label="Aplicar Tag" type="tag" color="#10b981" />
        <SidebarItem icon={Bell} label="Notificar Admin" type="notify" color="#f43f5e" />
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
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="btn-icon"
              style={{ 
                color: isSidebarCollapsed ? 'var(--accent-primary)' : 'var(--text-secondary)',
                backgroundColor: isSidebarCollapsed ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                borderRadius: '8px'
              }}
              title={isSidebarCollapsed ? "Mostrar Barra Lateral" : "Recolher Barra Lateral"}
            >
              <LayoutIcon size={18} />
            </button>
            <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 5px' }} />
            <button
              onClick={() => navigate('/flows')}
              className="btn-icon"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft size={18} />
            </button>
            <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 5px' }} />
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
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'custom' }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          defaultViewport={{ x: 150, y: 150, zoom: 1 }}
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
