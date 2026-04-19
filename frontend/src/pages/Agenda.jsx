import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, RefreshCw, CheckCircle, Clock, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import Swal from 'sweetalert2';
import ReactDOM from 'react-dom';

const API = 'http://localhost:3001/orders';

const STATUS_CONFIG = {
  pending:   { label: 'Pendente',   color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',   icon: Clock },
  confirmed: { label: 'Confirmado', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',   icon: CheckCircle },
  done:      { label: 'Concluído',  color: '#10b981', bg: 'rgba(16,185,129,0.1)',   icon: CheckCircle },
  cancelled: { label: 'Cancelado',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)',    icon: XCircle },
};

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function OrderModal({ onClose, onSaved, date }) {
  const [form, setForm] = useState({
    clientName: '', clientJid: '', product: '', quantity: '',
    notes: '', scheduledDate: date || toDateStr(new Date()), scheduledTime: '09:00', type: 'order', deliveryAddress: ''
  });
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);

  const checkAvailability = useCallback(async () => {
    if (!form.scheduledDate || !form.scheduledTime) return;
    try {
      const res = await axios.get(`${API}/availability`, { params: { date: form.scheduledDate, time: form.scheduledTime } });
      setAvailability(res.data);
    } catch { setAvailability(null); }
  }, [form.scheduledDate, form.scheduledTime]);

  useEffect(() => { checkAvailability(); }, [checkAvailability]);

  const handleSubmit = async () => {
    if (!form.product || !form.scheduledDate || !form.scheduledTime) {
      return Swal.fire({ icon: 'warning', title: 'Preencha produto, data e horário.', background: '#18181b', color: '#f4f4f5' });
    }
    if (availability && !availability.available) {
      return Swal.fire({ icon: 'error', title: availability.reason, background: '#18181b', color: '#f4f4f5' });
    }
    setLoading(true);
    try {
      await axios.post(API, form);
      onSaved();
      onClose();
    } catch (e) {
      Swal.fire({ icon: 'error', title: e.response?.data?.error || 'Erro ao salvar.', background: '#18181b', color: '#f4f4f5' });
    } finally { setLoading(false); }
  };

  const inp = { style: { width: '100%', padding: '10px 14px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '14px' } };

  return ReactDOM.createPortal(
    <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, backdropFilter:'blur(5px)' }}>
      <div className="card" style={{ width: '500px', padding: '30px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'24px' }}>
          <h3 style={{ fontSize:'20px', fontWeight:700 }}>Novo Pedido / Agendamento</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'16px' }}>
          <div>
            <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Cliente</label>
            <input {...inp} placeholder="Nome do cliente" value={form.clientName} onChange={e => setForm(f => ({...f, clientName: e.target.value}))} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>WhatsApp</label>
            <input {...inp} placeholder="5511999999999" value={form.clientJid} onChange={e => setForm(f => ({...f, clientJid: e.target.value}))} />
          </div>
        </div>

        <div style={{ marginBottom:'16px' }}>
          <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Produto / Serviço *</label>
          <input {...inp} placeholder="Ex: Bolo de chocolate 2kg" value={form.product} onChange={e => setForm(f => ({...f, product: e.target.value}))} />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'16px', marginBottom:'16px' }}>
          <div>
            <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Quantidade</label>
            <input {...inp} placeholder="Ex: 2kg" value={form.quantity} onChange={e => setForm(f => ({...f, quantity: e.target.value}))} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Data *</label>
            <input {...inp} type="date" value={form.scheduledDate} onChange={e => setForm(f => ({...f, scheduledDate: e.target.value}))} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Horário *</label>
            <input {...inp} type="time" value={form.scheduledTime} onChange={e => setForm(f => ({...f, scheduledTime: e.target.value}))} />
          </div>
        </div>

        {availability && (
          <div style={{ padding:'10px 14px', borderRadius:'8px', marginBottom:'16px',
            backgroundColor: availability.available ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${availability.available ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
            color: availability.available ? '#10b981' : '#ef4444', fontSize:'13px', fontWeight:600
          }}>
            {availability.available ? '✓ Horário disponível' : `✗ ${availability.reason}`}
          </div>
        )}

        <div style={{ marginBottom:'16px' }}>
          <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Tipo</label>
          <select {...inp} value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
            <option value="order">Encomenda</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>

        {form.type === 'delivery' && (
          <div style={{ marginBottom:'16px' }}>
            <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Endereço de entrega</label>
            <input {...inp} placeholder="Rua, número, bairro..." value={form.deliveryAddress} onChange={e => setForm(f => ({...f, deliveryAddress: e.target.value}))} />
          </div>
        )}

        <div style={{ marginBottom:'24px' }}>
          <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Observações</label>
          <textarea {...inp} rows={3} placeholder="Detalhes adicionais..." value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} style={{...inp.style, resize:'vertical'}} />
        </div>

        <div style={{ display:'flex', gap:'12px' }}>
          <button className="btn btn-secondary" style={{ flex:1 }} onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" style={{ flex:1 }} onClick={handleSubmit} disabled={loading || (availability && !availability.available)}>
            {loading ? 'Salvando...' : 'Criar Pedido'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function OrderCard({ order, onUpdate }) {
  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  const changeStatus = async (status) => {
    await axios.patch(`${API}/${order.id}`, { status });
    onUpdate();
  };

  return (
    <div className="card" style={{ padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'15px' }}>{order.product}</div>
          {order.quantity && <div style={{ fontSize:'12px', color:'var(--text-muted)' }}>{order.quantity}</div>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'4px 10px', borderRadius:'20px',
          backgroundColor: cfg.bg, color: cfg.color, fontSize:'11px', fontWeight:700 }}>
          <Icon size={12} />
          {cfg.label}
        </div>
      </div>

      <div style={{ display:'flex', gap:'12px', fontSize:'13px', color:'var(--text-secondary)' }}>
        <span>📅 {order.scheduledDate}</span>
        <span>🕐 {order.scheduledTime}</span>
        {order.type === 'delivery' && <span>🛵 Delivery</span>}
      </div>

      {order.clientName && <div style={{ fontSize:'13px' }}>👤 {order.clientName}</div>}
      {order.notes && <div style={{ fontSize:'12px', color:'var(--text-muted)', fontStyle:'italic' }}>{order.notes}</div>}
      {order.calendarEventId && <div style={{ fontSize:'11px', color:'#3b82f6' }}>📆 Sincronizado com Google Calendar</div>}

      <div style={{ display:'flex', gap:'8px', paddingTop:'8px', borderTop:'1px solid var(--border-color)' }}>
        {order.status === 'pending' && (
          <button className="btn btn-secondary" style={{ flex:1, fontSize:'12px', padding:'6px' }} onClick={() => changeStatus('confirmed')}>Confirmar</button>
        )}
        {order.status === 'confirmed' && (
          <button className="btn btn-secondary" style={{ flex:1, fontSize:'12px', padding:'6px', color:'#10b981' }} onClick={() => changeStatus('done')}>Concluir</button>
        )}
        {order.status !== 'cancelled' && order.status !== 'done' && (
          <button className="btn btn-secondary" style={{ fontSize:'12px', padding:'6px', color:'#ef4444' }} onClick={() => changeStatus('cancelled')}>Cancelar</button>
        )}
      </div>
    </div>
  );
}

function MiniCalendar({ selectedDate, onSelect, orders }) {
  const [current, setCurrent] = useState(new Date(selectedDate + 'T12:00:00'));
  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const hasOrders = (day) => {
    const d = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return orders.some(o => o.scheduledDate === d && o.status !== 'cancelled');
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="card" style={{ padding:'20px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
        <button className="btn-icon" onClick={() => setCurrent(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
        <span style={{ fontWeight:700, fontSize:'15px' }}>{MONTHS[month]} {year}</span>
        <button className="btn-icon" onClick={() => setCurrent(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'2px', marginBottom:'8px' }}>
        {DAYS.map(d => <div key={d} style={{ textAlign:'center', fontSize:'11px', color:'var(--text-muted)', fontWeight:700, padding:'4px' }}>{d}</div>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'2px' }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === toDateStr(new Date());
          const has = hasOrders(day);
          return (
            <div key={day} onClick={() => onSelect(dateStr)} style={{
              textAlign:'center', padding:'6px 2px', borderRadius:'8px', fontSize:'13px', cursor:'pointer',
              fontWeight: isSelected || isToday ? 700 : 400,
              backgroundColor: isSelected ? 'var(--accent-primary)' : isToday ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: isSelected ? '#fff' : isToday ? 'var(--accent-primary)' : 'var(--text-primary)',
              position:'relative', transition:'all 0.15s'
            }}>
              {day}
              {has && !isSelected && (
                <div style={{ width:'4px', height:'4px', borderRadius:'50%', backgroundColor:'#10b981',
                  position:'absolute', bottom:'2px', left:'50%', transform:'translateX(-50%)' }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Agenda() {
  const [orders, setOrders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [filterStatus, setFilterStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const fetchAll = useCallback(async () => {
    const [ordRes, calRes] = await Promise.all([
      axios.get(API).catch(() => ({ data: [] })),
      axios.get(`${API}/calendar-events`).catch(() => ({ data: [] })),
    ]);
    setOrders(ordRes.data);
    setCalendarEvents(calRes.data);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const syncCalendar = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/calendar-sync`);
      Swal.fire({ icon:'success', title:`${res.data.synced} eventos sincronizados!`, background:'#18181b', color:'#f4f4f5', timer:2000, showConfirmButton:false });
      fetchAll();
    } catch {
      Swal.fire({ icon:'error', title:'Verifique as credenciais do Google Calendar nas Configurações.', background:'#18181b', color:'#f4f4f5' });
    } finally { setSyncing(false); }
  };

  const ordersForDate = orders.filter(o => o.scheduledDate === selectedDate);
  const filteredOrders = filterStatus === 'all' ? ordersForDate : ordersForDate.filter(o => o.status === filterStatus);

  const stats = {
    today: orders.filter(o => o.scheduledDate === toDateStr(new Date()) && o.status !== 'cancelled').length,
    pending: orders.filter(o => o.status === 'pending').length,
    week: orders.filter(o => {
      const d = new Date(o.scheduledDate + 'T12:00:00');
      const now = new Date();
      return d >= now && d <= new Date(now.getTime() + 7 * 86400000) && o.status !== 'cancelled';
    }).length,
  };

  return (
    <div style={{ padding:'30px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'30px' }}>
        <div>
          <h2 style={{ fontSize:'24px', fontWeight:700 }}>Agenda de Pedidos</h2>
          <p style={{ color:'var(--text-secondary)' }}>Gerencie agendamentos, deliveries e disponibilidade</p>
        </div>
        <div style={{ display:'flex', gap:'12px' }}>
          <button className="btn btn-secondary" onClick={syncCalendar} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sync Google Calendar'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={18} /> Novo Pedido
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'16px', marginBottom:'30px' }}>
        {[
          { label:'Pedidos Hoje', value: stats.today, color:'#3b82f6', icon:'📅' },
          { label:'Pendentes', value: stats.pending, color:'#f59e0b', icon:'⏳' },
          { label:'Próximos 7 dias', value: stats.week, color:'#10b981', icon:'📆' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding:'20px', textAlign:'center' }}>
            <div style={{ fontSize:'28px', marginBottom:'4px' }}>{s.icon}</div>
            <div style={{ fontSize:'32px', fontWeight:800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize:'13px', color:'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:'24px' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
          <MiniCalendar selectedDate={selectedDate} onSelect={setSelectedDate} orders={orders} />

          {calendarEvents.length > 0 && (
            <div className="card" style={{ padding:'16px' }}>
              <div style={{ fontSize:'12px', fontWeight:700, color:'var(--text-muted)', marginBottom:'12px', textTransform:'uppercase' }}>
                📆 Google Calendar
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {calendarEvents.slice(0, 5).map(e => (
                  <div key={e.id} style={{ padding:'8px', borderRadius:'8px', backgroundColor:'rgba(59,130,246,0.08)', borderLeft:'3px solid #3b82f6' }}>
                    <div style={{ fontSize:'13px', fontWeight:600 }}>{e.title}</div>
                    <div style={{ fontSize:'11px', color:'var(--text-muted)' }}>
                      {new Date(e.startAt).toLocaleDateString('pt-BR')} {new Date(e.startAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
            <h3 style={{ fontWeight:700 }}>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' })}
              <span style={{ fontSize:'13px', color:'var(--text-muted)', fontWeight:400, marginLeft:'10px' }}>
                {filteredOrders.length} pedido(s)
              </span>
            </h3>
            <div style={{ display:'flex', gap:'8px' }}>
              {['all','pending','confirmed','done','cancelled'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{
                  padding:'5px 12px', borderRadius:'20px', fontSize:'12px', fontWeight:600, cursor:'pointer', border:'none',
                  backgroundColor: filterStatus === s ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: filterStatus === s ? '#fff' : 'var(--text-secondary)'
                }}>
                  {s === 'all' ? 'Todos' : STATUS_CONFIG[s]?.label}
                </button>
              ))}
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="card" style={{ padding:'60px 20px', textAlign:'center', border:'1px dashed var(--border-color)' }}>
              <Calendar size={40} style={{ color:'var(--text-muted)', margin:'0 auto 16px' }} />
              <p style={{ color:'var(--text-secondary)' }}>Nenhum pedido para este dia.</p>
              <button className="btn btn-primary" style={{ marginTop:'16px' }} onClick={() => setShowModal(true)}>
                <Plus size={16} /> Adicionar Pedido
              </button>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'16px' }}>
              {filteredOrders.map(o => <OrderCard key={o.id} order={o} onUpdate={fetchAll} />)}
            </div>
          )}
        </div>
      </div>

      {showModal && <OrderModal onClose={() => setShowModal(false)} onSaved={fetchAll} date={selectedDate} />}
    </div>
  );
}
