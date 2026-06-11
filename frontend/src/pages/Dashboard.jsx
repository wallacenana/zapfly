import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Package,
  RefreshCcw,
  Star,
  Store,
  Truck,
  Wifi,
  Boxes,
  Layers3,
  Gauge,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { api } from '../api';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR');

const formatCurrency = (value) => money.format(Number(value || 0));

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const labelFromStatus = (status = '') => {
  const value = String(status || '').toLowerCase();
  const map = {
    pending: 'Pendente',
    waiting_payment: 'Aguardando pagamento',
    confirmed: 'Confirmado',
    paid: 'Pago',
    accepted: 'Aceito',
    production: 'Em produção',
    ready: 'Pronto',
    completed: 'Finalizado',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
  };
  return map[value] || status || '-';
};

const statusTone = (status = '') => {
  const value = String(status || '').toLowerCase();
  if (['completed'].includes(value)) return { bg: 'rgba(16,185,129,0.14)', fg: '#34d399', border: 'rgba(16,185,129,0.22)' };
  if (['accepted', 'production'].includes(value)) return { bg: 'rgba(59,130,246,0.14)', fg: '#60a5fa', border: 'rgba(59,130,246,0.22)' };
  if (['ready'].includes(value)) return { bg: 'rgba(34,197,94,0.14)', fg: '#4ade80', border: 'rgba(34,197,94,0.22)' };
  if (['cancelled', 'canceled'].includes(value)) return { bg: 'rgba(239,68,68,0.14)', fg: '#f87171', border: 'rgba(239,68,68,0.22)' };
  return { bg: 'rgba(245,158,11,0.14)', fg: '#fbbf24', border: 'rgba(245,158,11,0.22)' };
};

const paymentLabel = (status = '') => {
  const value = String(status || '').toLowerCase();
  const map = {
    pending: 'Pendente',
    confirmed: 'Confirmado',
    paid: 'Pago',
    refunded: 'Reembolsado',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
  };
  return map[value] || status || '-';
};

const glass = {
  background: 'linear-gradient(180deg, rgba(24,24,27,0.98), rgba(17,17,19,0.96))',
  border: '1px solid rgba(63,63,70,0.9)',
  boxShadow: '0 12px 30px rgba(0,0,0,0.16)',
};

