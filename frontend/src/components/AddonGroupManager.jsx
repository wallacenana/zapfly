import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, Trash2, ChevronRight, Layers, X, DollarSign } from 'lucide-react';
import Swal from 'sweetalert2';

import { api } from '../api';

const parseItems = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
};

const toMoney = (value) => {
  const number = Number(value) || 0;
  return number.toFixed(2);
};

const emptyForm = {
  name: '',
  min: 0,
  max: 1,
  items: []
};

const AddonGroupManager = ({ groups = [], products = [], onReloadGroups, onReloadProducts }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (group) => {
    setEditingId(group.id);
    setForm({
      name: group.name || '',
      min: Number(group.min) || 0,
      max: Number(group.max) || 1,
      items: parseItems(group.items)
    });
    setShowModal(true);
  };

  const persistGroup = async () => {
    const name = form.name.trim();
    const min = Math.max(parseInt(form.min, 10) || 0, 0);
    const max = Math.max(parseInt(form.max, 10) || 1, 1);

    if (!name) {
      Swal.fire('Atenção', 'Informe o nome do grupo.', 'warning');
      return;
    }

    if (max < min) {
      Swal.fire('Atenção', 'O máximo não pode ser menor que o mínimo.', 'warning');
      return;
    }

    const items = (form.items || [])
      .map(item => ({
        name: String(item.name || '').trim(),
        price: Number(item.price) || 0
      }))
      .filter(item => item.name);

    try {
      setSaving(true);
      const payload = { name, min, max, items: JSON.stringify(items) };
      if (editingId) {
        await api.patch(`/orders/addon-groups/${editingId}`, payload);
      } else {
        await api.post('/orders/addon-groups', payload);
      }

      setShowModal(false);
      setEditingId(null);
      setForm(emptyForm);
      await Promise.all([
        onReloadGroups?.(),
        onReloadProducts?.()
      ]);

      Swal.fire({
        title: 'Salvo!',
        icon: 'success',
        toast: true,
        position: 'top-end',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire('Erro', err?.response?.data?.error || 'Falha ao salvar grupo.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeGroup = async (group) => {
    const { isConfirmed } = await Swal.fire({
      title: 'Excluir grupo?',
      text: `Deseja remover "${group.name}"? Os vínculos nos produtos serão limpos.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, excluir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444'
    });

    if (!isConfirmed) return;

    try {
      await api.delete(`/orders/addon-groups/${group.id}`);
      await Promise.all([
        onReloadGroups?.(),
        onReloadProducts?.()
      ]);
      Swal.fire({
        title: 'Removido!',
        icon: 'success',
        toast: true,
        position: 'top-end',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire('Erro', err?.response?.data?.error || 'Falha ao excluir grupo.', 'error');
    }
  };

  const linkedProductCount = (groupId) => {
    return products.filter(product => {
      const ids = parseItems(product.addonGroups).map(String);
      return ids.includes(groupId);
    }).length;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        padding: '18px 20px',
        borderRadius: '16px',
        border: '1px solid rgba(245, 158, 11, 0.16)',
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(17, 17, 19, 0.96))'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(245, 158, 11, 0.14)',
              color: '#f59e0b'
            }}>
              <Layers size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#fff' }}>Grupos de adicionais</h3>
              <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                Crie um grupo uma vez e reutilize em vários produtos, com preço adicional e regras de seleção.
              </p>
            </div>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={openCreate}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px', backgroundColor: '#f59e0b' }}
        >
          <Plus size={18} />
          Novo grupo
        </button>
      </div>

      {groups.length === 0 ? (
        <div style={{
          padding: '28px',
          borderRadius: '16px',
          border: '1px dashed rgba(255,255,255,0.08)',
          backgroundColor: 'rgba(255,255,255,0.02)',
          color: 'var(--text-secondary)',
          textAlign: 'center'
        }}>
          Nenhum grupo cadastrado ainda. Crie o primeiro grupo para começar a vincular adicionais aos produtos.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {groups.map(group => {
            const items = parseItems(group.items);
            const isExpanded = expandedId === group.id;
            const productCount = linkedProductCount(group.id);

            return (
              <div
                key={group.id}
                style={{
                  borderRadius: '16px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  backgroundColor: '#18181b',
                  overflow: 'hidden'
                }}
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : group.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '18px 20px',
                    background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', textAlign: 'left' }}>
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      color: '#f59e0b'
                    }}>
                      <Layers size={18} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '16px', fontWeight: 800 }}>{group.name}</span>
                        <span style={{
                          fontSize: '10px',
                          padding: '3px 8px',
                          borderRadius: '999px',
                          backgroundColor: group.min > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255,255,255,0.08)',
                          color: group.min > 0 ? '#fca5a5' : 'var(--text-secondary)',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}>
                          {group.min > 0 ? 'Obrigatório' : 'Opcional'}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          padding: '3px 8px',
                          borderRadius: '999px',
                          backgroundColor: 'rgba(245, 158, 11, 0.12)',
                          color: '#f59e0b',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}>
                          Min {group.min} / Max {group.max}
                        </span>
                      </div>
                      <div style={{ marginTop: '4px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {items.length} item(ns) cadastrado(s) · {productCount} produto(s) usando este grupo
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      className="btn-icon"
                      style={{ padding: '8px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', borderRadius: '10px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(group);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      style={{ padding: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '10px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeGroup(group);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                    <ChevronRight size={18} color="var(--text-secondary)" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginTop: '18px' }}>
                      {items.length === 0 ? (
                        <div style={{
                          padding: '16px',
                          borderRadius: '12px',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          color: 'var(--text-secondary)',
                          fontSize: '13px'
                        }}>
                          Nenhum item cadastrado neste grupo ainda.
                        </div>
                      ) : items.map((item, index) => (
                        <div
                          key={`${group.id}-${index}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '16px 18px',
                            borderRadius: '12px',
                            border: '1px solid rgba(255,255,255,0.06)',
                            backgroundColor: 'rgba(255,255,255,0.03)'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: '#fff' }}>{item.name}</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>
                              Valor adicional aplicado ao produto
                            </div>
                          </div>
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 10px',
                            borderRadius: '999px',
                            backgroundColor: 'rgba(245, 158, 11, 0.12)',
                            color: '#f59e0b',
                            fontWeight: 800,
                            fontSize: '12px'
                          }}>
                            <DollarSign size={14} />
                            R$ {toMoney(item.price)}
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
      )}

      {showModal && createPortal(
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#fff' }}>
                  {editingId ? 'Editar grupo' : 'Novo grupo'}
                </h3>
                <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  Defina quantas opções o cliente deve escolher e quais itens entram no grupo.
                </p>
              </div>
              <button onClick={() => setShowModal(false)} style={closeButtonStyle}>
                <X size={22} />
              </button>
            </div>

            <div style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: '4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={fieldLabelStyle}>Nome do grupo</label>
                  <input
                    style={inputStyle}
                    value={form.name}
                    onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ex: Recheios Gourmet"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Mínimo</label>
                  <input
                    type="number"
                    min="0"
                    style={inputStyle}
                    value={form.min}
                    onChange={(e) => setForm(prev => ({ ...prev, min: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Máximo</label>
                  <input
                    type="number"
                    min="1"
                    style={inputStyle}
                    value={form.max}
                    onChange={(e) => setForm(prev => ({ ...prev, max: e.target.value }))}
                  />
                </div>
              </div>

              <div style={sectionBoxStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <label style={sectionLabelStyle}>Itens do grupo</label>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '8px 12px' }}
                    onClick={() => setForm(prev => ({
                      ...prev,
                      items: [...(prev.items || []), { name: '', price: 0 }]
                    }))}
                  >
                    + Adicionar item
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(form.items || []).length === 0 ? (
                    <div style={{
                      padding: '14px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      color: 'var(--text-secondary)',
                      fontSize: '13px'
                    }}>
                      Adicione itens como "Chocolate", "Morango", "Brigadeiro Gourmet" com o valor adicional de cada um.
                    </div>
                  ) : (form.items || []).map((item, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr auto',
                        gap: '10px',
                        alignItems: 'end',
                        padding: '12px',
                        borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.06)',
                        backgroundColor: 'rgba(255,255,255,0.02)'
                      }}
                    >
                      <div>
                        <label style={subLabelStyle}>Nome</label>
                        <input
                          style={inputStyle}
                          value={item.name}
                          onChange={(e) => {
                            const next = [...(form.items || [])];
                            next[index] = { ...next[index], name: e.target.value };
                            setForm(prev => ({ ...prev, items: next }));
                          }}
                          placeholder="Ex: Gourmet de Chocolate"
                        />
                      </div>
                      <div>
                        <label style={subLabelStyle}>Preço adicional</label>
                        <input
                          type="number"
                          step="0.01"
                          style={inputStyle}
                          value={item.price}
                          onChange={(e) => {
                            const next = [...(form.items || [])];
                            next[index] = { ...next[index], price: e.target.value };
                            setForm(prev => ({ ...prev, items: next }));
                          }}
                        />
                      </div>
                      <button
                        className="btn-icon"
                        style={{ color: '#ef4444', marginBottom: '8px' }}
                        onClick={() => setForm(prev => ({
                          ...prev,
                          items: (prev.items || []).filter((_, idx) => idx !== index)
                        }))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '22px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 2, backgroundColor: '#f59e0b' }}
                onClick={persistGroup}
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar grupo'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.92)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 9999,
  padding: '20px'
};

const modalStyle = {
  width: '100%',
  maxWidth: '840px',
  maxHeight: '92vh',
  overflowY: 'auto',
  backgroundColor: '#18181b',
  borderRadius: '18px',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
  padding: '28px'
};

const closeButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer'
};

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: '12px',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  color: '#fff',
  fontSize: '14px',
  outline: 'none'
};

const fieldLabelStyle = {
  display: 'block',
  fontSize: '10px',
  color: 'var(--text-secondary)',
  marginBottom: '6px',
  fontWeight: 800,
  textTransform: 'uppercase'
};

const subLabelStyle = {
  display: 'block',
  fontSize: '9px',
  color: 'var(--text-muted)',
  marginBottom: '4px',
  fontWeight: 700,
  textTransform: 'uppercase'
};

const sectionLabelStyle = {
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase'
};

const sectionBoxStyle = {
  backgroundColor: 'rgba(255,255,255,0.03)',
  padding: '18px',
  borderRadius: '14px',
  border: '1px dashed var(--border-color)'
};

export default AddonGroupManager;
