import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Package, Clock, CheckCircle, Search, Truck, XCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin } from 'lucide-react';
import Swal from 'sweetalert2';

const Kanban = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeType, setActiveType] = useState(localStorage.getItem('kanban_activeType') || 'order');
  const [selectedDate, setSelectedDate] = useState(localStorage.getItem('kanban_selectedDate') || new Date().toISOString().split('T')[0]);
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
    { id: 'pending', title: 'Pendentes', color: '#f59e0b', icon: <Clock size={18} /> },
    { id: 'production', title: 'Em Produção', color: '#3b82f6', icon: <Package size={18} /> },
    { id: 'ready', title: 'Saiu p/ Entrega / Pronto', color: '#10b981', icon: <Truck size={18} /> },
    { id: 'completed', title: 'Finalizados', color: '#6b7280', icon: <CheckCircle size={18} /> },
    { id: 'cancelled', title: 'Cancelados', color: '#ef4444', icon: <XCircle size={18} /> }
  ];

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await axios.get('http://localhost:3001/orders');
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (orderId, newStatus) => {
    try {
      await axios.patch(`http://localhost:3001/orders/${orderId}`, { status: newStatus });
      const updatedOrders = orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o);
      setOrders(updatedOrders);
      if (newStatus === 'ready') {
        Swal.fire({ title: 'Pronto!', text: 'Status atualizado com sucesso.', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
      }
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível atualizar o status.', 'error');
    }
  };

  const openDetails = (order) => {
    console.log(order);
    const orderIdShort = (order.id || '').slice(-4).toUpperCase();
    const formattedDate = (order.scheduledDate || '').split('-').reverse().join('/');
    const statusLabel = order.status === 'pending' ? 'Pendente' : 'Em Produção';
    const quantity = parseFloat(order.quantity) || 1;
    // Pega o preço real do produto (ou da variação se tivéssemos salvo, mas vamos no preço base por enquanto)
    const priceFromDb = order.productRelation?.price || (order.totalValue / quantity);
    const unitPrice = priceFromDb;

    // Tenta extrair o frete das notas [Frete: R$ 4.00]
    const freightMatch = (order.notes || '').match(/\[Frete: R\$ ([\d.]+)\]/);
    const freightValue = freightMatch ? parseFloat(freightMatch[1]) : 0;

    const itemsSubtotal = unitPrice * quantity;
    const finalTotal = itemsSubtotal + freightValue;

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

    Swal.fire({
      background: '#111827',
      color: '#fff',
      width: '550px',
      showCloseButton: true,
      showConfirmButton: false,
      didOpen: () => {
        const chatBtn = document.getElementById('btn-go-to-chat');
        if (chatBtn) {
          chatBtn.onclick = () => {
            Swal.close();
            navigate(`/chat/${encodeURIComponent(order.clientJid)}`);
          };
        }
      },
      html: `
        <div style="text-align: left; font-family: 'Inter', sans-serif;">
          <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: #3b82f6; font-weight: 900; letter-spacing: 1px;">PEDIDO #${orderIdShort}</span>
            <div style="background: #10b981; color: #fff; padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 800; text-transform: uppercase;">${statusLabel}</div>
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
                    <div style="font-size: 13px; color: #6b7280; margin-top: 2px;">Preço unitário: R$ ${unitPrice.toFixed(2)}</div>
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

          <div style="padding: 15px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dotted rgba(255,255,255,0.1);">
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
        </div>
      `
    });
  };

  const filteredOrders = orders.filter(o => {
    const matchSearch = (o.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.product || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchType = o.type === activeType;
    const matchDate = o.scheduledDate === selectedDate;

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#fff', margin: 0 }}>Produção & Kanban</h2>
          </div>

          {/* Seletor de Tipo */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button
              onClick={() => setActiveType('delivery')}
              style={{ ...tabBtn, backgroundColor: activeType === 'delivery' ? '#3b82f6' : 'var(--bg-tertiary)', color: '#fff' }}
            >
              <Truck size={16} /> Pronta Entrega
            </button>
            <button
              onClick={() => setActiveType('order')}
              style={{ ...tabBtn, backgroundColor: activeType === 'order' ? '#f59e0b' : 'var(--bg-tertiary)', color: '#fff' }}
            >
              <CalendarIcon size={16} /> Encomendas
            </button>
          </div>

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
                  <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Produção de:</div>
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
        </div>

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

      <div
        ref={scrollRef}
        className="kanban-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          display: 'flex', gap: '20px', flex: 1, overflowX: 'auto', overflowY: 'hidden',
          paddingBottom: '20px', scrollBehavior: isDragging ? 'auto' : 'smooth',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: isDragging ? 'none' : 'auto',
          paddingRight: '40px',
          width: '100%',
          maxWidth: '100%'
        }}
      >
        {columns.map(col => (
          <div key={col.id} style={{
            width: '320px', minWidth: '320px', backgroundColor: 'rgba(255,255,255,0.015)',
            borderRadius: '20px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)',
            flexShrink: 0
          }}>
            <div style={{
              padding: '18px 20px', borderBottom: '3px solid ' + col.color,
              display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(0,0,0,0.3)',
              borderTopLeftRadius: '20px', borderTopRightRadius: '20px'
            }}>
              <span style={{ color: col.color }}>{col.icon}</span>
              <h4 style={{ color: '#fff', fontWeight: 800, margin: 0, fontSize: '15px' }}>{col.title}</h4>
              <span style={{
                marginLeft: 'auto', backgroundColor: 'var(--bg-tertiary)', padding: '4px 12px',
                borderRadius: '20px', fontSize: '12px', color: '#fff', fontWeight: 700
              }}>
                {filteredOrders.filter(o => o.status === col.id).length}
              </span>
            </div>

            <div style={{
              padding: '15px',
              paddingBottom: '40px', // Extra padding to not 'eat' cards
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '15px'
            }}>
              {filteredOrders.filter(o => o.status === col.id).map(order => (
                <div
                  key={order.id}
                  className="kanban-card"
                  onClick={() => openDetails(order)}
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    padding: '18px',
                    borderRadius: '16px',
                    border: '1px solid var(--border-color)',
                    boxShadow: '0 8px 15px rgba(0,0,0,0.2)',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                  onDragStart={(e) => e.dataTransfer.setData("orderId", order.id)}
                  draggable
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 900 }}>#{order.id.slice(-4).toUpperCase()}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10b981', fontSize: '12px', fontWeight: 800 }}>
                      <Clock size={12} />
                      {order.scheduledTime}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{
                      backgroundColor: '#3b82f6',
                      color: '#fff',
                      minWidth: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: 900
                    }}>
                      {order.quantity || '1'}
                    </div>
                    <h5 style={{ color: '#fff', margin: 0, fontSize: '15px', fontWeight: 800, flex: 1 }}>{order.product}</h5>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', mt: '10px', alignItems: 'center' }}>
                    <div style={{ fontSize: '10px', backgroundColor: '#fbbf24', color: '#000', padding: '2px 8px', borderRadius: '4px', fontWeight: 900, textTransform: 'uppercase' }}>
                      {order.paymentMethod || 'PGTO?'}
                    </div>
                    {order.notes && (
                      <div style={{ fontSize: '10px', color: '#f59e0b', fontWeight: 700, display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <Package size={10} /> Notas...
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                    {col.id !== 'pending' && <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, columns[columns.findIndex(c => c.id === col.id) - 1].id) }} style={btnMini}>Voltar</button>}
                    {col.id !== 'completed' && <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, columns[columns.findIndex(c => c.id === col.id) + 1].id) }} style={{ ...btnMini, backgroundColor: col.color, color: '#000' }}>
                      {col.id === 'production' ? 'Pronto' : 'Aceitar'}
                    </button>}
                  </div>
                </div>
              ))}

              <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => updateStatus(e.dataTransfer.getData("orderId"), col.id)} style={{ flex: 1, minHeight: '100px' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const tabBtn = { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderRadius: '10px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' };
const btnMini = { flex: 1, padding: '8px', borderRadius: '8px', fontSize: '12px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 800 };

export default Kanban;
