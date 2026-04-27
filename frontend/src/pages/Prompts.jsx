import React, { useState, useEffect } from 'react';
import { Bot, Save, Plus, Trash2, Copy, Check, MessageSquare, Edit3, Loader2 } from 'lucide-react';
import { api } from '../api';
import Swal from 'sweetalert2';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true
});

const Prompts = () => {
  const [instances, setInstances] = useState([]);
  const [activeInstance, setActiveInstance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formPrompt, setFormPrompt] = useState('');
  const [formKnowledge, setFormKnowledge] = useState([]);
  const [showCopySuccess, setShowCopySuccess] = useState(false);

  // Trainer State
  const [testQuestion, setTestQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [correctedResponse, setCorrectedResponse] = useState('');

  useEffect(() => {
    fetchInstances();
  }, []);

  const fetchInstances = async () => {
    setLoading(true);
    try {
      const res = await api.get('/instances');
      setInstances(res.data);
      if (res.data.length > 0) {
        selectInstance(res.data[0]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectInstance = (inst) => {
    setActiveInstance(inst);
    setFormPrompt(inst.botPrompt || '');
    setFormKnowledge(JSON.parse(inst.knowledge || '[]'));
    setAiResponse('');
    setTestQuestion('');
    setCorrectedResponse('');
  };

  const handleSave = async () => {
    if (!activeInstance) return;
    setSaving(true);
    try {
      const res = await api.patch(`/instances/${activeInstance.id}`, {
        botPrompt: formPrompt,
        knowledge: JSON.stringify(formKnowledge)
      });
      // Update local list
      setInstances(prev => prev.map(i => i.id === activeInstance.id ? res.data : i));
      Toast.fire({ icon: 'success', title: 'Configurações salvas com sucesso!' });
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro ao salvar configurações.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = (fromId) => {
    const other = instances.find(i => i.id === fromId);
    if (other) {
      setFormPrompt(other.botPrompt || '');
      setFormKnowledge(JSON.parse(other.knowledge || '[]'));
      setShowCopySuccess(true);
      setTimeout(() => setShowCopySuccess(false), 2000);
    }
  };

  const handleSimulate = async () => {
    if (!testQuestion.trim()) return;
    setIsSimulating(true);
    setAiResponse('');
    try {
      const res = await api.post(`/instances/${activeInstance.id}/ai-test`, {
        question: testQuestion,
        botPrompt: formPrompt,
        knowledge: JSON.stringify(formKnowledge)
      });
      setAiResponse(res.data.answer);
      setCorrectedResponse(res.data.answer); // Default correction to the AI's answer
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro na simulação' });
    } finally {
      setIsSimulating(false);
    }
  };

  const handleAddToKnowledge = () => {
    if (!testQuestion.trim() || !correctedResponse.trim()) return;
    setFormKnowledge([{ q: testQuestion, a: correctedResponse }, ...formKnowledge]);
    setTestQuestion('');
    setAiResponse('');
    setCorrectedResponse('');
    Toast.fire({ icon: 'success', title: 'Adicionado à base de conhecimento!' });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 className="animate-spin" size={32} color="var(--accent-primary)" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '30px', height: '100%' }}>
      {/* Sidebar de Instâncias */}
      <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conexões</h3>
        {instances.map(inst => (
          <div 
            key={inst.id}
            onClick={() => selectInstance(inst)}
            style={{ 
              padding: '15px', 
              borderRadius: '12px', 
              backgroundColor: activeInstance?.id === inst.id ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              border: `1px solid ${activeInstance?.id === inst.id ? inst.color : 'var(--border-color)'}`,
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: inst.status === 'connected' ? '#10b981' : '#71717a' }}></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>{inst.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{inst.id.split('-')[0]}...</div>
            </div>
          </div>
        ))}
      </div>

      {/* Editor Principal */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '25px' }}>
        {activeInstance ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '22px', fontWeight: 800 }}>Inteligência de {activeInstance.name}</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Configure como a IA deve se comportar e o que ela deve saber.</p>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                 <div style={{ position: 'relative' }}>
                    <select 
                        onChange={(e) => handleDuplicate(e.target.value)}
                        value=""
                        style={{ 
                            padding: '8px 15px', 
                            borderRadius: '8px', 
                            backgroundColor: 'var(--bg-tertiary)', 
                            border: '1px solid var(--border-color)', 
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="" disabled>Duplicar de outro número...</option>
                        {instances.filter(i => i.id !== activeInstance.id).map(i => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                        ))}
                    </select>
                    {showCopySuccess && (
                        <div style={{ position: 'absolute', top: '-30px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--success)', color: '#fff', fontSize: '10px', padding: '2px 8px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                            Copiado!
                        </div>
                    )}
                 </div>
                 <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" size={18} /> : <><Save size={18} /> Salvar Tudo</>}
                 </button>
              </div>
            </div>

            <div className="card" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.1)', marginBottom: '30px', padding: '25px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <div style={{ padding: '8px', backgroundColor: 'var(--accent-primary)', color: '#fff', borderRadius: '8px' }}>
                  <MessageSquare size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Simulador e Treinamento</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Teste perguntas e ensine a IA como ela deve responder.</p>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Pergunta de Teste</label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input 
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: '#fff', outline: 'none' }}
                      placeholder="Ex: Qual o valor do frete para o centro?"
                      value={testQuestion}
                      onChange={(e) => setTestQuestion(e.target.value)}
                    />
                    <button 
                      className="btn btn-secondary" 
                      onClick={handleSimulate} 
                      disabled={isSimulating}
                      style={{ width: '150px' }}
                    >
                      {isSimulating ? <Loader2 className="animate-spin" size={18} /> : 'Simular Resposta'}
                    </button>
                  </div>
                </div>

                {aiResponse && (
                  <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                    <div style={{ marginBottom: '15px', padding: '15px', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', borderLeft: '4px solid var(--accent-primary)' }}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: 'var(--accent-primary)', marginBottom: '5px' }}>RESPOSTA ATUAL DA IA:</label>
                      <p style={{ fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{aiResponse}</p>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Sua Correção (Ensinar):</label>
                      <textarea 
                        style={{ width: '100%', height: '80px', padding: '12px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: '#fff', outline: 'none', resize: 'none', fontSize: '13px' }}
                        placeholder="Como você prefere que ela responda?"
                        value={correctedResponse}
                        onChange={(e) => setCorrectedResponse(e.target.value)}
                      />
                      <button 
                        className="btn btn-primary" 
                        style={{ marginTop: '10px', width: '100%', backgroundColor: 'var(--success)', borderColor: 'var(--success)' }}
                        onClick={handleAddToKnowledge}
                      >
                        <Plus size={18} /> Ensinar este padrão à IA
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
              {/* System Prompt Section */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <div style={{ padding: '8px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', borderRadius: '8px' }}>
                    <Bot size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Personalidade do Agente</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Defina o papel, tom de voz e regras principais do robô.</p>
                  </div>
                </div>
                <textarea 
                  style={{ 
                    width: '100%', 
                    height: '150px', 
                    padding: '15px', 
                    borderRadius: '12px', 
                    backgroundColor: 'var(--bg-tertiary)', 
                    border: '1px solid var(--border-color)', 
                    color: '#fff', 
                    fontSize: '14px',
                    lineHeight: '1.6',
                    resize: 'none',
                    outline: 'none'
                  }}
                  placeholder="Ex: Você é o atendente virtual da Confeitaria ZAP Fly. Seu nome é FlyBot. Seja educado, use emojis e ajude os clientes a escolherem bolos e doces..."
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                />
              </section>

              {/* FAQ / Knowledge Base Section */}
              <section style={{ borderTop: '1px solid var(--border-color)', paddingTop: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ padding: '8px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '8px' }}>
                      <Edit3 size={20} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Base de Conhecimento Dinâmica</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Adicione perguntas frequentes para que a IA saiba responder com precisão.</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setFormKnowledge([...formKnowledge, { q: '', a: '' }])}
                    style={{ 
                      padding: '8px 16px', 
                      borderRadius: '8px', 
                      backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                      color: '#10b981', 
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Plus size={16} /> Adicionar Item
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  {formKnowledge.map((item, idx) => (
                    <div key={idx} className="card" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', padding: '20px', position: 'relative' }}>
                       <button 
                        onClick={() => setFormKnowledge(formKnowledge.filter((_, i) => i !== idx))}
                        style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '5px' }}
                      >
                        <Trash2 size={16} />
                      </button>
                      
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Pergunta do Cliente</label>
                        <input 
                          value={item.q}
                          onChange={(e) => {
                            const n = [...formKnowledge];
                            n[idx].q = e.target.value;
                            setFormKnowledge(n);
                          }}
                          placeholder="Ex: Qual o endereço?"
                          style={{ width: '100%', padding: '10px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '13px', outline: 'none' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>O que a IA deve responder</label>
                        <textarea 
                          value={item.a}
                          onChange={(e) => {
                            const n = [...formKnowledge];
                            n[idx].a = e.target.value;
                            setFormKnowledge(n);
                          }}
                          placeholder="Ex: Estamos localizados na Rua das Flores, 123..."
                          style={{ width: '100%', height: '80px', padding: '10px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '13px', resize: 'none', outline: 'none' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {formKnowledge.length === 0 && (
                  <div style={{ padding: '60px', textAlign: 'center', backgroundColor: 'var(--bg-tertiary)', borderRadius: '15px', border: '1px dashed var(--border-color)' }}>
                    <MessageSquare size={48} color="var(--text-muted)" style={{ marginBottom: '15px', opacity: 0.2 }} />
                    <p style={{ color: 'var(--text-muted)' }}>Nenhuma informação específica cadastrada. Comece clicando em "Adicionar Item".</p>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
             <Bot size={64} style={{ opacity: 0.1, marginBottom: '20px' }} />
             <p>Selecione uma conexão para editar seus prompts.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Prompts;
