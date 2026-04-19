import React, { useState, useEffect } from 'react';
import { Save, Key, Shield, Cpu, Loader2, Globe, Calendar, CheckCircle, XCircle, RefreshCw, ExternalLink } from 'lucide-react';
import axios from 'axios';
import Swal from 'sweetalert2';
import { useSearchParams } from 'react-router-dom';

const Toast = Swal.mixin({
  toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true
});

const API = 'http://localhost:3001';

export default function Settings() {
  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState({ openai: '', claude: '', activeModel: 'openai' });
  const [business, setBusiness] = useState({ businessName: '', managerJid: '', deliveryJid: '', reportEnabled: false, reportHour: 7 });
  const [gcal, setGcal] = useState({ clientId: '', clientSecret: '', syncHour: 6 });
  const [gcalStatus, setGcalStatus] = useState({ connected: false, hasCredentials: false, calendarId: null });
  const [calendars, setCalendars] = useState([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    loadAll();
    // Detecta retorno do OAuth
    if (searchParams.get('gcal_success')) {
      Toast.fire({ icon: 'success', title: '✅ Google Calendar conectado!' });
      loadGcalStatus();
    }
    if (searchParams.get('gcal_error')) {
      const err = searchParams.get('gcal_error');
      const msgs = { missing_credentials: 'Salve o Client ID e Secret antes de conectar.', token_exchange_failed: 'Falha na troca de tokens. Verifique as credenciais.' };
      Swal.fire({ icon: 'error', title: msgs[err] || `Erro: ${err}`, background: '#18181b', color: '#f4f4f5' });
    }
  }, []);

  const loadAll = async () => {
    const [keysRes, gcalStatusRes] = await Promise.all([
      axios.get(`${API}/config/keys`).catch(() => ({ data: {} })),
      axios.get(`${API}/auth/google/status`).catch(() => ({ data: {} })),
    ]);
    const data = keysRes.data;
    setKeys({ openai: data.openai || '', claude: data.claude || '', activeModel: data.activeModel || 'openai' });
    setGcal({ clientId: data.gcalClientId || '', clientSecret: data.gcalClientSecret || '', syncHour: data.gcalSyncHour ?? 6 });
    setBusiness({ businessName: data.businessName || '', managerJid: data.managerJid || '', deliveryJid: data.deliveryJid || '', reportEnabled: data.reportEnabled || false, reportHour: data.reportHour ?? 7 });
    setGcalStatus(gcalStatusRes.data);
  };

  const loadGcalStatus = async () => {
    const res = await axios.get(`${API}/auth/google/status`).catch(() => ({ data: {} }));
    setGcalStatus(res.data);
  };

  const loadCalendars = async () => {
    setLoadingCalendars(true);
    try {
      const res = await axios.get(`${API}/auth/google/calendars`);
      setCalendars(res.data);
    } catch {
      Toast.fire({ icon: 'error', title: 'Erro ao listar calendários.' });
    } finally { setLoadingCalendars(false); }
  };

  const handleSaveKeys = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/config/keys`, {
        ...keys,
        gcalClientId: gcal.clientId,
        gcalClientSecret: gcal.clientSecret,
        gcalSyncHour: gcal.syncHour,
        ...business
      });
      Toast.fire({ icon: 'success', title: 'Configurações salvas!' });
    } catch { Toast.fire({ icon: 'error', title: 'Erro ao salvar.' }); }
    finally { setLoading(false); }
  };

  const handleConnect = () => {
    window.location.href = `${API}/auth/google`;
  };

  const handleDisconnect = async () => {
    const r = await Swal.fire({ title: 'Desconectar Google Calendar?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim', cancelButtonText: 'Não', background: '#18181b', color: '#f4f4f5' });
    if (r.isConfirmed) {
      await axios.post(`${API}/auth/google/disconnect`);
      setGcalStatus({ connected: false, hasCredentials: gcalStatus.hasCredentials });
      setCalendars([]);
      Toast.fire({ icon: 'info', title: 'Google Calendar desconectado.' });
    }
  };

  const selectCalendar = async (calendarId) => {
    await axios.patch(`${API}/auth/google/calendar`, { calendarId });
    setGcalStatus(s => ({ ...s, calendarId }));
    Toast.fire({ icon: 'success', title: 'Calendário selecionado!' });
  };

  const inp = (extra = {}) => ({
    style: { width: '100%', padding: '11px 14px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '14px', ...extra }
  });

  return (
    <div style={{ padding: '30px', maxWidth: '860px', margin: '0 auto' }}>
      <div style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Configurações do Sistema</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Chaves de API, integrações e preferências do negócio</p>
      </div>

      {/* ── Chaves de IA ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Cpu size={20} color="var(--accent-primary)" />
          <h3 style={{ fontWeight: 700 }}>Inteligência Artificial</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>OpenAI API Key</label>
            <div style={{ position: 'relative' }}>
              <Key size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="password" {...inp({ paddingLeft: '36px' })} placeholder="sk-..." value={keys.openai} onChange={e => setKeys(k => ({ ...k, openai: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Anthropic API Key</label>
            <div style={{ position: 'relative' }}>
              <Key size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="password" {...inp({ paddingLeft: '36px' })} placeholder="sk-ant-..." value={keys.claude} onChange={e => setKeys(k => ({ ...k, claude: e.target.value }))} />
            </div>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Modelo Padrão</label>
          <select {...inp()} value={keys.activeModel} onChange={e => setKeys(k => ({ ...k, activeModel: e.target.value }))}>
            <option value="openai">OpenAI — GPT-4o</option>
            <option value="openai-mini">OpenAI — GPT-4o mini</option>
            <option value="openai-nano">OpenAI — GPT-4.1 nano ⚡</option>
            <option value="claude">Anthropic — Claude 3.5 Sonnet</option>
          </select>
        </div>
      </div>

      {/* ── Google Calendar ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <Calendar size={20} color="#3b82f6" />
          <h3 style={{ fontWeight: 700 }}>Google Calendar</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px',
            color: gcalStatus.connected ? '#10b981' : 'var(--text-muted)',
            fontSize: '13px', fontWeight: 600 }}>
            {gcalStatus.connected ? <CheckCircle size={15} /> : <XCircle size={15} />}
            {gcalStatus.connected ? 'Conectado' : 'Desconectado'}
          </div>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
          Configure suas credenciais OAuth 2.0 do Google Cloud Console e clique em Conectar.{' '}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
            style={{ color: '#3b82f6', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            Abrir Google Cloud Console <ExternalLink size={12} />
          </a>
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Client ID</label>
            <input {...inp()} placeholder="xxxxxxxx.apps.googleusercontent.com" value={gcal.clientId} onChange={e => setGcal(g => ({ ...g, clientId: e.target.value }))} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Client Secret</label>
            <input type="password" {...inp()} placeholder="GOCSPX-..." value={gcal.clientSecret} onChange={e => setGcal(g => ({ ...g, clientSecret: e.target.value }))} />
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
            Hora do Sync automático (cron)
          </label>
          <select {...inp()} style={{ ...inp().style, width: '200px' }} value={gcal.syncHour} onChange={e => setGcal(g => ({ ...g, syncHour: parseInt(e.target.value) }))}>
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>

        {/* Botões de conexão */}
        {!gcalStatus.connected ? (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={handleConnect} disabled={!gcal.clientId || !gcal.clientSecret}
              style={{ opacity: (!gcal.clientId || !gcal.clientSecret) ? 0.5 : 1 }}>
              <Globe size={16} /> Conectar com Google
            </button>
            {(!gcal.clientId || !gcal.clientSecret) && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Preencha Client ID e Secret primeiro e salve</span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Seletor de calendário */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Calendário ativo</label>
                <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '5px 12px' }} onClick={loadCalendars} disabled={loadingCalendars}>
                  <RefreshCw size={13} className={loadingCalendars ? 'animate-spin' : ''} />
                  {loadingCalendars ? 'Carregando...' : 'Listar calendários'}
                </button>
              </div>

              {calendars.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {calendars.map(c => (
                    <div key={c.id} onClick={() => selectCalendar(c.id)} style={{
                      padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                      backgroundColor: gcalStatus.calendarId === c.id ? 'rgba(59,130,246,0.12)' : 'var(--bg-tertiary)',
                      border: `1px solid ${gcalStatus.calendarId === c.id ? 'rgba(59,130,246,0.4)' : 'var(--border-color)'}`,
                      transition: 'all 0.15s'
                    }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: gcalStatus.calendarId === c.id ? '#3b82f6' : 'var(--border-color)', flexShrink: 0 }} />
                      <span style={{ fontWeight: gcalStatus.calendarId === c.id ? 700 : 400, fontSize: '14px' }}>{c.name}</span>
                      {c.primary && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>Principal</span>}
                    </div>
                  ))}
                </div>
              )}

              {gcalStatus.calendarId && calendars.length === 0 && (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Calendário selecionado: <strong style={{ color: 'var(--text-primary)' }}>{gcalStatus.calendarId}</strong>
                </div>
              )}
            </div>

            <button className="btn btn-secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)', width: 'fit-content' }} onClick={handleDisconnect}>
              <XCircle size={16} /> Desconectar Google Calendar
            </button>
          </div>
        )}
      </div>

      {/* ── Configurações do Negócio ─────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Globe size={20} color="#10b981" />
          <h3 style={{ fontWeight: 700 }}>Configurações do Negócio</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Nome do Negócio</label>
            <input {...inp()} placeholder="Ex: Confeitaria da Ana" value={business.businessName} onChange={e => setBusiness(b => ({ ...b, businessName: e.target.value }))} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>WhatsApp do Gestor (relatórios)</label>
            <input {...inp()} placeholder="5511999999999@s.whatsapp.net" value={business.managerJid} onChange={e => setBusiness(b => ({ ...b, managerJid: e.target.value }))} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>WhatsApp da Cozinha (delivery)</label>
            <input {...inp()} placeholder="5511999999999@s.whatsapp.net" value={business.deliveryJid} onChange={e => setBusiness(b => ({ ...b, deliveryJid: e.target.value }))} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>Hora do relatório diário</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <select {...inp()} style={{ ...inp().style, flex: 1 }} value={business.reportHour} onChange={e => setBusiness(b => ({ ...b, reportHour: parseInt(e.target.value) }))}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={business.reportEnabled} onChange={e => setBusiness(b => ({ ...b, reportEnabled: e.target.checked }))} />
                Ativar
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── Salvar ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSaveKeys} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={18} /> : <><Save size={18} /> Salvar Configurações</>}
        </button>
      </div>

      {/* ── Info de segurança ────────────────────────────────── */}
      <div className="card" style={{ marginTop: '20px', border: '1px solid rgba(16,185,129,0.2)', backgroundColor: 'rgba(16,185,129,0.05)' }}>
        <div style={{ display: 'flex', gap: '15px' }}>
          <Shield size={24} color="var(--success)" />
          <div>
            <h4 style={{ color: 'var(--success)', marginBottom: '5px' }}>Segurança de Dados</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Suas chaves e tokens são armazenados localmente no banco de dados SQLite do servidor.
              Nenhuma informação é enviada para servidores externos além das APIs configuradas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
