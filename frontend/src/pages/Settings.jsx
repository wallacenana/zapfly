import React, { useState, useEffect, useRef } from 'react';
import { Save, Shield, MessageSquare, Bell, Calendar, MapPin, Truck, Plus, Trash2, Key, Cpu, ExternalLink, CheckCircle2, Image, Upload } from 'lucide-react';
import { api, API_URL } from '../api';
import Swal from 'sweetalert2';

const API_CONFIG = `${API_URL}/config/keys`;
const API_CALENDARS = `${API_URL}/auth/google/calendars`;
const API_DISCONNECT_GCAL = `${API_URL}/auth/google/disconnect`;

const Settings = () => {
  const [activeTab, setActiveTab] = useState('business');
  const [loading, setLoading] = useState(true);
  const [calendars, setCalendars] = useState([]);
  const [settings, setSettings] = useState({
    businessName: '',
    businessAddress: '',
    businessLocation: '',
    openaiKey: '',
    claudeKey: '',
    activeModel: 'openai',
    googleApiKey: '',
    gcalCalendarId: '',
    deliveryRules: [],
    managerJid: '',
    deliveryJid: '',
    mercadopagoToken: '',
    mercadopagoPublicKey: '',
    dailyMaxOrders: 10,
    gcalSyncHour: 6,
    reportHour: 7,
    reportEnabled: false,
    gcalRefreshToken: '',
    gcalEnabled: false,
    reminderHours: 2
  });
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [marketingAssets, setMarketingAssets] = useState([]);
  const [uploadName, setUploadName] = useState('');
  const fileInputRef = useRef(null);

  const loadSettings = async () => {
    try {
      const res = await api.get('/config/keys');
      if (res.data) {
        setSettings({
          ...res.data,
          openaiKey: res.data.openai || '',
          claudeKey: res.data.claude || '',
          googleApiKey: res.data.googleApiKey || '',
          gcalCalendarId: res.data.gcalCalendarId || '',
          deliveryRules: typeof res.data.deliveryRules === 'string'
            ? JSON.parse(res.data.deliveryRules || '[]')
            : (Array.isArray(res.data.deliveryRules) ? res.data.deliveryRules : []),
          reminderHours: res.data.reminderHours || 2,
          mercadopagoToken: res.data.mercadopagoToken || '',
          mercadopagoPublicKey: res.data.mercadopagoPublicKey || ''
        });

        if (res.data.gcalRefreshToken) {
          fetchCalendars();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCalendars = async () => {
    try {
      const res = await api.get('/auth/google/calendars');
      setCalendars(res.data);
    } catch (err) {
      console.error('Erro ao buscar calendários:', err);
    }
  };

  useEffect(() => {
    // Se estiver no popup de sucesso do Google, fecha a janela
    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal_success')) {
      window.close();
      return;
    }
    loadSettings();
    loadSlots();
    loadMarketingAssets();
  }, []);

  const loadSlots = async () => {
    try {
      const res = await api.get('/config/slots');
      setSlots(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSlots(false);
    }
  };

  const loadMarketingAssets = async () => {
    try {
      const res = await api.get('/marketing-assets');
      setMarketingAssets(res.data);
    } catch (err) { console.error(err); }
  };

  const handleUploadAsset = async () => {
    if (!fileInputRef.current?.files[0] || !uploadName.trim()) {
      Swal.fire('Atenção', 'Preencha o nome e selecione uma imagem.', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('name', uploadName);
    formData.append('file', fileInputRef.current.files[0]);
    try {
      await api.post('/marketing-assets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadName('');
      fileInputRef.current.value = '';
      await loadMarketingAssets();
      Swal.fire({ title: 'Foto adicionada!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível subir a imagem.', 'error');
    }
  };

  const handleDeleteAsset = async (id) => {
    const { isConfirmed } = await Swal.fire({ title: 'Remover foto?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim', cancelButtonText: 'Não' });
    if (!isConfirmed) return;
    await api.delete(`/marketing-assets/${id}`);
    await loadMarketingAssets();
  };

  const handleSaveSlots = async () => {
    try {
      await api.post('/config/slots', { slots });
      Swal.fire({ title: 'Horários Atualizados!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível salvar os horários.', 'error');
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        ...settings,
        openai: settings.openaiKey,
        claude: settings.claudeKey,
        deliveryRules: JSON.stringify(settings.deliveryRules)
      };
      await api.post('/config/keys', payload);
      await loadSettings(); // Recarrega para garantir que o estado local bata com o banco (especialmente GCal)
      Swal.fire({ title: 'Configurações Salvas!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível salvar.', 'error');
    }
  };

  const connectGoogle = () => {
    const width = 500;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const win = window.open(`${API_URL}/auth/google`, 'google_auth', `width=${width},height=${height},left=${left},top=${top}`);

    const checkTimer = setInterval(() => {
      if (win.closed) {
        clearInterval(checkTimer);
        loadSettings();
      }
    }, 1000);
  };

  const addDeliveryRule = () => setSettings(s => ({ ...s, deliveryRules: [...s.deliveryRules, { maxKm: 5, fee: 10 }] }));
  const updateRule = (idx, field, val) => {
    const rules = [...settings.deliveryRules];
    rules[idx][field] = parseFloat(val);
    setSettings(s => ({ ...s, deliveryRules: rules }));
  };

  const tabs = [
    { id: 'business', label: 'Empresa', icon: Shield },
    { id: 'delivery', label: 'Logística & Frete', icon: Truck },
    { id: 'schedules', label: 'Horários', icon: Calendar },
    { id: 'bot', label: 'Integrações (IA/GCal)', icon: Cpu },
    { id: 'marketing', label: 'Mídias de Marketing', icon: Image }
  ];

  if (loading) return <div style={{ padding: '40px', color: '#fff' }}>Carregando configurações...</div>;

  return (
    <div style={{ padding: '30px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#fff' }}>Configurações</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie o cérebro e a logística da sua plataforma</p>
        </div>
        <button
          onClick={activeTab === 'schedules' ? handleSaveSlots : handleSave}
          style={{ display: activeTab === 'marketing' ? 'none' : 'flex', alignItems: 'center', gap: '8px', padding: '12px 25px', borderRadius: '12px' }}
          className="btn btn-primary"
        >
          <Save size={20} /> Salvar {activeTab === 'schedules' ? 'Horários' : 'Tudo'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '30px' }}>
        <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                ...tabStyle,
                backgroundColor: activeTab === t.id ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                color: activeTab === t.id ? '#3b82f6' : 'var(--text-secondary)',
                borderLeft: activeTab === t.id ? '4px solid #3b82f6' : '4px solid transparent'
              }}
            >
              <t.icon size={20} /> {t.label}
            </button>
          ))}
        </div>

        <div className="card" style={{ flex: 1, padding: '40px', borderRadius: '20px' }}>
          {activeTab === 'business' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Perfil do Negócio</h3>
              </div>
              <div>
                <label style={labelStyle}>Nome Fantasia</label>
                <input {...inp} value={settings.businessName} onChange={e => setSettings({ ...settings, businessName: e.target.value })} placeholder="Nome da sua loja" />
              </div>
              <div>
                <label style={labelStyle}>Endereço Base (Para cálculo de KM)</label>
                <input {...inp} value={settings.businessAddress} onChange={e => setSettings({ ...settings, businessAddress: e.target.value })} placeholder="Endereço onde as entregas saem" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  <label style={labelStyle}>🆔 ID / Número do Administrador</label>
                  <input {...inp} value={settings.managerJid} onChange={e => setSettings({ ...settings, managerJid: e.target.value })} placeholder="Ex: 5521..." />
                </div>
                <div>
                  <label style={labelStyle}>Capacidade de Pedidos/Dia</label>
                  <input {...inp} type="number" value={settings.dailyMaxOrders} onChange={e => setSettings({ ...settings, dailyMaxOrders: parseInt(e.target.value) })} />
                </div>
              </div>
              <div style={subCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <Bell size={20} color="#f59e0b" />
                  <span style={{ fontWeight: 800 }}>Lembrete Automático de Retirada</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={microLabel}>Horas de antecedência para enviar o lembrete</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input {...inp} style={{ ...inp.style, width: '100px' }} type="number" value={settings.reminderHours} onChange={e => setSettings({ ...settings, reminderHours: parseInt(e.target.value) })} />
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>horas antes da retirada</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    O sistema enviará uma mensagem automática ao cliente lembrando do horário agendado.
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'delivery' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Logística & Google Maps</h3>
              </div>

              <div style={subCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <MapPin size={20} color="#3b82f6" />
                  <span style={{ fontWeight: 800 }}>Chave API Google Maps</span>
                </div>
                <input {...inp} type="password" value={settings.googleApiKey} onChange={e => setSettings({ ...settings, googleApiKey: e.target.value })} placeholder="Chave do Google Cloud (Distance Matrix)" />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Tabela de Preços por Distância</label>
                  <button onClick={addDeliveryRule} style={smallLink}>+ Adicionar Faixa</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {settings.deliveryRules.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>Nenhuma regra configurada. O frete será manual.</p>}
                  {settings.deliveryRules.map((rule, idx) => (
                    <div key={idx} style={ruleRow}>
                      <span>Até</span>
                      <input {...inp} style={smallInp} type="number" value={rule.maxKm} onChange={e => updateRule(idx, 'maxKm', e.target.value)} />
                      <span>KM</span>
                      <span style={{ marginLeft: '15px' }}>Taxa: R$</span>
                      <input {...inp} style={smallInp} type="number" value={rule.fee} onChange={e => updateRule(idx, 'fee', e.target.value)} />
                      <button onClick={() => setSettings(s => ({ ...s, deliveryRules: s.deliveryRules.filter((_, i) => i !== idx) }))} style={delBtn}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label style={labelStyle}>WhatsApp do Entregador (Notificações)</label>
                <input {...inp} value={settings.deliveryJid} onChange={e => setSettings({ ...settings, deliveryJid: e.target.value })} placeholder="JID para aviso de delivery" />
              </div>
            </div>
          )}

          {activeTab === 'schedules' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Horários de Funcionamento</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Defina quando a Lily pode aceitar pedidos e as regras de retirada.</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((day, idx) => {
                  const slot = slots.find(s => s.dayOfWeek === idx);
                  return (
                    <div key={idx} style={{ ...ruleRow, gridTemplateColumns: '120px 1fr 1fr auto' }}>
                      <span style={{ fontWeight: 700 }}>{day}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Abre:</label>
                        <input
                          {...inp}
                          style={smallInp}
                          type="time"
                          value={slot?.startTime || '09:00'}
                          onChange={e => {
                            const newSlots = [...slots.filter(s => s.dayOfWeek !== idx), { dayOfWeek: idx, startTime: e.target.value, endTime: slot?.endTime || '20:00' }];
                            setSlots(newSlots.sort((a, b) => a.dayOfWeek - b.dayOfWeek));
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Fecha:</label>
                        <input
                          {...inp}
                          style={smallInp}
                          type="time"
                          value={slot?.endTime || '20:00'}
                          onChange={e => {
                            const newSlots = [...slots.filter(s => s.dayOfWeek !== idx), { dayOfWeek: idx, startTime: slot?.startTime || '09:00', endTime: e.target.value }];
                            setSlots(newSlots.sort((a, b) => a.dayOfWeek - b.dayOfWeek));
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: slot ? '#3b82f6' : 'var(--text-muted)' }}>
                          {slot ? 'ABERTO' : 'FECHADO'}
                        </span>
                        <button
                          onClick={() => {
                            if (slot) {
                              setSlots(slots.filter(s => s.dayOfWeek !== idx));
                            } else {
                              setSlots([...slots, { dayOfWeek: idx, startTime: '09:00', endTime: '20:00' }].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
                            }
                          }}
                          style={{
                            width: '44px',
                            height: '22px',
                            backgroundColor: slot ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${slot ? '#3b82f6' : 'var(--border-color)'}`,
                            borderRadius: '20px',
                            position: 'relative',
                            cursor: 'pointer',
                            transition: 'all 0.3s'
                          }}
                        >
                          <div style={{
                            width: '14px',
                            height: '14px',
                            backgroundColor: slot ? '#3b82f6' : 'var(--text-muted)',
                            borderRadius: '50%',
                            position: 'absolute',
                            top: '3px',
                            left: slot ? '25px' : '3px',
                            transition: 'all 0.3s',
                            boxShadow: slot ? '0 0 10px rgba(59, 130, 246, 0.5)' : 'none'
                          }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {activeTab === 'bot' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Motores de Inteligência</h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px' }}>
                <div>
                  <label style={labelStyle}>Modelo de IA Ativo</label>
                  <select {...inp} value={settings.activeModel} onChange={e => setSettings({ ...settings, activeModel: e.target.value })}>
                    <option value="openai">OpenAI GPT-4o (Recomendado)</option>
                    <option value="openai-mini">OpenAI GPT-4o Mini (Econômico)</option>
                    <option value="openai-nano">OpenAI GPT-4.1 Nano</option>
                    <option value="claude">Anthropic Claude 3.5 Sonnet</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '25px' }}>
                  <input type="checkbox" checked={settings.reportEnabled} onChange={e => setSettings({ ...settings, reportEnabled: e.target.checked })} style={{ width: '18px', height: '18px' }} />
                  <label style={{ fontSize: '14px', fontWeight: 600 }}>Ativar Relatório Diário por WhatsApp</label>
                </div>
              </div>

              <div style={subCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <MessageSquare size={20} color="#10b981" />
                  <span style={{ fontWeight: 800 }}>Chaves de API</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label style={microLabel}>OpenAI API Key</label>
                    <input {...inp} type="password" value={settings.openaiKey} onChange={e => setSettings({ ...settings, openaiKey: e.target.value })} placeholder="sk-..." />
                  </div>
                  <div>
                    <label style={microLabel}>Anthropic (Claude) API Key</label>
                    <input {...inp} type="password" value={settings.claudeKey} onChange={e => setSettings({ ...settings, claudeKey: e.target.value })} placeholder="sk-ant-..." />
                  </div>
                </div>
              </div>

              <div style={{ ...subCard, borderLeftColor: '#3b82f6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <Shield size={20} color="#3b82f6" />
                  <span style={{ fontWeight: 800 }}>Mercado Pago</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <label style={microLabel}>Access Token (Chave de API)</label>
                    <input {...inp} type="password" value={settings.mercadopagoToken || ''} onChange={e => setSettings({ ...settings, mercadopagoToken: e.target.value })} placeholder="APP_USR-..." />
                  </div>
                  <div>
                    <label style={microLabel}>Public Key</label>
                    <input {...inp} type="password" value={settings.mercadopagoPublicKey || ''} onChange={e => setSettings({ ...settings, mercadopagoPublicKey: e.target.value })} placeholder="APP_USR-..." />
                  </div>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '5px' }}>Usado para gerar links de pagamento automáticos e garantir que a cozinha só receba pedidos pagos.</p>
              </div>

              <div style={{ ...subCard, borderLeftColor: '#f59e0b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Calendar size={20} color="#f59e0b" />
                    <span style={{ fontWeight: 800 }}>Google Calendar</span>
                  </div>
                  {settings.gcalRefreshToken ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '13px', fontWeight: 800 }}>
                        <CheckCircle2 size={16} /> CONECTADO
                      </div>
                      <button onClick={connectGoogle} style={{ ...smallLink, color: '#3b82f6', fontSize: '12px' }}>
                        Reconectar
                      </button>
                      <button
                        onClick={async () => {
                          Swal.fire({
                            title: 'Sincronizando...',
                            text: 'Buscando eventos no Google Agenda',
                            allowOutsideClick: false,
                            didOpen: () => Swal.showLoading()
                          });
                          try {
                            const res = await api.post('/orders/calendar-sync');
                            Swal.fire({ title: 'Sincronizado!', text: `${res.data.synced} eventos atualizados.`, icon: 'success', timer: 2000, showConfirmButton: false });
                          } catch (err) {
                            Swal.fire('Erro na Sincronização', err.response?.data?.error || 'Não foi possível conectar ao Google.', 'error');
                          }
                        }}
                        style={{ ...smallLink, color: '#ef4444', fontSize: '12px' }}
                      >
                        Sincronizar Manualmente
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.post('/auth/google/disconnect');
                            setSettings({ ...settings, gcalRefreshToken: '', gcalAccessToken: '', gcalCalendarId: '' });
                            setCalendars([]);
                            Swal.fire('Desconectado', 'Sua conta do Google foi removida.', 'info');
                          } catch (err) {
                            Swal.fire('Erro', 'Falha ao desconectar do Google.', 'error');
                          }
                        }}
                        style={{ ...smallLink, color: '#ef4444', fontSize: '12px' }}
                      >
                        Desconectar
                      </button>
                    </div>
                  ) : (
                    <button onClick={connectGoogle} style={{ ...smallLink, color: '#f59e0b', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <ExternalLink size={16} /> Conectar Google Agenda
                    </button>
                  )}
                </div>

                <label style={microLabel}>Agenda para Gravar Pedidos</label>
                <select {...inp} value={settings.gcalCalendarId} onChange={e => setSettings({ ...settings, gcalCalendarId: e.target.value })}>
                  <option value="" style={{ backgroundColor: '#18181b' }}>Selecione um calendário...</option>
                  {calendars.map(c => (
                    <option key={c.id} value={c.id} style={{ backgroundColor: '#18181b' }}>
                      {c.name} {c.primary ? '(Principal)' : ''}
                    </option>
                  ))}
                </select>

                <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <label style={microLabel}>Hora da Sincronização (H)</label>
                    <input {...inp} type="number" value={settings.gcalSyncHour} onChange={e => setSettings({ ...settings, gcalSyncHour: parseInt(e.target.value) })} />
                  </div>
                  <div>
                    <label style={microLabel}>Hora do Relatório (H)</label>
                    <input {...inp} type="number" value={settings.reportHour} onChange={e => setSettings({ ...settings, reportHour: parseInt(e.target.value) })} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'marketing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Galeria de Mídias da Lily</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '5px' }}>Envie aqui as fotos que a Lily usará para postar Stories no WhatsApp quando você pedir.</p>
              </div>

              {/* Upload */}
              <div style={subCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <Upload size={20} color="#10b981" />
                  <span style={{ fontWeight: 800 }}>Adicionar Nova Foto</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={microLabel}>Nome (ex: "Vulcão Chocolate")</label>
                    <input {...inp} value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Nome que a Lily vai reconhecer" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={microLabel}>Selecionar Imagem</label>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ ...inp.style, padding: '10px', cursor: 'pointer' }} />
                  </div>
                  <button onClick={handleUploadAsset} className="btn btn-primary" style={{ padding: '14px 20px', borderRadius: '12px', whiteSpace: 'nowrap' }}>
                    <Upload size={18} /> Subir Foto
                  </button>
                </div>
              </div>

              {/* Galeria */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
                {marketingAssets.length === 0 && (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: '30px' }}>Nenhuma foto na galeria ainda.</p>
                )}
                {marketingAssets.map(asset => (
                  <div key={asset.id} style={{ borderRadius: '14px', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', position: 'relative' }}>
                    <img
                      src={`${API_URL}${asset.path}`}
                      alt={asset.name}
                      style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{asset.name}</span>
                      <button onClick={() => handleDeleteAsset(asset.id)} style={delBtn}><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

// Styles
const tabStyle = { display: 'flex', alignItems: 'center', gap: '15px', padding: '18px', borderRadius: '15px', border: 'none', fontWeight: 700, fontSize: '15px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left', width: '100%' };
const labelStyle = { display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' };
const microLabel = { display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 800 };
const inp = { style: { width: '100%', padding: '14px 18px', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '15px', outline: 'none', transition: 'border-color 0.2s' } };
const subCard = { backgroundColor: 'rgba(255,255,255,0.03)', padding: '25px', borderRadius: '18px', borderLeft: '5px solid #3b82f6' };
const ruleRow = { display: 'grid', gridTemplateColumns: 'auto 90px auto auto 100px auto', gap: '15px', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', padding: '15px 20px', borderRadius: '12px' };
const smallInp = { ...inp.style, padding: '10px 15px', textAlign: 'center' };
const smallLink = { border: 'none', background: 'none', color: '#3b82f6', fontWeight: 800, fontSize: '14px', cursor: 'pointer' };
const delBtn = { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: 'auto', padding: '5px' };

export default Settings;