function Panel({ title, subtitle, icon: Icon, accent = '#60a5fa', children, action }) {
  return (
    <section style={{ ...glass, borderRadius: 18, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>{title}</h2>
          {subtitle ? <p style={{ color: '#a1a1aa', fontSize: 13, lineHeight: 1.4 }}>{subtitle}</p> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {action}
          {Icon ? <Icon size={18} color={accent} /> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Metric({ title, value, hint, icon: Icon, accent }) {
  return (
    <div
      style={{
        ...glass,
        borderRadius: 18,
        padding: 18,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        minHeight: 116,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#a1a1aa', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1.05 }}>{value}</div>
        <div style={{ color: '#71717a', fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>{hint}</div>
      </div>
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          background: accent.bg,
          border: `1px solid ${accent.border}`,
          color: accent.fg,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={20} />
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{ color: '#a1a1aa', fontSize: 14, padding: '18px 0' }}>
      {text}
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: payload } = await api.get('/dashboard/summary');
      setData(payload || null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err?.response?.data?.error || 'Falha ao carregar o dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const metrics = data?.metrics || {};
  const store = data?.store || {};
  const charts = data?.charts || {};
  const lists = data?.lists || {};

  const ordersByDay = charts.ordersByDay || [];
  const statusBreakdown = charts.statusBreakdown || [];
  const paymentBreakdown = charts.paymentBreakdown || [];
  const orderTypeBreakdown = charts.orderTypeBreakdown || {};

  const recentOrders = lists.recentOrders || [];
  const topProducts = lists.topProducts || [];
  const lowStockItems = lists.lowStockItems || [];
  const recentReviews = lists.recentReviews || [];
  const upcomingOrders = lists.upcomingOrders || [];
  const recentSlots = lists.recentSlots || [];
  const categoryProductStats = lists.categoryProductStats || [];
  const configIssues = lists.configIssues || [];
  const slotsByDay = lists.slotsByDay || [];

  const storeState = store.active ? 'Ativo' : 'Inativo';
  const acceptState = store.acceptOrders ? 'Recebendo pedidos' : 'Fechado para pedidos';
  const themeState = String(store.menuTheme || 'dark').toLowerCase() === 'light' ? 'Tema claro' : 'Tema escuro';

  const totalPayments = useMemo(
    () => paymentBreakdown.reduce((sum, item) => sum + Number(item.count || 0), 0),
    [paymentBreakdown]
  );

  const kpis = [
    {
      title: 'Pedidos hoje',
      value: number.format(metrics.ordersTodayCount || 0),
      hint: `${number.format(metrics.pendingOrdersCount || 0)} ainda em aberto`,
      icon: CalendarDays,
      accent: { bg: 'rgba(59,130,246,0.14)', fg: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
    },
    {
      title: 'Faturamento hoje',
      value: formatCurrency(metrics.completedOrdersTodayValue || 0),
      hint: 'Somente pedidos finalizados',
      icon: CircleDollarSign,
      accent: { bg: 'rgba(16,185,129,0.14)', fg: '#34d399', border: 'rgba(16,185,129,0.2)' },
    },
    {
      title: 'Ticket médio',
      value: formatCurrency(metrics.averageTicketToday || 0),
      hint: 'Baseado nos pedidos do dia',
      icon: Gauge,
      accent: { bg: 'rgba(168,85,247,0.14)', fg: '#c084fc', border: 'rgba(168,85,247,0.2)' },
    },
    {
      title: 'Pedidos em aberto',
      value: number.format((metrics.pendingOrdersCount || 0) + (metrics.acceptedOrdersCount || 0) + (metrics.productionOrdersCount || 0) + (metrics.readyOrdersCount || 0)),
      hint: 'Fila operacional agora',
      icon: Clock3,
      accent: { bg: 'rgba(245,158,11,0.14)', fg: '#fbbf24', border: 'rgba(245,158,11,0.2)' },
    },
    {
      title: 'Produtos',
      value: number.format(metrics.productsCount || 0),
      hint: `${number.format(metrics.featuredProductsCount || 0)} em destaque`,
      icon: Package,
      accent: { bg: 'rgba(14,165,233,0.14)', fg: '#38bdf8', border: 'rgba(14,165,233,0.2)' },
    },
    {
      title: 'Categorias',
      value: number.format(metrics.categoriesCount || 0),
      hint: `${number.format(metrics.promotionProductsCount || 0)} com promoção`,
      icon: Layers3,
      accent: { bg: 'rgba(236,72,153,0.14)', fg: '#f472b6', border: 'rgba(236,72,153,0.2)' },
    },
    {
      title: 'Estoque baixo',
      value: number.format(metrics.lowStockCount || 0),
      hint: `${number.format(metrics.stockItemsCount || 0)} itens cadastrados`,
      icon: Boxes,
      accent: { bg: 'rgba(239,68,68,0.14)', fg: '#f87171', border: 'rgba(239,68,68,0.2)' },
    },
    {
      title: 'Conexões online',
      value: number.format(metrics.connectedInstancesCount || 0),
      hint: `${number.format(metrics.instancesCount || 0)} instâncias no total`,
      icon: Wifi,
      accent: { bg: 'rgba(34,197,94,0.14)', fg: '#4ade80', border: 'rgba(34,197,94,0.2)' },
    },
    {
      title: 'Horários ativos',
      value: number.format(metrics.slotsCount || 0),
      hint: 'Grade de atendimento configurada',
      icon: CalendarDays,
      accent: { bg: 'rgba(14,165,233,0.14)', fg: '#38bdf8', border: 'rgba(14,165,233,0.2)' },
    },
    {
      title: 'Variações',
      value: number.format(metrics.variationProductsCount || 0),
      hint: 'Itens com opções ou tamanhos',
      icon: Layers3,
      accent: { bg: 'rgba(168,85,247,0.14)', fg: '#c084fc', border: 'rgba(168,85,247,0.2)' },
    },
    {
      title: 'Delivery',
      value: number.format(orderTypeBreakdown.delivery || 0),
      hint: `${number.format(orderTypeBreakdown.order || 0)} de encomendas`,
      icon: Truck,
      accent: { bg: 'rgba(59,130,246,0.14)', fg: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
    },
    {
      title: 'Pagamentos confirmados',
      value: number.format(metrics.paymentConfirmedCount || 0),
      hint: `${number.format(totalPayments || 0)} rastreados`,
      icon: CircleDollarSign,
      accent: { bg: 'rgba(16,185,129,0.14)', fg: '#34d399', border: 'rgba(16,185,129,0.2)' },
    },
  ];

  const highestOrders = ordersByDay.length
    ? Math.max(...ordersByDay.map((item) => Number(item.count || 0)), 1)
    : 1;

  return (
    <div style={{ minHeight: '100%', background: '#09090b', color: '#fff', padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ minWidth: 280, flex: 1 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontSize: 12, fontWeight: 800, marginBottom: 12 }}>
            <Zap size={14} />
            Painel real da operação
          </div>
          <h1 style={{ fontSize: 34, lineHeight: 1.1, letterSpacing: '-0.05em', marginBottom: 8 }}>Dashboard</h1>
          <p style={{ color: '#a1a1aa', maxWidth: 860, lineHeight: 1.55 }}>
            Resumo operacional com base no que já existe no sistema: pedidos, catálogo, estoque, avaliações, horários, conexões e configuração da loja.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 10, justifyItems: 'end' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{ padding: '8px 12px', borderRadius: 999, background: store.active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: store.active ? '#34d399' : '#f87171', border: `1px solid ${store.active ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, fontSize: 12, fontWeight: 700 }}>
              {storeState}
            </span>
            <span style={{ padding: '8px 12px', borderRadius: 999, background: store.acceptOrders ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)', color: store.acceptOrders ? '#60a5fa' : '#fbbf24', border: `1px solid ${store.acceptOrders ? 'rgba(59,130,246,0.2)' : 'rgba(245,158,11,0.2)'}`, fontSize: 12, fontWeight: 700 }}>
              {acceptState}
            </span>
            <span style={{ padding: '8px 12px', borderRadius: 999, background: 'rgba(168,85,247,0.12)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.2)', fontSize: 12, fontWeight: 700 }}>
              {themeState}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', color: '#a1a1aa', fontSize: 13, lineHeight: 1.5 }}>
            <span>{store.category || store.businessCategory || 'Sem categoria'}</span>
            <span>•</span>
            <span>{store.prepTime ? `Preparo ${store.prepTime} min` : 'Tempo de preparo não informado'}</span>
            <span>•</span>
            <span>{store.deliveryMode || 'operando'}</span>
            <span>•</span>
            <span>{store.slug ? `/${store.slug}` : 'Slug não definido'}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', color: '#71717a', fontSize: 12 }}>
            <span>Atualizado {updatedAt ? formatDateTime(updatedAt) : '-'}</span>
            <span>•</span>
            <button type="button" onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid rgba(63,63,70,0.9)', background: 'rgba(24,24,27,0.9)', color: '#fff', borderRadius: 999, padding: '8px 12px', cursor: 'pointer' }}>
              <RefreshCcw size={14} />
              Atualizar
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div style={{ marginBottom: 20, padding: '14px 16px', borderRadius: 14, background: 'rgba(239,68,68,0.12)', color: '#fecaca', border: '1px solid rgba(239,68,68,0.22)' }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, marginBottom: 22 }}>
        {kpis.map((item) => (
          <Metric key={item.title} {...item} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)', gap: 18, marginBottom: 18 }}>
        <Panel title="Movimento dos últimos 7 dias" subtitle="Pedidos criados no período e valor acumulado por dia." icon={Activity}>
          {loading ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} style={{ height: 18, borderRadius: 999, background: 'rgba(63,63,70,0.55)' }} />
              ))}
            </div>
          ) : ordersByDay.length ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {ordersByDay.map((day) => {
                const width = `${Math.max(8, Math.round(((Number(day.count || 0)) / highestOrders) * 100))}%`;
                return (
                  <div key={day.date} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 110px', gap: 12, alignItems: 'center' }}>
                    <div style={{ color: '#d4d4d8', fontWeight: 700, fontSize: 13 }}>{day.label}</div>
                    <div style={{ height: 10, borderRadius: 999, background: 'rgba(63,63,70,0.45)', overflow: 'hidden' }}>
                      <div style={{ width, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #3b82f6, #22c55e)' }} />
                    </div>
                    <div style={{ textAlign: 'right', color: '#a1a1aa', fontSize: 13, lineHeight: 1.35 }}>
                      {number.format(day.count)} pedido{Number(day.count) === 1 ? '' : 's'}
                      <br />
                      <span style={{ color: '#34d399', fontWeight: 700 }}>{formatCurrency(day.total)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty text="Sem pedidos no período." />
          )}
        </Panel>

        <Panel title="Saúde da loja" subtitle="Status operacional e configurações já salvas." icon={Store}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 14, background: 'rgba(39,39,42,0.7)', border: '1px solid rgba(63,63,70,0.8)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Store size={18} color="#60a5fa" />
                <div>
                  <div style={{ fontWeight: 700 }}>{store.name || store.businessName || 'Loja'}</div>
                  <div style={{ color: '#a1a1aa', fontSize: 12 }}>{store.slug ? `/${store.slug}` : 'Slug não definido'}</div>
                </div>
              </div>
              <div style={{ color: store.active ? '#34d399' : '#f87171', fontWeight: 700 }}>{storeState}</div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <Row label="Pedidos aceitos" value={store.acceptOrders ? 'Sim' : 'Não'} />
              <Row label="Tempo de preparo" value={store.prepTime ? `${store.prepTime} min` : 'Não informado'} />
              <Row label="Entrega grátis" value={store.freeDeliveryEnabled ? `Até ${store.freeDeliveryKm || 0} km` : 'Desativado'} />
              <Row label="Distância máxima" value={store.maxDeliveryKm ? `${store.maxDeliveryKm} km` : '-'} />
              <Row label="Avaliação" value={metrics.reviewsCount > 0 ? `${Number(metrics.reviewsAverage || 0).toFixed(1)} (${number.format(metrics.reviewsCount)})` : 'Sem avaliações'} star />
              <Row label="Mensagens hoje" value={number.format(metrics.messagesTodayCount || 0)} />
              <Row label="Fluxos ativos" value={number.format(metrics.activeFlowsCount || 0)} />
            </div>
          </div>
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(320px, 1fr)', gap: 18, marginBottom: 18 }}>
        <Panel title="Pedidos recentes" subtitle="O que entrou agora no sistema." icon={RefreshCcw}>
          <div style={{ display: 'grid', gap: 10 }}>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={index} style={{ height: 72, borderRadius: 16, background: 'rgba(63,63,70,0.5)' }} />
              ))
            ) : recentOrders.length ? (
              recentOrders.map((order) => {
                const tone = statusTone(order.status);
                return (
                  <div key={order.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '14px 16px', borderRadius: 16, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <strong style={{ fontSize: 15 }}>{order.product}</strong>
                        <span style={{ padding: '4px 8px', borderRadius: 999, background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 700 }}>
                          {labelFromStatus(order.status)}
                        </span>
                      </div>
                      <div style={{ color: '#a1a1aa', fontSize: 13, lineHeight: 1.4 }}>
                        {order.clientName}
                        {order.variation ? ` • ${order.variation}` : ''}
                        {order.scheduledDate ? ` • ${order.scheduledDate}` : ''}
                        {order.scheduledTime ? ` às ${order.scheduledTime}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 800 }}>{formatCurrency(order.totalValue)}</div>
                      <div style={{ color: '#a1a1aa', fontSize: 12, marginTop: 4 }}>{formatDateTime(order.createdAt)}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty text="Nenhum pedido encontrado." />
            )}
          </div>
        </Panel>

        <div style={{ display: 'grid', gap: 18 }}>
          <Panel title="Produtos em destaque" subtitle="Itens que mais aparecem e vendem." icon={Package}>
            <div style={{ display: 'grid', gap: 10 }}>
              {topProducts.length ? topProducts.map((product) => (
                <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <strong>{product.name}</strong>
                      {product.featured ? <Badge text="Destaque" tone="blue" /> : null}
                      {product.promotion ? <Badge text="Promoção" tone="green" /> : null}
                    </div>
                    <div style={{ color: '#a1a1aa', fontSize: 13 }}>
                      {number.format(product.count)} pedido{Number(product.count) === 1 ? '' : 's'} · {formatCurrency(product.totalValue)}
                    </div>
                  </div>
                  <div style={{ color: '#34d399', fontWeight: 800, flexShrink: 0 }}>#{number.format(product.count)}</div>
                </div>
              )) : (
                <Empty text="Sem produtos vendidos ainda." />
              )}
            </div>
          </Panel>

          <Panel title="Estoque baixo" subtitle="Itens que merecem reposição." icon={AlertTriangle} accent="#fbbf24">
            <div style={{ display: 'grid', gap: 10 }}>
              {lowStockItems.length ? lowStockItems.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 16, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{item.name}</div>
                    <div style={{ color: '#a1a1aa', fontSize: 12 }}>Mínimo: {item.minQuantity} {item.unit}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, color: '#f87171' }}>{item.quantity} {item.unit}</div>
                    <div style={{ color: '#a1a1aa', fontSize: 12 }}>em estoque</div>
                  </div>
                </div>
              )) : (
                <div style={{ color: '#4ade80', fontSize: 14 }}>Estoque sem alertas no momento.</div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginBottom: 18 }}>
        <Panel title="Próximos agendamentos" subtitle="Pedidos já marcados no calendário da operação." icon={CalendarDays}>
          <div style={{ display: 'grid', gap: 10 }}>
            {upcomingOrders.length ? upcomingOrders.map((order) => {
              const tone = statusTone(order.status);
              return (
                <div key={order.id} style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, marginBottom: 4 }}>{order.product}</div>
                      <div style={{ color: '#a1a1aa', fontSize: 12, lineHeight: 1.4 }}>
                        {order.clientName}
                        {order.variation ? ` • ${order.variation}` : ''}
                      </div>
                    </div>
                    <span style={{ padding: '4px 8px', borderRadius: 999, background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 700 }}>
                      {labelFromStatus(order.status)}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, color: '#d4d4d8', fontSize: 13 }}>
                    {order.scheduledDate || '-'} {order.scheduledTime ? `às ${order.scheduledTime}` : ''}
                  </div>
                  <div style={{ color: '#a1a1aa', fontSize: 12, marginTop: 4 }}>
                    {order.type === 'delivery' ? 'Entrega' : 'Encomenda'}
                    {order.deliveryAddress ? ` • ${order.deliveryAddress}` : ''}
                  </div>
                </div>
              );
            }) : (
              <Empty text="Nenhum agendamento futuro encontrado." />
            )}
          </div>
        </Panel>

        <Panel title="Avaliações recentes" subtitle="Feedback real dos pedidos já concluídos." icon={Star} accent="#f59e0b">
          <div style={{ display: 'grid', gap: 10 }}>
            {recentReviews.length ? recentReviews.map((review) => (
              <div key={review.id} style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                  <strong>{review.clientName}</strong>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#fbbf24', fontWeight: 800 }}>
                    <Star size={14} fill="#fbbf24" color="#fbbf24" />
                    {Number(review.rating || 0).toFixed(1)}
                  </span>
                </div>
                <div style={{ color: '#a1a1aa', fontSize: 12, lineHeight: 1.4, marginBottom: 6 }}>
                  {review.product}{review.variation ? ` • ${review.variation}` : ''}
                </div>
                <div style={{ color: '#d4d4d8', fontSize: 13, lineHeight: 1.5 }}>
                  {review.comment || 'Sem comentário.'}
                </div>
                <div style={{ color: '#71717a', fontSize: 12, marginTop: 6 }}>{formatDateTime(review.createdAt)}</div>
              </div>
            )) : (
              <Empty text="Nenhuma avaliação registrada." />
            )}
          </div>
        </Panel>

        <Panel title="Catálogo em números" subtitle="Categorias, promoções e destaque do estoque." icon={Package} accent="#38bdf8">
          <div style={{ display: 'grid', gap: 10 }}>
            {categoryProductStats.length ? categoryProductStats.slice(0, 6).map((category) => (
              <div key={category.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 14, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{category.name}</div>
                  <div style={{ color: '#a1a1aa', fontSize: 12 }}>Ordem {category.order}</div>
                </div>
                <strong>{number.format(category.total)} item{Number(category.total) === 1 ? '' : 's'}</strong>
              </div>
            )) : (
              <Empty text="Nenhuma categoria cadastrada." />
            )}
          </div>
          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            <Row label="Com variações" value={number.format(metrics.variationProductsCount || 0)} />
            <Row label="Tempo médio de preparo" value={metrics.averagePrepTime ? `${metrics.averagePrepTime} min` : 'Não informado'} />
            <Row label="Produtos de entrega" value={number.format(metrics.deliveryCapableProducts || 0)} />
          </div>
        </Panel>

        <Panel title="Operação e agenda" subtitle="Alertas e horários que o sistema já conhece." icon={ShieldAlert} accent="#fbbf24">
          <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
            {configIssues.length ? configIssues.map((issue, index) => (
              <div key={`${issue}-${index}`} style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24', fontSize: 13 }}>
                {issue}
              </div>
            )) : (
              <div style={{ color: '#4ade80', fontSize: 14 }}>Nenhum alerta de configuração no momento.</div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <Row label="Horários cadastrados" value={number.format(metrics.slotsCount || 0)} />
            <Row label="Pagamentos pendentes" value={number.format(metrics.paymentPendingCount || 0)} />
            <Row label="Pagamento confirmado" value={number.format(metrics.paymentConfirmedCount || 0)} />
          </div>
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Grade de atendimento</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {recentSlots.length ? recentSlots.map((slot) => (
                <div key={slot.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                  <span style={{ color: '#d4d4d8' }}>Dia {slot.dayOfWeek}</span>
                  <span style={{ color: '#a1a1aa' }}>{slot.startTime} - {slot.endTime}</span>
                  <strong>{number.format(slot.maxOrders)} pedidos</strong>
                </div>
              )) : (
                <Empty text="Sem horários cadastrados." />
              )}
            </div>
            {slotsByDay.length ? (
              <div style={{ marginTop: 12, color: '#71717a', fontSize: 12 }}>
                Dias com horários: {slotsByDay.map((item) => `Dia ${item.dayOfWeek} (${item.count})`).join(' · ')}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Pagamentos e canais" subtitle="Distribuição dos pedidos por status financeiro." icon={CircleDollarSign} accent="#34d399">
          <div style={{ display: 'grid', gap: 10 }}>
            {paymentBreakdown.length ? paymentBreakdown.map((item) => (
              <div key={item.paymentStatus} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 14, background: 'rgba(39,39,42,0.68)', border: '1px solid rgba(63,63,70,0.8)' }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)', fontSize: 11, fontWeight: 700 }}>
                  {paymentLabel(item.paymentStatus)}
                </span>
                <strong>{number.format(item.count)}</strong>
              </div>
            )) : (
              <Empty text="Sem dados de pagamento para mostrar." />
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Pedidos por tipo</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <Row label="Delivery" value={number.format(orderTypeBreakdown.delivery || 0)} />
              <Row label="Encomendas" value={number.format(orderTypeBreakdown.order || 0)} />
              <Row label="Mensagens hoje" value={number.format(metrics.messagesTodayCount || 0)} />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value, star = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
      <span style={{ color: '#a1a1aa' }}>{label}</span>
      <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {star ? <Star size={14} fill="#f59e0b" color="#f59e0b" /> : null}
        {value}
      </strong>
    </div>
  );
}

function Badge({ text, tone = 'blue' }) {
  const palette = {
    blue: { bg: 'rgba(59,130,246,0.12)', fg: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
    green: { bg: 'rgba(16,185,129,0.12)', fg: '#34d399', border: 'rgba(16,185,129,0.2)' },
  }[tone];

  return (
    <span style={{ padding: '3px 8px', borderRadius: 999, background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}`, fontSize: 11, fontWeight: 700 }}>
      {text}
    </span>
  );
}
