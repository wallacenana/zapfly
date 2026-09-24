import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Clock, CheckCircle, Search, Truck, XCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin, CreditCard } from 'lucide-react';
import { api } from '../api';
import { socket } from '../api';
import Swal from 'sweetalert2';

const getPrintableOrderParts = (order) => {
  const rawProduct = String(order.product || 'Produto');
  const extrasMatch = rawProduct.match(/\s*\[([^\]]+)\]\s*$/);
  let productName = (extrasMatch ? rawProduct.slice(0, extrasMatch.index) : rawProduct).trim();
  const variation = String(order.variation || '').trim();
  if (variation && productName.endsWith(`(${variation})`)) productName = productName.slice(0, -(variation.length + 2)).trim();
  const extras = extrasMatch ? extrasMatch[1].split(/,\s*/).filter(Boolean) : [];
  return { productName, extras };
};

const getAttachmentUrls = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
  } catch (e) { }

  return /^https?:\/\//i.test(raw) ? [raw] : [];
};

const renderAttachmentGallery = (value, targetBlank = true) => {
  const urls = getAttachmentUrls(value);
  if (!urls.length) return value;

  if (!targetBlank) {
    return `<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 5px;">${urls.map((url, index) => `<img src="${url}" alt="Anexo ${index + 1}" style="width: 76px; height: 76px; object-fit: cover; display: block; border: 1px solid #cbd5e1; border-radius: 8px;">`).join('')}</div>`;
  }

  return `<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 5px;">${urls.map((url, index) => `<button type="button" class="order-attachment-thumb" data-attachment-url="${encodeURIComponent(url)}" title="Abrir anexo ${index + 1}" style="display: block; width: 76px; height: 76px; padding: 0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #fff; cursor: zoom-in;"><img src="${url}" alt="Anexo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover; display: block;"></button>`).join('')}</div>`;
};

