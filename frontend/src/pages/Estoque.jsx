import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Plus, Trash2, ShoppingBag, Calendar, X, Layers, ChevronRight, Hash, Box, Copy, Pencil, Gift, Clock, AlertTriangle, Upload } from 'lucide-react';

import Swal from 'sweetalert2';

import { api, API_URL } from '../api';

const Estoque = () => {
  const [tab, setTab] = useState('delivery'); // 'delivery', 'encomenda' ou 'addon'
  const [products, setProducts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [isComboMode, setIsComboMode] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'delivery', category: '', image: '', price: 0, stock: 0, trackStock: false, capacityCost: 1, featured: false, variations: [], comboItems: [], customFields: [] });
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const [seasonalCatalogs, setSeasonalCatalogs] = useState([]);
  const [showSeasonalModal, setShowSeasonalModal] = useState(false);
  const [seasonalForm, setSeasonalForm] = useState({ name: '', eventDate: '', preStartDays: 15, postEndDays: 2, description: '', items: [], maxOrders: 0, onlySeasonalOnEventDay: false, active: true });
  const [editingSeasonal, setEditingSeasonal] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  
  const [categories, setCategories] = useState([]);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', order: 0 });

  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('draggedIndex', index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e, targetIndex) => {
    const draggedIndex = parseInt(e.dataTransfer.getData('draggedIndex'));
    if (draggedIndex === targetIndex) return;

    const newCategories = [...categories];
    const [draggedItem] = newCategories.splice(draggedIndex, 1);
    newCategories.splice(targetIndex, 0, draggedItem);

    // Update orders locally
    const updated = newCategories.map((cat, idx) => ({ ...cat, order: idx + 1 }));
    setCategories(updated);

    // Save to backend
    try {
      await api.post('/orders/categories/reorder', { 
        items: updated.map(cat => ({ id: cat.id, order: cat.order })) 
      });
      fetchCategories();
    } catch (err) { console.error(err); }
  };

  const handleProductDragStart = (e, index) => {
    e.dataTransfer.setData('draggedProductIndex', index);
  };

  const handleProductDrop = async (e, targetIndex) => {
    const draggedIndex = parseInt(e.dataTransfer.getData('draggedProductIndex'));
    if (isNaN(draggedIndex) || draggedIndex === targetIndex) return;

    const newFiltered = [...filtered];
    const [draggedItem] = newFiltered.splice(draggedIndex, 1);
    newFiltered.splice(targetIndex, 0, draggedItem);

    const updated = newFiltered.map((p, idx) => ({ ...p, displayOrder: idx + 1 }));
    
    // Update local state for immediate feedback
    const newProducts = products.map(p => {
      const match = updated.find(u => u.id === p.id);
      return match ? { ...p, displayOrder: match.displayOrder } : p;
    }).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    
    setProducts(newProducts);

    try {
      await api.post('/orders/products/reorder', { 
        items: updated.map(p => ({ id: p.id, displayOrder: p.displayOrder })) 
      });
    } catch (err) { console.error(err); }
  };

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/orders/products');
      const data = res.data.map(p => {
        let vars = [];
        let items = [];
        try {
          vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
        } catch (e) {
          console.error("Erro ao parsear variações do produto:", p.id, e);
          vars = [];
        }
        try {
          items = typeof p.comboItems === 'string' ? JSON.parse(p.comboItems || '[]') : (p.comboItems || []);
        } catch (e) {
          console.error("Erro ao parsear itens do combo:", p.id, e);
          items = [];
        }
        let cfs = [];
        try {
          cfs = typeof p.customFields === 'string' ? JSON.parse(p.customFields || '[]') : (p.customFields || []);
        } catch (e) {
          console.error("Erro ao parsear customFields:", p.id, e);
          cfs = [];
        }
        return { ...p, variations: vars, comboItems: items, customFields: cfs };
      });
      setProducts(data);
    } catch (err) { console.error(err); }
  }, []);

  const fetchSeasonal = useCallback(async () => {
    try {
      const res = await api.get('/orders/seasonal');
      setSeasonalCatalogs(res.data);
    } catch (err) { console.error(err); }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get('/orders/categories');
      setCategories(res.data);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { 
    fetchProducts(); 
    fetchSeasonal();
    fetchCategories();
  }, [fetchProducts, fetchSeasonal, fetchCategories]);

  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const MAX_SIZE = 600; // Optimal size for menu thumbnails
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob((blob) => {
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
              type: 'image/webp',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          }, 'image/webp', 0.8);
        };
      };
    });
  };

  const handleExternalUpload = async (file) => {
    if (!file) return null;
    
    // Mostra um loading enquanto comprime/envia
    Swal.fire({
      title: 'Otimizando Imagem...',
      text: 'Preparando para o cardápio rápido',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading() }
    });

    try {
      const compressedFile = await compressImage(file);
      const formData = new FormData();
      formData.append('file', compressedFile);
      formData.append('secret', 'BlinkMediaSecret123!');
      formData.append('size', '500'); // Tamanho ideal para produtos (carrossel + listagem)
      
      const res = await axios.post('https://files.digizap.com.br/upload.php', formData);
      Swal.close();
      return res.data.url;
    } catch (err) {
      console.error(err);
      Swal.close();
      Swal.fire('Erro', 'Falha no upload para o servidor externo', 'error');
      return null;
    }
  };

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && showModal) setShowModal(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showModal]);

  const openAdd = (asCombo = false) => {
    setEditing(null);
    setIsComboMode(asCombo);
    setForm({ name: '', description: '', type: tab, category: '', image: '', price: 0, stock: 0, trackStock: tab === 'delivery', capacityCost: 1, featured: false, variations: [], comboItems: [], customFields: [] });
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditing(p.id);
    setIsComboMode(p.comboItems && p.comboItems.length > 0 || p.type.startsWith('combo_'));
    setForm({ ...p });
    setShowModal(true);
  };

  const saveProduct = async () => {
    if (!form.name || form.name.trim() === '') {
      Swal.fire({ title: 'Campo Obrigatório', text: 'Por favor, insira o nome do item.', icon: 'warning', confirmButtonColor: '#3b82f6' });
      return;
    }

    if (isComboMode && (!form.comboItems || form.comboItems.length === 0)) {
      Swal.fire({ title: 'Combo Vazio', text: 'Selecione pelo menos um item para compor o combo.', icon: 'warning', confirmButtonColor: '#8b5cf6' });
      return;
    }

    const payload = { 
      ...form, 
      type: isComboMode ? (form.type.startsWith('combo_') ? form.type : `combo_${form.type}`) : form.type.replace('combo_', ''),
      variations: JSON.stringify(form.variations),
      comboItems: JSON.stringify(isComboMode ? form.comboItems : []),
      customFields: JSON.stringify(form.customFields || [])
    };
    try {
      if (editing) await api.patch(`/orders/products/${editing}`, payload);
      else await api.post('/orders/products', payload);
      setShowModal(false);
      fetchProducts();
      Swal.fire({ title: 'Salvo!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) { Swal.fire('Erro', 'Falha ao salvar.', 'error'); }
  };

  const addVar = () => setForm(f => ({ ...f, variations: [...f.variations, { name: '', price: 0, stock: 0, description: '', subItems: [] }] }));
  const addCustomField = () => setForm(f => ({ ...f, customFields: [...(f.customFields || []), { name: '', type: 'text', options: '', required: false }] }));
  const addSub = (vIdx) => {
    setForm(f => {
      const v2 = JSON.parse(JSON.stringify(f.variations));
      if (!v2[vIdx].subItems) v2[vIdx].subItems = [];
      v2[vIdx].subItems.push({ name: '', stock: 0 });
      return { ...f, variations: v2 };
    });
  };

  const toggleComboItem = (prodName, varName = null) => {
    const item = varName ? `${prodName} (${varName})` : prodName;
    setForm(f => {
      const items = [...f.comboItems];
      if (items.includes(item)) return { ...f, comboItems: items.filter(i => i !== item) };
      return { ...f, comboItems: [...items, item] };
    });
  };

  const saveSeasonal = async () => {
    if (!seasonalForm.name || !seasonalForm.eventDate) {
      Swal.fire({ title: 'Atenção', text: 'Nome e Data do Evento são obrigatórios.', icon: 'warning' });
      return;
    }
    try {
      if (editingSeasonal) await api.patch(`/orders/seasonal/${editingSeasonal}`, seasonalForm);
      else await api.post('/orders/seasonal', seasonalForm);
      setShowSeasonalModal(false);
      fetchSeasonal();
      Swal.fire({ title: 'Salvo!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) { Swal.fire('Erro', 'Falha ao salvar catálogo sazonal.', 'error'); }
  };

  const openAddSeasonal = () => {
    setEditingSeasonal(null);
    setSeasonalForm({ name: '', eventDate: '', preStartDays: 15, postEndDays: 2, description: '', items: [], maxOrders: 0, onlySeasonalOnEventDay: false, active: true });
    setShowSeasonalModal(true);
  };

  const openEditSeasonal = (s) => {
    setEditingSeasonal(s.id);
    const items = typeof s.items === 'string' ? JSON.parse(s.items || '[]') : (s.items || []);
    setSeasonalForm({ ...s, items });
    setShowSeasonalModal(true);
  };

  const filtered = products.filter(p => {
    const matchesTab = p.type === tab || p.type === `combo_${tab}`;
    if (!matchesTab) return false;

    if (!showHidden && p.variations.length > 0) {
      const hasVisible = p.variations.some(v => !v.hidden);
      if (!hasVisible) return false;
    }

    return true;
  });
  const inp = { style: { width:'100%', padding:'10px 14px', borderRadius:'10px', backgroundColor:'var(--bg-tertiary)', border:'1px solid var(--border-color)', color:'#fff', fontSize:'14px', outline: 'none' } };

  return (
    <div style={{ padding: '30px' }}>
      <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#fff' }}>Catálogo & Estoque</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie seus produtos e combos de {tab === 'delivery' ? 'Pronta Entrega' : 'Agendamento'}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {tab === 'seasonal' ? (
            <button className="btn btn-primary" onClick={openAddSeasonal} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: '#ec4899' }}>
              <Plus size={20} /> Novo Evento
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => setShowCategoryModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: 'rgba(255, 255, 255, 0.05)', color: '#fff', border: '1px solid var(--border-color)', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>
                <Layers size={20} /> Categorias
              </button>
              <button className="btn" onClick={() => openAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#a78bfa', border: '1px solid #8b5cf6', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>
                Novo Combo
              </button>
              <button className="btn btn-primary" onClick={() => openAdd(false)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px' }}>
                <Plus size={20} /> Adicionar Item
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
        <button onClick={() => setTab('delivery')} style={{ ...tabBtn, backgroundColor: tab === 'delivery' ? '#3b82f6' : 'var(--bg-secondary)', color: tab === 'delivery' ? '#fff' : 'var(--text-secondary)' }}>
          <ShoppingBag size={18} /> Pronta Entrega
        </button>
        <button onClick={() => setTab('encomenda')} style={{ ...tabBtn, backgroundColor: tab === 'encomenda' ? '#10b981' : 'var(--bg-secondary)', color: tab === 'encomenda' ? '#fff' : 'var(--text-secondary)' }}>
          <Calendar size={18} /> Agendamentos
        </button>
        <button onClick={() => setTab('addon')} style={{ ...tabBtn, backgroundColor: tab === 'addon' ? '#f59e0b' : 'var(--bg-secondary)', color: tab === 'addon' ? '#fff' : 'var(--text-secondary)' }}>
          <Plus size={18} /> Adicionais
        </button>
        <button onClick={() => setTab('seasonal')} style={{ ...tabBtn, backgroundColor: tab === 'seasonal' ? '#ec4899' : 'var(--bg-secondary)', color: tab === 'seasonal' ? '#fff' : 'var(--text-secondary)' }}>
          <Gift size={18} /> Datas Comemorativas
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
           <input type="checkbox" id="showHiddenToggle" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
           <label htmlFor="showHiddenToggle" style={{ fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>Mostrar itens ocultos</label>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {tab === 'seasonal' ? (
          seasonalCatalogs.map(s => (
            <div key={s.id} style={{ backgroundColor: '#18181b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(236, 72, 153, 0.1)', color: '#ec4899', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Gift size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '16px', color: '#fff' }}>{s.name}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', gap: '10px', marginTop: '4px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14} /> {new Date(s.eventDate + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> Antecedência: {s.preStartDays} dias</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                {s.maxOrders > 0 && <span style={{ fontSize: '10px', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '4px 10px', borderRadius: '20px', fontWeight: 800 }}>Limite: {s.maxOrders} pedidos</span>}
                <button className="btn-icon" style={{ padding: '8px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', borderRadius: '8px' }} onClick={() => openEditSeasonal(s)}><Pencil size={16} /></button>
                <button className="btn-icon" style={{ padding: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px' }} onClick={() => {
                  Swal.fire({ title: 'Excluir?', text: "Deseja remover este catálogo?", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444' }).then(r => {
                    if (r.isConfirmed) api.delete(`/orders/seasonal/${s.id}`).then(() => fetchSeasonal());
                  });
                }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))
        ) : (
          filtered.map((p, idx) => {
            const isExpanded = expanded === p.id;
            const isCombo = p.comboItems && p.comboItems.length > 0;
            return (
              <div 
                key={p.id} 
                draggable 
                onDragStart={(e) => handleProductDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleProductDrop(e, idx)}
                style={{ backgroundColor: '#18181b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', transition: 'all 0.2s', cursor: 'grab' }}
              >
                <div 
                  onClick={() => setExpanded(isExpanded ? null : p.id)}
                  style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', backgroundColor: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent', borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ width: '4px', height: '24px', borderRadius: '4px', background: isCombo ? '#8b5cf6' : (p.type === 'delivery' ? '#3b82f6' : '#10b981') }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ fontWeight: 800, fontSize: '16px', color: '#fff' }}>{p.name}</div>
                        {isCombo && <span style={{ fontSize: '10px', backgroundColor: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', padding: '2px 8px', borderRadius: '4px', fontWeight: 900 }}>COMBO</span>}
                      </div>
                      {p.description && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{p.description}</div>}
                      {!p.variations.length && !isCombo && <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>R$ {p.price.toFixed(2)} {p.trackStock && `| Estoque: ${p.stock}`} {!p.trackStock && '| Estoque: ∞'}</div>}
                      {isCombo && <div style={{ fontSize: '13px', color: '#8b5cf6', marginTop: '4px', fontWeight: 700 }}>R$ {p.price.toFixed(2)} | {p.comboItems.length} itens inclusos</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
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
                
                {isExpanded && (
                  <div style={{ padding: '20px', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                    {isCombo ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                         {p.comboItems.map((item, i) => (
                           <div key={i} style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#a78bfa', padding: '6px 15px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                             📦 {item}
                           </div>
                         ))}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
                        {p.variations.filter(v => showHidden || !v.hidden).map((v, i) => (
                          <div key={i} style={{ padding: '15px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight:800, color: p.type === 'delivery' ? '#60a5fa' : '#34d399', fontSize:'13px' }}>{v.name.toUpperCase()} {v.hidden && <span style={{ color: '#fbbf24', fontSize: '10px', marginLeft: '5px' }}>(INVISÍVEL)</span>}</span>
                                {v.description && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{v.description}</span>}
                              </div>
                              <span style={{ fontWeight:700, fontSize:'13px', backgroundColor: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '6px', color: '#fff' }}>R$ {v.price}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {v.subItems?.map((si, idx) => (
                                <div key={idx} style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'var(--text-secondary)', padding:'4px 10px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '20px' }}>
                                  <span style={{ fontWeight: 600 }}>{si.name}</span>
                                  {p.trackStock ? (
                                    <span style={{ color: si.stock > 0 ? '#10b981' : '#ef4444', fontWeight:800, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '6px' }}>{si.stock}</span>
                                  ) : (
                                    <span style={{ color: '#60a5fa', fontWeight:800, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '6px' }}>∞</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {showSeasonalModal && createPortal(
        <div style={modalOverlay}>
          <div className="card" style={modalContent}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h3 style={{ fontWeight: 800 }}>{editingSeasonal ? 'Editar' : 'Novo'} Catálogo de Evento</h3>
              <button onClick={() => setShowSeasonalModal(false)} style={closeBtn}><X size={24} /></button>
            </div>

            <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr', gap: '15px', marginBottom: '20px' }}>
                <div>
                  <label style={labelStyle}>Nome do Evento</label>
                  <input {...inp} placeholder="Ex: Dia das Mães, Páscoa..." value={seasonalForm.name} onChange={e => setSeasonalForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Data do Evento</label>
                  <input {...inp} type="date" value={seasonalForm.eventDate} onChange={e => setSeasonalForm(f => ({ ...f, eventDate: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                <div>
                  <label style={labelStyle}><Clock size={10} /> Antecedência (Exibir X dias antes)</label>
                  <input {...inp} type="number" value={seasonalForm.preStartDays} onChange={e => setSeasonalForm(f => ({ ...f, preStartDays: parseInt(e.target.value) }))} />
                </div>
                <div>
                  <label style={labelStyle}><Clock size={10} /> Permanência (Exibir Y dias depois)</label>
                  <input {...inp} type="number" value={seasonalForm.postEndDays} onChange={e => setSeasonalForm(f => ({ ...f, postEndDays: parseInt(e.target.value) }))} />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Descrição / Chamada Especial</label>
                <textarea {...inp} style={{ ...inp.style, minHeight: '60px' }} placeholder="Ex: Prepare-se para o dia mais especial do ano!" value={seasonalForm.description || ''} onChange={e => setSeasonalForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              <div style={sectionBox}>
                <h5 style={sectionTitle}>⚙️ REGRAS OPERACIONAIS</h5>
                <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label style={microLabel}>Limite Máximo de Pedidos para o Dia (0 = Ilimitado)</label>
                    <input {...inp} type="number" value={seasonalForm.maxOrders} onChange={e => setSeasonalForm(f => ({ ...f, maxOrders: parseInt(e.target.value) }))} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(236, 72, 153, 0.05)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(236, 72, 153, 0.1)' }}>
                    <input type="checkbox" id="onlySeasonal" checked={seasonalForm.onlySeasonalOnEventDay} onChange={e => setSeasonalForm(f => ({ ...f, onlySeasonalOnEventDay: e.target.checked }))} style={{ width: '18px', height: '18px' }} />
                    <label htmlFor="onlySeasonal" style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: '#ec4899' }}>
                      Aceitar APENAS itens sazonais para a data do evento?
                      <p style={{ fontWeight: 400, fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Lily recusará encomendas do cardápio regular se o cliente escolher o dia do evento para entrega.</p>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={labelStyle}>ITENS DO CATÁLOGO ESPECIAL</label>
                  <button className="btn btn-secondary" style={{ fontSize: '10px' }} onClick={() => setSeasonalForm(f => ({ ...f, items: [...f.items, { name: '', price: 0, description: '' }] }))}>+ Add Item</button>
                </div>
                {seasonalForm.items.map((item, idx) => (
                  <div key={idx} style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '10px', marginBottom: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '10px', marginBottom: '10px' }}>
                      <input {...inp} placeholder="Nome do Produto Especial" value={item.name} onChange={e => { const i = [...seasonalForm.items]; i[idx].name = e.target.value; setSeasonalForm(f => ({ ...f, items: i })) }} />
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-muted)' }}>R$</span>
                        <input 
                          {...inp} 
                          style={{ ...inp.style, paddingLeft: '30px' }} 
                          placeholder="0,00" 
                          value={item.price || ''} 
                          onChange={e => { 
                            let val = e.target.value.replace(/\D/g, "");
                            if (val === "") val = "0";
                            const floatVal = parseFloat(val) / 100;
                            const i = [...seasonalForm.items]; 
                            i[idx].price = floatVal; 
                            setSeasonalForm(f => ({ ...f, items: i }));
                          }}
                          onBlur={e => {
                            const i = [...seasonalForm.items];
                            i[idx].price = parseFloat(i[idx].price || 0).toFixed(2);
                            setSeasonalForm(f => ({ ...f, items: i }));
                          }}
                        />
                      </div>
                      <button className="btn-icon" style={{ color: '#ef4444' }} onClick={() => { const i = seasonalForm.items.filter((_, k) => k !== idx); setSeasonalForm(f => ({ ...f, items: i })) }}><Trash2 size={16} /></button>
                    </div>
                    <input {...inp} style={{ ...inp.style, fontSize: '12px', padding: '6px 10px' }} placeholder="Breve descrição do item..." value={item.description} onChange={e => { const i = [...seasonalForm.items]; i[idx].description = e.target.value; setSeasonalForm(f => ({ ...f, items: i })) }} />
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: '25px', display: 'flex', gap: '10px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowSeasonalModal(false)}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex: 2, backgroundColor: '#ec4899' }} onClick={saveSeasonal}>Salvar Catálogo</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showModal && createPortal(
        <div style={modalOverlay}>
          <div className="card" style={modalContent}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'25px' }}>
                <h3 style={{ fontWeight: 800 }}>{editing ? 'Editar' : 'Novo'} {isComboMode ? 'Combo' : 'Produto'}</h3>
                <button onClick={() => setShowModal(false)} style={closeBtn}><X size={24} /></button>
            </div>

            <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
                <div style={{ marginBottom:'20px' }}>
                    <label style={labelStyle}>Identificação do {isComboMode ? 'Combo' : 'Item'}</label>
                    <input {...inp} placeholder={isComboMode ? "Ex: Combo Casal, Kit Festa..." : "Ex: Nome do Produto"} value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
                </div>
                <div style={{ marginBottom:'20px' }}>
                    <label style={labelStyle}>Descrição (Opcional)</label>
                    <textarea {...inp} style={{ ...inp.style, minHeight: '60px', resize: 'vertical' }} placeholder="Detalhes que o cliente deve saber." value={form.description || ''} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
                </div>
                
                <div style={{ marginBottom: '20px' }}>
                    <label style={labelStyle}>Imagens do Produto (Múltiplas fotos)</label>
                    <div style={{ 
                        border: '2px dashed var(--border-color)', 
                        borderRadius: '12px', 
                        padding: '20px', 
                        textAlign: 'center',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }} onClick={() => document.getElementById('main-image-upload').click()}>
                        <div style={{ color: 'var(--text-secondary)' }}>
                            <Upload size={32} style={{ marginBottom: '10px', color: 'var(--active-color)' }} />
                            <p style={{ fontSize: '14px', fontWeight: 600 }}>Clique para adicionar fotos</p>
                            <p style={{ fontSize: '12px', opacity: 0.6 }}>Você pode selecionar várias imagens de uma vez</p>
                        </div>
                        <input 
                            id="main-image-upload"
                            type="file" 
                            hidden 
                            multiple
                            accept="image/*" 
                            onChange={async (e) => {
                                const files = Array.from(e.target.files);
                                if (!files.length) return;
                                
                                const newImages = [];
                                for (const file of files) {
                                    const url = await handleExternalUpload(file);
                                    if (url) newImages.push(url);
                                }
                                
                                setForm(f => {
                                    let current = [];
                                    try {
                                        current = JSON.parse(f.image || '[]');
                                        if (!Array.isArray(current)) current = f.image ? [f.image] : [];
                                    } catch(e) {
                                        current = f.image ? [f.image] : [];
                                    }
                                    return { ...f, image: JSON.stringify([...current, ...newImages]) };
                                });
                            }} 
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '10px', marginTop: '15px' }}>
                        {(() => {
                            let imgs = [];
                            try {
                                imgs = JSON.parse(form.image || '[]');
                                if (!Array.isArray(imgs)) imgs = form.image ? [form.image] : [];
                            } catch(e) {
                                imgs = form.image ? [form.image] : [];
                            }
                            return imgs.map((img, idx) => (
                                <div key={idx} style={{ position: 'relative', width: '80px', height: '80px' }}>
                                    <img src={img} alt={`Preview ${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-color)' }} />
                                    <button 
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            const filtered = imgs.filter((_, i) => i !== idx);
                                            setForm(f => ({ ...f, image: JSON.stringify(filtered) }));
                                        }} 
                                        style={{ position: 'absolute', top: '-5px', right: '-5px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            ));
                        })()}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px', marginBottom: '20px' }}>
                  <div>
                    <label style={labelStyle}>Categoria</label>
                    <select {...inp} value={form.category || ''} onChange={e => setForm(f => ({...f, category: e.target.value}))}>
                      <option value="">Selecione uma categoria</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.name}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                
                <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <input 
                      type="checkbox" 
                      id="trackStock" 
                      checked={form.trackStock} 
                      onChange={e => setForm(f => ({...f, trackStock: e.target.checked}))}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label htmlFor="trackStock" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: '#fff' }}>
                      Controle de estoque
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(59, 130, 246, 0.05)', padding: '15px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    <input 
                      type="checkbox" 
                      id="featured" 
                      checked={form.featured} 
                      onChange={e => setForm(f => ({...f, featured: e.target.checked}))}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label htmlFor="featured" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: '#3b82f6' }}>
                      Destaque no Menu (Exibir no topo)
                    </label>
                  </div>
                </div>
                {isComboMode ? (
                  <div style={sectionBox}>
                    <h5 style={sectionTitle}>🎁 ITENS DISPONÍVEIS PARA O COMBO</h5>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '15px' }}>Selecione apenas os produtos de <b>{tab === 'delivery' ? 'Pronta Entrega' : 'Agendamento'}</b>.</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '300px', overflowY: 'auto', paddingRight: '5px' }}>
                      {products.filter(p => p.type === tab && (!p.comboItems || p.comboItems.length === 0)).map(p => (
                        <div key={p.id} style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ fontWeight: 800, fontSize: '13px', color: '#fff', marginBottom: '8px' }}>{p.name}</div>
                          {p.variations.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingLeft: '10px' }}>
                              {p.variations.map((v, i) => {
                                const isSelected = form.comboItems.includes(`${p.name} (${v.name})`);
                                return (
                                  <button
                                    key={i}
                                    onClick={() => toggleComboItem(p.name, v.name)}
                                    style={{
                                      padding: '4px 12px', borderRadius: '20px', fontSize: '11px', border: '1px solid',
                                      backgroundColor: isSelected ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                                      borderColor: isSelected ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
                                      color: isSelected ? '#a78bfa' : 'var(--text-muted)',
                                      cursor: 'pointer', transition: 'all 0.2s'
                                    }}
                                  >
                                    {v.name}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div style={{ paddingLeft: '10px' }}>
                               <button
                                onClick={() => toggleComboItem(p.name)}
                                style={{
                                  padding: '4px 12px', borderRadius: '20px', fontSize: '11px', border: '1px solid',
                                  backgroundColor: form.comboItems.includes(p.name) ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                                  borderColor: form.comboItems.includes(p.name) ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
                                  color: form.comboItems.includes(p.name) ? '#a78bfa' : 'var(--text-muted)',
                                  cursor: 'pointer', transition: 'all 0.2s'
                                }}
                              >
                                Incluir no Combo
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
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

                              <div style={{ marginBottom: '15px', display: 'flex', gap: '15px', alignItems: 'center' }}>
                                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '15px' }}>
                                      <input type="checkbox" id={`hidden-${vIdx}`} checked={v.hidden || false} onChange={e => { const v2=[...form.variations]; v2[vIdx].hidden=e.target.checked; setForm(f=>({...f, variations:v2})) }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                                      <label htmlFor={`hidden-${vIdx}`} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: v.hidden ? '#fbbf24' : 'var(--text-muted)' }}>{v.hidden ? '🙈 INVISÍVEL' : '👁️ VISÍVEL'}</label>
                                  </div>
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
                )}

                <div style={sectionBox}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px' }}>
                        <h5 style={sectionTitle}>📋 CAMPOS PERSONALIZADOS (Encomendas)</h5>
                        <button className="btn btn-secondary" style={{ fontSize:'11px' }} onClick={addCustomField}>+ Add Campo</button>
                    </div>
                    {(form.customFields || []).map((cf, cIdx) => (
                        <div key={cIdx} style={varGroupStyle}>
                            <div style={{ display:'grid', gridTemplateColumns: '1.5fr 1fr 2fr auto', gap:'10px', alignItems:'end' }}>
                                <div>
                                    <label style={microLabel}>Nome do Campo</label>
                                    <input {...inp} placeholder="Ex: Sabor da massa..." value={cf.name} onChange={e => { const cfs=[...(form.customFields || [])]; cfs[cIdx].name=e.target.value; setForm(f=>({...f, customFields:cfs})) }} />
                                </div>
                                <div>
                                    <label style={microLabel}>Tipo</label>
                                    <select {...inp} value={cf.type} onChange={e => { const cfs=[...(form.customFields || [])]; cfs[cIdx].type=e.target.value; setForm(f=>({...f, customFields:cfs})) }}>
                                        <option value="text">Texto Curto</option>
                                        <option value="dropdown">Lista de Opções</option>
                                        <option value="image">Upload de Imagem</option>
                                    </select>
                                </div>
                                <div>
                                    {cf.type === 'dropdown' ? (
                                        <>
                                            <label style={microLabel}>Opções (separadas por vírgula)</label>
                                            <input {...inp} placeholder="Ex: Chocolate, Baunilha, Morango" value={cf.options || ''} onChange={e => { const cfs=[...(form.customFields || [])]; cfs[cIdx].options=e.target.value; setForm(f=>({...f, customFields:cfs})) }} />
                                        </>
                                    ) : (
                                        <div style={{ paddingTop: '28px', display: 'flex', alignItems: 'center' }}>
                                            <input type="checkbox" id={`req-${cIdx}`} checked={cf.required || false} onChange={e => { const cfs=[...(form.customFields || [])]; cfs[cIdx].required=e.target.checked; setForm(f=>({...f, customFields:cfs})) }} style={{ width: '16px', height: '16px', cursor: 'pointer', marginRight: '8px' }} />
                                            <label htmlFor={`req-${cIdx}`} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Obrigatório?</label>
                                        </div>
                                    )}
                                </div>
                                <button className="btn-icon" style={{ color:'#ef4444', marginBottom:'6px' }} onClick={() => setForm(f=>({...f, customFields: (f.customFields || []).filter((_, idx)=>idx!==cIdx)}))}><Trash2 size={16} /></button>
                            </div>
                            {cf.type === 'dropdown' && (
                                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center' }}>
                                    <input type="checkbox" id={`req-${cIdx}`} checked={cf.required || false} onChange={e => { const cfs=[...(form.customFields || [])]; cfs[cIdx].required=e.target.checked; setForm(f=>({...f, customFields:cfs})) }} style={{ width: '16px', height: '16px', cursor: 'pointer', marginRight: '8px' }} />
                                    <label htmlFor={`req-${cIdx}`} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Obrigatório?</label>
                                </div>
                            )}
                        </div>
                    ))}
                    {(form.customFields || []).length === 0 && (
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Adicione campos para coletar informações como sabores, detalhes ou envio de fotos (útil para bolos e topos).</p>
                    )}
                </div>
                
                {isComboMode && (
                   <div style={{ marginTop: '20px' }}>
                      <label style={labelStyle}>Preço Final do Combo (R$)</label>
                      <input {...inp} type="number" value={form.price} onChange={e=>setForm(f=>({...f, price:parseFloat(e.target.value)}))} />
                   </div>
                )}
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
      {showCategoryModal && createPortal(
        <div style={modalOverlay}>
          <div className="card" style={{ ...modalContent, width: '450px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'25px' }}>
                <h3 style={{ fontWeight: 800 }}>Gerenciar Categorias</h3>
                <button onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }} style={closeBtn}><X size={24} /></button>
            </div>

            <div style={{ marginBottom: '25px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <label style={labelStyle}>{editingCategory ? 'Editar Categoria' : 'Nova Categoria'}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                   <input 
                    {...inp} 
                    placeholder="Nome da Categoria" 
                    value={editingCategory ? categoryForm.name : newCategoryName} 
                    onChange={e => editingCategory ? setCategoryForm(f => ({...f, name: e.target.value})) : setNewCategoryName(e.target.value)} 
                  />
                   {editingCategory && (
                     <input 
                      {...inp} 
                      type="number"
                      style={{ ...inp.style, width: '80px' }}
                      placeholder="Ordem" 
                      value={categoryForm.order} 
                      onChange={e => setCategoryForm(f => ({...f, order: e.target.value}))} 
                    />
                   )}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {editingCategory ? (
                    <>
                      <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditingCategory(null)}>Cancelar</button>
                      <button className="btn btn-primary" style={{ flex: 2 }} onClick={async () => {
                        try {
                          await api.patch(`/orders/categories/${editingCategory}`, categoryForm);
                          setEditingCategory(null);
                          fetchCategories();
                          Swal.fire({ title: 'Atualizado!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
                        } catch (err) { Swal.fire('Erro', 'Falha ao atualizar.', 'error'); }
                      }}>Salvar Alterações</button>
                    </>
                  ) : (
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={async () => {
                      if (!newCategoryName.trim()) return;
                      try {
                        await api.post('/orders/categories', { name: newCategoryName });
                        setNewCategoryName('');
                        fetchCategories();
                        Swal.fire({ title: 'Adicionado!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
                      } catch (err) { Swal.fire('Erro', 'Falha ao adicionar.', 'error'); }
                    }}>Adicionar Categoria</button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={labelStyle}>Categorias Existentes</label>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Arraste ou edite a ordem</span>
              </div>
              {categories.length === 0 ? (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>Nenhuma categoria cadastrada.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {categories.map((cat, idx) => (
                    <div 
                      key={cat.id} 
                      draggable 
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, idx)}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        backgroundColor: 'rgba(255,255,255,0.02)', 
                        padding: '10px 15px', 
                        borderRadius: '8px', 
                        border: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'grab'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><Layers size={14} /></div>
                        <span style={{ fontSize: '11px', backgroundColor: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}>{cat.order}</span>
                        <span style={{ fontSize: '14px', color: '#fff', fontWeight: 600 }}>{cat.name}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button className="btn-icon" style={{ color: '#3b82f6' }} onClick={() => {
                          setEditingCategory(cat.id);
                          setCategoryForm({ name: cat.name, order: cat.order });
                        }}><Pencil size={16} /></button>
                        <button className="btn-icon" style={{ color: '#ef4444' }} onClick={() => {
                          Swal.fire({ title: 'Excluir?', text: `Deseja remover a categoria "${cat.name}"?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444' }).then(r => {
                            if (r.isConfirmed) api.delete(`/orders/categories/${cat.id}`).then(() => fetchCategories());
                          });
                        }}><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: '25px' }}>
              <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }}>Fechar</button>
            </div>
          </div>
        </div>,
        document.body
      )}
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
