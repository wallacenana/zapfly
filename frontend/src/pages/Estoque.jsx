import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Plus, Trash2, ShoppingBag, Calendar, X, Layers, ChevronRight, Hash, Box, Copy, Pencil, Gift, Clock, AlertTriangle, Upload, ArrowUp, ArrowDown } from 'lucide-react';

import Swal from 'sweetalert2';

import { api, API_URL } from '../api';
import AddonGroupManager from '../components/AddonGroupManager';

const parseJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
};

const normalizeCustomField = (field = {}) => ({
  name: field?.name || '',
  type: ['text', 'dropdown', 'image'].includes(String(field?.type || 'text').toLowerCase()) ? String(field?.type || 'text').toLowerCase() : 'text',
  required: !!field?.required,
  options: Array.isArray(field?.options) ? field.options.join(', ') : (field?.options || '')
});

const createCustomField = () => ({
  name: '',
  type: 'text',
  required: false,
  options: ''
});

const getBannerSizeHint = () => 'Tamanho recomendado: altura max. 230px. Em artes menores, use 16:9.';

const sanitizeMoneyInput = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[^\d.,]/g, '');
};

const parseMoneyInput = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim().replace(/[^\d.,-]/g, '');
  if (!raw) return null;

  let normalized = raw;
  if (raw.includes(',') && raw.includes('.')) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatMoneyInput = (value) => {
  const parsed = parseMoneyInput(value);
  if (parsed === null) return sanitizeMoneyInput(value);
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(parsed);
};

const maskMoneyInput = (value) => {
  if (value === null || value === undefined) return '';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  const amount = Number(digits) / 100;
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount)
    : '';
};

