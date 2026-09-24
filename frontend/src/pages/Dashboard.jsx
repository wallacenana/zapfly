import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Package,
  Pause,
  Play,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Tooltip, Legend } from 'chart.js';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button, Heading, Tabs, Text } from '../components/ui';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Tooltip, Legend);

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const toInputDate = date => new Date(date).toISOString().slice(0, 10);
const safeText = (value, fallback = 'Não informado') => String(value || '').trim() || fallback;

function MetricCard({ label, value, caption, icon: Icon, tone = 'blue' }) {
  return (
    <article className={`dashboard-metric dashboard-metric--${tone}`}>
      <div>
        <div className="dashboard-eyebrow">{label}</div>
        <div className="dashboard-metric-value">{value}</div>
        {caption ? <div className="dashboard-metric-caption">{caption}</div> : null}
      </div>
      <span className="dashboard-metric-icon"><Icon size={18} strokeWidth={2} /></span>
    </article>
  );
}

function PerformanceChart({ days }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    chartRef.current?.destroy();
    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'line',
      data: {
        labels: days.map(day => day.label || day.date || ''),
        datasets: [
          {
            label: 'Faturamento (R$)',
            data: days.map(day => safeNumber(day.total)),
            borderColor: '#0a9f68',
            backgroundColor: 'rgba(10, 159, 104, 0.10)',
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#fff',
            pointBorderWidth: 2,
          },
          {
            label: 'Qtd. pedidos',
            data: days.map(day => safeNumber(day.count)),
            borderColor: '#2563eb',
            backgroundColor: 'transparent',
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#fff',
            pointBorderWidth: 2,
            yAxisID: 'orders',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'center', labels: { usePointStyle: true, boxWidth: 8, color: '#60736b', font: { size: 12, weight: '600' } } },
          tooltip: { backgroundColor: '#10231d', padding: 12, cornerRadius: 10, displayColors: true },
        },
        scales: {
          x: { grid: { color: '#e3ebe5' }, ticks: { color: '#7b8d84', font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: '#e3ebe5' }, ticks: { color: '#7b8d84', font: { size: 11 }, callback: value => `R$ ${value}` } },
          orders: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: '#7b8d84', precision: 0, font: { size: 11 } } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [days]);

  if (!days.length) return <div className="dashboard-empty-chart">Ainda não há dados para este período.</div>;
  return <div className="dashboard-chart-canvas"><canvas ref={canvasRef} /></div>;
}

