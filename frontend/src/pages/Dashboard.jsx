import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Package,
  RefreshCw,
  ShoppingBag,
  Store,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Tooltip, Legend } from 'chart.js';
import { useNavigate } from 'react-router-dom';
import { api, PUBLIC_SITE_URL } from '../api';
import { Button, Heading, Text } from '../components/ui';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Tooltip, Legend);

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
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

  const loadSummary = async ({ silent = false } = {}) => {
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/dashboard/summary');
      setSummary(data || {});
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível carregar o resumo do painel.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadSummary(); }, []);
  if (loading) return <DashboardSkeleton />;

  const store = summary?.store || {};
  const metrics = summary?.metrics || {};
  const charts = summary?.charts || {};
  const lists = summary?.lists || {};
  const days = Array.isArray(charts.ordersByDay) ? charts.ordersByDay : [];
  const recentOrders = Array.isArray(lists.recentOrders) ? lists.recentOrders : [];
  const connected = safeNumber(metrics.connectedInstancesCount);
  const instances = safeNumber(metrics.instancesCount);
  const openStoreUrl = store.slug ? `${PUBLIC_SITE_URL}/${store.slug}` : '';
  const modeLabel = String(store.deliveryMode || '').toLowerCase() === 'delivery' ? 'Delivery ativo' : String(store.deliveryMode || '').toLowerCase() === 'pickup' ? 'Retirada na loja' : 'Entrega + retirada';

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
          <span className={`dashboard-status-pill ${store.acceptOrders ? 'is-active' : 'is-paused'}`}>
            {store.acceptOrders ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {store.acceptOrders ? 'Aberto para pedidos' : 'Pedidos pausados'}
          </span>
          <Button variant="secondary" size="sm" onClick={() => loadSummary({ silent: true })} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar
          </Button>
          {openStoreUrl ? <Button as="a" variant="primary" size="sm" href={openStoreUrl} target="_blank" rel="noreferrer"><Store size={15} /> Cardápio</Button> : null}
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

        <Panel eyebrow="Performance operacional" title="Volume de pedidos e faturamento" description="Acompanhe a movimentação da loja nos últimos 7 dias." actions={<span className="dashboard-range-pill">Últimos 7 dias</span>}>
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
