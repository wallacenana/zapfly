import React, { useEffect, useState } from 'react';
import { Calendar, RefreshCw, Truck } from 'lucide-react';
import { api } from '../api';
import { Button, Heading, Text } from '../components/ui';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const todayBrazil = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const formatDate = (date) => String(date || '').split('-').reverse().join('/');
const statusLabel = (status) => ({ pending: 'Pendente', production: 'Em producao', ready: 'Pronto', completed: 'Finalizado', waiting_payment: 'Aguardando pagamento' }[String(status || '').toLowerCase()] || status || 'Pendente');

function DeliveryMetric({ label, value, caption, tone }) {
  return <article className={`deliveries-metric deliveries-metric--${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{caption}</small>
  </article>;
}

export default function Deliveries() {
  const [date, setDate] = useState(todayBrazil);
  const [data, setData] = useState({ summary: {}, orders: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDeliveries = async ({ silent = false, nextDate = date } = {}) => {
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const response = await api.get('/dashboard/deliveries', { params: { date: nextDate } });
      setData(response.data || { summary: {}, orders: [] });
    } catch (err) {
      setError(err?.response?.data?.error || 'Nao foi possivel carregar as entregas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadDeliveries({ nextDate: date }); }, [date]);

  const summary = data.summary || {};
  const orders = Array.isArray(data.orders) ? data.orders : [];

  return <main className="deliveries-page">
    <header className="deliveries-header">
      <div>
        <div className="dashboard-eyebrow">Operacao de delivery</div>
        <Heading as="h1" level={1}>Entregas e repasses</Heading>
        <Text variant="description">Confira o que entrou para a loja e o total separado para os entregadores.</Text>
      </div>
      <div className="deliveries-actions">
        <label className="deliveries-date"><Calendar size={16} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <Button variant="secondary" size="sm" onClick={() => loadDeliveries({ silent: true })} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar</Button>
      </div>
    </header>

    {error ? <div className="dashboard-alert">{error}</div> : null}
    {loading ? <div className="deliveries-loading">Carregando entregas...</div> : <>
      <section className="deliveries-metrics">
        <DeliveryMetric label="Deliveries lancados" value={summary.deliveriesCount || 0} caption={`Dia ${formatDate(data.date || date)}`} tone="blue" />
        <DeliveryMetric label="Taxas para repasse" value={money.format(Number(summary.deliveryFeesValue) || 0)} caption="Soma de todas as taxas do dia" tone="orange" />
        <DeliveryMetric label="Recebido dos clientes" value={money.format(Number(summary.receivedValue) || 0)} caption="Somente pagamentos confirmados" tone="green" />
        <DeliveryMetric label="Receita da loja" value={money.format(Number(summary.storeRevenueValue) || 0)} caption={`Ja descontadas ${money.format(Number(summary.receivedDeliveryFeesValue) || 0)} em taxas pagas`} tone="blue" />
      </section>

      <section className="deliveries-panel">
        <div className="deliveries-panel-head"><div><h2>Conferencia por entrega</h2><p>A taxa e o valor da loja ficam separados em cada pedido.</p></div><span><Truck size={16} /> {orders.length} pedido(s)</span></div>
        {orders.length ? <div className="deliveries-table-wrap"><table className="deliveries-table"><thead><tr><th>Pedido</th><th>Cliente e endereco</th><th>Status</th><th>Pagamento</th><th>Pedido</th><th>Taxa</th><th>Loja</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>#{String(order.id || '').slice(-4).toUpperCase()}</strong><small>{order.scheduledTime || new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></td><td><strong>{order.clientName || 'Cliente'}</strong><small>{order.deliveryAddress || 'Endereco nao informado'}</small></td><td><span className="deliveries-status">{statusLabel(order.status)}</span></td><td><strong className={order.paymentReceived ? 'is-paid' : 'is-unpaid'}>{order.paymentReceived ? 'Confirmado' : 'Pendente'}</strong><small>{order.paymentMethod || 'A combinar'}</small></td><td>{money.format(Number(order.totalValue) || 0)}</td><td className="deliveries-fee">{money.format(Number(order.deliveryFee) || 0)}</td><td className="deliveries-store-value">{order.paymentReceived ? money.format(Number(order.storeRevenue) || 0) : '-'}</td></tr>)}</tbody></table></div> : <div className="deliveries-empty">Nenhuma entrega lancada nesta data.</div>}
      </section>
    </>}
  </main>;
}
