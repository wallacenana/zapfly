import { useEffect, useState } from 'react';
import { CalendarClock, Copy, Plus, RefreshCw, Ticket, Trash2, X } from 'lucide-react';
import { api } from '../api';

const DAYS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
const emptyForm = () => ({
  code: '', name: '', discountType: 'fixed', discountValue: '', freeDelivery: false,
  usageLimit: '', validFrom: '', validUntil: '', active: true, orderSlots: []
});

const dateValue = (value) => value ? String(value).slice(0, 10) : '';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Coupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const loadCoupons = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/coupons');
      setCoupons(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Nao foi possivel carregar os cupons.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCoupons(); }, []);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const addSlot = () => setForm((current) => ({ ...current, orderSlots: [...current.orderSlots, { dayOfWeek: 1, startTime: '07:00', endTime: '09:00' }] }));
  const updateSlot = (index, field, value) => setForm((current) => ({
    ...current,
    orderSlots: current.orderSlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, [field]: field === 'dayOfWeek' ? Number(value) : value } : slot)
  }));
  const removeSlot = (index) => setForm((current) => ({ ...current, orderSlots: current.orderSlots.filter((_, slotIndex) => slotIndex !== index) }));

  const openNew = () => { setForm(emptyForm()); setError(''); setFormOpen(true); };
  const editCoupon = (coupon) => {
    let orderSlots = [];
    try { orderSlots = Array.isArray(coupon.orderSlots) ? coupon.orderSlots : JSON.parse(coupon.orderSlots || '[]'); } catch { orderSlots = []; }
    setForm({
      code: coupon.code || '', name: coupon.name || '', discountType: coupon.discountType === 'percent' ? 'percent' : 'fixed',
      discountValue: coupon.discountValue || '', freeDelivery: Boolean(coupon.freeDelivery), usageLimit: coupon.usageLimit || '',
      validFrom: dateValue(coupon.validFrom), validUntil: dateValue(coupon.validUntil), active: coupon.active !== false,
      orderSlots: Array.isArray(orderSlots) ? orderSlots : []
    });
    setError('');
    setFormOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/coupons', {
        ...form,
        code: form.code.trim().toUpperCase(),
        discountValue: Number(form.discountValue) || 0,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null
      });
      setFormOpen(false);
      await loadCoupons();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Nao foi possivel salvar o cupom.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (coupon) => {
    if (!window.confirm(`Excluir o cupom ${coupon.code}?`)) return;
    try {
      await api.delete(`/coupons/${coupon.id}`);
      setCoupons((current) => current.filter((item) => item.id !== coupon.id));
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Nao foi possivel excluir o cupom.');
    }
  };

  const copyCode = async (code) => {
    try { await navigator.clipboard.writeText(code); } catch { /* Clipboard is optional. */ }
  };

  return <main style={{ padding: '34px 36px 56px', maxWidth: '1320px', margin: '0 auto' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '26px' }}>
      <div><div className="dashboard-eyebrow">Beneficios e horarios especiais</div><h1 style={{ margin: '6px 0 8px', fontSize: '32px', letterSpacing: '-1.2px' }}>Cupons</h1><p style={{ margin: 0, color: 'var(--text-secondary)' }}>Descontos, frete gratis e acesso a horarios exclusivos para clientes especiais.</p></div>
      <div style={{ display: 'flex', gap: '9px' }}><button type="button" className="btn btn-secondary" onClick={loadCoupons} title="Atualizar"><RefreshCw size={16} /></button><button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} /> Novo cupom</button></div>
    </header>
    {error ? <div className="dashboard-alert" style={{ marginBottom: '18px' }}>{error}</div> : null}
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))', gap: '14px', marginBottom: '22px' }}>
      <article style={{ background: '#effcf5', border: '1px solid #a7efd0', borderRadius: '16px', padding: '18px' }}><Ticket size={20} color="#07865d" /><strong style={{ display: 'block', marginTop: '10px' }}>Desconto e frete</strong><small style={{ color: 'var(--text-secondary)' }}>O cupom pode reduzir o pedido, liberar frete ou combinar os dois.</small></article>
      <article style={{ background: '#f1f6ff', border: '1px solid #b8d1ff', borderRadius: '16px', padding: '18px' }}><CalendarClock size={20} color="#2563eb" /><strong style={{ display: 'block', marginTop: '10px' }}>Horario especial</strong><small style={{ color: 'var(--text-secondary)' }}>Clientes com o codigo podem agendar nos horarios definidos abaixo, mesmo fora da agenda normal.</small></article>
    </section>
    <section style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '18px', overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-color)' }}><h2 style={{ margin: 0, fontSize: '18px' }}>Cupons cadastrados</h2></div>
      {loading ? <div style={{ padding: '32px', color: 'var(--text-secondary)' }}>Carregando cupons...</div> : coupons.length === 0 ? <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum cupom cadastrado.</div> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}><thead><tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}><th style={{ padding: '13px 20px' }}>Codigo</th><th>Beneficio</th><th>Horario especial</th><th>Uso</th><th>Validade</th><th /></tr></thead><tbody>{coupons.map((coupon) => {
        let slots = []; try { slots = JSON.parse(coupon.orderSlots || '[]'); } catch { slots = []; }
        const benefit = [Number(coupon.discountValue) > 0 ? (coupon.discountType === 'percent' ? `${coupon.discountValue}% de desconto` : `${money.format(coupon.discountValue)} de desconto`) : '', coupon.freeDelivery ? 'Frete gratis' : ''].filter(Boolean).join(' + ') || 'Horario especial';
        return <tr key={coupon.id} style={{ borderTop: '1px solid #edf1ed' }}><td style={{ padding: '15px 20px' }}><button type="button" onClick={() => copyCode(coupon.code)} style={{ border: 0, background: '#edf9e8', color: '#237800', padding: '6px 9px', borderRadius: '7px', fontWeight: 800, cursor: 'pointer' }}>{coupon.code} <Copy size={12} style={{ verticalAlign: 'middle' }} /></button><small style={{ display: 'block', marginTop: '5px', color: 'var(--text-secondary)' }}>{coupon.name || 'Sem nome'} {coupon.active === false ? ' - inativo' : ''}</small></td><td>{benefit}</td><td>{slots.length ? `${slots.length} horario(s) especial(is)` : '-'}</td><td>{coupon.usedCount || 0}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ' usos'}</td><td>{coupon.validFrom || coupon.validUntil ? `${dateValue(coupon.validFrom) || 'Sem inicio'} ate ${dateValue(coupon.validUntil) || 'Sem fim'}` : 'Sem prazo'}</td><td><button type="button" className="btn btn-secondary" onClick={() => editCoupon(coupon)}>Editar</button> <button type="button" onClick={() => remove(coupon)} aria-label="Excluir cupom" style={{ border: 0, background: 'transparent', color: '#dc2626', cursor: 'pointer', verticalAlign: 'middle' }}><Trash2 size={17} /></button></td></tr>;
      })}</tbody></table></div>}
    </section>
    {formOpen ? <div className="deliveries-modal-backdrop" role="presentation"><form className="deliveries-modal" onSubmit={save} style={{ maxWidth: '720px' }}><div className="deliveries-modal-head"><div><div className="dashboard-eyebrow">Configuracao do cupom</div><h2>{form.code ? `Cupom ${form.code}` : 'Novo cupom'}</h2></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={20} /></button></div><div className="deliveries-form-grid"><label>Codigo<input required value={form.code} onChange={(event) => update('code', event.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="VIPMANHA" /></label><label>Nome interno<input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Mesarios da manha" /></label><label>Tipo de desconto<select value={form.discountType} onChange={(event) => update('discountType', event.target.value)}><option value="fixed">Valor em reais</option><option value="percent">Percentual</option></select></label><label>Desconto<input type="number" min="0" step="0.01" value={form.discountValue} onChange={(event) => update('discountValue', event.target.value)} placeholder="Opcional" /></label><label>Valido a partir de<input type="date" value={form.validFrom} onChange={(event) => update('validFrom', event.target.value)} /></label><label>Valido ate<input type="date" value={form.validUntil} onChange={(event) => update('validUntil', event.target.value)} /></label><label>Limite de usos<input type="number" min="1" step="1" value={form.usageLimit} onChange={(event) => update('usageLimit', event.target.value)} placeholder="Sem limite" /></label></div><label className="deliveries-checkbox"><input type="checkbox" checked={form.freeDelivery} onChange={(event) => update('freeDelivery', event.target.checked)} /> Frete gratis</label><label className="deliveries-checkbox"><input type="checkbox" checked={form.active} onChange={(event) => update('active', event.target.checked)} /> Cupom ativo</label><section style={{ marginTop: '18px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}><div><strong>Horarios especiais para encomendas</strong><small style={{ display: 'block', color: 'var(--text-secondary)', marginTop: '3px' }}>Estes horarios ficam disponiveis somente para quem informar este cupom.</small></div><button type="button" className="btn btn-secondary" onClick={addSlot}><Plus size={15} /> Horario</button></div>{form.orderSlots.map((slot, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px auto', gap: '8px', marginTop: '10px', alignItems: 'end' }}><label>Dia<select value={slot.dayOfWeek} onChange={(event) => updateSlot(index, 'dayOfWeek', event.target.value)}>{DAYS.map((day, dayIndex) => <option value={dayIndex} key={day}>{day}</option>)}</select></label><label>Inicio<input type="time" value={slot.startTime} onChange={(event) => updateSlot(index, 'startTime', event.target.value)} /></label><label>Fim<input type="time" value={slot.endTime} onChange={(event) => updateSlot(index, 'endTime', event.target.value)} /></label><button type="button" onClick={() => removeSlot(index)} style={{ height: '38px', border: 0, background: '#fff1f2', color: '#e11d48', borderRadius: '8px', cursor: 'pointer' }}><Trash2 size={16} /></button></div>)}</section><div className="deliveries-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar cupom'}</button></div></form></div> : null}
  </main>;
}
