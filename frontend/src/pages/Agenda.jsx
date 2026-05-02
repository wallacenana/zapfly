import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, RefreshCw, CheckCircle, Clock, XCircle, ChevronLeft, ChevronRight, Package, Truck } from 'lucide-react';

import Swal from 'sweetalert2';
import ReactDOM from 'react-dom';

import { api, API_URL } from '../api';

const STATUS_CONFIG = {
  pending: { label: 'Pendente', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: Clock },
  production: { label: 'Em Produção', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: Package },
  ready: { label: 'Pronto/Entrega', color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: Truck },
  completed: { label: 'Finalizado', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: CheckCircle },
  cancelled: { label: 'Cancelado', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: XCircle },
};

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function toDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function OrderModal({ onClose, onSaved, date }) {
  const [activeTab, setActiveTab] = useState('order'); // 'order' ou 'delivery'
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [variations, setVariations] = useState([]);
  const [form, setForm] = useState({
    clientName: '', clientJid: '', product: '', productId: '', quantity: '1',
    notes: '', scheduledDate: date || toDateStr(new Date()), scheduledTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    type: 'order', deliveryAddress: '', paymentMethod: '', variation: '', totalValue: 0
  });
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm(f => ({ ...f, type: activeTab }));
  }, [activeTab]);

  useEffect(() => {
    api.get('/orders/products').then(res => setProducts(res.data));
  }, []);

  const handleProductChange = (e) => {
    const p = products.find(prod => prod.id === e.target.value);
    setSelectedProduct(p);

    if (p) {
      const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
      setVariations(vars);

      if (vars.length === 0) {
        setForm(f => ({ ...f, productId: p.id, product: p.name, variation: '', totalValue: p.price * (parseFloat(f.quantity) || 1) }));
      } else {
        setForm(f => ({ ...f, productId: p.id, product: p.name, variation: '', totalValue: 0 }));
      }
    } else {
      setVariations([]);
      setForm(f => ({ ...f, productId: '', product: '', variation: '', totalValue: 0 }));
    }
  };

  const handleVariationChange = (e) => {
    const vName = e.target.value;
    const v = variations.find(varItem => varItem.name === vName);
    if (v && selectedProduct) {
      const price = v.price || selectedProduct.price || 0;
      setForm(f => ({
        ...f,
        variation: vName,
        product: `${selectedProduct.name} (${vName})`,
        totalValue: price * (parseFloat(f.quantity) || 1)
      }));
    }
  };

  const checkAvailability = useCallback(async () => {
    if (!form.scheduledDate || !form.scheduledTime) return;
    try {
      const res = await api.get('/orders/availability', { params: { date: form.scheduledDate, time: form.scheduledTime } });
      setAvailability(res.data);
    } catch { setAvailability(null); }
  }, [form.scheduledDate, form.scheduledTime]);

  useEffect(() => { checkAvailability(); }, [checkAvailability]);

  const handleSubmit = async () => {
    if (!form.product || !form.scheduledDate || !form.scheduledTime) {
      return Swal.fire({ icon: 'warning', title: 'Preencha os campos obrigatórios.', background: '#18181b', color: '#f4f4f5' });
    }

    if (variations.length > 0 && !form.variation) {
      return Swal.fire({ icon: 'warning', title: 'Por favor, selecione o tamanho/variação.', background: '#18181b', color: '#f4f4f5' });
    }

    if (activeTab === 'order' && availability && !availability.available) {
      return Swal.fire({ icon: 'error', title: availability.reason, background: '#18181b', color: '#f4f4f5' });
    }

    setLoading(true);
    try {
      await api.post('/orders', form);
      onSaved();
      onClose();
    } catch (e) {
      Swal.fire({ icon: 'error', title: e.response?.data?.error || 'Erro ao salvar.', background: '#18181b', color: '#f4f4f5' });
    } finally { setLoading(false); }
  };

  const filteredProducts = activeTab === 'delivery'
    ? products.filter(p => p.type === 'delivery')
    : products;

  const inp = { style: { width: '100%', padding: '12px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '14px', outline: 'none' } };

  const tabStyle = (id) => ({
    flex: 1, padding: '12px', textAlign: 'center', cursor: 'pointer', fontWeight: 800, fontSize: '13px',
    backgroundColor: activeTab === id ? 'var(--bg-tertiary)' : 'transparent',
    color: activeTab === id ? '#fff' : 'var(--text-muted)',
    borderBottom: activeTab === id ? '3px solid ' + (id === 'delivery' ? '#3b82f6' : '#f59e0b') : '3px solid transparent',
    transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
  });

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(8px)' }}>
      <div className="card" style={{ width: '550px', padding: '0', maxHeight: '95vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)' }}>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <div style={tabStyle('delivery')} onClick={() => setActiveTab('delivery')}>
            <Truck size={18} /> PRONTA ENTREGA
          </div>
          <div style={tabStyle('order')} onClick={() => setActiveTab('order')}>
            <Package size={18} /> ENCOMENDA AGENDADA
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '0 20px', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '30px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Cliente</label>
              <input {...inp} placeholder="Nome do cliente" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>WhatsApp</label>
              <input {...inp} placeholder="5511999999999" value={form.clientJid} onChange={e => setForm(f => ({ ...f, clientJid: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: variations.length > 0 ? '1fr 1fr' : '1fr', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Produto</label>
              <select {...inp} value={form.productId} onChange={handleProductChange}>
                <option value="">Escolha um produto...</option>
                {filteredProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {variations.length > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Tamanho / Variação</label>
                <select {...inp} value={form.variation} onChange={handleVariationChange}>
                  <option value="">Selecione...</option>
                  {variations.map((v, idx) => (
                    <option key={idx} value={v.name}>{v.name} — R$ {v.price?.toFixed(2)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Quantidade</label>
              <input {...inp} type="number" min="1" value={form.quantity} onChange={e => {
                const q = e.target.value;
                setForm(f => ({ ...f, quantity: q, totalValue: (f.totalValue / (parseFloat(f.quantity) || 1)) * (parseFloat(q) || 1) }));
              }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Data</label>
              <input {...inp} type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Horário</label>
              <input {...inp} type="time" value={form.scheduledTime} onChange={e => setForm(f => ({ ...f, scheduledTime: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)' }}>VALOR TOTAL:</span>
            <span style={{ fontSize: '20px', fontWeight: 900, color: '#10b981' }}>R$ {form.totalValue?.toFixed(2) || '0.00'}</span>
          </div>

          {availability && (
            <div style={{
              padding: '12px', borderRadius: '10px', marginBottom: '20px',
              backgroundColor: availability.available ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)',
              border: `1px solid ${availability.available ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
              color: availability.available ? '#10b981' : '#ef4444', fontSize: '13px', fontWeight: 700, display: 'flex', gap: '8px', alignItems: 'center'
            }}>
              {availability.available ? '✓ Horário Disponível' : `✗ ${availability.reason}`}
              {activeTab === 'delivery' && !availability.available && <span style={{ fontSize: '10px', opacity: 0.7 }}>(Permitido p/ Delivery)</span>}
            </div>
          )}

          {activeTab === 'delivery' && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Endereço de Entrega</label>
              <input {...inp} placeholder="Rua, número, bairro..." value={form.deliveryAddress} onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))} />
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Forma de Pagamento</label>
            <select {...inp} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
              <option value="">Selecione...</option>
              <option value="Pix">Pix</option>
              <option value="Cartão de Crédito">Cartão de Crédito</option>
              <option value="Cartão de Débito">Cartão de Débito</option>
              <option value="Dinheiro">Dinheiro</option>
            </select>
          </div>

          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase' }}>Observações</label>
            <textarea {...inp} rows={2} placeholder="Algum detalhe especial?" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inp.style, resize: 'none' }} />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" style={{ flex: 1, padding: '14px' }} onClick={onClose}>Cancelar</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, padding: '14px', backgroundColor: activeTab === 'delivery' ? '#3b82f6' : '#f59e0b' }}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Processando...' : activeTab === 'delivery' ? 'Lançar Delivery' : 'Confirmar Encomenda'}
            </button>
          </div>
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
    await api.patch(`/orders/${order.id}`, { status });
    onUpdate();
  };

  const openDetails = () => {
    const orderIdShort = (order.id || '').slice(-4).toUpperCase();
    const formattedDate = (order.scheduledDate || '').split('-').reverse().join('/');
    const quantity = parseFloat(order.quantity) || 1;
    // Pega o preço real do produto (ou da variação se tivéssemos salvo, mas vamos no preço base por enquanto)
    const unitPrice = order.totalValue > 0 ? (order.totalValue - (order.deliveryFee || 0)) / quantity : 0;
    const itemsSubtotal = unitPrice * quantity;
    const freightValue = order.deliveryFee || 0;
    
    let notesHtml = '';
    // Limpa a tag de frete da exibição visual das notas para não ficar repetitivo
    const cleanNotes = (order.notes || '').replace(/\[Frete: R\$ [\d.]+\]/, '').trim();

    if (cleanNotes) {
      notesHtml = `
            <div style="margin-top: 12px; font-size: 13px;">
                "${cleanNotes}"
            </div>`;
    }

    let addressHtml = '<div style="color: #10b981; font-weight: 800; font-size: 12px; margin-top: 10px;">🏠 RETIRADA NO LOCAL</div>';
    if (order.deliveryAddress) {
      addressHtml = `
            <div style="font-size: 12px; color: #9ca3af; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; margin-top: 10px;">
                📍 ${order.deliveryAddress}
            </div>`;
    }

    Swal.fire({
      background: '#111827',
      color: '#fff',
      width: '500px',
      showCloseButton: true,
      showConfirmButton: false,
      html: `
        <div style="text-align: left; font-family: 'Inter', sans-serif; padding: 10px;">
          <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: #3b82f6; font-weight: 900; letter-spacing: 1px;">PEDIDO #${orderIdShort}</span>
            <div style="background: ${cfg.bg}; color: ${cfg.color}; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 800; text-transform: uppercase;">${cfg.label}</div>
          </div>

          <div style="background: rgba(255,255,255,0.03); border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 20px;">
            <div style="display: flex; gap: 15px; align-items: center; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px;">
               <div style="background: #3b82f6; color: #fff; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 18px; font-weight: 900;">
                 ${quantity}
               </div>
               <div>
                  <div style="font-weight: 800; font-size: 16px; color: #fff;">${order.product}</div>
                  <div style="font-size: 12px; color: var(--text-muted);">Preço un.: R$ ${unitPrice.toFixed(2)}</div>
               </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px;">
              <span style="color: #9ca3af;">Subtotal Itens</span>
              <span style="color: #fff;">R$ ${itemsSubtotal.toFixed(2)}</span>
            </div>
            ${freightValue > 0 ? `
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; color: #fbbf24;">
              <span>Taxa de Entrega</span>
              <span>R$ ${freightValue.toFixed(2)}</span>
            </div>
            ` : ''}
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; font-size: 13px; color: #9ca3af;">TOTAL A RECEBER</span>
              <span style="font-weight: 900; font-size: 24px; color: #10b981;">R$ ${order.totalValue.toFixed(2)}</span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: #9ca3af; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">📅 Horário</div>
              <div style="font-size: 14px; font-weight: 800; color: #fff;">${order.scheduledTime} - ${formattedDate}</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: #9ca3af; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">💰 Pagamento</div>
              <div style="font-size: 14px; font-weight: 800; color: #fbbf24;">${order.paymentMethod || 'A COMBINAR'}</div>
            </div>
          </div>

          <div style="padding: 15px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dotted rgba(255,255,255,0.1);">
            <div style="font-weight: 800; font-size: 14px; color: #fff; margin-bottom: 5px;">${order.clientName || 'Cliente'}</div>
            ${addressHtml}
            ${notesHtml}
          </div>
        </div>
      `
    });
  };

  return (
    <div className="card" onClick={openDetails} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', cursor: 'pointer', transition: 'transform 0.2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>{order.product}</div>
          {order.quantity && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{order.quantity}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px',
            backgroundColor: cfg.bg, color: cfg.color, fontSize: '11px', fontWeight: 700
          }}>
            <Icon size={12} />
            {cfg.label}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#fff' }}>
            R$ {order.totalValue?.toFixed(2) || '0.00'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        <span>📅 {order.scheduledDate}</span>
        <span>🕐 {order.scheduledTime}</span>
        {order.type === 'delivery' && <span>🛵 Delivery</span>}
      </div>

      {order.clientName && <div style={{ fontSize: '13px' }}>👤 {order.clientName}</div>}
      {order.notes && <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.notes}</div>}
      {order.calendarEventId && <div style={{ fontSize: '11px', color: '#3b82f6' }}>📆 Sincronizado com Google Calendar</div>}

      <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
        {order.status === 'pending' && (
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '6px' }} onClick={(e) => { e.stopPropagation(); changeStatus('production'); }}>Iniciar Produção</button>
        )}
        {order.status === 'production' && (
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '6px', color: '#10b981' }} onClick={(e) => { e.stopPropagation(); changeStatus('ready'); }}>Marcar Pronto</button>
        )}
        {order.status === 'ready' && (
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '6px', color: '#6b7280' }} onClick={(e) => { e.stopPropagation(); changeStatus('completed'); }}>Finalizar</button>
        )}
        {order.status !== 'cancelled' && order.status !== 'completed' && (
          <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px', color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); changeStatus('cancelled'); }}>Cancelar</button>
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
    <div className="card" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button className="btn-icon" onClick={() => setCurrent(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
        <span style={{ fontWeight: 700, fontSize: '15px' }}>{MONTHS[month]} {year}</span>
        <button className="btn-icon" onClick={() => setCurrent(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '8px' }}>
        {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, padding: '4px' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === toDateStr(new Date());
          const has = hasOrders(day);
          return (
            <div key={day} onClick={() => onSelect(dateStr)} style={{
              textAlign: 'center', padding: '6px 2px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
              fontWeight: isSelected || isToday ? 700 : 400,
              backgroundColor: isSelected ? 'var(--accent-primary)' : isToday ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: isSelected ? '#fff' : isToday ? 'var(--accent-primary)' : 'var(--text-primary)',
              position: 'relative', transition: 'all 0.15s'
            }}>
              {day}
              {has && !isSelected && (
                <div style={{
                  width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#10b981',
                  position: 'absolute', bottom: '2px', left: '50%', transform: 'translateX(-50%)'
                }} />
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
      api.get('/orders').catch(() => ({ data: [] })),
      api.get('/orders/calendar-events').catch(() => ({ data: [] })),
    ]);
    setOrders(ordRes.data);
    setCalendarEvents(calRes.data);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const syncCalendar = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/orders/calendar-sync');
      Swal.fire({
        icon: 'success',
        title: 'Sincronização Concluída!',
        html: `<div style="text-align:center">${res.data.synced} eventos recebidos<br/>${res.data.pushed} pedidos enviados</div>`,
        background: '#18181b',
        color: '#f4f4f5',
        timer: 3000,
        showConfirmButton: false
      });
      fetchAll();
    } catch {
      Swal.fire({ icon: 'error', title: 'Verifique as credenciais do Google Calendar nas Configurações.', background: '#18181b', color: '#f4f4f5' });
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
    <div style={{ padding: '30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700 }}>Agenda de Pedidos</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie agendamentos, deliveries e disponibilidade</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={syncCalendar} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sync Google Calendar'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={18} /> Novo Pedido
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '30px' }}>
        {[
          { label: 'Pedidos Hoje', value: stats.today, color: '#3b82f6', icon: '📅' },
          { label: 'Pendentes', value: stats.pending, color: '#f59e0b', icon: '⏳' },
          { label: 'Próximos 7 dias', value: stats.week, color: '#10b981', icon: '📆' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', marginBottom: '4px' }}>{s.icon}</div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <MiniCalendar selectedDate={selectedDate} onSelect={setSelectedDate} orders={orders} />

          {calendarEvents.length > 0 && (
            <div className="card" style={{ padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>
                📆 Google Calendar
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {calendarEvents.slice(0, 5).map(e => (
                  <div key={e.id} style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.08)', borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{e.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {new Date(e.startAt).toLocaleDateString('pt-BR')} {new Date(e.startAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontWeight: 700 }}>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '10px' }}>
                {filteredOrders.length} pedido(s)
              </span>
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['all', 'pending', 'production', 'ready', 'completed', 'cancelled'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{
                  padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none',
                  backgroundColor: filterStatus === s ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: filterStatus === s ? '#fff' : 'var(--text-secondary)'
                }}>
                  {s === 'all' ? 'Todos' : STATUS_CONFIG[s]?.label}
                </button>
              ))}
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="card" style={{ padding: '60px 20px', textAlign: 'center', border: '1px dashed var(--border-color)' }}>
              <Calendar size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
              <p style={{ color: 'var(--text-secondary)' }}>Nenhum pedido para este dia.</p>
              <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={() => setShowModal(true)}>
                <Plus size={16} /> Adicionar Pedido
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {filteredOrders.map(o => <OrderCard key={o.id} order={o} onUpdate={fetchAll} />)}
            </div>
          )}
        </div>
      </div>

      {showModal && <OrderModal onClose={() => setShowModal(false)} onSaved={fetchAll} date={selectedDate} />}
    </div>
  );
}
