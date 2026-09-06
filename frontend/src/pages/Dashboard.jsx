import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  DollarSign,
  ExternalLink,
  Package,
  RefreshCw,
  ShieldAlert,
  ShoppingBag,
  Star,
  Store,
  TrendingUp,
  Truck,
  Zap,
  CircleAlert,
  Layers3,
} from 'lucide-react';
import { api, PUBLIC_SITE_URL } from '../api';
import { useNavigate } from 'react-router-dom';

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const integer = new Intl.NumberFormat('pt-BR');

const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const safeText = (value, fallback = '—') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const toBrazilDate = (value) => {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const toShortDateTime = (value) => {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const severityTone = (count, total) => {
  if (!total) return { fill: 'rgba(93, 183, 44, 0.12)', bar: 'var(--accent-primary)', text: 'var(--accent-primary)' };
  const ratio = count / total;
  if (ratio >= 0.7) return { fill: 'rgba(34, 197, 94, 0.12)', bar: '#16a34a', text: '#16a34a' };
  if (ratio >= 0.4) return { fill: 'rgba(245, 158, 11, 0.12)', bar: '#f59e0b', text: '#b45309' };
  return { fill: 'rgba(239, 68, 68, 0.12)', bar: '#ef4444', text: '#dc2626' };
};

const Card = ({ children, style = {}, className = '', ...rest }) => (
  <section
    className={`card ${className}`.trim()}
    style={{
      backgroundColor: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '24px',
      boxShadow: 'var(--card-shadow)',
      ...style,
    }}
    {...rest}
  >
    {children}
  </section>
);

const Badge = ({ tone = 'neutral', children, icon: Icon }) => {
  const palette = {
    neutral: { background: 'rgba(15, 23, 42, 0.05)', color: 'var(--text-secondary)', border: 'rgba(15, 23, 42, 0.06)' },
    success: { background: 'rgba(93, 183, 44, 0.12)', color: '#2e7d15', border: 'rgba(93, 183, 44, 0.18)' },
    info: { background: 'rgba(59, 130, 246, 0.10)', color: '#2563eb', border: 'rgba(59, 130, 246, 0.16)' },
    warning: { background: 'rgba(245, 158, 11, 0.12)', color: '#b45309', border: 'rgba(245, 158, 11, 0.18)' },
    danger: { background: 'rgba(239, 68, 68, 0.10)', color: '#dc2626', border: 'rgba(239, 68, 68, 0.16)' },
  };
  const toneStyle = palette[tone] || palette.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '999px',
        backgroundColor: toneStyle.background,
        color: toneStyle.color,
        border: `1px solid ${toneStyle.border}`,
        fontSize: '12px',
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {Icon ? <Icon size={14} /> : null}
      {children}
    </span>
  );
};

const SectionHeader = ({ eyebrow, title, description, actions }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '16px',
      marginBottom: '18px',
      flexWrap: 'wrap',
    }}
  >
    <div>
      {eyebrow ? (
        <div
          style={{
            fontSize: '12px',
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: 'var(--accent-primary)',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '22px', lineHeight: 1.1, color: 'var(--text-primary)', marginBottom: description ? '6px' : 0 }}>
        {title}
      </h2>
      {description ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, maxWidth: '760px' }}>
          {description}
        </p>
      ) : null}
    </div>
    {actions ? <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div> : null}
  </div>
);

