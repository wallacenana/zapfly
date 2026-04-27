import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, GitMerge, Play, Pause, Edit2, Copy, Trash2, Smartphone, Loader2 } from 'lucide-react';
import { api } from '../api';
import Swal from 'sweetalert2';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
});

const TableSkeleton = () => (
  <>
    {[1, 2, 3, 4, 5].map((i) => (
      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
        <td style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: 'var(--bg-tertiary)', animation: 'pulse 1.5s infinite' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ width: '120px', height: '14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
              <div style={{ width: '60px', height: '10px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
            </div>
          </div>
        </td>
        <td style={{ padding: '16px 20px' }}>
          <div style={{ width: '80px', height: '20px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
        </td>
        <td style={{ padding: '16px 20px' }}>
          <div style={{ width: '70px', height: '22px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px', animation: 'pulse 1.5s infinite' }} />
        </td>
        <td style={{ padding: '16px 20px' }}>
          <div style={{ width: '100px', height: '14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
        </td>
        <td style={{ padding: '16px 20px', textAlign: 'right' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            {[1, 2, 3, 4].map(b => (
              <div key={b} style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        </td>
      </tr>
    ))}
    <style>{`
      @keyframes pulse {
        0% { opacity: 0.5; }
        50% { opacity: 0.8; }
        100% { opacity: 0.5; }
      }
    `}</style>
  </>
);

const Flows = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [flows, setFlows] = useState([]);
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [instRes, flowRes] = await Promise.all([
          api.get('/instances'),
          api.get('/flows')
        ]);
        setInstances(instRes.data);
        setFlows(flowRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleCreateFlow = async () => {
    try {
      const res = await api.post('/flows', {
        name: 'Novo Fluxo de Automação',
        status: 'Rascunho',
        data: JSON.stringify({ 
          nodes: [{ id: 'node-trigger', type: 'triggerNode', data: {}, position: { x: 250, y: 150 } }], 
          edges: [] 
        })
      });
      navigate(`/flows/${res.data.id}`);
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro ao criar fluxo' });
    }
  };

  const handleToggleStatus = async (flow) => {
    try {
      const newStatus = flow.status === 'Ativo' ? 'Pausado' : 'Ativo';
      await api.patch(`/flows/${flow.id}`, { ...flow, status: newStatus });
      setFlows(flows.map(f => f.id === flow.id ? { ...f, status: newStatus } : f));
      Toast.fire({
        icon: 'success',
        title: `Fluxo ${newStatus === 'Ativo' ? 'ativado' : 'pausado'} com sucesso!`
      });
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro ao mudar status' });
    }
  };

  const handleDuplicate = async (flow) => {
    try {
      const res = await api.post('/flows', {
        ...flow,
        id: undefined,
        name: `${flow.name} (Cópia)`,
        status: 'Rascunho'
      });
      setFlows([...flows, res.data]);
      Toast.fire({ icon: 'success', title: 'Fluxo duplicado com sucesso!' });
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro ao duplicar fluxo' });
    }
  };

  const handleDeleteFlow = async (id) => {
    const result = await Swal.fire({
      title: 'Tem certeza?',
      text: "Você não poderá reverter isso!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: 'var(--danger)',
      cancelButtonColor: 'var(--bg-tertiary)',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar',
      background: 'var(--bg-secondary)',
      color: 'var(--text-primary)'
    });

    if (result.isConfirmed) {
      try {
        await api.delete(`/flows/${id}`);
        setFlows(flows.filter(f => f.id !== id));
        Toast.fire({ icon: 'success', title: 'Fluxo excluído!' });
      } catch (err) {
        Toast.fire({ icon: 'error', title: 'Erro ao excluir fluxo' });
      }
    }
  };

  const filteredFlows = activeTab === 'all'
    ? flows
    : flows.filter(f => f.instanceId === activeTab);

  return (
    <div style={{ padding: '30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <GitMerge color="var(--success)" /> Fluxos de Automação
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Gerencie seus fluxos e gatilhos de mensagens automáticas</p>
        </div>
        <button className="btn btn-primary" style={{ backgroundColor: '#10b981', gap: '10px' }} onClick={handleCreateFlow}>
          <Plus size={18} /> Criar Novo Fluxo
        </button>
      </div>

      {/* Instance Tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('all')}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: activeTab === 'all' ? 'var(--accent-glow)' : 'transparent',
            color: activeTab === 'all' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontWeight: 500
          }}
        >
          Todos os Fluxos
        </button>
        {instances.map(inst => (
          <button
            key={inst.id}
            onClick={() => setActiveTab(inst.id)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === inst.id ? 'var(--accent-glow)' : 'transparent',
              color: activeTab === inst.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Smartphone size={14} />
            {inst.name}
          </button>
        ))}
      </div>

      {/* Flows Table/List */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ backgroundColor: 'rgba(23, 23, 23, 0.5)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>NOME DO FLUXO</th>
              <th style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>GATILHO (TRIGGER)</th>
              <th style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>STATUS</th>
              <th style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>ATUALIZADO EM</th>
              <th style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 500, textAlign: 'right' }}>AÇÕES</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton />
            ) : filteredFlows.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nenhum fluxo encontrado.
                </td>
              </tr>
            ) : (
              filteredFlows.map(flow => (
                <tr key={flow.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }}>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ padding: '8px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', borderRadius: '6px' }}>
                        <Play size={16} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{flow.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ID: #{flow.id}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: 'fit-content'
                    }}>
                      <Smartphone size={12} /> {flow.trigger}
                    </span>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{
                      backgroundColor: flow.status === 'Ativo' ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-tertiary)',
                      color: flow.status === 'Ativo' ? 'var(--success)' : 'var(--text-secondary)',
                      padding: '4px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: flow.status === 'Ativo' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid var(--border-color)'
                    }}>
                      {flow.status}
                    </span>
                  </td>
                  <td style={{ padding: '16px 20px', color: 'var(--text-secondary)' }}>
                    {new Date(flow.updatedAt).toLocaleString('pt-BR')}
                  </td>
                  <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button 
                        className="btn-icon" 
                        title={flow.status === 'Ativo' ? 'Pausar' : 'Ativar'} 
                        style={{ color: flow.status === 'Ativo' ? '#f59e0b' : 'var(--success)' }}
                        onClick={() => handleToggleStatus(flow)}
                      >
                        {flow.status === 'Ativo' ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button className="btn-icon" title="Editar" style={{ color: 'var(--accent-primary)' }} onClick={() => navigate(`/flows/${flow.id}`)}><Edit2 size={16} /></button>
                      <button className="btn-icon" title="Duplicar" style={{ color: 'var(--text-secondary)' }} onClick={() => handleDuplicate(flow)}><Copy size={16} /></button>
                      <button className="btn-icon" title="Excluir" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteFlow(flow.id)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Flows;