const Estoque = () => {
  const [tab, setTab] = useState('delivery'); // 'delivery', 'encomenda' ou 'addon'
  const [products, setProducts] = useState([]);
  const [addonGroups, setAddonGroups] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [isComboMode, setIsComboMode] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'delivery', category: '', image: '', bannerUrl: '', price: 0, promoPrice: '', stock: 0, trackStock: false, capacityCost: 1, featured: false, variations: [], comboItems: [], addonGroups: [], customFields: [], suggestedItemId: '' });
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
  const hasVariations = (form.variations || []).length > 0;

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
        return {
          ...p,
          variations: vars,
          comboItems: items,
          addonGroups: parseJsonArray(p.addonGroups, []),
          customFields: parseJsonArray(p.customFields, []).map(normalizeCustomField)
        };
      });
      setProducts(data.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)));
    } catch (err) { console.error(err); }
  }, []);

  const fetchAddonGroups = useCallback(async () => {
    try {
      const res = await api.get('/orders/addon-groups');
      const data = Array.isArray(res.data) ? res.data.map(group => ({
        ...group,
        items: parseJsonArray(group.items, [])
      })) : [];
      setAddonGroups(data);
    } catch (err) {
      console.error(err);
    }
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
      setCategories(Array.isArray(res.data) ? [...res.data].sort((a, b) => (a.order || 0) - (b.order || 0)) : []);
    } catch (err) { console.error(err); }
  }, []);



  useEffect(() => {
    fetchProducts();
    fetchAddonGroups();
    fetchSeasonal();
    fetchCategories();
  }, [fetchProducts, fetchAddonGroups, fetchSeasonal, fetchCategories]);


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
    setForm({ name: '', description: '', type: tab, category: '', categoryId: '', image: '', bannerUrl: '', price: '', promoPrice: '', stock: 0, trackStock: tab === 'delivery', capacityCost: 1, featured: false, variations: [], comboItems: [], addonGroups: [], customFields: [], suggestedItemId: '' });
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditing(p.id);
    setIsComboMode(p.comboItems && p.comboItems.length > 0 || p.type.startsWith('combo_'));
    const productData = { ...p };
    const resolvedCategoryId = p.categoryId || categories.find(cat => cat.name === p.category)?.id || '';
    setForm({
      ...productData,
      categoryId: resolvedCategoryId,
      category: p.category || categories.find(cat => cat.id === p.categoryId)?.name || '',
      price: p.price ? formatMoneyInput(p.price) : '',
      promoPrice: p.promoPrice ? formatMoneyInput(p.promoPrice) : '',
      variations: parseJsonArray(p.variations, []).map(variation => ({
        ...variation,
        price: variation?.price ? formatMoneyInput(variation.price) : '',
        promoPrice: variation?.promoPrice ? formatMoneyInput(variation.promoPrice) : '',
        subItems: parseJsonArray(variation?.subItems, []).map(subItem => ({
          ...subItem,
          price: subItem?.price ? formatMoneyInput(subItem.price) : '',
          promoPrice: subItem?.promoPrice ? formatMoneyInput(subItem.promoPrice) : '',
          stock: subItem?.stock ?? 0
        }))
      })),
      addonGroups: parseJsonArray(p.addonGroups, []),
      suggestedItemId: p.suggestedItemId && p.suggestedItemId !== p.id ? p.suggestedItemId : '',
      customFields: parseJsonArray(p.customFields, []).map(normalizeCustomField)
    });
    setShowModal(true);
  };

  const duplicateVariationAt = (idx) => {
    setForm(f => {
      const current = [...(f.variations || [])];
      const source = current[idx];
      if (!source) return f;
      const copy = JSON.parse(JSON.stringify(source));
      copy.name = copy.name ? `${copy.name} (Cópia)` : 'Cópia';
      current.splice(idx + 1, 0, copy);
      return { ...f, variations: current };
    });
  };

  const buildProductPayload = (sourceForm, comboMode) => {
    const normalizedVariations = (sourceForm.variations || []).map((variation) => ({
      ...variation,
      subItems: Array.isArray(variation?.subItems) ? variation.subItems.map(subItem => ({
        ...subItem,
        price: parseMoneyInput(subItem?.price) ?? 0,
        promoPrice: parseMoneyInput(subItem?.promoPrice) ?? undefined,
        stock: Number.parseInt(subItem?.stock, 10) || 0
      })) : [],
      price: Array.isArray(variation?.subItems) && variation.subItems.length > 0 ? undefined : (parseMoneyInput(variation?.price) ?? 0),
      promoPrice: Array.isArray(variation?.subItems) && variation.subItems.length > 0 ? undefined : (parseMoneyInput(variation?.promoPrice) ?? undefined),
      stock: Array.isArray(variation?.subItems) && variation.subItems.length > 0 ? undefined : (Number.parseInt(variation?.stock, 10) || 0)
    }));
    const selectedCategory = categories.find(cat => String(cat.id) === String(sourceForm.categoryId));

    return {
      ...sourceForm,
      categoryId: sourceForm.categoryId || '',
      category: selectedCategory?.name || sourceForm.category || '',
      type: comboMode
        ? (String(sourceForm.type || '').startsWith('combo_') ? sourceForm.type : `combo_${sourceForm.type}`)
        : String(sourceForm.type || '').replace('combo_', ''),
      price: parseMoneyInput(sourceForm.price) ?? 0,
      promoPrice: parseMoneyInput(sourceForm.promoPrice) ?? undefined,
      variations: JSON.stringify(normalizedVariations),
      comboItems: JSON.stringify(comboMode ? sourceForm.comboItems : []),
      customFields: JSON.stringify(sourceForm.customFields || []),
      addonGroups: JSON.stringify(sourceForm.addonGroups || []),
      suggestedItemId: sourceForm.suggestedItemId || null
    };
  };

  const duplicateProduct = async (product) => {
    const cloneName = product.name ? `${product.name} (Cópia)` : 'Cópia';
    const cloneForm = {
      ...product,
      name: cloneName,
      price: product.price ? formatMoneyInput(product.price) : '',
      promoPrice: product.promoPrice ? formatMoneyInput(product.promoPrice) : '',
      variations: parseJsonArray(product.variations, []).map(variation => ({
        ...variation,
        price: variation?.price ? formatMoneyInput(variation.price) : '',
        promoPrice: variation?.promoPrice ? formatMoneyInput(variation.promoPrice) : ''
      })),
      addonGroups: parseJsonArray(product.addonGroups, []),
      suggestedItemId: product.suggestedItemId || '',
      customFields: parseJsonArray(product.customFields, []).map(normalizeCustomField)
    };

    const comboMode = (product.comboItems && product.comboItems.length > 0) || String(product.type || '').startsWith('combo_');
    const payload = buildProductPayload(cloneForm, comboMode);
    delete payload.id;

    Swal.fire({
      title: 'Duplicando item...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      await api.post('/orders/products', payload);
      Swal.close();
      fetchProducts();
      Swal.fire({ title: 'Duplicado!', icon: 'success', toast: true, position: 'bottom-end', timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.close();
      Swal.fire('Erro', 'Falha ao duplicar o item.', 'error');
    }
  };

  const handleBannerUpload = async (file) => {
    if (!file) return;
    const url = await handleExternalUpload(file);
    if (url) {
      setForm(prev => ({ ...prev, bannerUrl: url }));
    }
  };

  const saveProduct = async () => {
    if (!form.name || form.name.trim() === '') {
      Swal.fire({ title: 'Campo Obrigatório', text: 'Por favor, insira o nome do item.', icon: 'warning', confirmButtonColor: '#3b82f6' });
      return;
    }

    if (!form.categoryId || !String(form.categoryId).trim()) {
      Swal.fire({ title: 'Campo Obrigatório', text: 'Escolha uma categoria para o item.', icon: 'warning', confirmButtonColor: '#3b82f6' });
      return;
    }

    if (!hasVariations && !(parseMoneyInput(form.price) > 0)) {
      Swal.fire({ title: 'Campo Obrigatório', text: 'Informe um valor base para o item.', icon: 'warning', confirmButtonColor: '#3b82f6' });
      return;
    }

    if (isComboMode && (!form.comboItems || form.comboItems.length === 0)) {
      Swal.fire({ title: 'Combo Vazio', text: 'Selecione pelo menos um item para compor o combo.', icon: 'warning', confirmButtonColor: '#8b5cf6' });
      return;
    }

    const invalidCustomField = (form.customFields || []).find(field => {
      const name = String(field?.name || '').trim();
      const type = String(field?.type || 'text').toLowerCase();
      const options = String(field?.options || '').trim();
      return !name || (type === 'dropdown' && !options);
    });
    if (invalidCustomField) {
      Swal.fire({
        title: 'Campo extra incompleto',
        text: 'Preencha o nome do campo e as opções quando o tipo for lista.',
        icon: 'warning',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    const payload = buildProductPayload(form, isComboMode);
    try {
      if (editing) await api.patch(`/orders/products/${editing}`, payload);
      else await api.post('/orders/products', payload);
      setShowModal(false);
      fetchProducts();
      Swal.fire({ title: 'Salvo!', icon: 'success', toast: true, position: 'bottom-end', timer: 2000, showConfirmButton: false });
    } catch (err) { Swal.fire('Erro', 'Falha ao salvar.', 'error'); }
  };

  const addVar = () => setForm(f => ({ ...f, variations: [...f.variations, { name: '', price: '', promoPrice: '', stock: 0, description: '', subItems: [] }] }));
  const addCustomFieldRow = () => setForm(f => ({ ...f, customFields: [...(f.customFields || []), createCustomField()] }));
  const updateCustomFieldRow = (idx, key, value) => {
    setForm(f => {
      const rows = [...(f.customFields || [])];
      rows[idx] = { ...(rows[idx] || createCustomField()), [key]: value };
      if (key === 'type' && value !== 'dropdown') {
        rows[idx].options = rows[idx].options || '';
      }
      return { ...f, customFields: rows };
    });
  };
  const removeCustomFieldRow = (idx) => {
    setForm(f => ({ ...f, customFields: (f.customFields || []).filter((_, i) => i !== idx) }));
  };
  const addSub = (vIdx) => {
    setForm(f => {
      const v2 = JSON.parse(JSON.stringify(f.variations));
      if (!v2[vIdx].subItems) v2[vIdx].subItems = [];
      v2[vIdx].subItems.push({ name: '', price: '', promoPrice: '', stock: 0 });
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
      Swal.fire({ title: 'Salvo!', icon: 'success', toast: true, position: 'bottom-end', timer: 2000, showConfirmButton: false });
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

  const filtered = [...products]
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    .filter(p => {
      const matchesTab = p.type === tab || p.type === `combo_${tab}`;
      if (!matchesTab) return false;

      if (!showHidden && p.variations.length > 0) {
        const hasVisible = p.variations.some(v => !v.hidden);
        if (!hasVisible) return false;
      }

      return true;
    });

    const getVariationPriceRange = (variations = []) => {
      const prices = variations.flatMap((variation) => {
        const subItems = Array.isArray(variation?.subItems) ? variation.subItems : [];
        if (subItems.length > 0) {
          return subItems
            .map(subItem => parseMoneyInput(subItem?.promoPrice || subItem?.price))
            .filter(value => Number.isFinite(value));
        }
        return [parseMoneyInput(variation?.promoPrice || variation?.price)]
          .filter(value => Number.isFinite(value));
      })
        .filter(value => Number.isFinite(value));
      const min = prices.length ? Math.min(...prices) : null;
      const max = prices.length ? Math.max(...prices) : null;
      return { min, max };
    };

    const getVariationStockSummary = (variations = []) => {
      const total = variations.reduce((sum, variation) => {
        const subItems = Array.isArray(variation?.subItems) ? variation.subItems : [];
        if (subItems.length > 0) {
          const subTotal = subItems.reduce((subSum, subItem) => {
            const stock = Number.parseInt(subItem?.stock, 10);
            return subSum + (Number.isFinite(stock) ? stock : 0);
          }, 0);
          return sum + subTotal;
        }
        const stock = Number.parseInt(variation?.stock, 10);
        return sum + (Number.isFinite(stock) ? stock : 0);
      }, 0);
      return total;
    };

    const groupedProducts = (() => {
      const categoryNameById = new Map(categories.map(cat => [String(cat.id), cat.name]));
      const buckets = [];
    const bucketMap = new Map();

    const resolveCategoryLabel = (product) => {
      const labelById = product.categoryId ? categoryNameById.get(String(product.categoryId)) : '';
      return String(labelById || product.category || 'Sem categoria').trim() || 'Sem categoria';
    };

    filtered.forEach((product) => {
      const label = resolveCategoryLabel(product);
      if (!bucketMap.has(label)) {
        const bucket = { label, items: [] };
        bucketMap.set(label, bucket);
        buckets.push(bucket);
      }
      bucketMap.get(label).items.push(product);
    });

    const ordered = [];
    categories.forEach((cat) => {
      const label = String(cat.name || 'Sem categoria').trim() || 'Sem categoria';
      const bucket = bucketMap.get(label);
      if (bucket && !ordered.includes(bucket)) ordered.push(bucket);
    });

    buckets.forEach((bucket) => {
      if (!ordered.includes(bucket)) ordered.push(bucket);
    });

    return ordered;
  })();

  const moveProductOrder = async (currentIndex, delta) => {
    const targetIndex = currentIndex + delta;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= filtered.length) return;

    const nextList = [...filtered];
    const [moved] = nextList.splice(currentIndex, 1);
    nextList.splice(targetIndex, 0, moved);

    const updated = nextList.map((p, idx) => ({ ...p, displayOrder: idx + 1 }));
    const orderMap = new Map(updated.map(p => [p.id, p.displayOrder]));

    setProducts(prev => prev
      .map(p => (orderMap.has(p.id) ? { ...p, displayOrder: orderMap.get(p.id) } : p))
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    );

    try {
      await api.post('/orders/products/reorder', {
        items: updated.map(p => ({ id: p.id, displayOrder: p.displayOrder }))
      });
    } catch (err) {
      console.error(err);
      fetchProducts();
    }
  };

  const inp = { style: { width: '100%', padding: '10px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '14px', outline: 'none' } };

  return (
    <div style={{ padding: '30px' }}>
      <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#fff' }}>Catálogo & Estoque</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie seus produtos e combos de {tab === 'delivery' ? 'Pronta Entrega' : 'Agendamento'}</p>
        </div>
      </div>

      <div className="mb-30 d-flex gap-10 justify-content-between align-items-center">
        <div className="d-flex gap-10">
          {tab === 'seasonal' ? (
            <button className="btn btn-primary d-flex align-items-center gap-2" onClick={openAddSeasonal} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: '#ec4899' }}>
              <Plus size={20} /> Novo Evento
            </button>
          ) : tab === 'addon' ? (
            <div className="d-flex align-items-center gap-2" style={{ padding: '12px 18px', backgroundColor: 'rgba(245, 158, 11, 0.08)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.18)', borderRadius: '12px', fontWeight: 700 }}>
              <Layers size={18} /> Os grupos são gerenciados na lista abaixo
            </div>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => openAdd(false)} >
                <Plus size={20} /> Adicionar Item
              </button>
              <button className="btn btn-primary" onClick={() => openAdd(true)} >
                <Plus size={20} /> Novo Combo
              </button>
              <button className="btn btn-primary" onClick={() => setShowCategoryModal(true)} style={{ backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.16)', color: '#fff' }}>
                <Layers size={20} /> Categorias
              </button>
            </>
          )}
        </div>

        <div className="d-flex gap-10 tab-actions radius-8">
          <button onClick={() => setTab('delivery')} style={{ ...tabBtn, backgroundColor: tab === 'delivery' ? '#161b29' : '#0F172A', fontWeight: tab === 'delivery' ? 700 : 400, color: tab === 'delivery' ? '#fff' : 'var(--text-secondary)' }}>
            <ShoppingBag size={18} /> Pronta Entrega
          </button>
          <button onClick={() => setTab('encomenda')} style={{ ...tabBtn, backgroundColor: tab === 'encomenda' ? '#161b29' : '#0F172A', fontWeight: tab === 'encomenda' ? 700 : 400, color: tab === 'encomenda' ? '#fff' : 'var(--text-secondary)' }}>
            <Calendar size={18} /> Agendamentos
          </button>
          <button onClick={() => setTab('addon')} style={{ ...tabBtn, backgroundColor: tab === 'addon' ? '#161b29' : '#0F172A', fontWeight: tab === 'addon' ? 700 : 400, color: tab === 'addon' ? '#fff' : 'var(--text-secondary)' }}>
            <Plus size={18} /> Adicionais
          </button>
          <button onClick={() => setTab('seasonal')} style={{ ...tabBtn, backgroundColor: tab === 'seasonal' ? '#161b29' : '#0F172A', fontWeight: tab === 'seasonal' ? 700 : 400, color: tab === 'seasonal' ? '#fff' : 'var(--text-secondary)' }}>
            <Gift size={18} /> Datas Comemorativas
          </button>
        </div></div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        {tab === 'seasonal' ? (
          seasonalCatalogs.map(s => (
            <div key={s.id} style={{ backgroundColor: '#18181b', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(236, 72, 153, 0.1)', color: '#ec4899', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Gift size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '16px', color: '#fff' }}>{s.name}</div>
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
        ) : tab === 'addon' ? (
          <AddonGroupManager
            groups={addonGroups}
            products={products}
            onReloadGroups={fetchAddonGroups}
            onReloadProducts={fetchProducts}
          />
        ) : (
          groupedProducts.map((group) => (
            <React.Fragment key={group.label}>
              <div style={{ margin: '20px 2px 2px', fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                {group.label}
              </div>
              {group.items.map((p) => {
                const globalIndex = filtered.findIndex(item => item.id === p.id);
                const isExpanded = expanded === p.id;
                const isCombo = p.comboItems && p.comboItems.length > 0;
                const canExpand = isCombo || (Array.isArray(p.variations) && p.variations.length > 0);
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => handleProductDragStart(e, globalIndex)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleProductDrop(e, globalIndex)}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', transition: 'all 0.2s', cursor: 'grab' }}
                  >
                    <div
                      onClick={() => {
                        if (canExpand) {
                          setExpanded(isExpanded ? null : p.id);
                          return;
                        }
                        openEdit(p);
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent';
                      }}
                      style={{ padding: '20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', backgroundColor: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent', borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.05)' : 'none', transition: 'background-color 0.18s ease, border-color 0.18s ease' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {canExpand ? (
                          <ChevronRight size={20} color="var(--text-secondary)" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                        ) : (
                          <div style={{ width: '20px', height: '20px' }} />
                        )}
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ fontWeight: 800, fontSize: '15px', color: '#fff' }}>{p.name}</div>
                            {isCombo && <span style={{ fontSize: '10px', backgroundColor: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', padding: '2px 8px', borderRadius: '4px', fontWeight: 900 }}>COMBO</span>}
                            <span style={{ fontSize: '10px', backgroundColor: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: '999px', fontWeight: 800 }}>#{p.displayOrder || globalIndex + 1}</span>
                            {p.featured && <span style={{ fontSize: '10px', backgroundColor: 'rgba(59, 130, 246, 0.16)', color: '#60a5fa', padding: '2px 8px', borderRadius: '999px', fontWeight: 900 }}>DESTAQUE</span>}
                            {Array.isArray(p.customFields) && p.customFields.length > 0 && <span style={{ fontSize: '10px', backgroundColor: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b', padding: '2px 8px', borderRadius: '999px', fontWeight: 900 }}>EXTRAS</span>}
                          </div>
                          {!p.variations.length && !isCombo && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>R$ {p.price.toFixed(2)} {p.trackStock && `| Estoque: ${p.stock}`} {!p.trackStock && '| Estoque: Ilimitado'}</div>}
                          {p.variations.length > 0 && !isCombo && (() => {
                            const { min, max } = getVariationPriceRange(p.variations);
                            const stock = getVariationStockSummary(p.variations);
                            const stockLabel = p.trackStock ? ` | Estoque: ${stock}` : ' | Estoque: Ilimitado';
                            if (min !== null && max !== null) {
                              const priceLabel = min === max ? `R$ ${min.toFixed(2)}` : `R$ ${min.toFixed(2)} - R$ ${max.toFixed(2)}`;
                              return <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{priceLabel}{stockLabel}</div>;
                            }
                            return <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{p.price ? `R$ ${Number(p.price).toFixed(2)}` : 'Sem preço definido'}{stockLabel}</div>;
                          })()}
                          {isCombo && <div style={{ fontSize: '13px', color: '#8b5cf6', marginTop: '4px', fontWeight: 700 }}>R$ {p.price.toFixed(2)} | {p.comboItems.length} itens inclusos</div>}
                          {!isCombo && Array.isArray(p.addonGroups) && p.addonGroups.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                              {p.addonGroups.map(groupId => {
                                const group = addonGroups.find(g => g.id === groupId);
                                if (!group) return null;
                                return (
                                  <span
                                    key={groupId}
                                    style={{
                                      fontSize: '10px',
                                      padding: '3px 8px',
                                      borderRadius: '999px',
                                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                                      color: '#f59e0b',
                                      fontWeight: 800,
                                      letterSpacing: '0.04em'
                                    }}
                                  >
                                    {group.name}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            className="btn-icon"
                            disabled={globalIndex === 0}
                            title="Mover para cima"
                            style={{  color: globalIndex === 0 ? 'rgba(255,255,255,0.25)' : '#fff', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', cursor: globalIndex === 0 ? 'not-allowed' : 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); moveProductOrder(globalIndex, -1); }}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            className="btn-icon"
                            disabled={globalIndex === filtered.length - 1}
                            title="Mover para baixo"
                            style={{  color: globalIndex === filtered.length - 1 ? 'rgba(255,255,255,0.25)' : '#fff', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', cursor: globalIndex === filtered.length - 1 ? 'not-allowed' : 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); moveProductOrder(globalIndex, 1); }}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                        <button className="btn-icon" style={{ color: '#22c55e', borderRadius: '8px' }} onClick={(e) => { e.stopPropagation(); duplicateProduct(p); }} title="Duplicar item"><Copy size={16} /></button>
                        <button className="btn-icon" style={{ color: '#3b82f6', borderRadius: '8px' }} onClick={(e) => { e.stopPropagation(); openEdit(p); }}><Pencil size={16} /></button>
                        <button className="btn-icon" style={{ color: '#ef4444', borderRadius: '8px' }} onClick={(e) => {
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
                      </div>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))
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
                  <label className="estoque-label">Nome do Evento</label>
                  <input {...inp} placeholder="Ex: Dia das Mães, Páscoa..." value={seasonalForm.name} onChange={e => setSeasonalForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="estoque-label">Data do Evento</label>
                  <input {...inp} type="date" value={seasonalForm.eventDate} onChange={e => setSeasonalForm(f => ({ ...f, eventDate: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                <div>
                  <label className="estoque-label estoque-label--inline"><Clock size={10} /> Antecedência (Exibir X dias antes)</label>
                  <input {...inp} type="number" value={seasonalForm.preStartDays} onChange={e => setSeasonalForm(f => ({ ...f, preStartDays: parseInt(e.target.value) }))} />
                </div>
                <div>
                  <label className="estoque-label estoque-label--inline"><Clock size={10} /> Permanência (Exibir Y dias depois)</label>
                  <input {...inp} type="number" value={seasonalForm.postEndDays} onChange={e => setSeasonalForm(f => ({ ...f, postEndDays: parseInt(e.target.value) }))} />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label className="estoque-label">Descrição / Chamada Especial</label>
                <textarea {...inp} style={{ ...inp.style, minHeight: '60px' }} placeholder="Ex: Prepare-se para o dia mais especial do ano!" value={seasonalForm.description || ''} onChange={e => setSeasonalForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              <div style={sectionBox}>
                <h5 style={sectionTitle}>REGRAS OPERACIONAIS</h5>
                <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label className="estoque-label estoque-label--micro">Limite Máximo de Pedidos para o Dia (0 = Ilimitado)</label>
                    <input {...inp} type="number" value={seasonalForm.maxOrders} onChange={e => setSeasonalForm(f => ({ ...f, maxOrders: parseInt(e.target.value) }))} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(236, 72, 153, 0.05)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(236, 72, 153, 0.1)' }}>
                    <input type="checkbox" id="onlySeasonal" checked={seasonalForm.onlySeasonalOnEventDay} onChange={e => setSeasonalForm(f => ({ ...f, onlySeasonalOnEventDay: e.target.checked }))} style={{ width: '18px', height: '18px' }} />
                    <label htmlFor="onlySeasonal" className="estoque-label estoque-label--check estoque-label--pink">
                      Aceitar APENAS itens sazonais para a data do evento?
                      <p style={{ fontWeight: 400, fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Lily recusará encomendas do cardápio regular se o cliente escolher o dia do evento para entrega.</p>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label className="estoque-label estoque-label--section">Itens do catálogo especial</label>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h3 style={{ fontWeight: 800 }}>{editing ? 'Editar' : 'Novo'} {isComboMode ? 'Combo' : 'Produto'}</h3>
              <button onClick={() => setShowModal(false)} style={closeBtn}><X size={24} /></button>
            </div>

            <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
              <div style={{ marginBottom: '20px' }}>
                <label className="estoque-label">Identificação do {isComboMode ? 'Combo' : 'Item'}</label>
                <input {...inp} placeholder={isComboMode ? "Ex: Combo Casal, Kit Festa..." : "Ex: Nome do Produto"} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label className="estoque-label">Descrição (Opcional)</label>
                <textarea {...inp} style={{ ...inp.style, minHeight: '60px', resize: 'vertical' }} placeholder="Detalhes que o cliente deve saber." value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label className="estoque-label">Imagens do Produto (Múltiplas fotos)</label>
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
                        } catch (e) {
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
                    } catch (e) {
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
                  <label className="estoque-label">Categoria</label>
                  <select {...inp} required aria-required="true" value={form.categoryId || ''} onChange={e => {
                    const categoryId = e.target.value;
                    const selected = categories.find(cat => String(cat.id) === String(categoryId));
                    setForm(f => ({ ...f, categoryId, category: selected?.name || '' }));
                  }}>
                    <option value="">Selecione uma categoria</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>

                {!isComboMode && !hasVariations && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                    <div>
                      <label className="estoque-label">Preço normal (R$)</label>
                    <input
                      {...inp}
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={form.price}
                      onChange={e => setForm(f => ({ ...f, price: maskMoneyInput(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="estoque-label">Preço promocional (R$)</label>
                    <input
                      {...inp}
                      type="text"
                      inputMode="decimal"
                      placeholder="Opcional"
                      value={form.promoPrice}
                      onChange={e => setForm(f => ({ ...f, promoPrice: maskMoneyInput(e.target.value) }))}
                    />
                    </div>
                  </div>
                )}

                {!isComboMode && !hasVariations && (
                  <div style={{ marginBottom: '20px' }}>
                    <label className="estoque-label">Estoque</label>
                    <input
                      {...inp}
                      type="number"
                      inputMode="numeric"
                      placeholder="0"
                      value={form.stock}
                      onChange={e => setForm(f => ({ ...f, stock: e.target.value === '' ? '' : parseInt(e.target.value, 10) || 0 }))}
                    />
                  </div>
                )}


                <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "20px" }}>
                  <label htmlFor="trackStock" className="estoque-label estoque-label--switch">
                    <span style={{ cursor: 'pointer', fontWeight: 700, fontSize: '13px', color: '#e5e7eb' }}>Controle de estoque</span>
                    <span style={{ position: 'relative', width: '44px', height: '24px', borderRadius: '999px', backgroundColor: form.trackStock ? '#22c55e' : 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, transition: 'all 0.2s ease' }}>
                      <input
                        type="checkbox"
                        id="trackStock"
                        checked={form.trackStock}
                        onChange={e => setForm(f => ({ ...f, trackStock: e.target.checked }))}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                      />
                      <span style={{ position: 'absolute', top: '2px', left: form.trackStock ? '21px' : '2px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', transition: 'left 0.2s ease' }} />
                    </span>
                  </label>

                  <label htmlFor="featured" className="estoque-label estoque-label--switch">
                    <span style={{ cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>Destaque no menu</span>
                    <span style={{ position: 'relative', width: '44px', height: '24px', borderRadius: '999px', backgroundColor: form.featured ? '#3b82f6' : 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, transition: 'all 0.2s ease' }}>
                      <input
                        type="checkbox"
                        id="featured"
                        checked={form.featured}
                        onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                      />
                      <span style={{ position: 'absolute', top: '2px', left: form.featured ? '21px' : '2px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', transition: 'left 0.2s ease' }} />
                    </span>
                  </label>
                </div>
                {form.featured && (
                  <div style={{ gridColumn: '1 / -1', backgroundColor: 'rgba(59, 130, 246, 0.08)', padding: '15px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.22)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <div>
                          <div style={{ fontSize: '13px', fontWeight: 800, color: '#60a5fa' }}>Banner do destaque</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Se tiver banner, ele aparece no topo como destaque. Sem banner, o produto aparece normalmente.</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{getBannerSizeHint()}</div>
                        </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          id="banner-upload"
                          type="file"
                          hidden
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            await handleBannerUpload(file);
                            e.target.value = '';
                          }}
                        />
                        <button
                          className="btn"
                          type="button"
                          onClick={() => document.getElementById('banner-upload')?.click()}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
                        >
                          <Upload size={16} /> Enviar banner
                        </button>
                      </div>
                    </div>

                    {form.bannerUrl ? (
                      <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <img src={form.bannerUrl} alt="Banner do destaque" style={{ width: '100%', height: '180px', objectFit: 'cover', display: 'block' }} />
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, bannerUrl: '' }))}
                          style={{ position: 'absolute', top: '10px', right: '10px', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '999px', padding: '6px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
                        >
                          Remover banner
                        </button>
                      </div>
                    ) : (
                      <div style={{ border: '1px dashed rgba(255,255,255,0.12)', borderRadius: '12px', padding: '16px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                        Nenhum banner enviado ainda. O destaque vai usar a imagem normal do produto.
                      </div>
                    )}
                  </div>
                )}

                {!isComboMode && (
                  <div style={{ gridColumn: '1 / -1', backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '15px', borderRadius: '12px', marginTop: '10px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-secondary)' }}>Variações do Produto</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Use quando o item tiver opções diferentes, como tamanhos, sabores ou versões.</div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={addVar}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: 'rgba(255, 255, 255, 0.06)', color: 'rgb(255, 255, 255)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}
                      >
                        <Plus size={16} /> Add Variação
                      </button>
                    </div>

                    {(form.variations || []).length === 0 ? (
                      <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', fontSize: '12px' }}>
                        Nenhuma variação cadastrada. Se o produto tiver opções, cadastre aqui.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {(form.variations || []).map((variation, idx) => (
                          <div key={idx} style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.75fr 0.75fr 0.75fr auto', gap: '10px', alignItems: 'start' }}>
                            <div>
                              <label className="estoque-label estoque-label--compact">Nome</label>
                              <input
                                  {...inp}
                                  placeholder="Ex: 1kg, Chocolate, Tradicional"
                                  value={variation.name || ''}
                                  onChange={e => {
                                    const next = [...(form.variations || [])];
                                    next[idx] = { ...(next[idx] || {}), name: e.target.value };
                                    setForm(f => ({ ...f, variations: next }));
                                  }}
                                />
                              </div>
                              {!(variation.subItems || []).length && (
                                <>
                                  <div>
                                    <label className="estoque-label estoque-label--compact">Preço (R$)</label>
                                    <input
                                      {...inp}
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0,00"
                                      value={variation.price}
                                      onChange={e => {
                                        const next = [...(form.variations || [])];
                                        next[idx] = { ...(next[idx] || {}), price: maskMoneyInput(e.target.value) };
                                        setForm(f => ({ ...f, variations: next }));
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label className="estoque-label estoque-label--compact">Preço promocional (R$)</label>
                                    <input
                                      {...inp}
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="Opcional"
                                      value={variation.promoPrice}
                                      onChange={e => {
                                        const next = [...(form.variations || [])];
                                        next[idx] = { ...(next[idx] || {}), promoPrice: maskMoneyInput(e.target.value) };
                                        setForm(f => ({ ...f, variations: next }));
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label className="estoque-label estoque-label--compact">Estoque</label>
                                    <input
                                      {...inp}
                                      type="number"
                                      value={variation.stock ?? 0}
                                      onChange={e => {
                                        const next = [...(form.variations || [])];
                                        next[idx] = { ...(next[idx] || {}), stock: e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0 };
                                        setForm(f => ({ ...f, variations: next }));
                                      }}
                                    />
                                  </div>
                                </>
                              )}
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingTop: '27px' }}>
                                <label className="estoque-label estoque-label--check">
                                  <input
                                    type="checkbox"
                                    checked={!!variation.hidden}
                                    onChange={e => {
                                      const next = [...(form.variations || [])];
                                      next[idx] = { ...(next[idx] || {}), hidden: e.target.checked };
                                      setForm(f => ({ ...f, variations: next }));
                                    }}
                                    style={{ width: '16px', height: '16px', accentColor: '#60a5fa', cursor: 'pointer' }}
                                  />
                                  Invisivel
                                </label>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  onClick={() => duplicateVariationAt(idx)}
                                  style={{ color: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.10)', borderRadius: '8px', padding: '8px' }}
                                  title="Duplicar variação"
                                >
                                  <Copy size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  onClick={() => setForm(f => ({ ...f, variations: (f.variations || []).filter((_, i) => i !== idx) }))}
                                  style={{ color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.10)', borderRadius: '8px', padding: '8px' }}
                                  title="Remover variação"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>

                            <div style={{ marginTop: '10px' }}>
                              <label className="estoque-label estoque-label--compact">Descrição</label>
                              <textarea
                                {...inp}
                                placeholder="Breve descrição da variação"
                                value={variation.description || ''}
                                onChange={e => {
                                  const next = [...(form.variations || [])];
                                  next[idx] = { ...(next[idx] || {}), description: e.target.value };
                                  setForm(f => ({ ...f, variations: next }));
                                }}
                              ></textarea>
                            </div>

                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 800, color: '#94a3b8' }}>Subitens / Estoque interno</div>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => addSub(idx)}
                                  style={{ padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontSize: '12px' }}
                                >
                                  + Add Subitem
                                </button>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {(variation.subItems || []).length === 0 ? (
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Nenhum subitem adicionado.</div>
                                ) : (
                                  (variation.subItems || []).map((subItem, subIdx) => (
                                    <div key={subIdx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.7fr 0.7fr auto', gap: '10px', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '10px' }}>
                                      <input
                                        {...inp}
                                        placeholder="Nome do subitem"
                                        value={subItem.name || ''}
                                        onChange={e => {
                                          const next = JSON.parse(JSON.stringify(form.variations));
                                          next[idx].subItems[subIdx].name = e.target.value;
                                          setForm(f => ({ ...f, variations: next }));
                                        }}
                                      />
                                      <input
                                        {...inp}
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="Preço"
                                        value={subItem.price || ''}
                                        onChange={e => {
                                          const next = JSON.parse(JSON.stringify(form.variations));
                                          next[idx].subItems[subIdx].price = maskMoneyInput(e.target.value);
                                          setForm(f => ({ ...f, variations: next }));
                                        }}
                                      />
                                      <input
                                        {...inp}
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="Promoção"
                                        value={subItem.promoPrice || ''}
                                        onChange={e => {
                                          const next = JSON.parse(JSON.stringify(form.variations));
                                          next[idx].subItems[subIdx].promoPrice = maskMoneyInput(e.target.value);
                                          setForm(f => ({ ...f, variations: next }));
                                        }}
                                      />
                                      <input
                                        {...inp}
                                        type="number"
                                        placeholder="Estoque"
                                        value={subItem.stock ?? 0}
                                        onChange={e => {
                                          const next = JSON.parse(JSON.stringify(form.variations));
                                          next[idx].subItems[subIdx].stock = e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0;
                                          setForm(f => ({ ...f, variations: next }));
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="btn-icon"
                                        onClick={() => {
                                          const next = JSON.parse(JSON.stringify(form.variations));
                                          next[idx].subItems.splice(subIdx, 1);
                                          setForm(f => ({ ...f, variations: next }));
                                        }}
                                        style={{ color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.10)', borderRadius: '8px', padding: '8px' }}
                                        title="Remover subitem"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {isComboMode ? (
                <div style={{ ...sectionBox, gridColumn: '1 / -1' }}>
                  <h5 style={sectionTitle}>ITENS DISPONÍVEIS PARA O COMBO</h5>
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
                <div style={{ ...sectionBox, gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '14px' }}>
                    <h5 style={sectionTitle}><Layers size={14} /> GRUPOS DE ADICIONAIS</h5>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vincule um ou mais grupos ao produto</span>
                  </div>

                  {addonGroups.length === 0 ? (
                    <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      Nenhum grupo foi criado ainda. Use a aba <b>Adicionais</b> para cadastrar recheios, coberturas e complementos reutilizáveis.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                      {addonGroups.map(group => {
                        const checked = (form.addonGroups || []).includes(group.id);
                        const items = parseJsonArray(group.items, []);
                        return (
                          <label
                            key={group.id}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const current = [...(form.addonGroups || [])];
                                const next = e.target.checked
                                  ? Array.from(new Set([...current, group.id]))
                                  : current.filter(id => id !== group.id);
                                setForm(prev => ({ ...prev, addonGroups: next }));
                              }}
                              style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#f59e0b', cursor: 'pointer' }}
                            />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 800, color: '#fff' }}>{group.name}</span>
                                <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '999px', backgroundColor: group.min > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255,255,255,0.08)', color: group.min > 0 ? '#fca5a5' : 'var(--text-secondary)', fontWeight: 800 }}>
                                  {group.min > 0 ? 'Obrigatório' : 'Opcional'}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                Min {group.min} / Max {group.max} Â· {items.length} item(ns)
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div style={{ ...sectionBox, gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '14px' }}>
                  <h5 style={sectionTitle}><Gift size={14} /> Sugestão de Itens</h5>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Order bump sutil no checkout</span>
                </div>

                {products.length === 0 ? (
                  <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Crie pelo menos um item para poder sugerir outro produto no checkout.
                  </div>
                ) : (
                  <div>
                    <label className="estoque-label estoque-label--compact">Item sugerido</label>
                    <select
                      {...inp}
                      value={form.suggestedItemId || ''}
                      onChange={e => setForm(f => ({ ...f, suggestedItemId: e.target.value }))}
                    >
                      <option value="">Nenhuma sugestão</option>
                      {products
                        .filter(prod => String(prod.id) !== String(editing))
                        .map(prod => (
                          <option key={prod.id} value={prod.id}>
                            {prod.name}{prod.category ? ` · ${prod.category}` : ''}
                          </option>
                        ))}
                    </select>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                      Mostra um item extra, com no máximo 1 opcao, no momento do pedido.
                    </div>
                  </div>
                )}
              </div>

              {isComboMode && (
                <div style={{ marginTop: '20px' }}>
                  <label className="estoque-label">Preço Final do Combo (R$)</label>
                  <input
                    {...inp}
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: maskMoneyInput(e.target.value) }))}
                  />
                </div>
              )}
              <div style={{ gridColumn: '1 / -1', backgroundColor: 'rgba(245, 158, 11, 0.06)', padding: '15px', borderRadius: '12px', marginTop: '20px', border: '1px solid rgba(245, 158, 11, 0.16)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#f59e0b' }}>Campos Extras do Item</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Crie perguntas obrigatórias ou opcionais que aparecem na hora de montar o pedido.</div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={addCustomFieldRow}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: 'rgba(245, 158, 11, 0.10)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.18)', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}
                  >
                    <Plus size={16} /> Add Campo
                  </button>
                </div>

                {(form.customFields || []).length === 0 ? (
                  <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', fontSize: '12px' }}>
                    Nenhum campo extra configurado. Use isso para coletar referência, cor, topo, observações ou qualquer outro dado.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {(form.customFields || []).map((field, idx) => (
                      <div key={idx} style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 0.55fr auto', gap: '10px', alignItems: 'start' }}>
                          <div>
                            <label className="estoque-label estoque-label--compact">Nome do Campo</label>
                            <input
                              {...inp}
                              placeholder="Ex: Cor, Tema, Referência"
                              value={field.name || ''}
                              onChange={e => updateCustomFieldRow(idx, 'name', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="estoque-label estoque-label--compact">Tipo</label>
                            <select
                              {...inp}
                              value={field.type || 'text'}
                              onChange={e => updateCustomFieldRow(idx, 'type', e.target.value)}
                            >
                              <option value="text">Texto</option>
                              <option value="dropdown">Lista</option>
                              <option value="image">Imagem</option>
                            </select>
                          </div>
                          <div style={{ paddingTop: '32px' }}>
                            <label className="estoque-label estoque-label--check">
                              <input
                                type="checkbox"
                                checked={!!field.required}
                                onChange={e => updateCustomFieldRow(idx, 'required', e.target.checked)}
                                style={{ width: '16px', height: '16px', accentColor: '#f59e0b', cursor: 'pointer' }}
                              />
                              Obrigatorio
                            </label>
                          </div>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => removeCustomFieldRow(idx)}
                            style={{ marginTop: '26px', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.10)', borderRadius: '8px', padding: '8px' }}
                            title="Remover campo"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                        {String(field.type || 'text').toLowerCase() === 'dropdown' && (
                          <div style={{ marginTop: '10px' }}>
                            <label className="estoque-label estoque-label--compact">Opções da Lista</label>
                            <input
                              {...inp}
                              placeholder="Ex: Chocolate, Morango, Ninho"
                              value={field.options || ''}
                              onChange={e => updateCustomFieldRow(idx, 'options', e.target.value)}
                            />
                            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                              Separe as opções por vÃ­rgula.
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: '25px', display: 'flex', gap: '10px' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h3 style={{ fontWeight: 800 }}>Gerenciar Categorias</h3>
              <button onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }} style={closeBtn}><X size={24} /></button>
            </div>

            <div style={{ marginBottom: '25px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <label className="estoque-label">{editingCategory ? 'Editar Categoria' : 'Nova Categoria'}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    {...inp}
                    placeholder="Nome da Categoria"
                    value={editingCategory ? categoryForm.name : newCategoryName}
                    onChange={e => editingCategory ? setCategoryForm(f => ({ ...f, name: e.target.value })) : setNewCategoryName(e.target.value)}
                  />
                  {editingCategory && (
                    <input
                      {...inp}
                      type="number"
                      style={{ ...inp.style, width: '80px' }}
                      placeholder="Ordem"
                      value={categoryForm.order}
                      onChange={e => setCategoryForm(f => ({ ...f, order: e.target.value }))}
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
                          Swal.fire({ title: 'Atualizado!', icon: 'success', toast: true, position: 'bottom-end', timer: 2000, showConfirmButton: false });
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
                        Swal.fire({ title: 'Adicionado!', icon: 'success', toast: true, position: 'bottom-end', timer: 2000, showConfirmButton: false });
                      } catch (err) { Swal.fire('Erro', 'Falha ao adicionar.', 'error'); }
                    }}>Adicionar Categoria</button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label className="estoque-label">Categorias Existentes</label>
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
const modalOverlay = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9, backdropFilter: 'blur(8px)', padding: '20px' };
const modalContent = { width: '100%', maxWidth: '960px', maxHeight: '90vh', padding: '30px', position: 'relative', overflowY: 'auto', backgroundColor: '#18181b', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' };
const closeBtn = { background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' };
const sectionBox = { backgroundColor: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '12px', border: '1px dashed var(--border-color)', marginTop: '20px' };
const sectionTitle = { fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' };
const varGroupStyle = { backgroundColor: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '12px', marginBottom: '15px', border: '1px solid rgba(255,255,255,0.05)' };

export default Estoque;

