import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, AlertTriangle, Package, Edit3, Check } from 'lucide-react';
import axios from 'axios';
import Swal from 'sweetalert2';
import ReactDOM from 'react-dom';

const API = 'http://localhost:3001/orders';
const DAYS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

// ─── ESTOQUE ─────────────────────────────────────────────────────────────────

function StockSection() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', unit: 'kg', quantity: 0, minQuantity: 1 });
  const [editing, setEditing] = useState(null);

  const fetch = useCallback(async () => {
    const res = await axios.get(`${API}/stock`);
    setItems(res.data);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    if (!form.name) return;
    if (editing) {
      await axios.patch(`${API}/stock/${editing}`, form);
      setEditing(null);
    } else {
      await axios.post(`${API}/stock`, form);
    }
    setForm({ name: '', unit: 'kg', quantity: 0, minQuantity: 1 });
    fetch();
  };

  const remove = async (id) => {
    const r = await Swal.fire({ title:'Remover item?', icon:'warning', showCancelButton:true, confirmButtonText:'Sim', cancelButtonText:'Não', background:'#18181b', color:'#f4f4f5' });
    if (r.isConfirmed) { await axios.delete(`${API}/stock/${id}`); fetch(); }
  };

  const startEdit = (item) => {
    setEditing(item.id);
    setForm({ name: item.name, unit: item.unit, quantity: item.quantity, minQuantity: item.minQuantity });
  };

  const inp = { style: { width:'100%', padding:'8px 12px', borderRadius:'8px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff', fontSize:'13px' } };

  return (
    <div>
      <h3 style={{ fontSize:'18px', fontWeight:700, marginBottom:'16px', display:'flex', alignItems:'center', gap:'8px' }}>
        <Package size={20} /> Controle de Estoque
      </h3>

      {/* Form */}
      <div className="card" style={{ padding:'20px', marginBottom:'20px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr auto', gap:'12px', alignItems:'end' }}>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Nome</label>
            <input {...inp} placeholder="Ex: Farinha de trigo" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Unidade</label>
            <select {...inp} value={form.unit} onChange={e => setForm(f => ({...f, unit: e.target.value}))}>
              {['kg','g','L','ml','unidade','pacote','caixa'].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Qtd. em estoque</label>
            <input {...inp} type="number" step="0.1" value={form.quantity} onChange={e => setForm(f => ({...f, quantity: parseFloat(e.target.value)}))} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Qtd. mínima</label>
            <input {...inp} type="number" step="0.1" value={form.minQuantity} onChange={e => setForm(f => ({...f, minQuantity: parseFloat(e.target.value)}))} />
          </div>
          <button className="btn btn-primary" onClick={save} style={{ padding:'8px 16px' }}>
            {editing ? <Check size={16} /> : <Plus size={16} />}
          </button>
        </div>
        {editing && (
          <button className="btn btn-secondary" style={{ marginTop:'10px', fontSize:'12px' }} onClick={() => { setEditing(null); setForm({ name:'', unit:'kg', quantity:0, minQuantity:1 }); }}>
            Cancelar edição
          </button>
        )}
      </div>

      {/* Lista */}
      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
        {items.map(item => (
          <div key={item.id} className="card" style={{ padding:'14px 20px', display:'flex', alignItems:'center', gap:'16px',
            borderColor: item.alert ? 'rgba(239,68,68,0.3)' : 'var(--border-color)',
            backgroundColor: item.alert ? 'rgba(239,68,68,0.04)' : undefined
          }}>
            {item.alert && <AlertTriangle size={18} color="#ef4444" />}
            <div style={{ flex:1 }}>
              <span style={{ fontWeight:600 }}>{item.name}</span>
              {item.alert && <span style={{ fontSize:'11px', color:'#ef4444', marginLeft:'8px', fontWeight:700 }}>ESTOQUE BAIXO</span>}
            </div>
            <div style={{ fontSize:'15px', fontWeight:700, color: item.alert ? '#ef4444' : '#10b981' }}>
              {item.quantity} {item.unit}
            </div>
            <div style={{ fontSize:'12px', color:'var(--text-muted)' }}>
              mín: {item.minQuantity} {item.unit}
            </div>
            <button className="btn-icon" onClick={() => startEdit(item)}><Edit3 size={15} /></button>
            <button className="btn-icon" style={{ color:'#ef4444' }} onClick={() => remove(item.id)}><Trash2 size={15} /></button>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ textAlign:'center', padding:'40px', color:'var(--text-muted)' }}>Nenhum item no estoque ainda.</div>
        )}
      </div>
    </div>
  );
}

// ─── DISPONIBILIDADE ──────────────────────────────────────────────────────────

