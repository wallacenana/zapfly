import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Package, Clock, CheckCircle, Search, Truck, XCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin, CreditCard } from 'lucide-react';
import { api } from '../api';
import { socket } from '../api';
import Swal from 'sweetalert2';

const Production = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeType, setActiveType] = useState(localStorage.getItem('kanban_activeType') || 'order');
  const [selectedDate, setSelectedDate] = useState(localStorage.getItem('kanban_selectedDate') || new Date().toISOString().split('T')[0]);
  const [showWaitingDrawer, setShowWaitingDrawer] = useState(false);
  const scrollRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftState, setScrollLeftState] = useState(0);

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

  const handleMouseDown = (e) => {
    if (e.target.closest('.kanban-card') || e.target.closest('.date-pill')) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeftState(scrollRef.current.scrollLeft);
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 2;
    scrollRef.current.scrollLeft = scrollLeftState - walk;
  };

  const handleMouseUp = () => setIsDragging(false);

  const columns = [
    { id: 'waiting_payment', title: 'Aguardando', color: '#9ca3af', icon: <CreditCard size={18} /> },
    { id: 'pending', title: 'Pendentes', color: '#f59e0b', icon: <Clock size={18} /> },
    { id: 'accepted', title: 'Aceitos', color: '#8b5cf6', icon: <CheckCircle size={18} /> },
    { id: 'production', title: 'Em Produção', color: '#3b82f6', icon: <Package size={18} /> },
    { id: 'ready', title: 'Saiu p/ Entrega / Pronto', color: '#10b981', icon: <Truck size={18} /> },
    { id: 'completed', title: 'Finalizados', color: '#6b7280', icon: <CheckCircle size={18} /> },
    { id: 'cancelled', title: 'Cancelados', color: '#ef4444', icon: <XCircle size={18} /> }
  ];

  // Referência para o objeto de áudio para podermos parar o loop
  const audioRef = useRef(null);

  const playDing = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/alarme.wav');
      audioRef.current.loop = true;
    }
    audioRef.current.play().catch(e => console.warn('Erro ao tocar alarme:', e));
  };

  const stopDing = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  useEffect(() => {
    fetchOrders();

    socket.on('new_order_pending', (data) => {
      console.log('[Socket] Novo pedido pago!', data);
      fetchOrders();
      Swal.fire({
        title: '💰 PAGAMENTO CONFIRMADO!',
        text: 'Um novo pedido acaba de entrar na aba de Pendentes.',
        icon: 'success',
        toast: true,
        position: 'top-end',
        timer: 5000,
        showConfirmButton: false
      });
    });

    socket.on('order_confirmed', () => fetchOrders());

    const interval = setInterval(fetchOrders, 30000);
    return () => {
      clearInterval(interval);
      socket.off('new_order_pending');
      socket.off('order_confirmed');
      stopDing();
    };
  }, [selectedDate, activeType]); // Dependências adicionadas para recarregar ao mudar de dia

  // Monitora a lista de pedidos: toca o alarme se houver pendentes, para se não houver.
  useEffect(() => {
    const hasPending = orders.some(o => o.status === 'pending');
    if (hasPending) {
      playDing();
    } else {
      stopDing();
    }
  }, [orders]);

  const fetchOrders = async () => {
    try {
      const res = await api.get(`/orders?date=${selectedDate}`);
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (orderId, newStatus) => {
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
    Swal.fire({
      title: 'Editar Pedido',
      background: '#111827',
      color: '#fff',
      html: `
        <div style="text-align: left; font-family: 'Inter', sans-serif;">
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">PRODUTO</label>
            <input id="edit-product" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.product || ''}">
          </div>
          
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">VARIAÇÃO / SABOR</label>
            <input id="edit-variation" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.variation || ''}">
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
              <input id="edit-massa" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.massa || ''}">
            </div>
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">RECHEIO</label>
              <input id="edit-recheio" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.recheio || ''}">
            </div>
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #9ca3af; font-weight: 800;">TOPO</label>
              <input id="edit-topo" style="width: 100%; padding: 10px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; color: #fff;" value="${order.topo || ''}">
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
    const statusLabel = order.status === 'pending' ? 'Pendente' : 'Em Produção';
    const quantity = parseFloat(order.quantity) || 1;
    // Pega o preço real do produto (ou da variação se tivéssemos salvo, mas vamos no preço base por enquanto)
    const priceFromDb = order.productRelation?.price || (order.totalValue / quantity);
    const unitPrice = priceFromDb;

    const freightValue = order.deliveryFee || 0;

    const itemsSubtotal = unitPrice * quantity;
    const finalTotal = order.totalValue || (itemsSubtotal + freightValue);

    const totalValueStr = finalTotal.toFixed(2);
    const subtotalStr = itemsSubtotal.toFixed(2);
    const freightStr = freightValue.toFixed(2);

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

    // Botão de ação baseado no status
    let actionBtnHtml = '';
    if (order.status === 'waiting_payment') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #fbbf24; color: #000; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">CONFIRMAR PAGAMENTO</button>`;
    } else if (order.status === 'pending') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #8b5cf6; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">${order.type === 'delivery' ? 'INICIAR PRODUÇÃO' : 'ACEITAR PEDIDO'}</button>`;
    } else if (order.status === 'accepted') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #3b82f6; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">INICIAR PRODUÇÃO</button>`;
    } else if (order.status === 'production') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #3b82f6; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">PEDIDO PRONTO</button>`;
    } else if (order.status === 'ready') {
      actionBtnHtml = `<button id="btn-action-next" style="flex: 1; background: #10b981; color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer;">FINALIZAR</button>`;
    }

    const handlePrint = (order) => {
      const saved = JSON.parse(localStorage.getItem('print_settings') || '{"showId":true,"prod":true,"massa":true,"notes":true,"value":true,"addr":true,"client":true}');
      
      Swal.fire({
        title: 'Opções de Impressão',
        background: '#111827',
        color: '#fff',
        html: `
          <div style="text-align: left; padding: 10px;">
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-id" ${saved.showId ? 'checked' : ''}> ID do Pedido (#XXXX)</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-prod" ${saved.prod ? 'checked' : ''}> Produto e Variação</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-massa" ${saved.massa ? 'checked' : ''}> Detalhes (Massa/Recheio/Topo)</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-notes" ${saved.notes ? 'checked' : ''}> Observações</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-value" ${saved.value ? 'checked' : ''}> Valor Total</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-addr" ${saved.addr ? 'checked' : ''}> Endereço de Entrega</label></div>
            <div style="margin-bottom: 10px;"><label><input type="checkbox" id="p-client" ${saved.client ? 'checked' : ''}> Nome do Cliente</label></div>
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
          };
          localStorage.setItem('print_settings', JSON.stringify(settings));
          return settings;
        }
      }).then((result) => {
        if (result.isConfirmed) {
          const opts = result.value;
          const idShort = order.id.slice(-4).toUpperCase();
          
          let content = `
            <div style="font-family: 'Inter', Arial, sans-serif; width: 100%; max-width: 280px; margin: 0 auto; color: #000; line-height: 1.4;">
              <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px;">
                ${opts.showId ? `<h1 style="margin: 0; font-size: 32px; font-weight: 900;">#${idShort}</h1>` : ''}
                <p style="margin: 5px 0; font-size: 16px; font-weight: 700;">${order.scheduledDate} - ${order.scheduledTime}</p>
              </div>
          `;

          if (opts.client) content += `<p style="font-size: 18px; margin: 8px 0;"><b>👤 CLIENTE:</b> ${order.clientName}</p>`;
          if (opts.prod) content += `<p style="font-size: 20px; margin: 10px 0; border-bottom: 1px solid #eee; padding-bottom: 5px;"><b>📦 ITEM:</b> ${order.product} <br/><span style="font-size: 16px;">(${order.variation || 'Padrão'})</span></p>`;
          
          if (opts.massa) {
            content += `
              <div style="margin: 10px 0; padding: 10px; border: 1px solid #000; border-radius: 5px; font-size: 16px;">
                <p style="margin: 4px 0;"><b>MASSA:</b> ${order.massa || '-'}</p>
                <p style="margin: 4px 0;"><b>RECHEIO:</b> ${order.recheio || '-'}</p>
                <p style="margin: 4px 0;"><b>TOPO:</b> ${order.topo || '-'}</p>
              </div>
            `;
          }

          if (opts.notes && order.notes) content += `<p style="font-size: 16px; margin: 10px 0; padding: 8px; background: #f3f4f6; border-radius: 5px;"><b>📝 OBS:</b> ${order.notes}</p>`;
          if (opts.addr && order.deliveryAddress) content += `<p style="font-size: 16px; margin: 10px 0;"><b>📍 ENTREGA:</b> ${order.deliveryAddress}</p>`;
          if (opts.value) content += `<div style="margin-top: 15px; border-top: 2px solid #000; padding-top: 10px;"><h2 style="margin: 0; text-align: right; font-size: 24px;">TOTAL: R$ ${order.totalValue?.toFixed(2)}</h2></div>`;

          content += `
              <div style="text-align: center; margin-top: 30px; font-size: 14px; border-top: 1px dashed #000; padding-top: 10px;">
                CUPOM DE PRODUÇÃO - ZAPFLY
              </div>
            </div>
          `;

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
      background: '#111827',
      color: '#fff',
      width: '550px',
      showCloseButton: true,
      showConfirmButton: false,
      didOpen: () => {
        const chatBtn = document.getElementById('btn-go-to-chat');
        if (chatBtn) chatBtn.onclick = () => { Swal.close(); navigate(`/chat/${encodeURIComponent(order.clientJid)}`); };

        const actionBtn = document.getElementById('btn-action-next');
        if (actionBtn) {
          actionBtn.onclick = () => {
            const nextStatusMap = {
              'waiting_payment': 'pending',
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
        <div style="text-align: left; font-family: 'Inter', sans-serif;">
          <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: #3b82f6; font-weight: 900; letter-spacing: 1px;">PEDIDO #${orderIdShort}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              ${order.type === 'delivery' ? `<button id="btn-maps-order" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; cursor: pointer;">📍 ROTA</button>` : ''}
              <button id="btn-print-order" style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); color: #a78bfa; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; cursor: pointer;">🖨️ IMPRIMIR</button>
              <button id="btn-edit-order" style="background: rgba(255,255,255,0.1); border: none; color: #fff; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; cursor: pointer;">✏️ EDITAR</button>
              <div style="background: ${order.status === 'waiting_payment' ? '#6b7280' : '#10b981'}; color: #fff; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 800; text-transform: uppercase;">${order.status}</div>
            </div>
          </div>

          <div style="background: rgba(255,255,255,0.03); border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 20px;">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="font-size: 10px; color: #9ca3af; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.1);">
                  <th style="text-align: left; padding-bottom: 12px; width: 60px;">Qtd</th>
                  <th style="text-align: left; padding-bottom: 12px;">Descrição do Pedido</th>
                  <th style="text-align: right; padding-bottom: 12px;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 20px 0; vertical-align: top;">
                    <div style="background: #3b82f6; color: #fff; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 20px; font-weight: 900;">
                      ${quantity}
                    </div>
                  </td>
                  <td style="padding: 20px 10px; vertical-align: top;">
                    <div style="font-weight: 800; font-size: 18px; color: #fff; line-height: 1.2;">${order.product}</div>
                    <div style="font-size: 13px; color: #3b82f6; margin-top: 4px; font-weight: 700;">${order.variation || 'Opção Padrão'}</div>
                    <div style="font-size: 12px; color: #9ca3af; margin-top: 5px;">Massa: ${order.massa || '-'} | Recheio: ${order.recheio || '-'} | Topo: ${order.topo || '-'}</div>
                    ${notesHtml}
                  </td>
                  <td style="font-size: 14px;">
                    R$ ${subtotalStr}
                  </td>
                </tr>
                ${freightValue > 0 ? `
                <tr style="border-top: 1px dashed rgba(255,255,255,0.05);">
                  <td style="padding: 10px 0;"></td>
                  <td style="padding: 10px 10px; font-size: 13px; color: #9ca3af; font-weight: 600;">Taxa de Entrega (Uber)</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: 700; font-size: 15px; color: #fbbf24;">R$ ${freightStr}</td>
                </tr>
                ` : ''}
              </tbody>
            </table>

            <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; font-size: 13px; color: #9ca3af;">TOTAL A RECEBER</span>
              <span style="font-weight: 900; font-size: 26px; color: #10b981;">R$ ${totalValueStr}</span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
            <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: #9ca3af; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">📅 Entrega/Retirada</div>
              <div style="font-size: 15px; font-weight: 800; color: #fff;">${order.scheduledTime} - ${formattedDate}</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: #9ca3af; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">💰 Pagamento</div>
              <div style="background: #fbbf24; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 900; display: inline-block; margin-top: 2px;">
                ${order.paymentMethod || 'A COMBINAR'}
              </div>
            </div>
          </div>

          <div style="padding: 15px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dotted rgba(255,255,255,0.1); margin-bottom: 20px;">
            <div style="font-size: 10px; color: #9ca3af; font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Dados do Cliente</div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 800; font-size: 15px; color: #fff;">${order.clientName}</div>
                <div style="font-size: 12px; color: #6b7280;">${order.clientJid?.split('@')[0]}</div>
              </div>
              <button id="btn-go-to-chat" style="background: #3b82f6; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                <span>💬</span> Ver Conversa
              </button>
            </div>
            ${addressHtml}
          </div>

          <div style="display: flex; gap: 10px;">
            ${actionBtnHtml}
          </div>
        </div>
      `
    });
  };

  const filteredOrders = orders.filter(o => {
    const matchSearch =
      (o.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.product || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.id || '').toLowerCase().includes(searchTerm.toLowerCase());

    // Se o pedido não tiver tipo (antigos), tratamos como 'order' por padrão para não sumir
    const orderType = o.type || 'order';
    const matchType = orderType === activeType;

    // Apenas pedidos "Pendente" furam o filtro de data (como uma Caixa de Entrada universal).
    // Todo o restante (aguardando, aceito, produção, pronto, histórico) obedece rigorosamente à data selecionada.
    const bypassDateFilter = o.status === 'pending';
    const matchDate = bypassDateFilter ? true : (o.scheduledDate === selectedDate);

    return matchType && matchSearch && matchDate;
  });

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#fff' }}>Carregando Produção...</div>;

  return (
    <div style={{
      padding: '25px',
      height: 'calc(100vh - 70px)',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      maxWidth: '100%',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Seletor de Tipo */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button
              onClick={() => setActiveType('delivery')}
              style={{ ...tabBtn, backgroundColor: activeType === 'delivery' ? '#3b82f6' : 'var(--bg-tertiary)', color: '#fff', position: 'relative' }}
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
              style={{ ...tabBtn, backgroundColor: activeType === 'order' ? '#f59e0b' : 'var(--bg-tertiary)', color: '#fff', position: 'relative' }}
            >
              <CalendarIcon size={16} /> Encomendas
              {orders.filter(o => (o.type === 'order' || !o.type) && o.status !== 'completed' && o.status !== 'cancelled').length > 0 && (
                <span style={badgeStyle}>
                  {orders.filter(o => (o.type === 'order' || !o.type) && o.status !== 'completed' && o.status !== 'cancelled').length}
                </span>
              )}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {/* Navegação de Datas (Sempre Visível) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', backgroundColor: 'var(--bg-secondary)', padding: '10px 20px', borderRadius: '15px', border: '1px solid var(--border-color)', width: 'fit-content' }}>
              <button
                onClick={() => changeDate(-1)}
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '5px' }}
              >
                <ChevronLeft size={24} />
              </button>

              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px', minWidth: '150px', justifyContent: 'center' }}>
                <div
                  onClick={() => document.getElementById('date-picker').showPicker()}
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>{getDayName(selectedDate)}</div>
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
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '5px' }}
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <button
                onClick={() => setShowWaitingDrawer(true)}
                style={{
                  padding: '10px 15px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-color)', color: '#9ca3af', fontSize: '12px', fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', position: 'relative'
                }}
              >
                <span>💳</span> Aguardando Pagamento
                {orders.filter(o => o.status === 'waiting_payment' && (o.type === activeType || (!o.type && activeType === 'order'))).length > 0 && (
                  <span style={{ position: 'absolute', top: '-5px', right: '-5px', backgroundColor: '#ef4444', color: '#fff', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                    backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{
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

        <KanbanColumn col={columns.find(c => c.id === 'accepted')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} />

        <KanbanColumn col={columns.find(c => c.id === 'production')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} />

        <div style={{ flex: '1 1 30%', display: 'flex', flexDirection: 'column', gap: '15px', minWidth: '320px' }}>
          <KanbanColumn col={columns.find(c => c.id === 'ready')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} height="40%" />
          <KanbanColumn col={columns.find(c => c.id === 'completed')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} height="30%" />
          <KanbanColumn col={columns.find(c => c.id === 'cancelled')} orders={filteredOrders} updateStatus={updateStatus} openDetails={openDetails} height="30%" />
        </div>
      </div>

      {showWaitingDrawer && (
        <div style={{
          position: 'fixed', top: 0, right: 0, width: '400px', height: '100vh',
          backgroundColor: 'var(--bg-primary)', borderLeft: '1px solid var(--border-color)',
          zIndex: 2000, boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
          padding: '30px', display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>💳 Aguardando Pagamento</h3>
            <button onClick={() => setShowWaitingDrawer(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
              <XCircle size={24} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {orders.filter(o => o.status === 'waiting_payment' && (o.type === activeType || (!o.type && activeType === 'order'))).map(order => (
              <div
                key={order.id}
                onClick={() => openDetails(order)}
                style={{
                  backgroundColor: 'var(--bg-secondary)', padding: '15px', borderRadius: '15px',
                  border: '1px solid var(--border-color)', marginBottom: '10px', cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '5px' }}>#{order.id.slice(-4).toUpperCase()}</div>
                <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{order.clientName}</div>
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
    <div style={{
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
          <span style={{ fontSize: '14px', fontWeight: 800, color: '#fff' }}>{col.title}</span>
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
              border: '1px solid var(--border-color)',
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
              color: '#fff',
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
          </div>
        ))}

      </div>
    </div>
  );
};

const tabBtn = { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderRadius: '10px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' };
const btnMini = { flex: 1, padding: '8px', borderRadius: '8px', fontSize: '12px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 800 };
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
