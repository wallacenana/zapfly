import React, { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, Clock, User, Cake, CheckCircle } from 'lucide-react';
import axios from 'axios';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

const Agenda = () => {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    axios.get('http://localhost:3001/orders')
      .then(res => setOrders(res.data))
      .catch(err => console.error(err));

    socket.on('new_order', (order) => {
      setOrders(prev => [order, ...prev]);
    });

    return () => socket.off('new_order');
  }, []);

  return (
    <div style={{ padding: '30px' }}>
      <div style={{ marginBottom: '30px' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Acompanhe as encomendas de bolos capturadas pela IA</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
        {orders.length === 0 ? (
          <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
            <CalendarIcon size={48} style={{ marginBottom: '15px', opacity: 0.5 }} />
            <p>Nenhuma encomenda agendada no momento.</p>
          </div>
        ) : (
          orders.map(order => (
            <div key={order.id} className="card" style={{ borderLeft: '4px solid var(--success)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', fontWeight: 600, fontSize: '14px' }}>
                  <CheckCircle size={16} /> Encomenda Confirmada
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ID: {order.id.toString().slice(-4)}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Cake size={18} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 600, fontSize: '16px' }}>{order.cakeType}</span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                  <User size={16} />
                  <span>Cliente: {order.clientName}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                  <CalendarIcon size={16} />
                  <span>Data/Hora: {order.deliveryDate}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                  <Clock size={16} />
                  <span>Quantidade: {order.quantity || '1 unidade'}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Agenda;