function AvailabilitySection() {
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState({ dayOfWeek: 1, startTime: '09:00', endTime: '18:00', maxOrders: 3 });

  const fetch = useCallback(async () => {
    const res = await axios.get(`${API}/available-slots`);
    setSlots(res.data);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    await axios.post(`${API}/available-slots`, form);
    fetch();
  };

  const remove = async (id) => {
    await axios.delete(`${API}/available-slots/${id}`);
    fetch();
  };

  const inp = { style: { width:'100%', padding:'8px 12px', borderRadius:'8px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff', fontSize:'13px' } };

  // Agrupa por dia da semana
  const grouped = DAYS.map((name, i) => ({
    day: i, name, slots: slots.filter(s => s.dayOfWeek === i)
  }));

  return (
    <div>
      <h3 style={{ fontSize:'18px', fontWeight:700, marginBottom:'16px' }}>📅 Horários Disponíveis</h3>
      <p style={{ color:'var(--text-secondary)', fontSize:'13px', marginBottom:'20px' }}>
        Configure os dias e horários em que seu negócio aceita agendamentos. A IA verificará a disponibilidade automaticamente.
      </p>

      {/* Form */}
      <div className="card" style={{ padding:'20px', marginBottom:'24px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr auto', gap:'12px', alignItems:'end' }}>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Dia da semana</label>
            <select {...inp} value={form.dayOfWeek} onChange={e => setForm(f => ({...f, dayOfWeek: parseInt(e.target.value)}))}>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Início</label>
            <input {...inp} type="time" value={form.startTime} onChange={e => setForm(f => ({...f, startTime: e.target.value}))} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Fim</label>
            <input {...inp} type="time" value={form.endTime} onChange={e => setForm(f => ({...f, endTime: e.target.value}))} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'11px', color:'var(--text-muted)', marginBottom:'6px', fontWeight:600 }}>Máx. pedidos</label>
            <input {...inp} type="number" min="1" value={form.maxOrders} onChange={e => setForm(f => ({...f, maxOrders: parseInt(e.target.value)}))} />
          </div>
          <button className="btn btn-primary" onClick={save} style={{ padding:'8px 16px' }}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Grid visual dos dias */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'12px' }}>
        {grouped.map(({ day, name, slots: daySlots }) => (
          <div key={day} className="card" style={{ padding:'12px', minHeight:'120px',
            borderColor: daySlots.length > 0 ? 'rgba(16,185,129,0.3)' : 'var(--border-color)',
            backgroundColor: daySlots.length > 0 ? 'rgba(16,185,129,0.04)' : undefined
          }}>
            <div style={{ fontSize:'12px', fontWeight:700, marginBottom:'8px', color: daySlots.length > 0 ? '#10b981' : 'var(--text-muted)' }}>
              {name.slice(0, 3)}
            </div>
            {daySlots.length === 0 ? (
              <div style={{ fontSize:'11px', color:'var(--text-muted)', textAlign:'center', marginTop:'20px' }}>Fechado</div>
            ) : (
              daySlots.map(s => (
                <div key={s.id} style={{ fontSize:'11px', backgroundColor:'rgba(16,185,129,0.1)', borderRadius:'6px', padding:'4px 6px', marginBottom:'4px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>{s.startTime}–{s.endTime}</span>
                  <button onClick={() => remove(s.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:'12px', padding:'0 2px' }}>✕</button>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── RECEITAS ─────────────────────────────────────────────────────────────────

function RecipesSection() {
  const [products, setProducts] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', unit: 'unidade', ingredients: [] });

  const fetch = useCallback(async () => {
    const [p, s] = await Promise.all([axios.get(`${API}/products`), axios.get(`${API}/stock`)]);
    setProducts(p.data);
    setStockItems(s.data);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const addIngredient = () => setForm(f => ({...f, ingredients: [...f.ingredients, { stockItemId: stockItems[0]?.id || '', quantityPer: 0 }]}));
  const removeIngredient = (i) => setForm(f => ({...f, ingredients: f.ingredients.filter((_, idx) => idx !== i)}));
  const updateIngredient = (i, field, val) => setForm(f => ({ ...f, ingredients: f.ingredients.map((ing, idx) => idx === i ? {...ing, [field]: val} : ing) }));

  const save = async () => {
    if (!form.name) return;
    await axios.post(`${API}/products`, form);
    setForm({ name: '', unit: 'unidade', ingredients: [] });
    setShowForm(false);
    fetch();
  };

  const remove = async (id) => {
    const r = await Swal.fire({ title:'Remover receita?', icon:'warning', showCancelButton:true, confirmButtonText:'Sim', cancelButtonText:'Não', background:'#18181b', color:'#f4f4f5' });
    if (r.isConfirmed) { await axios.delete(`${API}/products/${id}`); fetch(); }
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
        <h3 style={{ fontSize:'18px', fontWeight:700 }}>🎂 Receitas / Produtos</h3>
        <button className="btn btn-primary" onClick={() => setShowForm(v => !v)}>
          <Plus size={16} /> Nova Receita
        </button>
      </div>

      {showForm && ReactDOM.createPortal(
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, backdropFilter:'blur(5px)' }}>
          <div className="card" style={{ width:'480px', padding:'30px', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'20px' }}>
              <h3 style={{ fontWeight:700 }}>Nova Receita</h3>
              <button className="btn-icon" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'12px', marginBottom:'16px' }}>
              <div>
                <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Nome do produto</label>
                <input style={{ width:'100%', padding:'10px', borderRadius:'8px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff' }}
                  placeholder="Ex: Bolo de Cenoura" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'12px', color:'var(--text-secondary)', marginBottom:'6px', fontWeight:600 }}>Unidade</label>
                <select style={{ width:'100%', padding:'10px', borderRadius:'8px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff' }}
                  value={form.unit} onChange={e => setForm(f => ({...f, unit: e.target.value}))}>
                  {['unidade','kg','L','porção'].map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom:'16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
                <label style={{ fontSize:'12px', color:'var(--text-secondary)', fontWeight:600 }}>Ingredientes (por unidade)</label>
                <button className="btn btn-secondary" style={{ fontSize:'12px', padding:'4px 10px' }} onClick={addIngredient}>+ Adicionar</button>
              </div>
              {form.ingredients.map((ing, i) => (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:'8px', marginBottom:'8px' }}>
                  <select style={{ padding:'8px', borderRadius:'8px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff', fontSize:'13px' }}
                    value={ing.stockItemId} onChange={e => updateIngredient(i, 'stockItemId', e.target.value)}>
                    {stockItems.map(s => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                  </select>
                  <input type="number" step="0.01" placeholder="Qtd."
                    style={{ padding:'8px', borderRadius:'8px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff', fontSize:'13px' }}
                    value={ing.quantityPer} onChange={e => updateIngredient(i, 'quantityPer', parseFloat(e.target.value))} />
                  <button className="btn-icon" style={{ color:'#ef4444' }} onClick={() => removeIngredient(i)}><Trash2 size={14} /></button>
                </div>
              ))}
              {form.ingredients.length === 0 && (
                <p style={{ fontSize:'12px', color:'var(--text-muted)', textAlign:'center', padding:'10px' }}>Nenhum ingrediente adicionado.</p>
              )}
            </div>

            <div style={{ display:'flex', gap:'12px' }}>
              <button className="btn btn-secondary" style={{ flex:1 }} onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex:1 }} onClick={save}>Salvar Receita</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'16px' }}>
        {products.map(p => (
          <div key={p.id} className="card" style={{ padding:'16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
              <div style={{ fontWeight:700 }}>{p.name}</div>
              <div style={{ display:'flex', gap:'8px' }}>
                <span style={{ fontSize:'11px', backgroundColor:'rgba(59,130,246,0.1)', color:'#3b82f6', padding:'2px 8px', borderRadius:'10px' }}>{p.unit}</span>
                <button className="btn-icon" style={{ color:'#ef4444' }} onClick={() => remove(p.id)}><Trash2 size={14} /></button>
              </div>
            </div>
            {p.ingredients.length > 0 ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                {p.ingredients.map(ing => (
                  <div key={ing.id} style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', color:'var(--text-secondary)', padding:'4px 0', borderBottom:'1px solid var(--border-color)' }}>
                    <span>{ing.stockItem.name}</span>
                    <span style={{ fontWeight:600 }}>{ing.quantityPer} {ing.stockItem.unit}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize:'12px', color:'var(--text-muted)' }}>Sem ingredientes cadastrados.</p>
            )}
          </div>
        ))}
        {products.length === 0 && (
          <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'40px', color:'var(--text-muted)' }}>
            Nenhuma receita cadastrada ainda.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PÁGINA ───────────────────────────────────────────────────────────────────

export default function Estoque() {
  const [tab, setTab] = useState('stock');

  const tabs = [
    { id: 'stock', label: '📦 Estoque' },
    { id: 'availability', label: '📅 Disponibilidade' },
    { id: 'recipes', label: '🎂 Receitas' },
  ];

  return (
    <div style={{ padding:'30px' }}>
      <div style={{ marginBottom:'30px' }}>
        <h2 style={{ fontSize:'24px', fontWeight:700 }}>Estoque & Disponibilidade</h2>
        <p style={{ color:'var(--text-secondary)' }}>Controle ingredientes, configure horários e cadastre receitas</p>
      </div>

      <div style={{ display:'flex', gap:'8px', marginBottom:'28px' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'8px 20px', borderRadius:'10px', fontSize:'14px', fontWeight:600, cursor:'pointer', border:'none',
            backgroundColor: tab === t.id ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
            color: tab === t.id ? '#fff' : 'var(--text-secondary)',
            transition:'all 0.2s'
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && <StockSection />}
      {tab === 'availability' && <AvailabilitySection />}
      {tab === 'recipes' && <RecipesSection />}
    </div>
  );
}
