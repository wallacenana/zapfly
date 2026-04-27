import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, ShoppingBag, Calendar, X, Layers, ChevronRight, Hash, Box, Copy, Pencil } from 'lucide-react';

import Swal from 'sweetalert2';

import { api } from '../api';

const Estoque = () => {
  const [tab, setTab] = useState('delivery');
  const [products, setProducts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'delivery', price: 0, stock: 0, capacityCost: 1, variations: [] });
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/orders/products');
      const data = res.data.map(p => ({
        ...p,
        variations: typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || [])
      }));
      setProducts(data);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && showModal) setShowModal(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showModal]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', type: tab, price: 0, stock: 0, capacityCost: 1, variations: [] });
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditing(p.id);
    setForm({ ...p });
    setShowModal(true);
  };

  const saveProduct = async () => {
    if (!form.name) return;
    const payload = { ...form, variations: JSON.stringify(form.variations) };
    try {
      if (editing) await api.patch(`/orders/products/${editing}`, payload);
      else await api.post('/orders/products', payload);
      setShowModal(false);
      fetchProducts();
      Swal.fire({ title: 'Salvo!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) { Swal.fire('Erro', 'Falha ao salvar.', 'error'); }
  };

  const addVar = () => setForm(f => ({ ...f, variations: [...f.variations, { name: '', price: 0, stock: 0, description: '', subItems: [] }] }));
  const addSub = (vIdx) => {
    setForm(f => {
      const v2 = JSON.parse(JSON.stringify(f.variations));
      if (!v2[vIdx].subItems) v2[vIdx].subItems = [];
      v2[vIdx].subItems.push({ name: '', stock: 0 });
      return { ...f, variations: v2 };
    });
  };

  const filtered = products.filter(p => p.type === tab);
  const inp = { style: { width:'100%', padding:'10px 14px', borderRadius:'10px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff', fontSize:'14px' } };

  return (
    <div style={{ padding: '30px' }}>
      <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#fff' }}>Itens & Disponibilidade</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie o catálogo de produtos e agendamentos</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px' }}>
          <Plus size={20} /> Adicionar Item
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
        <button onClick={() => setTab('delivery')} style={{ ...tabBtn, backgroundColor: tab === 'delivery' ? '#3b82f6' : 'var(--bg-secondary)', color: tab === 'delivery' ? '#fff' : 'var(--text-secondary)' }}>
          <ShoppingBag size={18} /> Pronta Entrega
        </button>
        <button onClick={() => setTab('encomenda')} style={{ ...tabBtn, backgroundColor: tab === 'encomenda' ? '#10b981' : 'var(--bg-secondary)', color: tab === 'encomenda' ? '#fff' : 'var(--text-secondary)' }}>
          <Calendar size={18} /> Agendamentos
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {filtered.map(p => {
          const isExpanded = expanded === p.id;
          return (
            <div key={p.id} style={{ backgroundColor: '#18181b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', transition: 'all 0.2s' }}>
              <div 
                onClick={() => setExpanded(isExpanded ? null : p.id)}
                style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', backgroundColor: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent', borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ width: '4px', height: '24px', borderRadius: '4px', background: p.type === 'delivery' ? 'linear-gradient(180deg, #3b82f6, #60a5fa)' : 'linear-gradient(180deg, #10b981, #34d399)' }} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '16px', color: '#fff' }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{p.description}</div>}
                    {!p.variations.length && <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>R$ {p.price.toFixed(2)} {p.type !== 'encomenda' && `| Estoque: ${p.stock}`}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  {p.variations.length > 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '20px' }}>{p.variations.length} Variações</div>}
                  <button className="btn-icon" style={{ padding: '8px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', borderRadius: '8px' }} onClick={(e) => { e.stopPropagation(); openEdit(p); }}><Pencil size={16} /></button>
                  <button className="btn-icon" style={{ padding: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px' }} onClick={(e) => { 
                    e.stopPropagation(); 
                    Swal.fire({
                      title: 'Tem certeza?',
                      text: "Você não poderá reverter isso!",
                      icon: 'warning',
                      showCancelButton: true,
                      confirmButtonColor: '#ef4444',
                      cancelButtonColor: '#6e7881',
                      confirmButtonText: 'Sim, excluir!',
                      cancelButtonText: 'Cancelar'
                    }).then((result) => {
                      if (result.isConfirmed) {
                        api.delete(`/orders/products/${p.id}`).then(() => {
                          fetchProducts();
                          Swal.fire('Excluído!', 'O item foi removido com sucesso.', 'success');
                        });
                      }
                    });
                  }}><Trash2 size={16} /></button>
                  <ChevronRight size={20} color="var(--text-secondary)" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </div>
              </div>
              
              {isExpanded && p.variations.length > 0 && (
                <div style={{ padding: '20px', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
                    {p.variations.map((v, i) => (
                      <div key={i} style={{ padding: '15px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight:800, color: p.type === 'delivery' ? '#60a5fa' : '#34d399', fontSize:'13px' }}>{v.name.toUpperCase()}</span>
                            {v.description && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{v.description}</span>}
                          </div>
                          <span style={{ fontWeight:700, fontSize:'13px', backgroundColor: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '6px', color: '#fff' }}>R$ {v.price}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {v.subItems?.map((si, idx) => (
                            <div key={idx} style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'var(--text-secondary)', padding:'4px 10px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '20px' }}>
                              <span style={{ fontWeight: 600 }}>{si.name}</span>
                              {p.type !== 'encomenda' && <span style={{ color: si.stock > 0 ? '#10b981' : '#ef4444', fontWeight:800, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '6px' }}>{si.stock}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && createPortal(
        <div style={modalOverlay}>
          <div className="card" style={modalContent}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'25px' }}>
                <h3 style={{ fontWeight: 800 }}>{editing ? 'Editar' : 'Novo'} Registro</h3>
                <button onClick={() => setShowModal(false)} style={closeBtn}><X size={24} /></button>
            </div>

            <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
                <div style={{ marginBottom:'20px' }}>
                    <label style={labelStyle}>Identificação do Item</label>
                    <input {...inp} placeholder="Ex: Nome do Produto ou Serviço" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
                </div>
                <div style={{ marginBottom:'20px' }}>
                    <label style={labelStyle}>Descrição Breve (Opcional)</label>
                    <textarea {...inp} style={{ ...inp.style, minHeight: '60px', resize: 'vertical' }} placeholder="Ex: Serve 10 fatias. Topo personalizado incluso." value={form.description || ''} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
                </div>

                <div style={sectionBox}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px' }}>
                        <h5 style={sectionTitle}><Layers size={14} /> VARIAÇÕES & OPÇÕES</h5>
                        <button className="btn btn-secondary" style={{ fontSize:'11px' }} onClick={addVar}>+ Add Variação</button>
                    </div>

                    {form.variations.map((v, vIdx) => (
                        <div key={vIdx} style={varGroupStyle}>
                            <div style={{ display:'grid', gridTemplateColumns: form.type === 'encomenda' ? '2fr 1fr auto' : '2fr 1fr 1fr auto', gap:'10px', marginBottom:'15px', alignItems:'end' }}>
                                <div>
                                    <label style={microLabel}>Tipo / Categoria</label>
                                    <input {...inp} placeholder="Ex: Tamanho, Modelo..." value={v.name} onChange={e => { const v2=[...form.variations]; v2[vIdx].name=e.target.value; setForm(f=>({...f, variations:v2})) }} />
                                </div>
                                <div>
                                    <label style={microLabel}>Preço (R$)</label>
                                    <input {...inp} type="number" placeholder="0.00" value={v.price} onChange={e => { const v2=[...form.variations]; v2[vIdx].price=parseFloat(e.target.value); setForm(f=>({...f, variations:v2})) }} />
                                </div>
                                {form.type !== 'encomenda' && (
                                    <div style={{ opacity: v.subItems?.some(si => (si.stock || 0) > 0) ? 0.3 : 1, transition: 'opacity 0.2s' }}>
                                        <label style={microLabel}>Estoque Geral</label>
                                        <input 
                                            {...inp} 
                                            type="number" 
                                            placeholder="0" 
                                            disabled={v.subItems?.some(si => (si.stock || 0) > 0)}
                                            value={v.stock || 0} 
                                            onChange={e => { const v2=[...form.variations]; v2[vIdx].stock=parseInt(e.target.value); setForm(f=>({...f, variations:v2})) }} 
                                        />
                                    </div>
                                )}
                                <div style={{ display:'flex', gap:'5px', marginBottom:'8px' }}>
                                    <button className="btn-icon" title="Duplicar" onClick={() => {
                                        const cloned = JSON.parse(JSON.stringify(v));
                                        setForm(f => ({ ...f, variations: [...f.variations, cloned] }));
                                    }}><Copy size={16} color="#3b82f6" /></button>
                                    <button className="btn-icon" style={{ color:'#ef4444' }} onClick={() => setForm(f=>({...f, variations: f.variations.filter((_, idx)=>idx!==vIdx)}))}><Trash2 size={16} /></button>
                                </div>
                            </div>

                            <div style={{ marginBottom: '15px' }}>
                                <label style={microLabel}>Descrição da Categoria (Opcional)</label>
                                <input {...inp} style={{ ...inp.style, padding: '6px 12px', fontSize: '12px' }} placeholder="Ex: Serve 2 pessoas, embalagem especial..." value={v.description || ''} onChange={e => { const v2=[...form.variations]; v2[vIdx].description=e.target.value; setForm(f=>({...f, variations:v2})) }} />
                            </div>

                            <div style={{ paddingLeft:'20px', borderLeft:'2px solid var(--border-color)', marginBottom:'10px' }}>
                                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'10px' }}>
                                    <span style={{ fontSize:'10px', fontWeight:800, color:'var(--text-muted)' }}>DETALHES DA VARIAÇÃO</span>
                                    <button style={{ background:'none', border:'none', color:'#3b82f6', fontSize:'10px', fontWeight:700, cursor:'pointer' }} onClick={() => addSub(vIdx)}>+ Add Opção</button>
                                </div>
                                {v.subItems?.map((si, sIdx) => (
                                    <div key={sIdx} style={{ display:'grid', gridTemplateColumns: form.type === 'encomenda' ? '1fr auto' : '2fr 1fr auto', gap:'8px', marginBottom:'8px', alignItems:'end' }}>
                                        <div>
                                            <label style={tinyLabel}>Nome da Opção</label>
                                            <input {...inp} style={{ ...inp.style, padding:'6px 10px', fontSize:'12px' }} placeholder="Ex: Sabor, Cor, Material..." value={si.name} onChange={e => { const v2=JSON.parse(JSON.stringify(form.variations)); v2[vIdx].subItems[sIdx].name=e.target.value; setForm(f=>({...f, variations:v2})) }} />
                                        </div>
                                        {form.type !== 'encomenda' && (
                                            <div>
                                                <label style={tinyLabel}>Quantidade</label>
                                                <input {...inp} style={{ ...inp.style, padding:'6px 10px', fontSize:'12px' }} type="number" placeholder="0" value={si.stock} onChange={e => { const v2=JSON.parse(JSON.stringify(form.variations)); v2[vIdx].subItems[sIdx].stock=parseInt(e.target.value); setForm(f=>({...f, variations:v2})) }} />
                                            </div>
                                        )}
                                        <button className="btn-icon" style={{ color:'#ef4444', marginBottom:'6px' }} onClick={() => { const v2=JSON.parse(JSON.stringify(form.variations)); v2[vIdx].subItems.splice(sIdx,1); setForm(f=>({...f, variations:v2})) }}><Trash2 size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {form.variations.length === 0 && (
                        <div style={{ display:'grid', gridTemplateColumns: form.type === 'encomenda' ? '1fr' : '1fr 1fr', gap:'15px' }}>
                            <div><label style={labelStyle}>Valor Base</label><input {...inp} type="number" value={form.price} onChange={e=>setForm(f=>({...f, price:parseFloat(e.target.value)}))} /></div>
                            {form.type !== 'encomenda' && (
                                <div><label style={labelStyle}>Qtd Disponível</label><input {...inp} type="number" value={form.stock} onChange={e=>setForm(f=>({...f, stock:parseInt(e.target.value)}))} /></div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ marginTop:'25px', display:'flex', gap:'10px' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancelar</button>
                <button className="btn btn-primary" style={{ flex: 2 }} onClick={saveProduct}>Salvar Informações</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .product-card { transition: all 0.2s; cursor: pointer; border: 1px solid var(--border-color); }
        .product-card:hover { transform: translateY(-5px); border-color: #3b82f6; }
      `}</style>
    </div>
  );
};

const tabBtn = { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', borderRadius: '12px', border: 'none', fontWeight: 700, fontSize: '14px', cursor: 'pointer' };
const modalOverlay = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, backdropFilter: 'blur(8px)', padding: '20px' };
const modalContent = { width: '100%', maxWidth: '600px', maxHeight: '90vh', padding: '30px', position: 'relative', overflowY: 'auto', backgroundColor: '#18181b', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' };
const closeBtn = { background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' };
const labelStyle = { display: 'block', fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 800, textTransform: 'uppercase' };
const microLabel = { display: 'block', fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 700, textTransform: 'uppercase' };
const tinyLabel = { display: 'block', fontSize: '8px', color: 'var(--text-muted)', marginBottom: '2px', fontWeight: 600, textTransform: 'uppercase' };
const sectionBox = { backgroundColor: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '12px', border: '1px dashed var(--border-color)' };
const sectionTitle = { fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' };
const varGroupStyle = { backgroundColor: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '12px', marginBottom: '15px', border: '1px solid rgba(255,255,255,0.05)' };

export default Estoque;
