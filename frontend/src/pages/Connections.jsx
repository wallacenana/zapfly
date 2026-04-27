import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Smartphone, RefreshCw, Trash2, Plus, Loader2, QrCode, X, Edit3 } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { api, API_URL, socket } from '../api';
import Swal from 'sweetalert2';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true
});

const socket = io('http://localhost:3001');

const Connections = () => {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [qrs, setQrs] = useState({}); // { instanceId: qrCodeString }
  const [showModal, setShowModal] = useState(false);
  const [editingInstance, setEditingInstance] = useState(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#3b82f6');

  useEffect(() => {
    fetchInstances();

    socket.on('qr', (data) => {
      setQrs(prev => ({ ...prev, [data.instanceId]: data.qr }));
    });

    socket.on('connection_update', (data) => {
      setInstances(prev => prev.map(inst => 
        inst.id === data.instanceId ? { ...inst, status: data.status } : inst
      ));
      if (data.status === 'connected') {
        setQrs(prev => {
          const newQrs = { ...prev };
          delete newQrs[data.instanceId];
          return newQrs;
        });
      }
    });

    return () => {
      socket.off('qr');
      socket.off('connection_update');
    };
  }, []);

  const fetchInstances = async () => {
    try {
      const res = await api.get('/instances');
      setInstances(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenAddModal = () => {
    setEditingInstance(null);
    setFormName('');
    setFormColor('#3b82f6');
    setShowModal(true);
  };

  const handleOpenEditModal = (inst) => {
    setEditingInstance(inst);
    setFormName(inst.name);
    setFormColor(inst.color);
    setShowModal(true);
  };

  const handleSaveInstance = async () => {
    if (!formName) return;
    setLoading(true);
    try {
      if (editingInstance) {
        await api.patch(`/instances/${editingInstance.id}`, { name: formName, color: formColor });
      } else {
        await api.post('/instances', { name: formName, color: formColor });
      }
      setShowModal(false);
      fetchInstances();
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro ao salvar instância' });
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async (e, id) => {
    e.stopPropagation();
    try {
      await api.post(`/instances/${id}/restart`);
      Toast.fire({ icon: 'info', title: 'Reiniciando instância...' });
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro ao reiniciar' });
    }
  };

  const handleLogout = async (e, id) => {
    e.stopPropagation();
    const result = await Swal.fire({
      title: 'Desconectar WhatsApp?',
      text: "Isso irá deslogar o número atual. Você precisará escanear o QR Code novamente.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Sim, desconectar!',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      try {
        await api.post(`/instances/${id}/logout`);
        fetchInstances();
        Toast.fire({ icon: 'success', title: 'Desconectado com sucesso' });
      } catch (err) {
        Toast.fire({ icon: 'error', title: 'Erro ao desconectar' });
      }
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    
    const result = await Swal.fire({
      title: 'Tem certeza?',
      text: "Você não poderá reverter isso!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      try {
        await api.delete(`/instances/${id}`);
        fetchInstances();
        Toast.fire({ icon: 'success', title: 'Conexão removida' });
      } catch (err) {
        Toast.fire({ icon: 'error', title: 'Erro ao excluir' });
      }
    }
  };

  return (
    <div style={{ padding: '30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700 }}>Conexões Ativas</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie e conecte múltiplos números de WhatsApp</p>
        </div>
        <button className="btn btn-primary" onClick={handleOpenAddModal}>
          <Plus size={18} /> Adicionar Nova Conexão
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
        {instances.map(inst => (
          <div 
            key={inst.id} 
            className="card" 
            onClick={() => handleOpenEditModal(inst)}
            style={{ display: 'flex', flexDirection: 'column', gap: '20px', cursor: 'pointer', position: 'relative' }}
          >
             <div style={{ position: 'absolute', top: '15px', right: '15px', opacity: 0.3 }}>
                <Edit3 size={14} />
             </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ 
                  width: '52px', 
                  height: '52px', 
                  backgroundColor: inst.status === 'connected' ? `${inst.color}15` : 'var(--bg-tertiary)', 
                  borderRadius: '14px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: `1px solid ${inst.status === 'connected' ? `${inst.color}33` : 'var(--border-color)'}`
                }}>
                  <Smartphone color={inst.status === 'connected' ? inst.color : 'var(--text-muted)'} size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '2px' }}>{inst.name}</h3>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', opacity: 0.7 }}>
                    ID: {inst.id}
                  </div>
                </div>
              </div>
              <div 
                className="badge" 
                style={{ 
                  backgroundColor: inst.status === 'connected' ? `${inst.color}15` : 'rgba(245, 158, 11, 0.1)',
                  color: inst.status === 'connected' ? inst.color : 'var(--warning)',
                  border: `1px solid ${inst.status === 'connected' ? `${inst.color}33` : 'rgba(245, 158, 11, 0.2)'}`
                }}
              >
                {inst.status === 'connected' ? 'ONLINE' : 'OFFLINE'}
              </div>
            </div>

            {inst.status !== 'connected' && qrs[inst.id] ? (
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                gap: '16px',
                padding: '24px',
                backgroundColor: '#fff',
                borderRadius: '12px',
                boxShadow: '0 0 30px rgba(255,255,255,0.05)'
              }}>
                <QRCodeCanvas value={qrs[inst.id]} size={180} />
                <div style={{ 
                  color: '#000', 
                  fontSize: '12px', 
                  fontWeight: 700, 
                  textAlign: 'center',
                  letterSpacing: '0.02em',
                  opacity: 0.8
                }}>
                  Escaneie para conectar {inst.name}
                </div>
              </div>
            ) : inst.status !== 'connected' ? (
              <div style={{ 
                padding: '40px 20px', 
                textAlign: 'center', 
                backgroundColor: 'rgba(0,0,0,0.2)', 
                borderRadius: '12px', 
                border: '1px dashed var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px'
              }}>
                <QrCode size={32} color="var(--text-muted)" />
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Aguardando sinal do servidor...</p>
              </div>
            ) : (
              <div style={{ 
                padding: '40px 20px', 
                textAlign: 'center', 
                backgroundColor: 'rgba(16, 185, 129, 0.05)', 
                borderRadius: '12px', 
                border: '1px solid rgba(16, 185, 129, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px'
              }}>
                <Smartphone size={32} color="var(--success)" />
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Esta conexão está ativa e recebendo mensagens.</p>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
              <button className="btn btn-secondary" style={{ padding: '8px' }} onClick={(e) => handleRestart(e, inst.id)}>
                <RefreshCw size={14} /> Reiniciar
              </button>
              {inst.status === 'connected' ? (
                <button className="btn btn-secondary" style={{ padding: '8px', color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.2)' }} onClick={(e) => handleLogout(e, inst.id)}>
                   <Smartphone size={14} /> Desconectar
                </button>
              ) : (
                <button className="btn btn-secondary" style={{ padding: '8px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }} onClick={(e) => handleDelete(e, inst.id)}>
                  <Trash2 size={14} /> Remover
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal para Adicionar/Editar */}
      {showModal && ReactDOM.createPortal(
        <div style={{ 
          position: 'fixed', 
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0,0,0,0.85)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(5px)'
        }}>
          <div className="card" style={{ width: '420px', padding: '30px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
               <h3 style={{ fontSize: '20px', fontWeight: 700 }}>{editingInstance ? 'Editar Conexão' : 'Nova Conexão'}</h3>
               <button onClick={() => setShowModal(false)} className="btn-icon"><X size={20} /></button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>Nome da Conexão</label>
              <input 
                style={{ 
                  width: '100%', 
                  padding: '12px 15px', 
                  borderRadius: '10px',
                  outline: 'none', 
                  border: '1px solid var(--border-color)', 
                  backgroundColor: 'var(--bg-tertiary)', 
                  color: '#fff',
                  fontSize: '14px'
                }}
                placeholder="Ex: Suporte Vendas"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', fontWeight: 600 }}>Cor de Destaque (Accent)</label>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e'].map(color => (
                  <div 
                    key={color}
                    onClick={() => setFormColor(color)}
                    style={{ 
                      width: '34px', 
                      height: '34px', 
                      borderRadius: '10px', 
                      backgroundColor: color, 
                      cursor: 'pointer',
                      border: formColor === color ? '3px solid #fff' : 'none',
                      boxShadow: formColor === color ? `0 0 15px ${color}88` : 'none',
                      transition: 'all 0.2s'
                    }}
                  />
                ))}
                <div style={{
                  position: 'relative',
                  width: '34px',
                  height: '34px',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: !['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e'].includes(formColor) ? '3px solid #fff' : '1px dashed var(--border-color)',
                  boxShadow: !['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e'].includes(formColor) ? `0 0 15px ${formColor}88` : 'none',
                  cursor: 'pointer'
                }}>
                  <input 
                    type="color" 
                    value={formColor} 
                    onChange={(e) => setFormColor(e.target.value)}
                    style={{
                      position: 'absolute',
                      top: '-10px',
                      left: '-10px',
                      width: '54px',
                      height: '54px',
                      cursor: 'pointer',
                      border: 'none',
                      padding: 0
                    }}
                    title="Escolher cor personalizada"
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveInstance} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" size={18} /> : (editingInstance ? 'Salvar Alterações' : 'Criar e Conectar')}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
};

export default Connections;