const getOrderChatJid = (order) => {
  const storedJid = String(order?.clientJid || '').trim();
  if (storedJid.includes('@') && !storedJid.startsWith('manual_')) return storedJid;

  const digits = String(order?.clientPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `${digits.startsWith('55') ? digits : `55${digits}`}@s.whatsapp.net`;
};

const getLegacyGroupName = (order, value) => {
  const groups = Array.isArray(order.productRelation?.addonGroupDefinitions) ? order.productRelation.addonGroupDefinitions : [];
  return groups.find(group => {
    try {
      return JSON.parse(group.items || '[]').some(item => String(item?.name || item).trim() === String(value).trim());
    } catch (e) { return false; }
  })?.name || '';
};

const normalizeCatalogName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const getOrderSelectionRows = (order) => {
  const rows = [];
  const productParts = getPrintableOrderParts(order);
  const addRow = (label, value, isAttachment = false, isCustomField = false, price = 0) => {
    const cleanLabel = String(label || '').trim();
    const cleanValue = String(value || '').trim();
    if (cleanLabel && cleanValue && !rows.some(([rowLabel, rowValue]) => rowLabel === cleanLabel && rowValue === cleanValue)) {
      rows.push([cleanLabel, cleanValue, isAttachment, isCustomField, Math.max(0, Number(price) || 0)]);
    }
  };
  try {
    const parsedAddons = typeof order.addons === 'string' ? JSON.parse(order.addons) : order.addons;
    const addons = Array.isArray(parsedAddons) ? parsedAddons : parsedAddons?.addons;
    (Array.isArray(addons) ? addons : []).forEach(addon => addRow(
      addon.groupName || 'Opção',
      addon.name,
      addon.isAttachment,
      addon.isCustomField,
      (Number(addon?.price) || 0) * (Number(addon?.quantity) || 1)
    ));
  } catch (e) { }

  try {
    const customFields = typeof order.customFields === 'string' ? JSON.parse(order.customFields) : order.customFields;
    (Array.isArray(customFields) ? customFields : []).forEach(field => {
      if (field?.type === 'image' && !field.urls?.length) return;
      const value = field?.type === 'image' ? JSON.stringify(field.urls) : field?.value;
      addRow(field?.name, value, field?.type === 'image', true);
    });
  } catch (e) { }

  if (!rows.length) {
    productParts.extras.forEach(extra => {
      const separator = extra.indexOf(':');
      if (separator > 0) addRow(extra.slice(0, separator), extra.slice(separator + 1), /^https?:\/\//i.test(extra.slice(separator + 1)), true);
      else addRow(getLegacyGroupName(order, extra) || 'Opção', extra, /^https?:\/\//i.test(extra), false);
    });
  }
  const hasGroupFor = (name) => rows.some(([label]) => normalizeCatalogName(label).includes(normalizeCatalogName(name)));
  // Compatibilidade com pedidos antigos que gravavam estes campos fixos.
  addRow('Massa', order.massa);
  if (!hasGroupFor('recheio')) addRow('Recheio', order.recheio);
  addRow('Topo', order.topo);
  addRow('Variação', order.variation);
  return rows;
};

const getOrderSelectionSections = (order) => {
  const rows = getOrderSelectionRows(order);
  const sections = [];
  const variation = String(order.variation || '').trim();

  rows.forEach(([rowLabel, value, isAttachment, isCustomField, price]) => {
    if (value === variation) return;
    const label = isCustomField ? 'Informações extras' : rowLabel || 'Opção';
    let section = sections.find(item => item.label === label);
    if (!section) {
      section = { label, values: [] };
      sections.push(section);
    }
    if (!section.values.some(([currentValue]) => currentValue === value)) section.values.push([value, isAttachment, price]);
  });
  return sections;
};

const getEditSelectionValue = (order, aliases, fallback = '') => {
  const aliasList = aliases.map(alias => alias.toLowerCase());
  const rows = getOrderSelectionRows(order);
  const row = rows.find(([label]) => {
    const normalizedLabel = String(label).toLowerCase();
    return aliasList.some(alias => normalizedLabel.includes(alias));
  });
  return row ? rows.filter(([label]) => label === row[0]).map(([, value]) => value).join(', ') : fallback;
};

const normalizeVariationName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/^bolo\s+de\s+/, '')
  .replace(/\s+/g, '');

const resolveOrderItemPrice = (order) => {
  const product = order.productRelation;
  if (!product) return 0;

  try {
    const variations = typeof product.variations === 'string' ? JSON.parse(product.variations) : product.variations;
    const selectedName = normalizeVariationName(order.variation);
    const matches = (Array.isArray(variations) ? variations : [])
      .filter(variation => normalizeVariationName(variation?.name) === selectedName);
    const selected = matches.find(variation => !variation?.hidden) || matches[0];
    if (selected) {
      const price = Number(selected.price) || 0;
      const promoPrice = Number(selected.promoPrice) || 0;
      return promoPrice > 0 && promoPrice < price ? promoPrice : price;
    }
  } catch (e) { }

  const price = Number(product.price) || 0;
  const promoPrice = Number(product.promoPrice) || 0;
  return promoPrice > 0 && promoPrice < price ? promoPrice : price;
};

const getOrderItems = (order) => {
  try {
    const rawItems = order.cartItems ?? order.cartitems ?? order.cart_items;
    const parsedItems = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
    const items = Array.isArray(parsedItems) ? parsedItems : parsedItems?.cartItems;
    if (Array.isArray(items) && items.length > 0) return items;
  } catch (e) { }

  try {
    const legacyAddons = typeof order.addons === 'string' ? JSON.parse(order.addons) : order.addons;
    if (Array.isArray(legacyAddons?.cartItems) && legacyAddons.cartItems.length > 0) return legacyAddons.cartItems;
  } catch (e) { }

  return [{
    productId: order.productId,
    name: order.product || 'Produto',
    variation: order.variation || null,
    price: resolveOrderItemPrice(order),
    quantity: Number(order.quantity) || 1
  }];
};

const hasAcceptedPendingPayment = (order) => {
  const paymentStatus = String(order?.paymentStatus || '').trim().toLowerCase();
  const paymentMethod = String(order?.paymentMethod || '').trim().toLowerCase();
  const isCashPayment = ['dinheiro', 'cash'].includes(paymentMethod);
  return String(order?.status || '').toLowerCase() === 'accepted'
    && !isCashPayment
    && paymentStatus !== 'confirmed';
};

const Production = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeType, setActiveType] = useState(localStorage.getItem('kanban_activeType') || 'order');
  const [selectedDate, setSelectedDate] = useState(localStorage.getItem('kanban_selectedDate') || new Date().toISOString().split('T')[0]);
  const [showWaitingDrawer, setShowWaitingDrawer] = useState(false);
  const ordersRequestRef = useRef(null);
  const openedLinkedOrderRef = useRef('');
  const linkedOrderId = String(searchParams.get('orderId') || '').trim();
  const linkedOrderDate = String(searchParams.get('date') || '').trim();

  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(linkedOrderDate) && linkedOrderDate !== selectedDate) {
      setSelectedDate(linkedOrderDate);
    }
  }, [linkedOrderDate, selectedDate]);

  // Persistência de estado
  useEffect(() => {
    localStorage.setItem('kanban_activeType', activeType);
  }, [activeType]);

  useEffect(() => {
    localStorage.setItem('kanban_selectedDate', selectedDate);
  }, [selectedDate]);

  // Navegação de dias
  const changeDate = (days) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const getDayName = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date().toISOString().split('T')[0];
    if (dateStr === today) return "Hoje";
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' });
  };

  const columns = [
    { id: 'waiting_payment', title: 'Aguardando', color: '#9ca3af', icon: <CreditCard size={18} /> },
    { id: 'pending', title: 'Pendentes', color: '#f59e0b', icon: <Clock size={18} /> },
    { id: 'accepted', title: 'Aceitos', color: '#8b5cf6', icon: <CheckCircle size={18} /> },
    { id: 'production', title: 'Em Produção', color: '#3b82f6', icon: <Package size={18} /> },
    { id: 'ready', title: 'Saiu p/ Entrega / Pronto', color: '#10b981', icon: <Truck size={18} /> },
    { id: 'completed', title: 'Finalizados', color: '#6b7280', icon: <CheckCircle size={18} /> },
    { id: 'cancelled', title: 'Cancelados', color: '#ef4444', icon: <XCircle size={18} /> }
  ];

  useEffect(() => {
    fetchOrders();

    const refreshOrders = () => fetchOrders();
    const handleNewOrder = (data) => {
      console.log('[Socket] Novo pedido pago!', data);
      refreshOrders();
      Swal.fire({
        title: '💰 PAGAMENTO CONFIRMADO!',
        text: 'Um novo pedido pago acaba de entrar na produção ou nos pendentes.',
        icon: 'success',
        toast: true,
        position: 'top-end',
        timer: 5000,
        showConfirmButton: false
      });
    };

    socket.on('new_order_pending', handleNewOrder);
    socket.on('order_confirmed', refreshOrders);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchOrders({ force: true });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchOrders();
    }, 30000);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      ordersRequestRef.current?.abort();
      ordersRequestRef.current = null;
      socket.off('new_order_pending', handleNewOrder);
      socket.off('order_confirmed', refreshOrders);
    };
  }, [selectedDate, activeType]); // Dependências adicionadas para recarregar ao mudar de dia



  const fetchOrders = async ({ force = false } = {}) => {
    if (document.visibilityState === 'hidden' && !force) return;
    if (ordersRequestRef.current) return;

    const controller = new AbortController();
    ordersRequestRef.current = controller;
    try {
      const res = await api.get(`/orders?date=${selectedDate}`, { signal: controller.signal });
      setOrders(res.data);
    } catch (err) {
      if (err?.code !== 'ERR_CANCELED' && err?.name !== 'CanceledError') {
        console.warn('[Production] Não foi possível atualizar os pedidos.', err?.message || err);
      }
    } finally {
      if (ordersRequestRef.current === controller) ordersRequestRef.current = null;
      setLoading(false);
    }
  };

  const updateStatus = async (orderId, newStatus) => {
    const targetOrder = orders.find(order => order.id === orderId);
    if (!targetOrder) return;

    if (newStatus === 'cancelled') {
      const result = await Swal.fire({
        title: 'Cancelar pedido?',
        text: targetOrder.paymentStatus === 'confirmed'
          ? 'O pagamento confirmado será estornado automaticamente.'
          : 'O pedido será marcado como cancelado.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: targetOrder.paymentStatus === 'confirmed' ? 'Cancelar e estornar' : 'Cancelar pedido',
        cancelButtonText: 'Voltar',
        confirmButtonColor: '#ef4444'
      });
      if (!result.isConfirmed) return;
    }

    // 1. Guarda o estado antigo caso dê erro no banco
    const previousOrders = [...orders];

    // 2. Atualiza a interface IMEDIATAMENTE (Magia do Optimistic UI)
    const updatedOrders = orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o);
    setOrders(updatedOrders);

    // 3. Dispara alerta visual instantâneo para QUALQUER coluna
    Swal.fire({
      title: newStatus === 'ready' ? 'Pronto!' : 'Atualizado!',
      text: newStatus === 'ready' ? 'O cliente será avisado (se houver robô ativo).' : 'Status do pedido alterado.',
      icon: 'success',
      toast: true,
      position: 'top-end',
      timer: 2000,
      showConfirmButton: false
    });

    try {
      // 4. Salva no banco de forma silenciosa e invisível para o usuário
      await api.patch(`/orders/${orderId}`, { status: newStatus });
    } catch (err) {
      // 5. Se o banco falhar, devolvemos o card pro lugar original e avisamos o erro
      setOrders(previousOrders);
      Swal.fire('Erro na Conexão', 'Não foi possível salvar a alteração no banco de dados. O card foi revertido.', 'error');
    }
  };

  const handleEditOrder = (order) => {
    const editProduct = getPrintableOrderParts(order).productName;
    const editMassa = getEditSelectionValue(order, ['massa'], order.massa || '');
    const editRecheio = getEditSelectionValue(order, ['recheio'], order.recheio || '');
    const editTopo = getEditSelectionValue(order, ['topo'], order.topo || '');
    Swal.fire({
      title: 'Editar Pedido',
      background: '#111827',
      color: '#fff',
      willOpen: () => {
        const container = Swal.getContainer();
        if (container) container.style.zIndex = '3000';
      },
      html: `
        <div style="text-align: left; font-family: 'Inter', sans-serif;">
           <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-bottom: 15px;">
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">PRODUTO</label>
              <input id="edit-product" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${editProduct}">
            </div>
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">QTD / PESO</label>
              <input id="edit-quantity" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.quantity || '1'}">
            </div>
          </div>
          
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">VARIAÇÃO / SABOR</label>
            <input id="edit-variation" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.variation || 'Opção Padrão'}">
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">DATA</label>
              <input id="edit-date" type="date" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.scheduledDate || ''}">
            </div>
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">HORA</label>
              <input id="edit-time" type="time" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.scheduledTime || ''}">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px;">
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">MASSA</label>
              <input id="edit-massa" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${editMassa}">
            </div>
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">RECHEIO</label>
              <input id="edit-recheio" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${editRecheio}">
            </div>
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">TOPO</label>
              <input id="edit-topo" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${editTopo}">
            </div>
          </div>

          <div>
            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">NOTAS / OBSERVAÇÕES</label>
            <textarea id="edit-notes" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff; min-height: 80px;">${order.notes || ''}</textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Salvar Alterações',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3b82f6',
      preConfirm: () => {
        return {
          product: document.getElementById('edit-product').value,
          quantity: document.getElementById('edit-quantity').value,
          variation: document.getElementById('edit-variation').value,
          scheduledDate: document.getElementById('edit-date').value,
          scheduledTime: document.getElementById('edit-time').value,
          massa: document.getElementById('edit-massa').value,
          recheio: document.getElementById('edit-recheio').value,
          topo: document.getElementById('edit-topo').value,
          notes: document.getElementById('edit-notes').value
        }
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await api.patch(`/orders/${order.id}`, result.value);
          Swal.fire({
            title: 'Sucesso!',
            text: 'Pedido atualizado com sucesso.',
            icon: 'success',
            timer: 2000,
            showConfirmButton: false,
            background: '#111827',
            color: '#fff'
          });
          fetchOrders();
        } catch (err) {
          Swal.fire({
            title: 'Erro!',
            text: 'Não foi possível atualizar o pedido.',
            icon: 'error',
            background: '#111827',
            color: '#fff'
          });
        }
      }
    });
  };

  const openDetails = (order) => {
    const orderIdShort = (order.id || '').slice(-4).toUpperCase();
    const formattedDate = (order.scheduledDate || '').split('-').reverse().join('/');
    const orderItems = getOrderItems(order);
    const quantity = orderItems.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    const freightValue = order.deliveryFee || 0;
    const isCashPayment = ['dinheiro', 'cash'].includes(String(order.paymentMethod || '').trim().toLowerCase());
    const acceptedWithoutPayment = hasAcceptedPendingPayment(order);
    const displayParts = getPrintableOrderParts(order);
    // Pega o preço real do produto ou calcula dinamicamente subtraindo a taxa de entrega, com fallback seguro
    const unitPrice = Number(orderItems[0]?.price) || 0;

    const itemsSubtotal = orderItems.length > 1
      ? orderItems.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 1)), 0)
      : unitPrice * quantity;
    // O detalhamento do carrinho e a fonte de verdade para pedidos com varios itens.
    // Pedidos antigos podem ter salvo apenas o valor do primeiro item em totalValue.
    const finalTotal = itemsSubtotal > 0 ? (itemsSubtotal + freightValue) : Number(order.totalValue || 0);

    const totalValueStr = finalTotal.toFixed(2);
    const subtotalStr = itemsSubtotal.toFixed(2);
    const freightStr = freightValue.toFixed(2);
    const selectionSections = getOrderSelectionSections(order);
    const detailRows = selectionSections.flatMap(section => section.values.map(([value, isAttachment]) => [section.label, value, isAttachment]));
    const printSelectionHtml = selectionSections.map(section => `<div style="margin-bottom: 8px;"><b>${section.label}:</b>${section.values.map(([value, isAttachment, price]) => `<div style="display: flex; justify-content: space-between; gap: 12px; padding-left: 10px;"><span>${isAttachment || getAttachmentUrls(value).length ? renderAttachmentGallery(value, false) : value}</span><span style="white-space: nowrap; font-weight: 700;">${price > 0 ? `R$ ${price.toFixed(2)}` : ''}</span></div>`).join('')}</div>`).join('');
    const detailSummaryHtml = detailRows.length
? `<div style="font-size: 13px; color: #475569; margin-top: 12px; padding-top: 0; line-height: 1.6;">${detailRows.map(([label, value, isAttachment]) => `<div><b>${label}:</b><br><span style="padding-left: 8px;">${isAttachment || getAttachmentUrls(value).length ? renderAttachmentGallery(value) : value}</span></div>`).join('')}</div>`
      : '';

    const selectionSummaryHtml = selectionSections.length
? `<div style="font-size: 13px; color: #475569; margin-top: 12px; padding-top: 0; line-height: 1.6;">${selectionSections.map((section, index) => `<div style="margin-top: 10px; padding-top: ${index ? '10px' : '0'}; ${index ? 'border-top: 1px dashed #cbd5e1;' : ''}"><b>${section.label}:</b>${section.values.map(([value, isAttachment]) => `<div style="padding-left: 8px;">${isAttachment || getAttachmentUrls(value).length ? renderAttachmentGallery(value) : value}</div>`).join('')}</div>`).join('')}</div>`
      : '';

    const selectionTableRowsHtml = selectionSections.map((section, sectionIndex) => `
      <tr${sectionIndex ? ' style="border-top: 1px dashed rgba(15,23,42,0.08);"' : ''}>
        <td style="padding: 8px 0 2px;"></td>
        <td style="padding: 8px 10px 2px; font-size: 13px; color: #475569; font-weight: 700;">${section.label}:</td>
        <td></td>
      </tr>
      ${section.values.map(([value, isAttachment, price]) => `
        <tr>
          <td style="padding: 2px 0;"></td>
          <td style="padding: 2px 10px 2px 18px; font-size: 13px; color: #475569;">${isAttachment || getAttachmentUrls(value).length ? renderAttachmentGallery(value) : value}</td>
          <td style="padding: 2px 0; text-align: right; white-space: nowrap; font-weight: 700; font-size: 14px; color: #f59e0b;">${price > 0 ? `R$ ${price.toFixed(2)}` : ''}</td>
        </tr>`).join('')}`).join('');

    let notesHtml = '';
    // Limpa a tag de frete da exibição visual das notas para não ficar repetitivo
    const cleanNotes = (order.notes || '')
      .replace(/\[Frete: R\$ [\d.]+\]/, '')
      .split(/\r?\n/)
      .filter(note => !/\d+\s+imagens?\s+recebidas/i.test(note))
      .join('\n')
      .trim();

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

    // Botão de ação baseado no status
    const orderItemsHtml = orderItems.map((item, index) => {
      const itemQuantity = Number(item.quantity) || 1;
      const itemPrice = Number(item.price) || 0;
      const rawName = String(item.name || 'Produto').trim();
      const extrasMatch = rawName.match(/\s*\[([^\]]+)\]\s*$/);
      let itemName = (extrasMatch ? rawName.slice(0, extrasMatch.index) : rawName).trim();
      const itemVariation = String(item.variation || '').trim();
      if (itemVariation && itemName.endsWith(`(${itemVariation})`)) {
        itemName = itemName.slice(0, -(itemVariation.length + 2)).trim();
      }
      const itemExtras = extrasMatch ? extrasMatch[1] : '';
      const itemDetailsHtml = index === 0
        ? notesHtml
        : (itemExtras ? `<div style="font-size: 13px; color: #475569; margin-top: 10px;">Extras: ${itemExtras}</div>` : '');

      return `
                <tr${index > 0 ? ' style="border-top: 1px dashed rgba(15,23,42,0.08);"' : ''}>
                  <td style="padding: 20px 0; vertical-align: top;">
                    <div style="background: #3b82f6; color: #fff; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 20px; font-weight: 900;">
                      ${itemQuantity}
                    </div>
                  </td>
                  <td style="padding: 20px 10px; vertical-align: top;">
                    <div style="font-size: 10px; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Item</div>
                    <div style="font-weight: 900; font-size: 18px; color: #0f172a; line-height: 1.25;">${itemName}</div>
                    ${itemVariation ? `<div style="font-size: 13px; color: #3b82f6; margin-top: 4px; font-weight: 700;">${itemVariation}</div>` : ''}
                    ${itemDetailsHtml}
                  </td>
                  <td style="font-size: 14px; vertical-align: top; padding-top: 20px; text-align: right;">
                    R$ ${(itemPrice * itemQuantity).toFixed(2)}
                  </td>
                </tr>`;
    }).join('');

    let actionBtnHtml = '';
    if (order.status === 'waiting_payment' && order.type === 'order') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #8b5cf6; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">ACEITAR PEDIDO</button>`;
    } else if (order.status === 'pending') {
      const nextLabel = order.type === 'delivery' ? 'INICIAR PRODUÇÃO' : 'ACEITAR PEDIDO';
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #8b5cf6; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">${nextLabel}</button>`;
    } else if (order.status === 'accepted') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #3b82f6; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">INICIAR PRODUÇÃO</button>`;
    } else if (order.status === 'production') {
      const nextLabel = order.type === 'delivery' ? 'MOVER PARA ENTREGA' : 'PEDIDO PRONTO';
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #3b82f6; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">${nextLabel}</button>`;
    } else if (order.status === 'ready') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #10b981; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">FINALIZAR</button>`;
    }

    const handlePrint = (order) => {
      const saved = JSON.parse(localStorage.getItem('print_settings') || '{"showId":true,"prod":true,"massa":true,"notes":true,"value":true,"addr":true,"client":true,"driver":false}');

      Swal.fire({
        title: 'Opções de Impressão',
        background: '#111827',
        color: '#fff',
        willOpen: () => {
          const container = Swal.getContainer();
          if (container) container.style.zIndex = '3000';
        },
        html: `
          <div style="text-align: left; padding: 10px;">
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-id" ${saved.showId ? 'checked' : ''}> ID do Pedido (#XXXX)</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-prod" ${saved.prod ? 'checked' : ''}> Produto e Variação</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-massa" ${saved.massa ? 'checked' : ''}> Detalhes (Massa/Recheio/Topo)</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-notes" ${saved.notes ? 'checked' : ''}> Observações</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-value" ${saved.value ? 'checked' : ''}> Valor Total</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-addr" ${saved.addr ? 'checked' : ''}> Endereço de Entrega</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-client" ${saved.client ? 'checked' : ''}> Nome do Cliente</label></div>
            <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.2);"><label><input type="checkbox" id="p-driver" ${saved.driver ? 'checked' : ''}> Imprimir versão do entregador</label><div style="font-size: 12px; opacity: 0.7; margin: 5px 0 0 20px;">ID, cliente, endereço e taxa. Em dinheiro, inclui o total a receber.</div></div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '🖨️ IMPRIMIR AGORA',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#3b82f6',
        preConfirm: () => {
          const settings = {
            showId: document.getElementById('p-id').checked,
            prod: document.getElementById('p-prod').checked,
            massa: document.getElementById('p-massa').checked,
            notes: document.getElementById('p-notes').checked,
            value: document.getElementById('p-value').checked,
            addr: document.getElementById('p-addr').checked,
            client: document.getElementById('p-client').checked,
            driver: document.getElementById('p-driver').checked,
          };
          localStorage.setItem('print_settings', JSON.stringify(settings));
          return settings;
        }
      }).then((result) => {
        if (result.isConfirmed) {
          const opts = result.value;
          const idShort = order.id.slice(-4).toUpperCase();
          const printParts = getPrintableOrderParts(order);

          const printItems = getOrderItems(order);
          const printItemsHtml = printItems.map((item) => {
            const itemQuantity = Number(item.quantity) || 1;
            const itemPrice = Number(item.price) || 0;
            const rawName = String(item.name || 'Produto').trim();
            const extrasMatch = rawName.match(/\s*\[([^\]]+)\]\s*$/);
            let itemName = (extrasMatch ? rawName.slice(0, extrasMatch.index) : rawName).trim();
            const itemVariation = String(item.variation || '').trim();
            if (itemVariation && itemName.endsWith(`(${itemVariation})`)) {
              itemName = itemName.slice(0, -(itemVariation.length + 2)).trim();
            }
            return `<div style="margin: 10px 0; padding-bottom: 10px; border-bottom: 1px solid #000;">
              <div style="font-size: 18px; font-weight: 900;">ITEM ${itemQuantity}x</div>
              <div style="font-size: 20px; margin-top: 5px; font-weight: 900;">${itemName}</div>
              ${itemVariation ? `<div style="font-size: 16px;">Variacao: ${itemVariation}</div>` : ''}
              ${extrasMatch ? `<div style="font-size: 15px;">Extras: ${extrasMatch[1]}</div>` : ''}
              <div style="font-size: 16px; text-align: right;">Subtotal: R$ ${(itemPrice * itemQuantity).toFixed(2)}</div>
            </div>`;
          }).join('');

          let content = `
            <div style="font-family: 'Inter', Arial, sans-serif; width: 100%; max-width: 280px; margin: 0 auto; color: #000; line-height: 1.4;">
              <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px;">
                ${opts.showId || opts.driver ? `<h1 style="margin: 0; font-size: 32px; font-weight: 900;">#${idShort}</h1>` : ''}
                <p style="margin: 5px 0; font-size: 16px; font-weight: 700;">${order.scheduledDate} - ${order.scheduledTime}</p>
              </div>
          `;

          if (opts.driver) {
            const isCashPayment = ['dinheiro', 'cash'].includes(String(order.paymentMethod || '').trim().toLowerCase());
            content += `<p style="font-size: 18px; margin: 8px 0;"><b>CLIENTE:</b> ${order.clientName || 'Cliente'}</p>`;
            content += `<p style="font-size: 16px; margin: 10px 0;"><b>ENDEREÇO:</b> ${order.deliveryAddress || 'Retirada na loja'}</p>`;
            content += `<div style="margin-top: 15px; border-top: 2px solid #000; padding-top: 10px;"><h2 style="margin: 0; text-align: right; font-size: 22px;">TAXA DE ENTREGA: R$ ${freightValue.toFixed(2)}</h2></div>`;
            if (isCashPayment) content += `<div style="margin-top: 12px; border-top: 1px dashed #000; padding-top: 10px;"><h2 style="margin: 0; text-align: right; font-size: 22px;">RECEBER: R$ ${finalTotal.toFixed(2)}</h2></div>`;
          } else {
            if (opts.client) content += `<p style="font-size: 18px; margin: 8px 0;"><b>👤 CLIENTE:</b> ${order.clientName}</p>`;
            if (opts.prod) content += printItemsHtml;

            if (opts.massa && printSelectionHtml) content += `<div style="margin: 10px 0; padding: 10px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; font-size: 16px;">${printSelectionHtml}</div>`;
            if (opts.notes && cleanNotes) content += `<p style="font-size: 16px; margin: 10px 0; padding: 8px; background: #f3f4f6; border-radius: 5px;"><b>📝 OBS:</b> ${cleanNotes}</p>`;
            if (opts.addr && order.deliveryAddress) content += `<p style="font-size: 16px; margin: 10px 0;"><b>📍 ENTREGA:</b> ${order.deliveryAddress}</p>`;
            if (freightValue > 0) content += `<p style="font-size: 16px; margin: 10px 0;"><b>TAXA DE ENTREGA:</b> R$ ${freightValue.toFixed(2)}</p>`;
            if (opts.value) content += `<div style="margin-top: 15px; border-top: 2px solid #000; padding-top: 10px;"><h2 style="margin: 0; text-align: right; font-size: 24px;">TOTAL: R$ ${finalTotal.toFixed(2)}</h2></div>`;
          }

          content += '</div>';

          const printWindow = window.open('', '_blank', 'width=600,height=800');
          if (printWindow) {
            printWindow.document.write(`
              <html>
                <head>
                  <title>Pedido #${idShort}</title>
                  <style>
                    @page { margin: 0; size: auto; }
                    body { margin: 0; padding: 10px; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; }
                    * { box-sizing: border-box; }
                  </style>
                </head>
                <body>
                  ${content}
                  <script>
                    setTimeout(() => {
                      window.print();
                      window.close();
                    }, 500);
                  </script>
                </body>
              </html>
            `);
            printWindow.document.close();
          } else {
            Swal.fire('Pop-up Bloqueado', 'Por favor, permita pop-ups para este site para poder imprimir.', 'warning');
          }
        }
      });
    };

    const handleMaps = (address) => {
      if (!address) {
        Swal.fire('Erro', 'Este pedido não possui endereço de entrega.', 'error');
        return;
      }
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      window.open(mapsUrl, '_blank');
    };

    Swal.fire({
      background: isCashPayment ? '#fff5f5' : '#ffffff',
      color: '#0f172a',
      width: '550px',
      showCloseButton: true,
      showConfirmButton: false,
      willOpen: () => {
        const container = Swal.getContainer();
        if (container) container.style.zIndex = '3000';
      },
      didOpen: () => {
        const chatBtn = document.getElementById('btn-go-to-chat');
        if (chatBtn) chatBtn.onclick = () => {
          const chatJid = getOrderChatJid(order);
          if (!chatJid) {
            Swal.fire('Telefone não informado', 'Este pedido não possui um número de WhatsApp válido.', 'warning');
            return;
          }
          Swal.close();
          navigate(`/chat/${encodeURIComponent(chatJid)}`);
        };

        document.querySelectorAll('.order-attachment-thumb').forEach(button => {
          button.onclick = () => {
            const imageUrl = decodeURIComponent(button.dataset.attachmentUrl || '');
            Swal.fire({
              imageUrl,
              imageAlt: 'Anexo do pedido',
              showConfirmButton: false,
              showCloseButton: true,
              width: 'min(92vw, 760px)',
              background: '#fff'
            });
          };
        });

        const markPaymentButton = document.getElementById('btn-mark-payment-received');
        if (markPaymentButton) {
          markPaymentButton.onclick = async () => {
            markPaymentButton.disabled = true;
            try {
              await api.patch(`/orders/${order.id}`, { paymentStatus: 'confirmed' });
              setOrders(current => current.map(item => item.id === order.id ? { ...item, paymentStatus: 'confirmed' } : item));
              Swal.fire({ title: 'Pagamento registrado', text: 'O pedido foi marcado como pago.', icon: 'success', timer: 1800, showConfirmButton: false });
            } catch (error) {
              markPaymentButton.disabled = false;
              Swal.fire('Erro', 'Não foi possível registrar o pagamento.', 'error');
            }
          };
        }

        const actionBtn = document.getElementById('btn-action-next');
        if (actionBtn) {
          actionBtn.onclick = () => {
            const nextStatusMap = {
              'waiting_payment': order.type === 'order' ? 'accepted' : 'pending',
              'pending': order.type === 'delivery' ? 'production' : 'accepted',
              'accepted': 'production',
              'production': 'ready',
              'ready': 'completed'
            };
            const nextStatus = nextStatusMap[order.status];
            if (nextStatus) {
              updateStatus(order.id, nextStatus);
              Swal.close();
            }
          };
        }

        const editBtn = document.getElementById('btn-edit-order');
        if (editBtn) editBtn.onclick = () => {
          Swal.close();
          handleEditOrder(order);
        };

        const printBtn = document.getElementById('btn-print-order');
        if (printBtn) printBtn.onclick = () => handlePrint(order);

        const mapsBtn = document.getElementById('btn-maps-order');
        if (mapsBtn) mapsBtn.onclick = () => handleMaps(order.deliveryAddress);
      },
      html: `
        <div style="text-align: left; font-family: 'Inter', sans-serif; color: #0f172a;">
          <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: #3b82f6; font-weight: 900; letter-spacing: 1px;">PEDIDO #${orderIdShort}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              ${order.type === 'delivery' ? `<button id="btn-maps-order" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); color: #059669; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; cursor: pointer;">📍 ROTA</button>` : ''}
              <button id="btn-print-order" style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); color: #3b82f6; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; cursor: pointer;">🖨️ IMPRIMIR</button>
              <button id="btn-edit-order" style="background: rgba(15, 23, 42, 0.04); border: 1px solid rgba(15, 23, 42, 0.08); color: #0f172a; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; cursor: pointer;">✏️ EDITAR</button>
              <div style="background: ${columns.find(c => c.id === order.status)?.color || '#6b7280'}; color: #ffffff; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 800; text-transform: uppercase;">
                ${columns.find(c => c.id === order.status)?.title || order.status}
              </div>
            </div>
          </div>

          <div style="background: #f8fafc; border-radius: 16px; padding: 20px; border: 1px solid rgba(15,23,42,0.08); margin-bottom: 20px;">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="font-size: 10px; color: #94a3b8; text-transform: uppercase; border-bottom: 1px solid rgba(15,23,42,0.08);">
                  <th style="text-align: left; padding-bottom: 12px; width: 60px;">Qtd</th>
                  <th style="text-align: left; padding-bottom: 12px;">Descrição do Pedido</th>
                  <th style="text-align: right; padding-bottom: 12px;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${orderItemsHtml}
                ${selectionTableRowsHtml}
                <tr style="display: none;">
                  <td style="padding: 20px 0; vertical-align: top;">
                    <div style="background: #3b82f6; color: #fff; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 20px; font-weight: 900;">
                      ${quantity}
                    </div>
                  </td>
                  <td style="padding: 20px 10px; vertical-align: top;">
                    <div style="font-size: 10px; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Item</div>
                    <div style="font-weight: 900; font-size: 18px; color: #0f172a; line-height: 1.25;">${orderItems.length > 1 ? orderItems.map(item => `${Number(item.quantity) || 1}x ${String(item.name || 'Produto').replace(/\s*\[[^\]]*\]\s*$/, '').trim()}${item.variation ? ` (${item.variation})` : ''}`).join('<br>') : displayParts.productName}</div>
                    <div style="font-size: 13px; color: #3b82f6; margin-top: 4px; font-weight: 700;">${order.variation || 'Opção Padrão'}</div>
                    ${selectionSummaryHtml}
                    ${notesHtml}
                  </td>
                  <td style="font-size: 14px; vertical-align: top; padding-top: 20px; text-align: right;">
                    R$ ${subtotalStr}
                  </td>
                </tr>
                ${freightValue > 0 ? `
                <tr style="border-top: 1px dashed rgba(15,23,42,0.08);">
                  <td style="padding: 10px 0;"></td>
                  <td style="padding: 10px 10px; font-size: 13px; color: #64748b; font-weight: 600;">Taxa de Entrega (Uber)</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: 700; font-size: 15px; color: #f59e0b;">R$ ${freightStr}</td>
                </tr>
                ` : ''}
              </tbody>
            </table>

            <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid rgba(15,23,42,0.08); display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; font-size: 13px; color: #64748b;">TOTAL A RECEBER</span>
              <span style="font-weight: 900; font-size: 26px; color: #10b981;">R$ ${totalValueStr}</span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div style="background: #f8fafc; padding: 12px; border-radius: 12px; border: 1px solid rgba(15,23,42,0.08);">
              <div style="font-size: 10px; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">📅 Entrega/Retirada</div>
              <div style="font-size: 15px; font-weight: 800; color: #0f172a;">${order.scheduledTime} - ${formattedDate}</div>
            </div>
            <div style="background: #f8fafc; padding: 12px; border-radius: 12px; border: 1px solid rgba(15,23,42,0.08);">
              <div style="font-size: 10px; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">💰 Pagamento</div>
              ${acceptedWithoutPayment
                ? `<div style="background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 900; display: inline-block; margin-top: 2px;">⚠️ ACEITO SEM PAGAMENTO</div><div style="font-size: 11px; color: #64748b; margin-top: 5px;">${order.paymentMethod || 'A COMBINAR'}</div>`
                : `<div style="background: #fbbf24; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 900; display: inline-block; margin-top: 2px;">${order.paymentMethod || 'A COMBINAR'}</div>`}
            </div>
          </div>

          <div style="padding: 15px; background: #f8fafc; border-radius: 12px; border: 1px dotted rgba(15,23,42,0.12); margin-bottom: 20px;">
            <div style="font-size: 10px; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Dados do Cliente</div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 800; font-size: 15px; color: #0f172a;">${order.clientName}</div>
                <div style="font-size: 12px; color: #64748b;">${order.clientPhone || order.clientJid?.split('@')[0]}</div>
              </div>
              <button id="btn-go-to-chat" style="background: #3b82f6; color: #ffffff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                <span>💬</span> Ver Conversa
              </button>
            </div>
            ${addressHtml}
          </div>

          <div style="display: flex; gap: 10px;">
            ${acceptedWithoutPayment ? '<button id="btn-mark-payment-received" style="flex: 1; background: #16a34a; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">MARCAR COMO PAGO</button>' : ''}
            ${actionBtnHtml}
          </div>
        </div>
      `
    });
  };

  useEffect(() => {
    if (!linkedOrderId || openedLinkedOrderRef.current === linkedOrderId) return;
    const linkedOrder = orders.find(order => String(order.id) === linkedOrderId);
    if (!linkedOrder) return;

    openedLinkedOrderRef.current = linkedOrderId;
    setActiveType(linkedOrder.type === 'delivery' ? 'delivery' : 'order');
    openDetails(linkedOrder);
    setSearchParams({}, { replace: true });
  }, [linkedOrderId, orders, setSearchParams]);

  const filteredOrders = orders.filter(o => {
    const matchSearch =
      (o.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.product || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.id || '').toLowerCase().includes(searchTerm.toLowerCase());

    // Se o pedido não tiver tipo (antigos), tratamos como 'order' por padrão para não sumir
    const orderType = o.type || 'order';
    const matchType = orderType === activeType;

    // Apenas pedidos Pendentes, Em Produção e Prontos furam o filtro de data.
    // Pedidos concluídos, cancelados ou agendados ('order' mas em accepted) obedecem à data selecionada.
    const isGeneralOrderQueue = ['order', 'delivery'].includes(orderType) && ['waiting_payment', 'pending'].includes(o.status);
    const matchDate = isGeneralOrderQueue || o.scheduledDate === selectedDate;

    return matchType && matchSearch && matchDate;
  });

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#fff' }}>Carregando Produção...</div>;

  return (
    <div className="production-page" style={{
      padding: '25px',
      height: 'calc(100vh - 70px)',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      maxWidth: '100%',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      <div className="production-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Seletor de Tipo */}
          <div className="production-type-tabs" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button
              onClick={() => setActiveType('delivery')}
              style={{ ...tabBtn, backgroundColor: activeType === 'delivery' ? '#3b82f6' : '#ffffff', color: activeType === 'delivery' ? '#ffffff' : 'var(--text-primary)', border: '1px solid var(--border-color)', position: 'relative' }}
            >
              <Truck size={16} /> Pronta Entrega
              {orders.filter(o => o.type === 'delivery' && o.status !== 'completed' && o.status !== 'cancelled').length > 0 && (
                <span style={badgeStyle}>
                  {orders.filter(o => o.type === 'delivery' && o.status !== 'completed' && o.status !== 'cancelled').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveType('order')}
              style={{ ...tabBtn, backgroundColor: activeType === 'order' ? '#f59e0b' : '#ffffff', color: activeType === 'order' ? '#ffffff' : 'var(--text-primary)', border: '1px solid var(--border-color)', position: 'relative' }}
            >
              <CalendarIcon size={16} /> Encomendas
              {orders.filter(o => (o.type === 'order' || !o.type) && o.status !== 'completed' && o.status !== 'cancelled').length > 0 && (
                <span style={badgeStyle}>
                  {orders.filter(o => (o.type === 'order' || !o.type) && o.status !== 'completed' && o.status !== 'cancelled').length}
                </span>
              )}
            </button>
          </div>

          <div className="production-controls" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {/* Navegação de Datas (Sempre Visível) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', backgroundColor: 'var(--bg-secondary)', padding: '10px 20px', borderRadius: '15px', border: '1px solid var(--border-color)', width: 'fit-content' }}>
              <button
                onClick={() => changeDate(-1)}
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '5px' }}
              >
                <ChevronLeft size={24} />
              </button>

              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px', minWidth: '150px', justifyContent: 'center' }}>
                <div
                  onClick={() => document.getElementById('date-picker').showPicker()}
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>{getDayName(selectedDate)}</div>
                </div>

                <input
                  id="date-picker"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', right: 0 }}
                />

                <CalendarIcon
                  size={18}
                  style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => document.getElementById('date-picker').showPicker()}
                />
              </div>

              <button
                onClick={() => changeDate(1)}
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '5px' }}
              >
                <ChevronRight size={24} />
              </button>

              {selectedDate !== new Date().toISOString().split('T')[0] && (
                <button
                  onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                  style={{ marginLeft: '10px', padding: '6px 12px', borderRadius: '8px', border: '1px solid #f59e0b', background: 'none', color: '#f59e0b', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
                >
                  VOLTAR P/ HOJE
                </button>
              )}
            </div>

            <div className="production-search-actions" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <button
                onClick={() => setShowWaitingDrawer(true)}
                style={{
                  padding: '10px 15px', borderRadius: '12px', backgroundColor: '#ffffff',
                  border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', position: 'relative'
                }}
              >
                <span>💳</span> Aguardando Pagamento
                {orders.filter(o => o.status === 'waiting_payment' && (o.type === activeType || (!o.type && activeType === 'order'))).length > 0 && (
                  <span style={{ position: 'absolute', top: '-5px', right: '-5px', backgroundColor: '#ef4444', color: '#ffffff', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {orders.filter(o => o.status === 'waiting_payment' && (o.type === activeType || (!o.type && activeType === 'order'))).length}
                  </span>
                )}
              </button>

              <div style={{ position: 'relative', width: '300px' }}>
                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  placeholder="Buscar pedido..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 12px 12px 40px', borderRadius: '12px',
                    backgroundColor: '#ffffff', border: '1px solid var(--border-color)', color: 'var(--text-primary)'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="production-board" style={{
        display: 'flex',
        gap: '20px',
        flex: 1,
        minHeight: 0,
        paddingBottom: '20px',
        width: '100%',
        maxWidth: '100%',
        height: 'calc(100vh - 200px)'
      }}>

        <KanbanColumn col={columns.find(c => c.id === 'pending')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} />

        {activeType === 'order' && (
          <KanbanColumn col={columns.find(c => c.id === 'accepted')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} />
        )}

        <KanbanColumn col={columns.find(c => c.id === 'production')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} />

        <div className="production-secondary-columns" style={{ flex: '1 1 30%', display: 'flex', flexDirection: 'column', gap: '15px', minWidth: '320px' }}>
          <KanbanColumn col={columns.find(c => c.id === 'ready')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} height="40%" />
          <KanbanColumn col={columns.find(c => c.id === 'completed')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} height="30%" />
          <KanbanColumn col={columns.find(c => c.id === 'cancelled')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} height="30%" />
        </div>
      </div>

      {showWaitingDrawer && (
        <div style={{
          position: 'fixed', top: 0, right: 0, width: '400px', height: '100vh',
          backgroundColor: '#ffffff', borderLeft: '1px solid var(--border-color)',
          zIndex: 2000, boxShadow: '-10px 0 30px rgba(15,23,42,0.08)',
          padding: '30px', display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>💳 Aguardando Pagamento</h3>
            <button onClick={() => setShowWaitingDrawer(false)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <XCircle size={24} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {orders.filter(o => o.status === 'waiting_payment' && (o.type === activeType || (!o.type && activeType === 'order'))).map(order => (
              <div
                key={order.id}
                onClick={() => openDetails(order)}
                onDragStart={(e) => e.dataTransfer.setData("orderId", order.id)}
                draggable
                style={{
                  backgroundColor: '#f8fafc', padding: '15px', borderRadius: '15px',
                  border: '1px solid var(--border-color)', marginBottom: '10px', cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '5px', color: 'var(--text-primary)' }}>#{order.id.slice(-4).toUpperCase()}</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{order.clientName}</div>
                <div style={{ fontSize: '12px', marginTop: '8px', color: '#9ca3af' }}>🕒 {order.scheduledTime}</div>
              </div>
            ))}
            {orders.filter(o => o.status === 'waiting_payment' && (o.type === activeType || (!o.type && activeType === 'order'))).length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '50px' }}>Nenhum pedido aguardando pagamento nesta categoria.</div>
            )}
          </div>
        </div>
      )}
      {showWaitingDrawer && <div onClick={() => setShowWaitingDrawer(false)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1999 }} />}

    </div>
  );
};

const KanbanColumn = ({ col, orders, updateStatus, openDetails, height = '100%' }) => {
  const colOrders = orders.filter(o => o.status === col.id);

  return (
    <div className="kanban-column" style={{
      flex: '1 1 30%', backgroundColor: 'rgba(255,255,255,0.015)',
      borderRadius: '20px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)',
      minWidth: '320px', height: height, overflow: 'hidden'
    }}>
      <div style={{
        padding: '15px 20px', borderBottom: '1px solid var(--border-color)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: col.color }}>{col.icon}</span>
          <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{col.title}</span>
        </div>
        <span style={{
          backgroundColor: 'rgba(255,255,255,0.05)', padding: '2px 10px',
          borderRadius: '10px', fontSize: '12px', fontWeight: 800, color: col.color
        }}>
          {colOrders.length}
        </span>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => updateStatus(e.dataTransfer.getData("orderId"), col.id)}
        style={{
          padding: '15px',
          overflowY: 'auto',
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: '12px',
          alignContent: 'start'
        }}>
        {colOrders.map(order => (
          <div
            key={order.id}
            className="kanban-card"
            onClick={() => openDetails(order)}
            style={{
              backgroundColor: 'var(--bg-secondary)',
              padding: '12px',
              borderRadius: '12px',
              border: hasAcceptedPendingPayment(order) ? '1px solid #f97316' : '1px solid var(--border-color)',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'transform 0.1s',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '100px',
              position: 'relative'
            }}
            onDragStart={(e) => e.dataTransfer.setData("orderId", order.id)}
            draggable
          >
            <div style={{
              fontSize: '18px',
              fontWeight: 900,
              color: 'var(--text-primary)',
              marginBottom: '4px'
            }}>
              #{order.id.slice(-4).toUpperCase()}
            </div>

            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              width: '100%',
              fontWeight: 600
            }}>
              {order.clientName?.split(' ')[0] || 'Cliente'}
            </div>

            <div style={{
              marginTop: '8px',
              fontSize: '10px',
              color: col.color,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Clock size={10} />
              {order.scheduledTime}
            </div>
            {hasAcceptedPendingPayment(order) && (
              <div style={{ marginTop: '7px', padding: '3px 6px', borderRadius: '5px', background: '#fff7ed', color: '#c2410c', fontSize: '9px', fontWeight: 900 }}>
                ⚠️ SEM PAGAMENTO
              </div>
            )}
          </div>
        ))}

      </div>
    </div>
  );
};

const tabBtn = { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderRadius: '10px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' };
const badgeStyle = {
  position: 'absolute',
  top: '-5px',
  right: '-5px',
  backgroundColor: '#ef4444',
  color: '#fff',
  borderRadius: '50%',
  width: '18px',
  height: '18px',
  fontSize: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 800,
  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
  border: '1.5px solid var(--bg-primary)'
};

export default Production;