function Panel({ eyebrow, title, description, actions, children, className = '' }) {
  return (
    <section className={`dashboard-panel ${className}`.trim()}>
      <div className="dashboard-panel-head">
        <div>
          {eyebrow ? <div className="dashboard-eyebrow">{eyebrow}</div> : null}
          <Heading as="h2" level={2}>{title}</Heading>
          {description ? <Text variant="description">{description}</Text> : null}
        </div>
        {actions ? <div className="dashboard-panel-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function DashboardSkeleton() {
  return <div className="dashboard-loading"><div className="dashboard-skeleton dashboard-skeleton--wide" /><div className="dashboard-skeleton-grid">{[1, 2, 3, 4].map(item => <div className="dashboard-skeleton" key={item} />)}</div></div>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('7');
  const [customDates, setCustomDates] = useState({ start: toInputDate(Date.now() - 6 * 24 * 60 * 60 * 1000), end: toInputDate(Date.now()) });
  const [savingStoreStatus, setSavingStoreStatus] = useState(false);

  const loadSummary = async ({ silent = false, nextPeriod = period, dates = customDates } = {}) => {
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const params = nextPeriod === 'custom'
        ? { range: 'custom', start: dates.start, end: dates.end }
        : { range: nextPeriod };
      const { data } = await api.get('/dashboard/summary', { params });
      setSummary(data || {});
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível carregar o resumo do painel.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadSummary(); }, []);

  const handleStoreStatus = async () => {
    if (savingStoreStatus) return;
    const nextValue = !summary?.store?.acceptOrders;
    setSavingStoreStatus(true);
    setSummary(current => ({ ...current, store: { ...current?.store, acceptOrders: nextValue } }));
    try {
      await api.post('/settings', { acceptOrders: nextValue });
    } catch (err) {
      setSummary(current => ({ ...current, store: { ...current?.store, acceptOrders: !nextValue } }));
      setError(err?.response?.data?.error || 'NÃ£o foi possÃ­vel alterar o status da loja.');
    } finally {
      setSavingStoreStatus(false);
    }
  };

  const handlePeriodChange = nextPeriod => {
    setPeriod(nextPeriod);
    if (nextPeriod !== 'custom') loadSummary({ silent: true, nextPeriod });
  };

  const applyCustomPeriod = () => {
    if (customDates.start && customDates.end && customDates.start <= customDates.end) {
      loadSummary({ silent: true, nextPeriod: 'custom', dates: customDates });
    }
  };
  if (loading) return <DashboardSkeleton />;

  const store = summary?.store || {};
  const metrics = summary?.metrics || {};
  const charts = summary?.charts || {};
  const lists = summary?.lists || {};
  const finance = summary?.finance || {};
  const days = Array.isArray(charts.ordersByDay) ? charts.ordersByDay : [];
  const recentOrders = Array.isArray(lists.recentOrders) ? lists.recentOrders : [];
  const acceptedWithoutPayment = Array.isArray(finance.acceptedWithoutPayment) ? finance.acceptedWithoutPayment : [];
  const connected = safeNumber(metrics.connectedInstancesCount);
  const instances = safeNumber(metrics.instancesCount);
  const modeLabel = String(store.deliveryMode || '').toLowerCase() === 'delivery' ? 'Delivery ativo' : String(store.deliveryMode || '').toLowerCase() === 'pickup' ? 'Retirada na loja' : 'Entrega + retirada';
  const periodItems = [
    { value: '7', label: '7 dias' },
    { value: '15', label: '15 dias' },
    { value: '30', label: '1 mês' },
    { value: 'custom', label: 'Personalizado', icon: Calendar },
  ];

  return (
    <div className="dashboard-page-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-store">
          <span className={`dashboard-store-dot ${store.acceptOrders ? 'is-online' : ''}`} />
          <strong>{safeText(store.name, 'Menzzu')}</strong>
          <span className="dashboard-topbar-divider">·</span>
          <span>{safeText(store.address?.split(',').slice(-2).join(',').trim(), 'Sua loja')}</span>
        </div>
        <div className="dashboard-topbar-actions">
          <Button variant="status" size="sm" className={`dashboard-status-pill ${store.acceptOrders ? 'is-active' : 'is-paused'}`} onClick={handleStoreStatus} disabled={savingStoreStatus} title={store.acceptOrders ? 'Pausar pedidos' : 'Retomar pedidos'}>
            {store.acceptOrders ? <Pause size={15} /> : <Play size={15} />}
            {savingStoreStatus ? 'Salvando...' : store.acceptOrders ? 'Aberto para pedidos' : 'Pedidos pausados'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => loadSummary({ silent: true })} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar
          </Button>
        </div>
      </header>

      <main className="dashboard-page-content">
        {error ? <div className="dashboard-alert"><XCircle size={17} /> {error}</div> : null}
        <div className="dashboard-metrics-grid">
          <MetricCard label="Pedidos hoje" value={integer.format(safeNumber(metrics.ordersTodayCount))} caption={`${integer.format(safeNumber(metrics.pendingOrdersCount))} em preparo`} icon={ShoppingBag} tone="blue" />
          <MetricCard label="Faturamento hoje" value={money.format(safeNumber(metrics.todayOrdersValue))} caption="Total do dia" icon={TrendingUp} tone="green" />
          <MetricCard label="Ticket médio" value={money.format(safeNumber(metrics.averageTicketToday))} caption="Por pedido" icon={BarChart3} tone="violet" />
          <MetricCard label="Cancelados / período" value={integer.format(safeNumber(metrics.cancelledOrdersCount))} caption="Pedidos cancelados" icon={XCircle} tone="red" />
        </div>

        <Panel eyebrow="Financeiro" title="Recebimentos, entregas e cobranças" description="As taxas de entrega são separadas da receita da loja para facilitar o repasse ao entregador." actions={<Button variant="secondary" size="sm" onClick={() => navigate('/production')}>Ver produção <ExternalLink size={14} /></Button>}>
          <div className="dashboard-finance-summary">
            <div className="dashboard-finance-card dashboard-finance-card--received"><span>Recebido bruto</span><strong>{money.format(safeNumber(finance.receivedInPeriodValue))}</strong><small>Pagamentos confirmados no período</small></div>
            <div className="dashboard-finance-card dashboard-finance-card--delivery"><span>Taxas de entrega</span><strong>{money.format(safeNumber(finance.deliveryFeesInPeriodValue))}</strong><small>Valor destinado aos entregadores</small></div>
            <div className="dashboard-finance-card dashboard-finance-card--net"><span>Receita da loja</span><strong>{money.format(safeNumber(finance.storeRevenueInPeriodValue))}</strong><small>Recebido bruto menos taxas de entrega</small></div>
            <div className="dashboard-finance-card dashboard-finance-card--pending"><span>A receber</span><strong>{money.format(safeNumber(finance.acceptedWithoutPaymentValue))}</strong><small>{integer.format(safeNumber(finance.acceptedWithoutPaymentCount))} encomenda(s) aceita(s) sem pagamento</small></div>
          </div>
          <div className="dashboard-delivery-today"><div><span>Taxas de entrega de hoje</span><strong>{money.format(safeNumber(finance.deliveryFeesTodayValue))}</strong></div><small>{integer.format(safeNumber(finance.deliveryOrdersTodayCount))} delivery(s) lançado(s) hoje. Este é o valor para conferência e repasse.</small></div>
          <div className="dashboard-finance-list">
            <div className="dashboard-finance-list-head"><strong>Encomendas a cobrar</strong><span>{acceptedWithoutPayment.length ? 'Acesse a produção para registrar o pagamento ou abrir a conversa.' : 'Tudo regularizado'}</span></div>
            {acceptedWithoutPayment.length ? acceptedWithoutPayment.slice(0, 6).map(order => (
              <button type="button" className="dashboard-finance-row" key={order.id} onClick={() => navigate('/production')}>
                <span className="dashboard-finance-alert">!</span>
                <span className="dashboard-finance-main"><strong>{safeText(order.clientName, 'Cliente')}</strong><small>{safeText(order.product, 'Produto')}{order.variation ? ` · ${order.variation}` : ''} · {order.scheduledDate ? `${order.scheduledDate.split('-').reverse().join('/')} ${order.scheduledTime || ''}` : 'Data a combinar'}</small></span>
                <span className="dashboard-finance-value"><strong>{money.format(safeNumber(order.totalValue))}</strong><small>{safeText(order.paymentMethod, 'A combinar')}</small></span>
              </button>
            )) : <div className="dashboard-finance-empty">Nenhuma encomenda aceita está aguardando pagamento.</div>}
          </div>
        </Panel>

        <Panel eyebrow="Performance operacional" title="Volume de pedidos e faturamento" description="Acompanhe a movimentação da loja no período selecionado." actions={<div className="dashboard-period-controls"><Tabs items={periodItems} value={period} onChange={handlePeriodChange} />{period === 'custom' ? <div className="dashboard-custom-period"><input type="date" value={customDates.start} onChange={event => setCustomDates(current => ({ ...current, start: event.target.value }))} /><span>até</span><input type="date" value={customDates.end} onChange={event => setCustomDates(current => ({ ...current, end: event.target.value }))} /><Button variant="secondary" size="sm" onClick={applyCustomPeriod}>Aplicar</Button></div> : null}</div>}>
          <PerformanceChart days={days} />
        </Panel>

        <div className="dashboard-lower-grid">
          <Panel eyebrow="Atividade recente" title="Pedidos recentes" description="Acompanhamento das últimas transações." actions={<span className="dashboard-count-pill">{recentOrders.length} transações</span>}>
            <div className="dashboard-order-list">
              {recentOrders.length ? recentOrders.slice(0, 5).map(order => (
                <div className="dashboard-order-row" key={order.id}>
                  <span className="dashboard-order-icon"><Package size={16} /></span>
                  <div className="dashboard-order-main"><strong>{safeText(order.product, 'Produto')}</strong><span>{safeText(order.clientName, 'Cliente')} · {order.type === 'delivery' ? 'Delivery' : 'Encomenda'}</span><small>{order.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Data não informada'}</small></div>
                  <div className="dashboard-order-value"><strong>{money.format(safeNumber(order.totalValue))}</strong><span className="dashboard-order-status">{safeText(order.status)}</span></div>
                </div>
              )) : <div className="dashboard-empty">Nenhum pedido recente.</div>}
            </div>
          </Panel>

          <Panel eyebrow="Canais & inteligência" title="Visão da operação" description="Parâmetros ativos e agentes da loja.">
            <div className="dashboard-channel-card"><span className="dashboard-channel-icon"><Zap size={18} /></span><div><strong>WhatsApp (Lily)</strong><small>{connected > 0 ? 'Instância conectada' : 'Nenhuma instância conectada'}</small></div><span className={`dashboard-channel-dot ${connected > 0 ? 'is-connected' : ''}`} /></div>
            <div className="dashboard-mini-grid"><div><span>Tempo preparo</span><strong>{store.prepTime ? `${store.prepTime} min` : '—'}</strong></div><div><span>Produtos</span><strong>{integer.format(safeNumber(metrics.productsCount))}</strong></div><div><span>Avaliação</span><strong>{safeNumber(metrics.reviewsAverage).toFixed(1).replace('.', ',')}</strong></div><div><span>Conexões</span><strong>{connected}/{instances}</strong></div></div>
            <div className="dashboard-panel-footer"><span>{modeLabel}</span><button type="button" onClick={() => navigate('/settings')}>Gerenciar <ExternalLink size={14} /></button></div>
          </Panel>
        </div>
      </main>
    </div>
  );
}