const MetricCard = ({ icon: Icon, label, value, caption, tone = 'accent' }) => {
  const iconStyles = {
    accent: { backgroundColor: 'rgba(93, 183, 44, 0.12)', color: 'var(--accent-primary)' },
    blue: { backgroundColor: 'rgba(59, 130, 246, 0.12)', color: '#2563eb' },
    amber: { backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#d97706' },
    red: { backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#dc2626' },
    violet: { backgroundColor: 'rgba(139, 92, 246, 0.12)', color: '#7c3aed' },
  };
  const tint = iconStyles[tone] || iconStyles.accent;
  return (
    <Card style={{ padding: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <span
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '14px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tint.backgroundColor,
                color: tint.color,
              }}
            >
              <Icon size={20} />
            </span>
            <div>
              <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 800 }}>
                {label}
              </div>
            </div>
          </div>
          <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '30px', lineHeight: 1, color: 'var(--text-primary)', fontWeight: 800 }}>
            {value}
          </div>
          {caption ? (
            <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {caption}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};

const EmptyState = ({ icon: Icon = CircleAlert, title, text }) => (
  <div
    style={{
      padding: '24px',
      borderRadius: '18px',
      border: '1px dashed var(--border-color)',
      backgroundColor: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
    }}
  >
    <div
      style={{
        width: '40px',
        height: '40px',
        borderRadius: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(93, 183, 44, 0.10)',
        color: 'var(--accent-primary)',
        flexShrink: 0,
      }}
    >
      <Icon size={18} />
    </div>
    <div>
      <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>{title}</div>
      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</div>
    </div>
  </div>
);

const ProgressLine = ({ value, max, tone = 'accent', label }) => {
  const width = max > 0 ? Math.max(8, Math.min(100, (value / max) * 100)) : 8;
  const toneMap = {
    accent: 'var(--accent-primary)',
    blue: '#2563eb',
    amber: '#f59e0b',
    red: '#ef4444',
  };
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{integer.format(value)}</span>
      </div>
      <div style={{ height: '10px', borderRadius: '999px', backgroundColor: 'var(--bg-primary)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        <div
          style={{
            width: `${width}%`,
            height: '100%',
            borderRadius: '999px',
            background: `linear-gradient(90deg, ${toneMap[tone]}, rgba(93, 183, 44, 0.55))`,
          }}
        />
      </div>
    </div>
  );
};

const SkeletonBlock = ({ height = 18, width = '100%', radius = 12 }) => (
  <div
    style={{
      height,
      width,
      borderRadius: radius,
      background: 'linear-gradient(90deg, rgba(148,163,184,0.10), rgba(148,163,184,0.18), rgba(148,163,184,0.10))',
      backgroundSize: '200% 100%',
      animation: 'dashboard-shimmer 1.4s ease-in-out infinite',
    }}
  />
);

const DashboardSkeleton = () => (
  <div style={{ padding: '28px', display: 'grid', gap: '24px' }}>
    <Card style={{ padding: '28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '280px' }}>
          <SkeletonBlock width="160px" />
          <div style={{ height: '14px' }} />
          <SkeletonBlock width="340px" height={28} />
          <div style={{ height: '10px' }} />
          <SkeletonBlock width="500px" height={16} />
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <SkeletonBlock width="140px" height={34} />
          <SkeletonBlock width="110px" height={34} />
        </div>
      </div>
    </Card>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '18px' }}>
      {[...Array(4)].map((_, index) => (
        <Card key={index} style={{ padding: '22px' }}>
          <SkeletonBlock width="80px" />
          <div style={{ height: '12px' }} />
          <SkeletonBlock width="120px" height={34} />
          <div style={{ height: '12px' }} />
          <SkeletonBlock width="180px" />
        </Card>
      ))}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
      <Card style={{ padding: '24px' }}>
        <SkeletonBlock width="180px" />
        <div style={{ height: '18px' }} />
        <SkeletonBlock height={220} radius={18} />
      </Card>
      <Card style={{ padding: '24px' }}>
        <SkeletonBlock width="160px" />
        <div style={{ height: '16px' }} />
        <SkeletonBlock height={220} radius={18} />
      </Card>
    </div>
  </div>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);

  const loadSummary = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const { data } = await api.get('/dashboard/summary');
      setSummary(data || {});
    } catch (err) {
      console.error('[Dashboard] summary error:', err);
      setError(err?.response?.data?.error || 'Falha ao carregar o resumo do painel.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const store = summary?.store || {};
  const metrics = summary?.metrics || {};
  const charts = summary?.charts || {};
  const lists = summary?.lists || {};

  const ordersByDay = Array.isArray(charts.ordersByDay) ? charts.ordersByDay : [];
  const topProducts = Array.isArray(lists.topProducts) ? lists.topProducts : [];
  const recentOrders = Array.isArray(lists.recentOrders) ? lists.recentOrders : [];
  const lowStockItems = Array.isArray(lists.lowStockItems) ? lists.lowStockItems : [];
  const upcomingOrders = Array.isArray(lists.upcomingOrders) ? lists.upcomingOrders : [];
  const recentReviews = Array.isArray(lists.recentReviews) ? lists.recentReviews : [];
  const categoryStats = Array.isArray(lists.categoryProductStats) ? lists.categoryProductStats : [];
  const configIssues = Array.isArray(lists.configIssues) ? lists.configIssues : [];
  const instances = Array.isArray(lists.instances) ? lists.instances : [];
  const slotsByDay = Array.isArray(lists.slotsByDay) ? lists.slotsByDay : [];

  const getIssueRoute = (issue) => {
    const text = String(issue || '').toLowerCase();
    if (text.includes('logo')) return '/site-settings';
    if (text.includes('produto')) return '/estoque';
    if (text.includes('raio')) return '/settings#delivery';
    if (text.includes('hor')) return '/settings#schedules';
    return '/settings';
  };

  const highestDay = useMemo(
    () => Math.max(...ordersByDay.map((item) => safeNumber(item.count)), 1),
    [ordersByDay],
  );

  const openStoreUrl = store.slug ? `${PUBLIC_SITE_URL}/${store.slug}` : '';
  const storeStatus = String(store.acceptOrders ? 'opened' : 'closed');
  const deliveryMode = String(store.deliveryMode || '').toLowerCase();
  const orderTypeBreakdown = charts.orderTypeBreakdown || {};
  const statusBreakdown = Array.isArray(charts.statusBreakdown) ? charts.statusBreakdown : [];
  const paymentBreakdown = Array.isArray(charts.paymentBreakdown) ? charts.paymentBreakdown : [];
  const totalOrderTypes = Math.max(1, Object.values(orderTypeBreakdown).reduce((sum, item) => sum + safeNumber(item), 0));
  const totalPayments = Math.max(1, paymentBreakdown.reduce((sum, item) => sum + safeNumber(item.count), 0));
  const avgRating = safeNumber(metrics.reviewsAverage || 0);

  const actions = (
    <>
      {store.acceptOrders ? (
        <Badge tone="success" icon={CheckCircle2}>Aberto para pedidos</Badge>
      ) : (
        <Badge tone="danger" icon={AlertTriangle}>Fechado para pedidos</Badge>
      )}
      {store.prepTime ? <Badge tone="info" icon={Clock3}>Entrega {store.prepTime}min</Badge> : null}
      <button
        type="button"
        onClick={() => loadSummary({ silent: true })}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderRadius: '14px',
          border: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        Atualizar
      </button>
      {openStoreUrl ? (
        <a
          href={openStoreUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: '14px',
            border: '1px solid rgba(93, 183, 44, 0.18)',
            backgroundColor: 'rgba(93, 183, 44, 0.08)',
            color: 'var(--accent-primary)',
            textDecoration: 'none',
            fontWeight: 800,
          }}
        >
          Abrir cardápio
          <ExternalLink size={16} />
        </a>
      ) : null}
    </>
  );

  if (loading) return <DashboardSkeleton />;

  const metricCards = [
    {
      label: 'Pedidos Hoje',
      value: integer.format(safeNumber(metrics.ordersTodayCount)),
      caption: `${integer.format(safeNumber(metrics.pendingOrdersCount))} aguardando preparo`,
      icon: ShoppingBag,
      tone: 'blue',
    },
    {
      label: 'Faturamento Hoje',
      value: money.format(safeNumber(metrics.completedOrdersTodayValue)),
      caption: 'Somente pedidos concluídos',
      icon: DollarSign,
      tone: 'accent',
    },
    {
      label: 'Ticket Médio',
      value: money.format(safeNumber(metrics.averageTicketToday)),
      caption: 'Média de gasto por pedido',
      icon: TrendingUp,
      tone: 'violet',
    },
    {
      label: 'Estoque Crítico',
      value: integer.format(safeNumber(metrics.lowStockCount)),
      caption: 'Itens abaixo do mínimo',
      icon: Package,
      tone: 'red',
    },
    {
      label: 'Instâncias Conectadas',
      value: integer.format(safeNumber(metrics.connectedInstancesCount)),
      caption: `${integer.format(safeNumber(metrics.instancesCount))} conexões cadastradas`,
      icon: Zap,
      tone: 'amber',
    },
    {
      label: 'Fluxos Ativos',
      value: integer.format(safeNumber(metrics.activeFlowsCount)),
      caption: `${integer.format(safeNumber(metrics.flowsCount))} fluxos no total`,
      icon: Layers3,
      tone: 'blue',
    },
  ];

  const openSlots = slotsByDay.reduce((sum, item) => sum + safeNumber(item.count), 0);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f6f8f3',
        color: '#0f172a',
        '--bg-primary': '#f6f8f3',
        '--bg-secondary': '#ffffff',
        '--bg-tertiary': '#eef5ea',
        '--text-primary': '#0f172a',
        '--text-secondary': '#475569',
        '--text-muted': '#64748b',
        '--border-color': '#d9e5d2',
        '--accent-primary': '#5db72c',
        '--accent-glow': 'rgba(93, 183, 44, 0.14)',
        '--card-shadow': '0 12px 30px rgba(15, 23, 42, 0.06)',
        '--bg-gray': '#eef5ea',
        '--text-black': '#0f172a',
        '--text-gray': '#64748b',
        '--btn-bg': '#5db72c',
        '--btn-text': '#ffffff',
      }}
    >
      <style>{`
        @keyframes dashboard-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <div style={{ padding: '28px', maxWidth: '1680px', margin: '0 auto' }}>
        <Card style={{ padding: '28px', marginBottom: '22px', background: 'linear-gradient(180deg, #ffffff 0%, #fbfdf8 100%)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ maxWidth: '920px' }}>
              <Badge tone={storeStatus === 'opened' ? 'success' : 'danger'} icon={storeStatus === 'opened' ? CheckCircle2 : ShieldAlert}>
                {storeStatus === 'opened' ? 'Operação estável' : 'Operação com restrições'}
              </Badge>
              <div style={{ height: '14px' }} />
              <h1 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '34px', lineHeight: 1.05, letterSpacing: '-0.04em', marginBottom: '8px', color: 'var(--text-primary)' }}>
                Resumo Diário
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: 1.7, maxWidth: '760px' }}>
                Métricas reais da operação, catálogo e atendimento em um painel mais limpo, leve e objetivo.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '18px' }}>
                <Badge tone={store.acceptOrders ? 'success' : 'danger'} icon={store.acceptOrders ? CheckCircle2 : AlertTriangle}>
                  {store.acceptOrders ? 'Aceitando pedidos' : 'Pedidos pausados'}
                </Badge>
                <Badge tone="info" icon={Truck}>
                  {deliveryMode === 'delivery'
                    ? 'Delivery ativo'
                    : deliveryMode === 'pickup'
                      ? 'Retirada na loja'
                      : deliveryMode === 'local'
                        ? 'Consumo no local'
                        : 'Entrega + retirada'}
                </Badge>
                <Badge tone="neutral" icon={Clock3}>
                  Tempo de preparo: {store.prepTime ? `${store.prepTime} min` : 'não informado'}
                </Badge>
                <Badge tone="neutral" icon={Store}>
                  {safeText(store.category, 'Categoria não informada')}
                </Badge>
                <Badge tone="neutral" icon={ExternalLink}>
                  {safeText(store.slug, 'slug não configurado')}
                </Badge>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '320px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '10px' }}>
                {actions}
              </div>
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: '20px',
                  border: '1px solid var(--border-color)',
                  background: 'linear-gradient(135deg, rgba(93,183,44,0.08), rgba(59,130,246,0.04))',
                }}
              >
                <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 800, marginBottom: '8px' }}>
                  Restaurante
                </div>
                <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {safeText(store.name, 'Menzzu')}
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {safeText(store.address, 'Endereço não informado')}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {error ? (
          <div style={{ marginBottom: '18px' }}>
            <Card style={{ padding: '18px 20px', backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.16)' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', color: '#b91c1c', fontWeight: 700 }}>
                <AlertTriangle size={18} />
                {error}
              </div>
            </Card>
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '18px',
            marginBottom: '22px',
          }}
        >
          {metricCards.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '22px' }}>
          <Card style={{ padding: '24px' }}>
            <SectionHeader
              eyebrow="Movimento"
              title="Pedidos por dia"
              description="Resumo dos últimos dias com volume de pedidos e faturamento por período."
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '14px', alignItems: 'end' }}>
              {ordersByDay.map((day) => {
                const tone = severityTone(safeNumber(day.count), highestDay);
                const height = Math.max(36, Math.round((safeNumber(day.count) / highestDay) * 190));
                return (
                  <div
                    key={day.date || day.label}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 700 }}>{day.label}</div>
                    <div
                      style={{
                        width: '100%',
                        minHeight: '220px',
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        borderRadius: '18px',
                        border: '1px solid var(--border-color)',
                        background: 'linear-gradient(180deg, rgba(93,183,44,0.05), rgba(255,255,255,0.6))',
                        padding: '14px 12px',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          height,
                          minHeight: '16px',
                          borderRadius: '999px 999px 12px 12px',
                          background: `linear-gradient(180deg, ${tone.bar}, rgba(93,183,44,0.45))`,
                          boxShadow: `0 12px 22px ${tone.fill}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 800,
                        }}
                      >
                        {safeNumber(day.count) > 0 ? integer.format(safeNumber(day.count)) : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 800 }}>{money.format(safeNumber(day.total))}</div>
                    </div>
                  </div>
                );
              })}
              {!ordersByDay.length ? <div style={{ gridColumn: '1 / -1' }}><EmptyState title="Sem pedidos no período." text="Quando houver movimentação, o gráfico aparece aqui com os valores dos últimos dias." /></div> : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '22px' }}>
              <div style={{ padding: '18px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: '8px' }}>
                  Tipos de pedido
                </div>
                <div style={{ display: 'grid', gap: '12px' }}>
                  <ProgressLine label="Delivery" value={safeNumber(orderTypeBreakdown.delivery)} max={totalOrderTypes} tone="accent" />
                  <ProgressLine label="Encomenda" value={safeNumber(orderTypeBreakdown.order)} max={totalOrderTypes} tone="blue" />
                </div>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: '8px' }}>
                  Pagamentos
                </div>
                <div style={{ display: 'grid', gap: '12px' }}>
                  {paymentBreakdown.map((item) => (
                    <ProgressLine
                      key={item.status}
                      label={safeText(item.status)}
                      value={safeNumber(item.count)}
                      max={totalPayments}
                      tone={String(item.status || '').toLowerCase() === 'paid' ? 'accent' : String(item.status || '').toLowerCase() === 'confirmed' ? 'blue' : 'amber'}
                    />
                  ))}
                  {!paymentBreakdown.length ? <EmptyState title="Sem pagamentos no período." text="As formas de pagamento utilizadas aparecem aqui quando houver pedidos." /> : null}
                </div>
              </div>
            </div>
          </Card>

          <Card style={{ padding: '24px' }}>
            <SectionHeader
              eyebrow="Operação"
              title="Parâmetros da loja"
              description="Resumo do que está configurado para esse cardápio público."
            />
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ padding: '18px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '14px', backgroundColor: 'rgba(93,183,44,0.10)', color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Store size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{safeText(store.name, 'Menzzu')}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{safeText(store.category, 'Categoria não informada')}</div>
                  </div>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{safeText(store.address, 'Endereço não informado')}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Tempo de preparo</div>
                  <div style={{ marginTop: '8px', fontFamily: 'Outfit, sans-serif', fontSize: '24px', color: 'var(--text-primary)', fontWeight: 800 }}>
                    {store.prepTime ? `${store.prepTime} min` : '—'}
                  </div>
                </div>
                <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Horários</div>
                  <div style={{ marginTop: '8px', fontFamily: 'Outfit, sans-serif', fontSize: '24px', color: 'var(--text-primary)', fontWeight: 800 }}>{integer.format(openSlots)}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>slots ativos</div>
                </div>
              </div>

              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Cobertura</span>
                  <span style={{ fontWeight: 800, color: 'var(--accent-primary)' }}>
                    {safeNumber(metrics.deliveryCapableProducts)} itens
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Produtos</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>{integer.format(safeNumber(metrics.productsCount))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Categorias</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>{integer.format(safeNumber(metrics.categoriesCount))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Avaliação</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {avgRating > 0 ? avgRating.toFixed(1).replace('.', ',') : '5,0'}
                    </div>
                  </div>
                </div>
              </div>

              {configIssues.length ? (
                <div style={{ padding: '18px', borderRadius: '18px', border: '1px solid rgba(239,68,68,0.14)', backgroundColor: 'rgba(239,68,68,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', color: '#b91c1c', fontWeight: 800 }}>
                    <ShieldAlert size={18} />
                    Pontos de atenção
                  </div>
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {configIssues.slice(0, 5).map((issue) => (
                      <button type="button" key={issue} onClick={() => navigate(getIssueRoute(issue))} aria-label={`Abrir configuração: ${issue}`} title="Abrir configuração" style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: 0, border: 0, background: 'transparent', color: 'var(--text-primary)', fontSize: '14px', lineHeight: 1.5, textAlign: 'left', cursor: 'pointer' }}>
                        <CircleAlert size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{issue}</span>
                        <ExternalLink size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState title="Tudo certo por aqui." text="Não há alertas de configuração no momento." />
              )}
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: '20px', marginBottom: '22px' }}>
          <Card style={{ padding: '24px' }}>
            <SectionHeader
              eyebrow="Atividade"
              title="Pedidos recentes"
              description="Últimos pedidos processados com status, cliente e valor."
            />
            <div style={{ display: 'grid', gap: '12px' }}>
              {recentOrders.length ? recentOrders.slice(0, 6).map((order) => (
                <div
                  key={order.id}
                  style={{
                    padding: '16px',
                    borderRadius: '18px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '14px',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{safeText(order.product, 'Produto')}</div>
                      <Badge tone={String(order.type || '').toLowerCase() === 'delivery' ? 'accent' : 'info'}>
                        {String(order.type || '').toLowerCase() === 'delivery' ? 'Delivery' : 'Encomenda'}
                      </Badge>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '5px' }}>
                      {safeText(order.clientName, 'Cliente')} · {order.variation ? order.variation : 'Sem variação'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                      {toShortDateTime(order.createdAt)} · {safeText(order.status)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {money.format(safeNumber(order.totalValue))}
                    </div>
                    {safeNumber(order.deliveryFee) > 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Frete {money.format(safeNumber(order.deliveryFee))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )) : <EmptyState title="Sem pedidos recentes." text="Quando houver novos pedidos, eles aparecem neste bloco." />}
            </div>
          </Card>

          <Card style={{ padding: '24px' }}>
            <SectionHeader
              eyebrow="Catálogo"
              title="Produtos em destaque"
              description="Itens mais vendidos, com indicação de promoção e variação de preço quando existir."
            />
            <div style={{ display: 'grid', gap: '12px' }}>
              {topProducts.length ? topProducts.slice(0, 6).map((product, index) => {
                const hasPromo = product.promoPrice !== null && product.promoPrice !== undefined && safeNumber(product.promoPrice) > 0;
                return (
                  <div key={product.id} style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ width: '28px', height: '28px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(93,183,44,0.10)', color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 800 }}>
                            {integer.format(index + 1)}
                          </span>
                          <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{safeText(product.name, 'Produto')}</div>
                          {product.featured ? <Badge tone="info">Destaque</Badge> : null}
                          {product.promotion ? <Badge tone="success">Promoção</Badge> : null}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.5 }}>
                          {integer.format(safeNumber(product.count))} vendas · {money.format(safeNumber(product.totalValue))}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {hasPromo ? (
                          <>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'line-through' }}>
                              {money.format(safeNumber(product.price))}
                            </div>
                            <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                              {money.format(safeNumber(product.promoPrice))}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {money.format(safeNumber(product.price))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }) : <EmptyState title="Nenhum destaque cadastrado." text="Os produtos mais vendidos e destacados vão aparecer aqui." />}
            </div>
          </Card>

          <Card style={{ padding: '24px' }}>
            <SectionHeader
              eyebrow="Controle"
              title="Estoque e agenda"
              description="Resumo rápido do que precisa de atenção imediata."
            />
            <div style={{ display: 'grid', gap: '14px' }}>
              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Itens com baixo estoque</span>
                  <Badge tone="warning">{integer.format(safeNumber(metrics.lowStockCount))}</Badge>
                </div>
                {lowStockItems.length ? (
                  <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
                    {lowStockItems.slice(0, 5).map((item) => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{safeText(item.name, 'Item')}</div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            {integer.format(safeNumber(item.quantity))} {safeText(item.unit, 'un')} · mínimo {integer.format(safeNumber(item.minQuantity))}
                          </div>
                        </div>
                        <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '18px', fontWeight: 800, color: safeNumber(item.quantity) <= safeNumber(item.minQuantity) ? '#dc2626' : 'var(--accent-primary)' }}>
                          {integer.format(safeNumber(item.quantity))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ marginTop: '12px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
                    Nenhum item em nível crítico no momento.
                  </p>
                )}
              </div>

              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Próximas encomendas</span>
                  <Badge tone="info">{integer.format(safeNumber(upcomingOrders.length))}</Badge>
                </div>
                {upcomingOrders.length ? (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {upcomingOrders.slice(0, 4).map((order) => (
                      <div key={order.id} style={{ padding: '12px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                          <div>
                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{safeText(order.product, 'Produto')}</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{safeText(order.clientName, 'Cliente')}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{safeText(order.scheduledTime, '—')}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{toBrazilDate(order.scheduledDate)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ marginTop: '12px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
                    Nenhuma encomenda agendada no período.
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          <Card style={{ padding: '24px' }}>
            <SectionHeader eyebrow="Mix" title="Categorias mais usadas" description="Distribuição de produtos por categoria no catálogo." />
            <div style={{ display: 'grid', gap: '12px' }}>
              {categoryStats.length ? categoryStats.slice(0, 6).map((category, index) => (
                <div key={category.id || category.name} style={{ padding: '14px', borderRadius: '16px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={{ width: '30px', height: '30px', borderRadius: '10px', backgroundColor: 'rgba(93,183,44,0.10)', color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800 }}>
                        {integer.format(index + 1)}
                      </span>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{safeText(category.name, 'Categoria')}</span>
                    </div>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 800 }}>{integer.format(safeNumber(category.total))}</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '999px', backgroundColor: 'var(--bg-secondary)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <div style={{ width: `${Math.max(8, Math.min(100, (safeNumber(category.total) / Math.max(1, categoryStats[0]?.total || 1)) * 100))}%`, height: '100%', borderRadius: '999px', backgroundColor: index === 0 ? 'var(--accent-primary)' : 'rgba(93,183,44,0.58)' }} />
                  </div>
                </div>
              )) : <EmptyState title="Sem categorias mapeadas." text="As categorias cadastradas aparecem aqui com a quantidade de produtos." />}
            </div>
          </Card>

          <Card style={{ padding: '24px' }}>
            <SectionHeader eyebrow="Avaliação" title="Últimas notas" description="Feedbacks recentes deixados pelos clientes." />
            <div style={{ display: 'grid', gap: '12px' }}>
              {recentReviews.length ? recentReviews.slice(0, 5).map((review) => (
                <div key={review.id} style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{safeText(review.clientName, 'Cliente')}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#d97706', fontWeight: 800 }}>
                      <Star size={14} fill="currentColor" /> {safeNumber(review.rating).toFixed(1).replace('.', ',')}
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {safeText(review.comment, 'Sem comentário')}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    {safeText(review.product, 'Produto')} {review.variation ? `· ${review.variation}` : ''}
                  </div>
                </div>
              )) : <EmptyState title="Sem avaliações recentes." text="Quando clientes avaliarem pedidos, os feedbacks aparecem aqui." />}
            </div>
          </Card>

          <Card style={{ padding: '24px' }}>
            <SectionHeader eyebrow="Conexões" title="Instâncias e disponibilidade" description="Status dos canais e horários configurados." />
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Instâncias</div>
                  <div style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>{integer.format(safeNumber(metrics.connectedInstancesCount))}/{integer.format(safeNumber(metrics.instancesCount))}</div>
                </div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  {instances.length ? instances.slice(0, 4).map((instance) => (
                    <div key={instance.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{safeText(instance.name, 'Instância')}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{safeText(instance.status, '—')}</div>
                      </div>
                      <Badge tone={String(instance.status || '').toLowerCase() === 'connected' ? 'success' : 'danger'}>
                        {String(instance.status || '').toLowerCase() === 'connected' ? 'Conectada' : 'Pendente'}
                      </Badge>
                    </div>
                  )) : <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Nenhuma instância cadastrada.</div>}
                </div>
              </div>

              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Horários ativos</div>
                  <Badge tone="neutral">{integer.format(openSlots)}</Badge>
                </div>
                {slotsByDay.length ? (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {slotsByDay.slice(0, 5).map((slot) => (
                      <div key={slot.dayOfWeek} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px' }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{safeText(slot.dayOfWeek)}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{integer.format(safeNumber(slot.count))} faixas · capacidade {integer.format(safeNumber(slot.totalCapacity))}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Nenhum horário configurado.</div>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          <Card style={{ padding: '24px' }}>
            <SectionHeader eyebrow="Resumo" title="Pedidos por status" description="Distribuição dos pedidos em andamento e finalizados." />
            <div style={{ display: 'grid', gap: '12px' }}>
              {statusBreakdown.length ? statusBreakdown.map((item) => (
                <div key={item.status} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '14px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{safeText(item.status)}</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 800 }}>{integer.format(safeNumber(item.count))}</span>
                </div>
              )) : <EmptyState title="Sem dados de status." text="Os status dos pedidos aparecerão aqui conforme a operação evolui." />}
            </div>
          </Card>

          <Card style={{ padding: '24px' }}>
            <SectionHeader eyebrow="Maturidade" title="Indicadores gerais" description="Panorama compacto da operação e do catálogo." />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Avaliação média</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', color: '#d97706', fontWeight: 800 }}>
                  <Star size={16} fill="currentColor" />
                  {avgRating > 0 ? avgRating.toFixed(1).replace('.', ',') : '5,0'}
                </div>
              </div>
              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Itens em promoção</div>
                <div style={{ marginTop: '10px', fontFamily: 'Outfit, sans-serif', fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {integer.format(safeNumber(metrics.promotionProductsCount))}
                </div>
              </div>
              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Produtos com variação</div>
                <div style={{ marginTop: '10px', fontFamily: 'Outfit, sans-serif', fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {integer.format(safeNumber(metrics.variationProductsCount))}
                </div>
              </div>
              <div style={{ padding: '16px', borderRadius: '18px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Entrega grátis</div>
                <div style={{ marginTop: '10px', fontFamily: 'Outfit, sans-serif', fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {store.freeDeliveryEnabled ? 'Ativo' : 'Desativado'}
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card style={{ padding: '24px' }}>
          <SectionHeader
            eyebrow="Sugestões"
            title="Atalhos do painel"
            description="Acesso rápido para as partes que você mais usa no dia a dia."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            {[
              { label: 'Gerenciar estoque', icon: Package, href: '/estoque', tone: 'accent' },
              { label: 'Ver agenda', icon: CalendarClock, href: '/agenda', tone: 'blue' },
              { label: 'Ajustar site', icon: Store, href: '/site-settings', tone: 'success' },
              { label: 'Acompanhar automações', icon: Zap, href: '/flows', tone: 'amber' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                style={{
                  textDecoration: 'none',
                  padding: '18px',
                  borderRadius: '18px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  color: 'var(--text-primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <span
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: item.tone === 'blue'
                        ? 'rgba(59,130,246,0.10)'
                        : item.tone === 'success'
                          ? 'rgba(93,183,44,0.10)'
                          : item.tone === 'amber'
                            ? 'rgba(245,158,11,0.10)'
                            : 'rgba(93,183,44,0.10)',
                      color: item.tone === 'blue'
                        ? '#2563eb'
                        : item.tone === 'success'
                          ? 'var(--accent-primary)'
                          : item.tone === 'amber'
                            ? '#d97706'
                            : 'var(--accent-primary)',
                    }}
                  >
                    <item.icon size={18} />
                  </span>
                  <div style={{ fontWeight: 800 }}>{item.label}</div>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-secondary)' }} />
              </a>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
